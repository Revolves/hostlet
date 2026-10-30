import express from 'express';

/**
 * Mount at a dedicated prefix, e.g. app.use('/api/account', router).
 * accounts: createAccounts({db,sender}); sessions: createAccountSessions({db}).
 * allowedOrigins: exact serialized HTTP(S) origins; registrationEnabled defaults false.
 * rateLimit: {limit, globalLimit, maxConcurrent, windowMs}, local to this process.
 * POST JSON: register {email,password}; verify {token}; resend-verification {email};
 * login {email,password}; logout {}; forgot-password {email}; reset-password {token,password}.
 * GET /me returns the account or null. Every POST requires an allowed Origin.
 * Deploy with trusted proxy settings configured correctly, HTTPS, shared edge rate limits
 * for multiple processes, and log redaction of request bodies, cookies and mail links.
 * Sender receives plaintext tokens and must deliver links without exposing them in logs.
 */
export function createAccountRouter({ accounts, sessions, allowedOrigins, registrationEnabled = false, rateLimit = {}, deleteAccount, accountDeletionStatus, apiCredentials }) {
  if (!accounts || !sessions || !Array.isArray(allowedOrigins) || !allowedOrigins.length || !['boolean', 'function'].includes(typeof registrationEnabled)) throw new TypeError('Invalid account router configuration.');
  if (deleteAccount !== undefined && typeof deleteAccount !== 'function') throw new TypeError('Invalid account deletion callback.');
  if (accountDeletionStatus !== undefined && typeof accountDeletionStatus !== 'function') throw new TypeError('Invalid account deletion status callback.');
  for (const origin of allowedOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new TypeError('Invalid allowed origin.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new TypeError('Invalid allowed origin.');
  }
  const { limit = 20, globalLimit = 10000, maxConcurrent = 16, windowMs = 15 * 60000 } = rateLimit;
  if ([limit,globalLimit,maxConcurrent,windowMs].some(value=>!Number.isSafeInteger(value) || value<1) || maxConcurrent>1000 || windowMs>86400000) throw new TypeError('Invalid rate limit.');
  const buckets = new Map(); let global={count:0,until:0}, concurrent=0;
  const router = express.Router();
  router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  router.use((req,res,next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    if (!allowedOrigins.includes(req.get('Origin'))) return res.status(403).json({error:'Origin denied.'});
    const now = Date.now();
    if(global.until<=now) global={count:0,until:now+windowMs};
    if(++global.count>globalLimit) return res.status(429).json({error:'Too many requests.'});
    for (const [key, entry] of buckets) if (entry.until <= now) buckets.delete(key);
    const key = `${req.ip || 'unknown'}:${req.path.toLowerCase().replace(/\/+$/, '')}`;
    let entry = buckets.get(key);
    if (!entry) {
      if (buckets.size >= 10000) return res.status(429).json({error:'Too many requests.'});
      entry = {count:0, until:now + windowMs}; buckets.set(key, entry);
    }
    if (++entry.count > limit) return res.status(429).json({error:'Too many requests.'});
    next();
  });
  router.use(express.json({ limit:'16kb', strict:true }));
  const neutral = res => res.status(202).json({ message:'If applicable, check your email for further instructions.' });
  const handler = fn => async (req,res) => {
    if(concurrent>=maxConcurrent) return res.status(429).json({error:'Too many requests.'});
    const release=req.maintenance?.retain() || (()=>{});
    concurrent++;
    try { await fn(req,res); }
    catch (error) {
      if (res.headersSent) { console.error('Account operation failed after response.'); return; }
      if (['INVALID_EMAIL','INVALID_PASSWORD'].includes(error?.code)) return res.status(400).json({error:'Invalid account details.'});
      return res.status(500).json({error:'Request could not be completed.'});
    }
    finally { concurrent--; release(); }
  };
  // Respond before looking up the account or waiting for SMTP. Keep the work
  // bounded and leased after the response so maintenance and shutdown drain it.
  const recovery = fn => (req,res) => {
    if(concurrent>=maxConcurrent) return res.status(429).json({error:'Too many requests.'});
    const release=req.maintenance?.retain() || (()=>{});
    concurrent++;
    Promise.resolve().then(()=>fn(req.body || {})).catch(error=>{
      if (!['INVALID_EMAIL','MAIL_FAILED'].includes(error?.code)) console.error('Account recovery task failed.');
    }).finally(()=>{concurrent--;release();});
    return neutral(res);
  };
  const exclusive = fn => async (req,res) => {
    if (concurrent >= maxConcurrent) return res.status(429).json({error:'Too many requests.'});
    concurrent++;
    try {
      if (typeof req.maintenance?.runExclusive !== 'function') return res.status(503).json({code:'MAINTENANCE_UNAVAILABLE'});
      await req.maintenance.runExclusive(() => fn(req,res));
    } catch (error) {
      if (res.headersSent) return;
      if (error?.code === 'LAST_OWNER') return res.status(409).json({code:'LAST_OWNER'});
      if (error?.code === 'MAINTENANCE_REQUIRED' || error?.code === 'RECOVERY_REQUIRED') return res.status(503).json({code:'MAINTENANCE_UNAVAILABLE'});
      if (error?.code === 'CONFLICT') return res.status(409).json({code:'CONFLICT'});
      if (error?.code === 'NOT_FOUND') return res.status(401).json({error:'Authentication required.'});
      return res.status(500).json({error:'Request could not be completed.'});
    } finally {
      concurrent--;
    }
  };
  router.post('/register', handler(async (req,res) => {
    if (!(typeof registrationEnabled === 'function' ? registrationEnabled() === true : registrationEnabled)) return res.status(403).json({error:'Registration is disabled.'});
    try { await accounts.register(req.body || {}, {onReady:()=>neutral(res)}); }
    catch (error) { if (!['EMAIL_EXISTS','MAIL_FAILED'].includes(error?.code)) throw error; }
    if (!res.headersSent) return neutral(res);
  }));
  router.post('/verify', handler(async (req,res) => {
    if (!accounts.verifyEmail(req.body?.token)) return res.status(400).json({error:'Invalid or expired link.'});
    return res.json({verified:true});
  }));
  router.post('/resend-verification', recovery(body => accounts.sendVerification(body)));
  router.post('/login', handler(async (req,res) => {
    const before = sessions.snapshot(req.body?.email);
    const user = await accounts.authenticate(req.body || {});
    const token = user && sessions.create(user, before);
    if (!token) return res.status(401).json({error:'Invalid credentials or account unavailable.'});
    sessions.setCookie(res,token);
    return res.json({account:{id:user.id,email:user.email}});
  }));
  router.post('/logout', handler(async (req,res) => { sessions.logout(req,res); return res.json({authenticated:false}); }));
  router.post('/forgot-password', recovery(body => accounts.requestPasswordReset(body)));
  router.post('/reset-password', handler(async (req,res) => {
    if (!await accounts.resetPassword(req.body || {})) return res.status(400).json({error:'Invalid or expired link.'});
    return res.json({reset:true});
  }));
  if (apiCredentials) {
    router.get('/credentials', (req,res) => {
      const user=sessions.find(req);
      if (!user) return res.status(401).json({error:'Authentication required.'});
      return res.json({credentials:apiCredentials.list(user.id)});
    });
    router.post('/credentials', handler(async (req,res) => {
      const user=sessions.find(req), body=req.body;
      if (!user) return res.status(401).json({error:'Authentication required.'});
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!['name','scopes','expiresAt','password'].includes(k)) || typeof body.password !== 'string') return res.status(400).json({error:'Invalid credential details.'});
      if (!await accounts.authenticate({email:user.email,password:body.password}) || sessions.find(req)?.id !== user.id) return res.status(401).json({error:'Invalid credentials.'});
      try { return res.status(201).json(apiCredentials.create(user.id,body)); }
      catch (error) { if (error instanceof TypeError) return res.status(400).json({error:'Invalid credential details.'}); throw error; }
    }));
    router.delete('/credentials/:id', (req,res) => {
      const user=sessions.find(req);
      if (!user) return res.status(401).json({error:'Authentication required.'});
      return apiCredentials.revoke(user.id,req.params.id) ? res.sendStatus(204) : res.sendStatus(404);
    });
  }
  router.get('/deletion', (req,res) => {
    const user = sessions.find(req);
    if (!user) return res.status(401).json({error:'Authentication required.'});
    if (typeof accountDeletionStatus !== 'function') return res.status(404).json({error:'Account deletion is unavailable.'});
    try {
      const status = accountDeletionStatus(user.id);
      return res.json({deletion: {canDelete: status.canDelete === true, blockedTeams: Array.isArray(status.blockedTeams) ? status.blockedTeams : []}});
    } catch { return res.status(500).json({error:'Request could not be completed.'}); }
  });
  router.delete('/', exclusive(async (req,res) => {
    if (typeof deleteAccount !== 'function') return res.status(404).json({error:'Account deletion is unavailable.'});
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof body.password !== 'string' || Buffer.byteLength(body.password, 'utf8') > 1024) {
      return res.status(400).json({error:'Password is required.'});
    }
    const user = sessions.find(req);
    if (!user) return res.status(401).json({error:'Authentication required.'});
    if (!await accounts.authenticate({email:user.email, password:body.password})) return res.status(401).json({error:'Invalid credentials.'});
    await deleteAccount(user.id);
    sessions.logout(req,res);
    return res.sendStatus(204);
  }));
  router.get('/me', (req,res) => { const user = sessions.find(req); res.json({account:user ? {id:user.id,email:user.email} : null}); });
  router.use((err,req,res,next) => { if (res.headersSent) return next(err); return res.status(err?.status === 413 ? 413 : 400).json({error:'Invalid request.'}); });
  return router;
}

