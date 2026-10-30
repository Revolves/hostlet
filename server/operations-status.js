// Process-local, deliberately aggregate-only status. Never accept error text,
// recipient addresses, tokens, paths, or other request data.
export function createOperationsStatus({now=Date.now}={}) {
  if (typeof now !== 'function') throw new TypeError('Invalid clock');
  const entries=Object.fromEntries(['accountMail','retention','temporaryCleanup'].map(name=>[name,{lastResult:'unknown',lastAt:null,failures:0,consecutiveFailures:0}]));
  let retentionDetails=null;
  function record(name,success) {
    if (!Object.hasOwn(entries,name) || typeof success !== 'boolean') throw new TypeError('Invalid operation result');
    const at=now();if(!Number.isSafeInteger(at) || at<0) throw new TypeError('Invalid clock');
    const entry=entries[name];entry.lastResult=success?'ok':'failed';entry.lastAt=at;
    if(name==='retention')retentionDetails=null;
    if(success)entry.consecutiveFailures=0;
    else {entry.failures++;entry.consecutiveFailures++;}
  }
  return {
    record,
    recordRetention(result) {
      const keys=['deliveryFailures','deletionFailures','blockedPages'];
      if (!result || keys.some(key=>!Number.isSafeInteger(result[key]) || result[key]<0)) throw new TypeError('Invalid retention result');
      record('retention',keys.every(key=>result[key]===0));
      retentionDetails=Object.fromEntries(keys.map(key=>[key,result[key]]));
    },
    snapshot() {return {...Object.fromEntries(Object.entries(entries).map(([name,entry])=>[name,{...entry}])),retentionDetails:retentionDetails && {...retentionDetails}};}
  };
}
