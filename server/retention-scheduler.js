// One scan at a time; stop waits for in-flight notification and cleanup before
// the host closes its database. Callbacks must not log message contents.
export function createRetentionScheduler({coordinator,intervalMs=3600000,onResult=()=>{},onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  if (!coordinator || typeof coordinator.runOnce !== 'function' || !Number.isSafeInteger(intervalMs) || intervalMs<1 || intervalMs>2147483647 || [onResult,onError,setTimer,clearTimer].some(fn=>typeof fn!=='function')) throw new TypeError('Invalid retention scheduler');
  let started=false,stopped=false,timer=null,active=null;
  const tick=()=>{
    timer=null;
    if (stopped) return;
    active=(async()=>{
      try { const result=await coordinator.runOnce(); onResult(result); }
      catch { onError(); }
    })().finally(()=>{active=null;if(!stopped)timer=setTimer(tick,intervalMs);});
  };
  return {
    start() { if(started)throw new Error('Scheduler already started');started=true;tick(); },
    isRunning() { return started && !stopped; },
    async waitForIdle() { if(active)await active; },
    async stop() { stopped=true;if(timer!==null){clearTimer(timer);timer=null;}if(active)await active; }
  };
}
