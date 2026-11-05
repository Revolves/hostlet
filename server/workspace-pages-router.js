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
export function createWorkspacePagesRouter({ service, requireUser, uploader, tempFiles, visibility = null, releaseCleanup = null, deletePage = null, receiptFactory = null }) {
  if (!service || typeof requireUser !== 'function' || typeof uploader?.single !== 'function' || typeof tempFiles?.open !== 'function' || typeof tempFiles?.remove !== 'function') throw new TypeError('service, requireUser, uploader and temporary file journal required');
  const platformLimit=uploader.limits?.fileSize;
  if (platformLimit !== undefined && (!Number.isSafeInteger(platformLimit) || platformLimit < 0)) throw new TypeError('Invalid platform upload limit');
  const router = Router(); router.use(requireUser);
  let replayActive=0;
  router.use((req, res, next) => typeof req.user?.id === 'string' && req.user.id ? next() : res.status(401).json({ code: 'UNAUTHORIZED' }));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/:workspaceId/pages', (req, res) => res.json({ pages: service.list(req.params.workspaceId, req.user.id).map(page => visibility ? { ...page, ...visibility.get(req.params.workspaceId, req.user.id, page.id) } : page) }));
  if (visibility) router.patch('/:workspaceId/pages/:pageId/visibility', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'visibility')) throw new ValidationError('Invalid visibility.');
    return res.json(visibility.set(req.params.workspaceId, req.user.id, req.params.pageId, req.body.visibility));
  });
  if (visibility) router.post('/:workspaceId/pages/:pageId/publication-review', (req,res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new ValidationError('Invalid request.');
    return res.json(visibility.submitReview(req.params.workspaceId,req.user.id,req.params.pageId));
  });
  if (visibility) router.post('/:workspaceId/pages/:pageId/publication-review/decision', (req,res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(k=>!['decision','comment'].includes(k))) throw new ValidationError('Invalid decision.');
    return res.json(visibility.decideReview(req.params.workspaceId,req.user.id,req.params.pageId,req.body.decision,req.body.comment));
  });
  router.get('/:workspaceId/pages/:pageId', (req, res) => res.json({ page: service.get(req.params.workspaceId, req.user.id, req.params.pageId) }));
  router.get('/:workspaceId/pages/:pageId/releases', (req, res) => res.json({ releases: service.listReleases(req.params.workspaceId, req.user.id, req.params.pageId) }));
  if (receiptFactory) router.get('/:workspaceId/publications/:requestId', (req,res) => {
    service.authorize(req.params.workspaceId,req.user.id,'view'); req.uploadGuard();
    if (!/^[A-Za-z0-9_-]{22,128}$/.test(req.params.requestId)) throw new ValidationError('Invalid request ID.');
    const result=receiptFactory().status({actor:req.user.id,workspace:req.params.workspaceId,key:req.params.requestId});
    if (result.status==='succeeded') {
      try { const page=service.get(req.params.workspaceId,req.user.id,result.result.page.id); result.current=page.revision===result.result.page.revision && page.releaseId===result.result.page.releaseId ? 'unchanged' : 'updated'; }
      catch (error) { if (error instanceof WorkspacePageError && error.code==='NOT_FOUND') result.current='deleted'; else throw error; }
    }
    res.json(result);
  });
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
    if (header !== undefined && (!/^(0|[1-9]\d*)$/.test(header) || !Number.isSafeInteger(Number(header)))) { finishReceipt(req); return next(new ValidationError('Invalid content length.')); }
    const contentLength=header === undefined ? undefined : Number(header);
    // Keep storage work counted even if the client disconnects before staging,
    // reservation release and temporary-file cleanup have all completed.
    try { req.releaseUploadLease=req.maintenance?.retain() || (()=>{}); }
    catch (error) { finishReceipt(req); return next(error); }
    const receiver={
      _handleFile(request,file,callback) {
        let reservation;
        try { if (request.receipt?.replay) reservation={rawLimit:platformLimit,bytes:platformLimit,type:'html'}; else { reservation=service.beginUpload(request.params.workspaceId,request.user.id,file.originalname,contentLength,request.params.pageId,request.uploadGuard,request.uploadSource); request.quotaReservation=reservation; } }
        catch (e) { callback(e); return; }
        let temp;
        const tempId=crypto.randomUUID();
        try { temp=tempFiles.open(tempId); }
        catch(e) { try { request.cleanupFailed=typeof tempFiles.hasResidual!=='function' || tempFiles.hasResidual(tempId); } catch { request.cleanupFailed=true; } if (request.receipt?.replay) e.code='REPLAY_CAPACITY'; callback(e); return; }
        let size=0; const hash=crypto.createHash('sha256');
        const cap=Math.min(reservation.rawLimit, platformLimit ?? Infinity, reservation.type === 'zip' ? reservation.rawLimit : reservation.bytes);
        const guard=new Transform({transform(chunk,_encoding,done){ size+=chunk.length; hash.update(chunk); done(size>cap ? new multer.MulterError('LIMIT_FILE_SIZE') : null,chunk); }});
        const abort=()=>file.stream.destroy(new Error('Upload aborted'));
        request.once('aborted',abort);
        let output;
        try { output=fs.createWriteStream(temp.path,{fd:temp.fd,autoClose:true}); }
        catch(error) { request.off('aborted',abort);fs.closeSync(temp.fd);try{tempFiles.remove(temp.id);}catch{request.cleanupFailed=true;}callback(error);return; }
        request.uploadSettled=pipeline(file.stream,guard,output).then(()=>{
          request.off('aborted',abort); callback(null,{path:temp.path,tempId:temp.id,size,digest:hash.digest('hex')});
        },async error=>{
          request.off('aborted',abort); try { tempFiles.remove(temp.id); } catch { request.cleanupFailed=true; } if (request.receipt?.replay && ['ENOSPC','EDQUOT'].includes(error.code)) error.code='REPLAY_CAPACITY'; callback(error);
        });
      },
      _removeFile(request,file,callback) { try {tempFiles.remove(file.tempId);callback(null);} catch(error){request.cleanupFailed=true;callback(error);} }
    };
    try {
      multer({storage:receiver,limits:{files:1,fields:20,parts:21,fieldSize:64*1024}}).single('file')(req,res,async error=>{
        if (!error) return next();
        try {
          // Multer may report an aborted request before its storage engine closes.
          if (req.uploadSettled) await req.uploadSettled;
          cancelUpload(req);
          finishReceipt(req);
          next(error);
        } catch (cleanup) { next(cleanup); }
        finally { req.releaseUploadLease(); }
      });
    } catch (error) { try { cancelUpload(req); finishReceipt(req); } finally { req.releaseUploadLease(); } next(error); }
  };
  function cancelUpload(req) {
    try { service.cancelUpload(req.quotaReservation); }
    catch (error) { if (req.receipt) req.maintenance?.failClosed(); throw error; }
  }
  function finishReceipt(req) {
    if (req.receipt && (req.cleanupFailed || req.receipt.failed)) req.maintenance?.failClosed();
    if (req.receipt?.claimed && !req.receipt.committed && !req.cleanupFailed && !req.receipt.failed) { try { req.receipt.service.interrupt(req.receipt.identity); } catch (error) { req.maintenance?.failClosed(); throw error; } }
    if (req.receipt?.replay && !req.cleanupFailed) { replayActive--; req.receipt.replay=false; }
  }
  const claim=(req,res,next)=>{
    service.authorize(req.params.workspaceId,req.user.id,'edit');
    if (!receiptFactory) return next();
    const names=['idempotency-key','x-content-sha256','x-content-length'];
    const counts=names.map(name=>req.rawHeaders.filter((v,i)=>i%2===0 && v.toLowerCase()===name).length);
    if (counts.every(n=>n===0)) return next();
    const [key,digest,length]=names.map(name=>req.headers[name]);
    if (counts.some(n=>n!==1) || !/^[A-Za-z0-9_-]{22,128}$/.test(key || '') || !/^[a-f0-9]{64}$/.test(digest || '') || !/^(0|[1-9][0-9]*)$/.test(length || '') || !Number.isSafeInteger(Number(length))) throw new ValidationError('Invalid publication headers.');
    req.uploadGuard();
    const identity={actor:req.user.id,workspace:req.params.workspaceId,key}; const receipts=receiptFactory();
    const headerFingerprint=crypto.createHash('sha256').update(JSON.stringify([req.params.workspaceId,req.params.pageId || null,req.params.pageId ? 'replace' : 'create',digest,length])).digest('hex');
    const outcome=receipts.claim({...identity,headerFingerprint});
    if (outcome.status==='conflict') return res.status(409).json({code:'IDEMPOTENCY_CONFLICT'});
    if (outcome.status==='in_progress') return res.status(409).json({code:'IN_PROGRESS'});
    const replay=outcome.status==='succeeded';
    if (replay && (replayActive>=4 || !Number.isSafeInteger(platformLimit))) return res.status(503).json({code:'REPLAY_CAPACITY',status:'succeeded'});
    if (replay) replayActive++;
    req.receipt={service:receipts,identity,claimed:!replay,replay,digest,length:Number(length)};
    next();
  };
  const verify=(req)=>{
    const receipt=req.receipt; if (!receipt) return null;
    if (!req.file || req.file.size!==receipt.length || req.file.digest!==receipt.digest) throw new ValidationError('Content digest or length mismatch.');
    req.uploadGuard(); service.authorize(req.params.workspaceId,req.user.id,'edit');
    const fingerprint=service.publicationFingerprint(req.params.workspaceId,req.params.pageId,req.file,req.body);
    const result=receipt.service.bind({...receipt.identity,fingerprint});
    if (result.status==='conflict') throw new WorkspacePageError('IDEMPOTENCY_CONFLICT');
    receipt.fingerprint=fingerprint; return result;
  };
  router.post('/:workspaceId/pages', claim, upload, async (req, res) => {
    let page, replayed=false;
    try { const bound=verify(req); if (bound?.status==='succeeded') { page=bound.result.page; replayed=true; } else { page = await service.create(req.params.workspaceId, req.user.id, req.file, req.body, req.quotaReservation, page=>{if(req.receipt) req.receipt.service.succeed({...req.receipt.identity,fingerprint:req.receipt.fingerprint,result:{page}});},req.receipt); if(req.receipt) req.receipt.committed=true; } }
    finally { try { if (req.file?.tempId) tempFiles.remove(req.file.tempId); } catch(e) {req.cleanupFailed=true;if (!page || req.receipt) throw e;} finally { try { cancelUpload(req); finishReceipt(req); } finally { req.releaseUploadLease(); } } }
    if (req.receipt) res.set('Idempotency-Replayed',String(replayed));
    res.status(201).json({ page });
  });
  router.post('/:workspaceId/pages/:pageId/replace', claim, upload, async (req, res) => {
    let page, replayed=false;
    try { const bound=verify(req); if (bound?.status==='succeeded') { page=bound.result.page; replayed=true; } else { page = await service.replace(req.params.workspaceId, req.user.id, req.params.pageId, req.file, req.body, req.quotaReservation, page=>{if(req.receipt) req.receipt.service.succeed({...req.receipt.identity,fingerprint:req.receipt.fingerprint,result:{page}});},req.receipt); if(req.receipt) req.receipt.committed=true; } }
    finally { try { if (req.file?.tempId) tempFiles.remove(req.file.tempId); } catch(e) {req.cleanupFailed=true;if (!page || req.receipt) throw e;} finally { try { cancelUpload(req); finishReceipt(req); } finally { req.releaseUploadLease(); } } }
    if (req.receipt) res.set('Idempotency-Replayed',String(replayed));
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
    if (err.message?.includes('PUBLIC_REVIEW_REQUIRED')) return res.status(409).json({code:'PUBLIC_REVIEW_REQUIRED'});
    if (err instanceof WorkspaceError || err instanceof WorkspacePageError) {
      const status = { INVALID: 400, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, HISTORY_LIMIT: 409 }[err.code] || 500;
      return res.status(status).json({ code: err.code });
    }
    if (err instanceof QuotaError) return res.status(({QUOTA_EXCEEDED:409,UPLOAD_TOO_LARGE:413,EXPIRED:409,NOT_FOUND:404,INVALID:400})[err.code] || 500).json({code:err.code,...(err.code==='QUOTA_EXCEEDED' && ['apps','storage'].includes(err.reason) ? {reason:err.reason} : {})});
    if (err.code==='REPLAY_CAPACITY') return res.status(503).json({code:'REPLAY_CAPACITY',status:'succeeded'});
    if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({code:'UPLOAD_TOO_LARGE'});
    if (err instanceof ValidationError && err.code === 'ENTRY_SELECTION_REQUIRED') return res.status(400).json({code:err.code,candidates:err.candidates});
    if (err instanceof ValidationError && ['ENTRY_NOT_FOUND','ENTRY_TOO_MANY','ZIP_TOO_MANY_ENTRIES','ZIP_UNSUPPORTED'].includes(err.code)) return res.status(400).json({code:err.code});
    if (err instanceof ValidationError || err.name === 'MulterError') return res.status(400).json({ code: 'INVALID' });
    return res.status(500).json({ code: 'INTERNAL_ERROR' });
  });
  return router;
}
