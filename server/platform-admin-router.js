import express from 'express';

/**
 * Mount before any body parser. managementOrigin is an exact HTTPS origin;
 * all writes require exactly one matching Origin and Host, no query string,
 * and consume a bounded per-IP and global process-local limit before parsing.
 * req.ip must be trustworthy: configure trust proxy only for trusted proxies.
 * Enforce shared edge limits in multi-process deployments. Never log bodies,
 * credentials, report text or responses at the app, proxy or monitoring layer.
 * requireAdmin must authenticate/authorize and set req.admin.id server-side.
 * GET /settings, PUT /settings; POST /reports (anonymous); GET /reports;
 * POST /reports/:id/resolve; POST /pages/:pageId/suspend or /restore.
 * Admin GETs require auth. Writes accept only JSON, no actor field. Service
 * is standalone: mount only on a trusted HTTPS management host, never app origin.
 */
export function createPlatformAdminRouter({service,requireAdmin,managementOrigin,quotaService,operationsStatus,retentionDiagnostics,rateLimit={}} = {}) {
  if (!service || ['getSettings','updateSettings','submitReport','listReportPage','resolveReport','suspendPage','restorePage'].some(k=>typeof service[k]!=='function') || typeof requireAdmin!=='function') throw new TypeError('Invalid platform admin router configuration');
  let origin;try{origin=new URL(managementOrigin);}catch{throw new TypeError('Invalid management origin');}
  if(origin.protocol!=='https:' || origin.origin!==managementOrigin || origin.username || origin.password) throw new TypeError('Invalid management origin');
  const {ipLimit=20,globalLimit=200,maxBuckets=10000,windowMs=60000}=rateLimit;
  if([ipLimit,globalLimit,maxBuckets,windowMs].some(n=>!Number.isSafeInteger(n)||n<1) || maxBuckets>100000 || windowMs>86400000) throw new TypeError('Invalid rate limit');
  const buckets=new Map();let global={count:0,until:0};
  const router=express.Router();
  router.use((req,res,next)=>{
    res.set({'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    if(req.originalUrl.includes('?')) return res.sendStatus(400);
    const hosts=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='host');
    if(hosts.length!==1 || req.headers.host!==origin.host) return res.sendStatus(403);
    if(['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    const origins=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='origin');
    if(origins.length!==1 || req.get('origin')!==managementOrigin) return res.sendStatus(403);
    const at=Date.now(),ip=req.ip;
    if(typeof ip!=='string'||!ip||ip.length>512) return res.sendStatus(429);
    for(const [key,value] of buckets) if(value.until<=at) buckets.delete(key);
    if(global.until<=at) global={count:0,until:at+windowMs};
    if(++global.count>globalLimit) return res.sendStatus(429);
    let bucket=buckets.get(ip);if(!bucket){if(buckets.size>=maxBuckets) return res.sendStatus(429);bucket={count:0,until:at+windowMs};buckets.set(ip,bucket);}
    if(++bucket.count>ipLimit) return res.sendStatus(429);
    if(!req.is('application/json')) return res.sendStatus(415);
    next();
  });
  router.use(express.json({limit:'8kb',strict:true}));
  router.post('/reports',(req,res)=>res.status(201).json(service.submitReport(req.body)));
  router.use(requireAdmin);
  router.use((req,res,next)=>typeof req.admin?.id==='string' && req.admin.id.trim() && req.admin.id.length<=200 ? next() : res.sendStatus(401));
  router.get('/settings',(req,res)=>res.json(service.getSettings()));
  if (operationsStatus) router.get('/operations',(req,res)=>res.json(operationsStatus.snapshot()));
  if (retentionDiagnostics) {
    router.get('/retention-issues',(req,res)=>res.json(retentionDiagnostics()));
    router.get('/retention-issues/after/:id',(req,res)=>{
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(req.params.id)) return res.sendStatus(400);
      return res.json(retentionDiagnostics(req.params.id));
    });
  }
  router.put('/settings',(req,res)=>res.json(service.updateSettings(req.admin.id,req.body)));
  if (typeof service.listWorkspaces === 'function') {
    router.get('/workspaces',(req,res)=>res.json(service.listWorkspaces()));
    router.get('/workspaces/page/:offset',(req,res)=>{
      if (!/^(0|[1-9]\d*)$/.test(req.params.offset)) return res.sendStatus(400);
      return res.json(service.listWorkspaces(Number(req.params.offset)));
    });
  }
  if (quotaService) {
    router.get('/workspaces/:workspaceId/quota',(req,res)=>res.json(quotaService.getConfig(req.params.workspaceId,req.admin.id)));
    router.put('/workspaces/:workspaceId/quota',(req,res)=>res.json({...quotaService.update(req.params.workspaceId,req.admin.id,req.body),source:'override'}));
    router.delete('/workspaces/:workspaceId/quota',(req,res)=>{if(!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).length) return res.sendStatus(400);return res.json(quotaService.clearOverride(req.params.workspaceId,req.admin.id));});
  }
  router.get('/reports',(req,res)=>res.json(service.listReportPage()));
  router.get('/reports/before/:createdAt/:id',(req,res)=>{
    if (!/^(0|[1-9]\d*)$/.test(req.params.createdAt)) return res.sendStatus(400);
    return res.json(service.listReportPage({createdAt:Number(req.params.createdAt),id:req.params.id}));
  });
  const empty=(req,res,next)=>req.body && typeof req.body==='object' && !Array.isArray(req.body) && Object.keys(req.body).length===0 ? next() : res.sendStatus(400);
  router.post('/reports/:id/resolve',empty,(req,res)=>{service.resolveReport(req.admin.id,req.params.id);res.sendStatus(204);});
  router.post('/pages/:pageId/suspend',empty,(req,res)=>{service.suspendPage(req.admin.id,req.params.pageId);res.sendStatus(204);});
  router.post('/pages/:pageId/restore',empty,(req,res)=>{service.restorePage(req.admin.id,req.params.pageId);res.sendStatus(204);});
  router.use((err,req,res,next)=>{if(res.headersSent) return next(err);const status={INVALID:400,NOT_FOUND:404,CONFLICT:409,RETENTION_UNAVAILABLE:409,REGISTRATION_DISABLED:409}[err?.code] || (err?.status===413 ? 413 : err?.status===400 ? 400 : 500);res.sendStatus(status);});
  return router;
}
