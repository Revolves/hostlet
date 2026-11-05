import express from 'express';

/**
 * Mount only on the HTTPS management service at a dedicated prefix.
 * GET /:workspaceId/pages/:pageId and POST (JSON {password?,expiresAt?}) at
 * the same path require requireUser and return {shares} / {share}; the latter
 * contains the plaintext token ONCE. POST /:workspaceId/pages/:pageId/list also
 * returns {shares}, for browsers that omit Origin on same-origin GET requests.
 * DELETE /:workspaceId/pages/:pageId/:shareId
 * revokes it. POST /ticket accepts JSON {pageId,token,password?} without an
 * account and returns {ticket}. Every request requires the exact HTTPS Origin
 * and Host, including GET; no query string is accepted. Never log bodies, cookies,
 * responses or credentials at the app, proxy or monitoring layer.
 *
 * Mount BEFORE any unbounded body parser. req.ip must reflect the real client:
 * configure Express trust proxy only for trusted proxies that replace forwarding
 * headers. Local fixed-window limits count malformed requests too, bound both
 * storage and concurrent checks, and fail closed at capacity. They are per process,
 * reset on restart, and do not replace shared edge/IP limits, per-share controls,
 * distributed rate limiting or exchange-endpoint protection. Configure the data
 * service's mandatory limiter as a separate defense, not as a substitute for this
 * router. The management origin must enforce HTTPS, authentication and isolation.
 * Transfer ticket to the exact app origin by form POST, never URL/query/referrer.
 */
export function createWorkspaceShareRouter({ service, requireUser, managementOrigin, rateLimit = {} }) {
  if (!service || ['create','list','revoke','issue'].some(k=>typeof service[k] !== 'function') || typeof requireUser !== 'function') throw new TypeError('Invalid share router configuration');
  let origin; try { origin=new URL(managementOrigin); } catch { throw new TypeError('Invalid management origin'); }
  if (origin.protocol !== 'https:' || origin.origin !== managementOrigin || origin.username || origin.password) throw new TypeError('Invalid management origin');
  const {ipLimit=20,pageLimit=60,globalLimit=200,maxBuckets=10000,windowMs=60000,maxConcurrent=8}=rateLimit;
  if ([ipLimit,pageLimit,globalLimit,maxBuckets,windowMs,maxConcurrent].some(n=>!Number.isSafeInteger(n) || n<1) || maxBuckets>100000 || windowMs>86400000 || maxConcurrent>1000) throw new TypeError('Invalid rate limit');
  const ips=new Map(), pages=new Map(); let global={count:0,until:0}, concurrent=0;
  const count=(map,key,limit,at)=>{
    for (const [k,v] of map) if (v.until<=at) map.delete(k);
    let bucket=map.get(key);
    if (!bucket) { if (map.size>=maxBuckets) return false; bucket={count:0,until:at+windowMs}; map.set(key,bucket); }
    return ++bucket.count<=limit;
  };
  const router=express.Router();
  router.use((req,res,next)=>{
    res.set({'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    const hosts=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='host');
    const origins=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='origin');
    if (hosts.length!==1 || req.headers.host!==origin.host || origins.length!==1 || req.get('origin')!==managementOrigin) return res.sendStatus(403);
    if (req.originalUrl.includes('?')) return res.sendStatus(400);
    next();
  });
  router.use('/ticket',(req,res,next)=>{
    if (req.method!=='POST' || req.path!=='/') return res.sendStatus(404);
    const at=Date.now(), ip=req.ip;
    if (typeof ip!=='string' || !ip || ip.length>512) return res.sendStatus(429);
    if (global.until<=at) global={count:0,until:at+windowMs};
    if (++global.count>globalLimit || !count(ips,ip,ipLimit,at)) return res.sendStatus(429);
    next();
  });
  router.use(express.json({limit:'4kb',strict:true}));
  router.post('/ticket',async (req,res)=>{
    const b=req.body;
    if (!b || typeof b!=='object' || Array.isArray(b) || Object.keys(b).some(k=>!['pageId','token','password'].includes(k)) || typeof b.pageId!=='string' || !b.pageId || b.pageId.length>128 || typeof b.token!=='string' || b.token.length>128 || (b.password!==undefined && (typeof b.password!=='string' || Buffer.byteLength(b.password)>1024))) return res.sendStatus(400);
    if (!count(pages,b.pageId,pageLimit,Date.now()) || concurrent>=maxConcurrent) return res.sendStatus(429);
    const release=req.maintenance?.retain() || (()=>{});
    concurrent++;
    try { const ticket=await service.issue(b.pageId,b.token,b.password,req.ip); return ticket ? res.status(201).json({ticket}) : res.sendStatus(401); }
    finally { concurrent--; release(); }
  });
  router.use(requireUser);
  router.use((req,res,next)=>typeof req.user?.id==='string' && req.user.id ? next() : res.sendStatus(401));
  router.get('/:workspaceId/pages/:pageId',(req,res)=>res.json({shares:service.list(req.params.workspaceId,req.user.id,req.params.pageId)}));
  router.post('/:workspaceId/pages/:pageId/list',(req,res)=>res.json({shares:service.list(req.params.workspaceId,req.user.id,req.params.pageId)}));
  router.post('/:workspaceId/pages/:pageId',async (req,res)=>{
    const body=req.body;
    if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['password','expiresAt'].includes(k))) return res.sendStatus(400);
    const release=req.maintenance?.retain() || (()=>{});
    try { return res.status(201).json({share:await service.create(req.params.workspaceId,req.user.id,req.params.pageId,body)}); }
    finally { release(); }
  });
  router.delete('/:workspaceId/pages/:pageId/:shareId',(req,res)=>{service.revoke(req.params.workspaceId,req.user.id,req.params.pageId,req.params.shareId);res.sendStatus(204);});
  router.use((err,req,res,next)=>{if(res.headersSent) return next(err); const status={INVALID:400,NOT_FOUND:404,FORBIDDEN:403,RATE_LIMITED:429}[err?.code] || (err?.status===413 ? 413 : err?.status===400 ? 400 : 500); return res.sendStatus(status);});
  return router;
}

/**
 * Bearer-authenticated share management for the CLI. Mount at
 * /api/cli/workspaces before the general CLI page router. Unlike the browser
 * router, this surface has no cookie session or Origin requirement; the API
 * credential scope provides authorization. Responses and errors are JSON so
 * callers can distinguish permission, validation and not-found failures.
 */
export function createWorkspaceCliShareRouter({ service, requireUser }) {
  if (!service || ['create','list','revoke'].some(k=>typeof service[k] !== 'function') || typeof requireUser !== 'function') throw new TypeError('Invalid CLI share router configuration');
  const router=express.Router();
  router.use((_req,res,next)=>{res.set({'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'});next();});
  const user=(req,res,next)=>requireUser(req,res,()=>{
    if (typeof req.user?.id === 'string' && req.user.id) return next();
    return res.status(401).json({code:'UNAUTHORIZED'});
  });
  router.get('/:workspaceId/pages/:pageId/shares',user,(req,res)=>res.json({shares:service.list(req.params.workspaceId,req.user.id,req.params.pageId)}));
  router.post('/:workspaceId/pages/:pageId/shares',user,async(req,res)=>{
    const body=req.body;
    if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['password','expiresAt'].includes(k))) return res.status(400).json({code:'INVALID'});
    const share=await service.create(req.params.workspaceId,req.user.id,req.params.pageId,body);
    return res.status(201).json({share});
  });
  router.delete('/:workspaceId/pages/:pageId/shares/:shareId',user,(req,res)=>{
    service.revoke(req.params.workspaceId,req.user.id,req.params.pageId,req.params.shareId);
    res.sendStatus(204);
  });
  router.use((err,_req,res,next)=>{
    if (res.headersSent) return next(err);
    const status={INVALID:400,NOT_FOUND:404,FORBIDDEN:403,UNAUTHORIZED:401,RATE_LIMITED:429}[err?.code] || 500;
    return res.status(status).json({code: status===500 ? 'INTERNAL_ERROR' : err.code});
  });
  return router;
}
