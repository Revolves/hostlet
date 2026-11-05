import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import express, { Router } from 'express';

const idPattern = /^w-[a-f0-9]{32}$/;
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

function createExchangeLimiter(options={}) {
  if (!options || typeof options!=='object' || Array.isArray(options)) throw new TypeError('Invalid rate limit');
  const {windowMs=60000,perIp=30,global=1000,maxEntries=4096,now=()=>performance.now()}=options;
  if (![windowMs,perIp,global,maxEntries].every(Number.isSafeInteger) || windowMs<1 || windowMs>86400000 || perIp<1 || global<1 || maxEntries<1 || maxEntries>100000 || typeof now!=='function') throw new TypeError('Invalid rate limit');
  const entries=new Map(); let globalStart, globalCount=0, lastTime=-Infinity;
  return req=>{
    const time=now();
    if (!Number.isFinite(time) || time<lastTime) return false;
    lastTime=time;
    if (globalStart===undefined || time-globalStart>=windowMs) {globalStart=time;globalCount=0;}
    if (globalCount>=global) return false;
    globalCount++;
    let ip=req.ip;
    if (!net.isIP(ip || '')) return false;
    if (net.isIP(ip)===6) {
      try {ip=new URL(`http://[${ip}]/`).hostname.slice(1,-1);} catch {return false;}
      const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
      if(mapped) {const hi=parseInt(mapped[1],16),lo=parseInt(mapped[2],16);ip=`${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`;}
    }
    let entry=entries.get(ip);
    if (entry && time-entry.start>=windowMs) {entries.delete(ip);entry=undefined;}
    if (!entry) {
      if(entries.size>=maxEntries) for(const [key,value] of entries) if(time-value.start>=windowMs) entries.delete(key);
      if(entries.size>=maxEntries) return false;
      entry={start:time,count:0}; entries.set(ip,entry);
    }
    if(entry.count>=perIp) return false;
    entry.count++; return true;
  };
}


/**
 * Independent HTTPS content router, mounted at the root of its own listener.
 * contentHost is an exact IP literal plus explicit port (IPv6 in brackets).
 * isSuspended must consult current state for every request, including shares.
 * service and shareService provide the existing exchange/authorize contracts.
 * The storage root and its ancestors must not be concurrently modified by
 * untrusted processes. Upstream must redact cookies and ticket bodies,
 * reject untrusted proxy headers and terminate trusted TLS. Exchange rate
 * limits are per router process, default 30/IP and 1000 total per 60 seconds,
 * with at most 4096 IP entries. Express req.ip follows the caller's trust
 * proxy setting (default false); only explicitly trusted proxies may supply
 * forwarded addresses and they must sanitize the forwarded chain.
 * Multi-process deployments need an additional shared upstream limit.
 * IP cookies cross ports. Suppressing Set-Cookie alone does not protect
 * management credentials; the management guard, host-prefixed HttpOnly
 * cookies, proxy filtering and browser security checks are also required.
 * Hosted pages share an origin and must be mutually trusted.
 */
export function createWorkspaceIpHostingRouter({service, shareService=null, contentHost, isSuspended, transferTimeoutMs=300000, rateLimit, onPublicVisit=null}) {
  const m=typeof contentHost==='string' && /^(\[[0-9a-f:]+\]|[0-9.]+):([1-9][0-9]{0,4})$/.exec(contentHost);
  const ip=m && (m[1].startsWith('[') ? m[1].slice(1,-1) : m[1]);
  if (!m || !net.isIP(ip) || Number(m[2])>65535 || !service || !path.isAbsolute(service.storageRoot || '') || typeof service.publicPage!=='function' || typeof service.authorize!=='function' || typeof service.exchange!=='function' || typeof isSuspended!=='function' || (shareService && (typeof shareService.exchange!=='function' || typeof shareService.authorize!=='function')) || !Number.isSafeInteger(transferTimeoutMs) || transferTimeoutMs<1 || transferTimeoutMs>3600000) throw new TypeError('Invalid IP hosting configuration');
  if (onPublicVisit !== null && typeof onPublicVisit !== 'function') throw new TypeError('Invalid public visit recorder');
  let origin; try { origin=new URL(service.managementOrigin); } catch { throw new TypeError('Invalid management origin'); }
  if (origin.protocol!=='https:' || origin.origin!==service.managementOrigin || origin.username || origin.password) throw new TypeError('Invalid management origin');
  const router=Router(), allowExchange=createExchangeLimiter(rateLimit);
  router.use((req,res,next)=>{
    // Suppress even previously installed middleware's Set-Cookie. Only the
    // exchange below can emit a cookie, using the captured setter directly.
    const set=res.setHeader.bind(res); res.removeHeader('Set-Cookie');
    res.setHeader=(name,value)=>String(name).toLowerCase()==='set-cookie' ? res : set(name,value);
    res.ipHostingSetCookie=value=>set('Set-Cookie',value);
    res.set({'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; worker-src 'none'; object-src 'none'; frame-ancestors 'none'",'Cross-Origin-Resource-Policy':'same-origin','Cross-Origin-Opener-Policy':'same-origin'});
    const hosts=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='host');
    if(hosts.length!==1 || req.headers.host!==contentHost) return res.sendStatus(421);
    next();
  });
  router.use((req,res,next)=>{
    const raw=req.originalUrl.split('?')[0];
    const match=/^\/p\/(w-[a-f0-9]{32})(\/.*)?$/.exec(raw);
    if(!match) return res.sendStatus(404);
    req.ipPage=match[1]; req.ipPrefix=`/p/${match[1]}`; req.ipPath=match[2] || '';
    if(req.ipPath==='/__host/exchange' && req.method==='POST' && !allowExchange(req)) return res.sendStatus(429);
    if(isSuspended(req.ipPage)) return res.sendStatus(401);
    next();
  });
  router.use((req,res,next)=>{
    if(req.ipPath!=='/__host/exchange') return next();
    if(req.method!=='POST') return res.sendStatus(405);
    express.urlencoded({extended:false,limit:'1kb',parameterLimit:2})(req,res,(err)=>{
      if (err) return next(err);
      try {
        const origins=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='origin');
        if(origins.length!==1 || req.originalUrl.includes('?') || req.get('origin')!==service.managementOrigin || Object.keys(req.body || {}).length!==1 || typeof req.body.ticket!=='string') return res.sendStatus(403);
        let result=service.exchange(req.ipPage,req.body.ticket), kind='member';
        if(!result && shareService) { result=shareService.exchange(req.ipPage,req.body.ticket); kind='share'; }
        if(!result) return res.sendStatus(401);
        if(typeof result.value!=='string' || !/^[A-Za-z0-9_-]+$/.test(result.value) || !Number.isSafeInteger(result.maxAge) || result.maxAge<1 || result.maxAge>3600000) throw new Error('Invalid session');
        const name=`iphost-${kind}-${req.ipPage}`;
        res.ipHostingSetCookie(`${name}=${result.value}; Max-Age=${Math.floor(result.maxAge/1000)}; Path=${req.ipPrefix}/; HttpOnly; Secure; SameSite=Lax`);
        return res.redirect(303,`${req.ipPrefix}/`);
      } catch(error) { next(error); }
    });
  });
  router.use((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)) return res.sendStatus(405);
    const member=cookieValue(req.headers.cookie,`iphost-member-${req.ipPage}`), share=cookieValue(req.headers.cookie,`iphost-share-${req.ipPage}`);
    if(member===false || share===false) return res.sendStatus(401);
    const publicRow=service.publicPage(req.ipPage);
    const row=publicRow || service.authorize(req.ipPage,member) || (shareService && shareService.authorize(req.ipPage,share));
    if(!row) return res.sendStatus(401);
    // Never follow an injected service result to a different page's files.
    if(row.id!==req.ipPage) return res.sendStatus(404);
    if(!req.ipPath) return res.redirect(308,`${req.ipPrefix}/${req.originalUrl.slice(req.originalUrl.split('?')[0].length)}`);
    const requested=req.ipPath.slice(1);
    const file=readFile(service.storageRoot,row,requested); if(!file) return res.sendStatus(404);
    const entry=encodedEntry(row.entry_file);
    const entryDocument=publicRow && req.method==='GET' && (req.ipPath === '/' || requested === entry);
    if(entryDocument && onPublicVisit) {
      try { onPublicVisit(req.ipPage,{method:req.method,entryDocument:true}); }
      catch(error) { console.error('Public visit count failed.'); }
    }
    const query=req.originalUrl.slice(req.originalUrl.split('?')[0].length);
    if(req.ipPath==='/') {const entry=encodedEntry(row.entry_file);if(entry && entry.includes('/')) return res.redirect(302,`${req.ipPrefix}/${entry}${query}`);}
    if(file.redirect) return res.redirect(308,`${req.ipPrefix}${req.ipPath}/${query}`);
    let fd=fs.openSync(file.filename,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened=fs.fstatSync(fd); if(!opened.isFile() || opened.dev!==file.stat.dev || opened.ino!==file.stat.ino) {fs.closeSync(fd);return res.sendStatus(404);}
      res.type(path.extname(file.filename)); res.set('Content-Length',String(opened.size));
      if(req.method==='HEAD') {fs.closeSync(fd);return res.end();}
      const release=req.maintenance?.retain() || (()=>{});
      let stream; try {stream=fs.createReadStream(file.filename,{fd,autoClose:true});fd=undefined;} catch(e) {release();throw e;}
      const disconnect=()=>stream.destroy(); const timer=setTimeout(()=>{stream.destroy();res.destroy();},transferTimeoutMs); timer.unref();
      const clear=()=>clearTimeout(timer); res.once('finish',clear); res.once('close',clear); res.once('close',disconnect);
      stream.once('close',()=>{res.off('close',disconnect);release();}); stream.once('error',()=>res.headersSent ? res.destroy() : res.sendStatus(500)); return stream.pipe(res);
    } catch(error) {if(fd!==undefined) {try {fs.closeSync(fd);} catch {}} throw error;}
  });
  router.use((err,req,res,next)=>res.headersSent ? res.destroy() : res.sendStatus(err.status===413 ? 413 : err.status===400 ? 400 : 500));
  return router;
}
