import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetentionScheduler } from '../server/retention-scheduler.js';

test('scheduler does not overlap scans and waits for an active scan when stopped',async()=>{
 let resume,started;const entered=new Promise(resolve=>{started=resolve;}), wait=new Promise(resolve=>{resume=resolve;});let count=0,timers=0;
 const scheduler=createRetentionScheduler({coordinator:{async runOnce(){count++;started();await wait;return {deliveryFailures:0,deletionFailures:0};}},intervalMs:1000,setTimer(){timers++;return {};},clearTimer(){}});
 scheduler.start();await entered;assert.throws(()=>scheduler.start(),/started/);
 let stopped=false;const stop=scheduler.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
 resume();await stop;assert.equal(count,1);assert.equal(timers,0);assert.equal(stopped,true);
});

test('a failed scan reports failure and schedules a retry',async()=>{
 let run,done;const finished=new Promise(resolve=>{done=resolve;});let calls=0,errors=0;
 const scheduler=createRetentionScheduler({coordinator:{async runOnce(){calls++;if(calls===1)throw Error('private details');return {deliveryFailures:0,deletionFailures:0};}},intervalMs:1000,setTimer(fn){run=fn;done();return 1;},clearTimer(){},onError(){errors++;}});
 scheduler.start();await finished;assert.equal(errors,1);assert.equal(calls,1);
 run();await scheduler.stop();assert.equal(calls,2);
});
