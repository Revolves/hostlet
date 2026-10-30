// A process-local gate. Every request touching workspace data must pass through
// middleware, and work that can outlive a response must retain a child lease
// before it starts and release it in a finally block. This is not a process lock.
export function createMaintenanceGate() {
  let paused=false, exclusive=false, failed=false, active=0, drained=null;
  const add = () => {
    active++;
    let released=false;
    return () => {
      if (released) return;
      released=true; active--;
      if (active===0 && drained) { const resolve=drained; drained=null; resolve(); }
    };
  };
  const runExclusive = async (fn, beforeDrain = () => {}) => {
    if (typeof fn !== 'function') throw new TypeError('Maintenance callback required');
    if (paused) throw new Error('Maintenance already active');
    paused=true;
    try {
      beforeDrain();
      if (active) await new Promise(resolve=>{drained=resolve;});
      exclusive=true;
      return await fn();
    } finally { exclusive=false; paused=failed; }
  };
  return {
    middleware(req,res,next) {
      if (paused) return res.set('Retry-After','5').set('Cache-Control','no-store').status(503).send('Service temporarily unavailable');
      const release=add(); let open=true, children=0;
      req.maintenance={
        retain() {
          if (!open) throw new Error('Request already closed');
          const done=add(); children++; let released=false;
          return () => { if (!released) { released=true; children--; done(); } };
        },
        runExclusive(fn) {
          if (!open || children) return Promise.reject(new Error('Request cannot enter maintenance'));
          return runExclusive(fn,()=>{open=false;release();});
        }
      };
      const done=()=>{open=false;release();};
      res.once('finish',done); res.once('close',done);
      next();
    },
    isQuiescent() { return exclusive && !failed && active===0; },
    failClosed() { if (!exclusive) throw new Error('Exclusive maintenance required'); failed=true; },
    runExclusive(fn) { return runExclusive(fn); }
  };
}
