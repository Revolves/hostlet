// Notifications may use the network and run outside maintenance. Deletion and
// journal recovery run only after all protected requests have drained.
export function createRetentionCoordinator({ service, gate, deletion }) {
  if (!service || typeof service.notify !== 'function' || typeof service.cleanup !== 'function' || !gate || typeof gate.runExclusive !== 'function' || typeof gate.failClosed !== 'function' || !deletion || typeof deletion.recover !== 'function') throw new TypeError('Invalid retention coordinator');
  let running=false;
  return {
    async runOnce() {
      if (running) throw new Error('Retention scan already active');
      running=true;
      try {
        const notices=await service.notify();
        // Checking without pausing is only a hint. Deletion still revalidates
        // eligibility under exclusive maintenance; uncertain state fails closed.
        if (typeof deletion.hasPending==='function' && typeof service.hasCleanupWork==='function' && deletion.hasPending()===false && service.hasCleanupWork()===false) return {...notices,deletionFailures:0};
        const cleanup=await gate.runExclusive(()=>{
          const recover=()=>{try { deletion.recover(); } catch (error) { gate.failClosed(); throw error; }};
          recover();
          try { return service.cleanup(); }
          finally { recover(); }
        });
        return {...notices,...cleanup};
      } finally { running=false; }
    }
  };
}
