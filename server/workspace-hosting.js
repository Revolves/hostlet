import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import express, { Router } from 'express';
import { getDomain } from 'tldts';

// Apply after workspaceSchema and workspacePagesSchema with foreign_keys enabled.
export const workspaceHostingSchema = `
CREATE TABLE workspace_host_tickets (token_hash TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE workspace_host_sessions (token_hash TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX workspace_host_tickets_user ON workspace_host_tickets(page_id,user_id);
CREATE INDEX workspace_host_sessions_user ON workspace_host_sessions(page_id,user_id);
CREATE TRIGGER workspace_host_member_removed AFTER DELETE ON workspace_members BEGIN
 DELETE FROM workspace_host_tickets WHERE user_id=OLD.user_id AND page_id IN (SELECT id FROM workspace_pages WHERE workspace_id=OLD.workspace_id);
 DELETE FROM workspace_host_sessions WHERE user_id=OLD.user_id AND page_id IN (SELECT id FROM workspace_pages WHERE workspace_id=OLD.workspace_id);
END;
`;

const idPattern = /^w-[a-f0-9]{32}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const cookieName = '__Host-workspace';
const shareCookieName = '__Host-workspace-share';
const safeHeaders = res => res.set({
  'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; worker-src 'none'; object-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin'
});

/**
 * Independent content service. storageRoot must be an absolute, dedicated trusted
 * FileSiteStorage root. Untrusted users/processes must not mutate its files or
 * ancestor directories concurrently with reads (lstat cannot prevent rename races).
 * Deploy the app router on a separate HTTPS content service, never alongside the
 * management service; strip request-body/cookie logging at every proxy. Configure
 * appDomain as a DNS suffix, optionally with the external HTTPS port. The
 * returned service.appDomain is canonical (default :443 omitted); callers
 * must use it for host routing and app URLs. Reverse
 * proxies must preserve the original Host, reject unknown hosts and not inject
 * authentication cookies. managementOrigin is the exact HTTPS origin that posts
 * the ticket form. The management router requires upstream Origin/CSRF checks.
 * Optional shareService is the independently migrated workspace share service.
 * Its cookies and sessions are separate from member sessions. Each resource
 * rechecks both credentials against their respective services. The caller must
 * rate-limit exchange and redact bodies, cookies and responses. Previously
 * downloaded content cannot be recalled. allowSameSite is an explicit demo-mode
 * opt-in; production deployments should keep management and applications on
 * separate registrable domains.
 */
export function createWorkspaceHostingService({ db, storageRoot, appDomain, managementOrigin, allowSameSite = false, isSuspended = () => false, publicPage = () => null, now = Date.now, ticketTtlMs = 30000, sessionTtlMs = 300000 }) {
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || !path.isAbsolute(storageRoot || '') || typeof allowSameSite !== 'boolean' || typeof now !== 'function' || typeof isSuspended !== 'function' || typeof publicPage !== 'function' || !Number.isSafeInteger(ticketTtlMs) || ticketTtlMs < 1000 || ticketTtlMs > 120000 || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 3600000) throw new TypeError('Invalid hosting configuration');
  if (typeof appDomain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[0-9]{1,5})?$/.test(appDomain)) throw new TypeError('Invalid app domain');
  const [appDns,appPort] = appDomain.split(':');
  if (appDns.length > 218 || (appPort !== undefined && (Number(appPort) < 1 || Number(appPort) > 65535))) throw new TypeError('Invalid app domain');
  appDomain = appPort === undefined || Number(appPort) === 443 ? appDns : `${appDns}:${Number(appPort)}`;
  let origin;
  try { origin = new URL(managementOrigin); } catch { throw new TypeError('Invalid management origin'); }
  if (origin.protocol !== 'https:' || origin.origin !== managementOrigin || origin.username || origin.password || origin.hostname === appDns || origin.hostname.endsWith('.' + appDns)) throw new TypeError('Invalid management origin');
  const appSite = getDomain(appDns, { allowPrivateDomains: true });
  const managementSite = getDomain(origin.hostname, { allowPrivateDomains: true });
  if (!appSite || !managementSite || (appSite === managementSite && allowSameSite !== true)) {
    throw new TypeError('Invalid management origin: applications require a separate registrable domain unless same-site hosting is explicitly enabled');
  }
  return createHostingCore({db,storageRoot,appDomain,managementOrigin,isSuspended,publicPage,now,ticketTtlMs,sessionTtlMs});
}

export function createWorkspaceIpHostingService({db,storageRoot,managementOrigin,contentOrigin,isSuspended=()=>false,publicPage=()=>null,now=Date.now,ticketTtlMs=30000,sessionTtlMs=300000}) {
  let management,content;
  try { management=new URL(managementOrigin);content=new URL(contentOrigin); } catch { throw new TypeError('Invalid IP hosting origin'); }
  const valid=(url,raw)=>url.protocol==='https:' && url.origin===raw && !url.username && !url.password && isIP(url.hostname)===4 && Boolean(url.port);
  if (!valid(management,managementOrigin) || !valid(content,contentOrigin) || management.hostname!==content.hostname || management.port===content.port) throw new TypeError('Invalid IP hosting origin');
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || !path.isAbsolute(storageRoot || '') || typeof now !== 'function' || typeof isSuspended !== 'function' || typeof publicPage !== 'function' || !Number.isSafeInteger(ticketTtlMs) || ticketTtlMs < 1000 || ticketTtlMs > 120000 || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 3600000) throw new TypeError('Invalid hosting configuration');
  return createHostingCore({db,storageRoot,appDomain:null,managementOrigin,isSuspended,publicPage,now,ticketTtlMs,sessionTtlMs});
}

function createHostingCore({db,storageRoot,appDomain,managementOrigin,isSuspended,publicPage,now,ticketTtlMs,sessionTtlMs}) {
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const page = id => idPattern.test(id || '') && !isSuspended(id) && db.prepare("SELECT * FROM workspace_pages WHERE id=? AND access_mode='private'").get(id);
  const member = (id, user) => !isSuspended(id) && db.prepare("SELECT p.* FROM workspace_pages p JOIN workspace_members m ON m.workspace_id=p.workspace_id WHERE p.id=? AND p.access_mode='private' AND m.user_id=? AND m.role IN ('owner','editor','viewer')").get(id,user);
  const clock = () => { const value=now(); if (!Number.isSafeInteger(value)) throw new Error('Invalid clock'); return value; };
  const valid = (id, user) => typeof user === 'string' && !!member(id,user);
  return {
    hostPage(host) {
      if (!appDomain || typeof host !== 'string' || host !== host.toLowerCase() || !host.endsWith('.' + appDomain)) return null;
      const id = host.slice(0, -appDomain.length - 1);
      return idPattern.test(id) && page(id) ? id : null;
    },
    issue(id, user) { return tx(() => { if (!valid(id,user)) return null; const value=token(); db.prepare('INSERT INTO workspace_host_tickets VALUES (?,?,?,?)').run(hash(value),id,user,clock()+ticketTtlMs); return value; }); },
    revoke(id, user) { return tx(() => { if (!valid(id,user)) return false; db.prepare('DELETE FROM workspace_host_tickets WHERE page_id=? AND user_id=?').run(id,user); db.prepare('DELETE FROM workspace_host_sessions WHERE page_id=? AND user_id=?').run(id,user); return true; }); },
    exchange(id, value) { if (!tokenPattern.test(value || '')) return null; return tx(() => {
      const at=clock(), ticket=db.prepare('SELECT * FROM workspace_host_tickets WHERE token_hash=? AND page_id=? AND expires_at>?').get(hash(value),id,at);
      if (!ticket || !valid(id,ticket.user_id)) return null;
      const deleted=db.prepare('DELETE FROM workspace_host_tickets WHERE token_hash=?').run(ticket.token_hash);
      if (deleted.changes !== 1) return null;
      const session=token(); db.prepare('INSERT INTO workspace_host_sessions VALUES (?,?,?,?)').run(hash(session),id,ticket.user_id,at+sessionTtlMs);
      return { value:session, maxAge:sessionTtlMs };
    }); },
    authorize(id, value) { if (!tokenPattern.test(value || '')) return null; const row=db.prepare('SELECT user_id FROM workspace_host_sessions WHERE token_hash=? AND page_id=? AND expires_at>?').get(hash(value),id,clock()); return row ? member(id,row.user_id) || null : null; },
    publicPage(id) { return idPattern.test(id || '') && !isSuspended(id) ? publicPage(id) : null; },
    purgeExpired() { const at=clock(); return tx(() => ({tickets:db.prepare('DELETE FROM workspace_host_tickets WHERE expires_at<=?').run(at).changes, sessions:db.prepare('DELETE FROM workspace_host_sessions WHERE expires_at<=?').run(at).changes})); },
    storageRoot, managementOrigin, appDomain
  };
}

// requireUser must set req.user.id from server-side authentication, never request data.
export function createWorkspaceHostingManagementRouter({ service, requireUser }) {
  if (!service || typeof requireUser !== 'function') throw new TypeError('Invalid management router configuration');
  const router=Router(); router.use((req,res,next)=>{ safeHeaders(res); next(); }); router.use(requireUser);
  router.use((req,res,next)=>typeof req.user?.id === 'string' && req.user.id ? next() : res.sendStatus(401));
  router.post('/:pageId/tickets',(req,res)=>{ const ticket=service.issue(req.params.pageId,req.user.id); return ticket ? res.status(201).json({ticket}) : res.sendStatus(404); });
  router.delete('/:pageId/authorizations',(req,res)=>service.revoke(req.params.pageId,req.user.id) ? res.sendStatus(204) : res.sendStatus(404));
  router.use((err,req,res,next)=>res.headersSent ? next(err) : res.sendStatus(500));
  return router;
}

function cookieValue(header, name) {
  const matches = String(header || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name + '='));
  return matches.length > 1 ? false : matches.length === 1 ? matches[0].slice(name.length+1) : null;
}
function segments(value) {
  let decoded; try { decoded=decodeURIComponent(value); } catch { return null; }
  if (!decoded || decoded.startsWith('/') || decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded)) return null;
  const parts=decoded.split('/');
  if (parts.some(s=>!s || s==='.' || s==='..' || /[<>:"|?*]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) return null;
  return parts;
}
function encodedEntry(value) {
  if (typeof value !== 'string') return null;
  try { const encoded=value.split('/').map(encodeURIComponent).join('/'); return segments(encoded) ? encoded : null; }
  catch { return null; }
}
function readFile(root, row, requestPath) {
  if (row.storage_id !== row.id || !idPattern.test(row.storage_id) || !/^[0-9]+-[a-f0-9]{10}$/.test(row.release_id)) return null;
  const directoryRequest=requestPath.endsWith('/');
  const requested=requestPath ? (directoryRequest ? requestPath.slice(0,-1) : requestPath) : encodedEntry(row.entry_file);
  if (!requested) return null;
  const parts=segments(requested); if (!parts) return null;
  const base=path.resolve(root), all=['sites',row.storage_id,'releases',row.release_id,...parts];
  let current=base;
  try {
    for (let parent=base;;) { if (fs.lstatSync(parent).isSymbolicLink()) return null; const next=path.dirname(parent); if (next === parent) break; parent=next; }
    for (const part of all) { current=path.join(current,part); const stat=fs.lstatSync(current); if (stat.isSymbolicLink()) return null; }
    let stat=fs.lstatSync(current);
    if (stat.isDirectory()) {
      current=path.join(current,'index.html');stat=fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isFile()) return null;
      if (!directoryRequest) return {redirect:true};
    } else if (directoryRequest || !stat.isFile()) return null;
    return {filename:current, stat};
  } catch (err) { if (['ENOENT','ENOTDIR','ELOOP','EACCES'].includes(err.code)) return null; throw err; }
}

export function createWorkspaceHostingAppRouter({ service, shareService = null, transferTimeoutMs = 300000, onPublicVisit = null }) {
  if (!service || !Number.isSafeInteger(transferTimeoutMs) || transferTimeoutMs < 1 || transferTimeoutMs > 3600000 || (shareService && (typeof shareService.exchange !== 'function' || typeof shareService.authorize !== 'function'))) throw new TypeError('Invalid hosting service');
  if (onPublicVisit !== null && typeof onPublicVisit !== 'function') throw new TypeError('Invalid public visit recorder');
  const router=Router();
  router.use((req,res,next)=>{ safeHeaders(res); const hosts=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='host'); const host=req.headers.host; req.hostingPage=hosts.length===1 && service.hostPage(host); if (!req.hostingPage) return res.sendStatus(421); next(); });
  router.post('/__host/exchange', express.urlencoded({extended:false,limit:'1kb',parameterLimit:2}), (req,res)=>{
    const origins=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='origin');
    if (origins.length!==1 || req.originalUrl.includes('?') || req.get('origin') !== service.managementOrigin || Object.keys(req.body || {}).length !== 1 || typeof req.body.ticket !== 'string') return res.sendStatus(403);
    let result=service.exchange(req.hostingPage,req.body.ticket), name=cookieName;
    if (!result && shareService) { result=shareService.exchange(req.hostingPage,req.body.ticket); name=shareCookieName; }
    if (!result) return res.sendStatus(401);
    res.cookie(name,result.value,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:result.maxAge}); return res.redirect(303,'/');
  });
  router.use((req,res)=>{
    if (!['GET','HEAD'].includes(req.method)) return res.sendStatus(405);
    const memberCookie=cookieValue(req.headers.cookie,cookieName), shareCookie=cookieValue(req.headers.cookie,shareCookieName);
    if (memberCookie===false || shareCookie===false) return res.sendStatus(401);
    const publicRow=service.publicPage(req.hostingPage);
    const row=publicRow || service.authorize(req.hostingPage,memberCookie) || (shareService && shareService.authorize(req.hostingPage,shareCookie)); if (!row) return res.sendStatus(401);
    const raw=req.originalUrl.split('?')[0]; if (!raw.startsWith('/')) return res.sendStatus(400);
    const requested=raw.slice(1);
    const file=readFile(service.storageRoot,row,requested); if (!file) return res.sendStatus(404);
    const entry=encodedEntry(row.entry_file);
    const entryDocument=publicRow && req.method==='GET' && (raw === '/' || requested === entry);
    if (entryDocument && onPublicVisit) {
      try { onPublicVisit(req.hostingPage, { method:req.method, entryDocument:true }); }
      catch (error) { console.error('Public visit count failed.'); }
    }
    if (raw === '/') {
      const entry=encodedEntry(row.entry_file);
      if (entry && entry.includes('/')) return res.redirect(302,`/${entry}${req.originalUrl.slice(raw.length)}`);
    }
    if (file.redirect) {
      const query=req.originalUrl.slice(raw.length);
      return res.redirect(308,`${raw}/${query}`);
    }
    let fd;
    try {
      fd=fs.openSync(file.filename,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened=fs.fstatSync(fd);
      if (!opened.isFile() || opened.dev !== file.stat.dev || opened.ino !== file.stat.ino) {fs.closeSync(fd);return res.sendStatus(404);}
      res.type(path.extname(file.filename));res.set('Content-Length',String(opened.size));
      if (req.method === 'HEAD') {fs.closeSync(fd);return res.end();}
      const release=req.maintenance?.retain() || (()=>{});
      let stream;
      try {stream=fs.createReadStream(file.filename,{fd,autoClose:true});}
      catch (error) {fs.closeSync(fd);fd=undefined;release();throw error;}
      const disconnect=()=>stream.destroy();
      const timer=setTimeout(()=>{stream.destroy();res.destroy();},transferTimeoutMs);
      timer.unref();
      const clearDeadline=()=>clearTimeout(timer);
      res.once('finish',clearDeadline);res.once('close',clearDeadline);
      res.once('close',disconnect);
      stream.once('close',()=>{res.off('close',disconnect);release();});
      stream.once('error',()=>{if(res.headersSent)res.destroy();else res.sendStatus(500);});
      return stream.pipe(res);
    } catch (error) {
      if (fd !== undefined) {try {fs.closeSync(fd);} catch { /* Preserve the original failure. */ }}
      if (['ENOENT','ENOTDIR','ELOOP','EACCES'].includes(error.code)) return res.sendStatus(404);
      throw error;
    }
  });
  router.use((err,req,res,next)=>res.headersSent ? next(err) : res.sendStatus(err.status === 413 ? 413 : 400));
  return router;
}
