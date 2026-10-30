import { Router } from 'express';
import { WorkspaceError } from './workspaces.js';
import { WorkspacePageError } from './workspace-pages.js';
import { ValidationError } from './validation.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import { QuotaError } from './quotas.js';

// Mount at /workspaces after JSON parsing. uploader remains accepted for caller
// compatibility; workspace uploads use the per-request quota-aware receiver.
export function createWorkspacePagesRouter({ service, requireUser, uploader, tempFiles, visibility = null, releaseCleanup = null, deletePage = null }) {
  if (!service || typeof requireUser !== 'function' || typeof uploader?.single !== 'function' || typeof tempFiles?.open !== 'function' || typeof tempFiles?.remove !== 'function') throw new TypeError('service, requireUser, uploader and temporary file journal required');
  const platformLimit=uploader.limits?.fileSize;
  if (platformLimit !== undefined && (!Number.isSafeInteger(platformLimit) || platformLimit < 0)) throw new TypeError('Invalid platform upload limit');
  const router = Router(); router.use(requireUser);
  router.use((req, res, next) => typeof req.user?.id === 'string' && req.user.id ? next() : res.status(401).json({ code: 'UNAUTHORIZED' }));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/:workspaceId/pages', (req, res) => res.json({ pages: service.list(req.params.workspaceId, req.user.id).map(page => visibility ? { ...page, ...visibility.get(req.params.workspaceId, req.user.id, page.id) } : page) }));
  if (visibility) router.patch('/:workspaceId/pages/:pageId/visibility', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'visibility')) throw new ValidationError('Invalid visibility.');
    return res.json(visibility.set(req.params.workspaceId, req.user.id, req.params.pageId, req.body.visibility));
  });
  router.get('/:workspaceId/pages/:pageId', (req, res) => res.json({ page: service.get(req.params.workspaceId, req.user.id, req.params.pageId) }));
  router.get('/:workspaceId/pages/:pageId/releases', (req, res) => res.json({ releases: service.listReleases(req.params.workspaceId, req.user.id, req.params.pageId) }));
  if (releaseCleanup) router.delete('/:workspaceId/pages/:pageId/releases/:releaseId', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'revision')) throw new ValidationError('Invalid revision.');
    service.authorize(req.params.workspaceId,req.user.id,'edit');
    service.get(req.params.workspaceId,req.user.id,req.params.pageId);
    if (!req.maintenance) return res.status(503).json({code:'MAINTENANCE_UNAVAILABLE'});
    const result=await req.maintenance.runExclusive(()=>releaseCleanup.remove(req.params.workspaceId, req.user.id, req.params.pageId, req.params.releaseId, req.body.revision));
    return res.json(result);
  });
  const upload = (req,res,next) => {
    const header=req.headers['content-length'];
    if (header !== undefined && (!/^(0|[1-9]\d*)$/.test(header) || !Number.isSafeInteger(Number(header)))) return next(new ValidationError('Invalid content length.'));
    const contentLength=header === undefined ? undefined : Number(header);
    // Keep storage work counted even if the client disconnects before staging,
    // reservation release and temporary-file cleanup have all completed.
    req.releaseUploadLease=req.maintenance?.retain() || (()=>{});
    const receiver={
      _handleFile(request,file,callback) {
        let reservation;
        try { reservation=service.beginUpload(request.params.workspaceId,request.user.id,file.originalname,contentLength,request.params.pageId,request.uploadGuard,request.uploadSource); request.quotaReservation=reservation; }
        catch (e) { callback(e); return; }
        let temp;
        try { temp=tempFiles.open(crypto.randomUUID()); }
        catch(e) { callback(e); return; }
        let size=0;
        const cap=Math.min(reservation.rawLimit, platformLimit ?? Infinity, reservation.type === 'zip' ? reservation.rawLimit : reservation.bytes);
        const guard=new Transform({transform(chunk,_encoding,done){ size+=chunk.length; done(size>cap ? new multer.MulterError('LIMIT_FILE_SIZE') : null,chunk); }});
        const abort=()=>file.stream.destroy(new Error('Upload aborted'));
        request.once('aborted',abort);
        let output;
        try { output=fs.createWriteStream(temp.path,{fd:temp.fd,autoClose:true}); }
        catch(error) { request.off('aborted',abort);fs.closeSync(temp.fd);try{tempFiles.remove(temp.id);}catch{}callback(error);return; }
        request.uploadSettled=pipeline(file.stream,guard,output).then(()=>{
          request.off('aborted',abort); callback(null,{path:temp.path,tempId:temp.id,size});
        },async error=>{
          request.off('aborted',abort); try { tempFiles.remove(temp.id); } catch {} callback(error);
        });
      },
      _removeFile(_req,file,callback) { try {tempFiles.remove(file.tempId);callback(null);} catch(error){callback(error);} }
    };
    try {
      multer({storage:receiver,limits:{files:1,fields:20,parts:21,fieldSize:64*1024}}).single('file')(req,res,async error=>{
        if (!error) return next();
        try {
          // Multer may report an aborted request before its storage engine closes.
          if (req.uploadSettled) await req.uploadSettled;
          service.cancelUpload(req.quotaReservation);
          next(error);
        } catch (cleanup) { next(cleanup); }
        finally { req.releaseUploadLease(); }
      });
    } catch (error) { req.releaseUploadLease(); next(error); }
  };
  router.post('/:workspaceId/pages', (req, _res, next) => { service.authorize(req.params.workspaceId, req.user.id, 'edit'); next(); }, upload, async (req, res) => {
    let page;
    try { page = await service.create(req.params.workspaceId, req.user.id, req.file, req.body, req.quotaReservation); }
    finally { try { if (req.file?.tempId) { if (page) { try { tempFiles.remove(req.file.tempId); } catch { /* Startup recovery retains the journal. */ } } else tempFiles.remove(req.file.tempId); } } finally { try { service.cancelUpload(req.quotaReservation); } finally { req.releaseUploadLease(); } } }
    res.status(201).json({ page });
  });
  router.post('/:workspaceId/pages/:pageId/replace', (req, _res, next) => { service.authorize(req.params.workspaceId, req.user.id, 'edit'); next(); }, upload, async (req, res) => {
    let page;
    try { page = await service.replace(req.params.workspaceId, req.user.id, req.params.pageId, req.file, req.body, req.quotaReservation); }
    finally { try { if (req.file?.tempId) { if (page) { try { tempFiles.remove(req.file.tempId); } catch { /* Startup recovery retains the journal. */ } } else tempFiles.remove(req.file.tempId); } } finally { try { service.cancelUpload(req.quotaReservation); } finally { req.releaseUploadLease(); } } }
    res.json({ page });
  });
  router.post('/:workspaceId/pages/:pageId/releases/:releaseId/activate', (req, res) => res.json({ page: service.activate(req.params.workspaceId, req.user.id, req.params.pageId, req.params.releaseId, req.body?.revision) }));
  router.patch('/:workspaceId/pages/:pageId', (req, res) => res.json({ page: service.update(req.params.workspaceId, req.user.id, req.params.pageId, req.body) }));
  router.delete('/:workspaceId/pages/:pageId', async (req, res) => {
    if (deletePage) {
      service.authorize(req.params.workspaceId,req.user.id,'manage');
      service.get(req.params.workspaceId,req.user.id,req.params.pageId);
      if (!req.maintenance?.runExclusive) throw new Error('Maintenance gate required');
      await req.maintenance.runExclusive(() => deletePage(req.params.workspaceId, req.user.id, req.params.pageId));
      return res.sendStatus(204);
    }
    const release=req.maintenance?.retain() || (()=>{}); try { await service.delete(req.params.workspaceId, req.user.id, req.params.pageId); res.sendStatus(204); } finally { release(); }
  });
  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof WorkspaceError || err instanceof WorkspacePageError) {
      const status = { INVALID: 400, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, HISTORY_LIMIT: 409 }[err.code] || 500;
      return res.status(status).json({ code: err.code });
    }
    if (err instanceof QuotaError) return res.status(({QUOTA_EXCEEDED:409,UPLOAD_TOO_LARGE:413,EXPIRED:409,NOT_FOUND:404,INVALID:400})[err.code] || 500).json({code:err.code,...(err.code==='QUOTA_EXCEEDED' && ['apps','storage'].includes(err.reason) ? {reason:err.reason} : {})});
    if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({code:'UPLOAD_TOO_LARGE'});
    if (err instanceof ValidationError && err.code === 'ENTRY_SELECTION_REQUIRED') return res.status(400).json({code:err.code,candidates:err.candidates});
    if (err instanceof ValidationError && ['ENTRY_NOT_FOUND','ENTRY_TOO_MANY','ZIP_TOO_MANY_ENTRIES','ZIP_UNSUPPORTED'].includes(err.code)) return res.status(400).json({code:err.code});
    if (err instanceof ValidationError || err.name === 'MulterError') return res.status(400).json({ code: 'INVALID' });
    return res.status(500).json({ code: 'INTERNAL_ERROR' });
  });
  return router;
}
