import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsStatus } from '../server/operations-status.js';

test('operational status reports aggregate failures and recovery without storing errors or message data', () => {
  let time=1000;const status=createOperationsStatus({now:()=>time});
  assert.equal(status.snapshot().accountMail.lastResult,'unknown');
  status.record('accountMail',false);time++;
  status.record('accountMail',false);time++;
  status.record('retention',false);time++;
  status.record('accountMail',true);
  const snapshot=status.snapshot();
  assert.deepEqual(snapshot.accountMail,{lastResult:'ok',lastAt:1003,failures:2,consecutiveFailures:0});
  assert.deepEqual(snapshot.retention,{lastResult:'failed',lastAt:1002,failures:1,consecutiveFailures:1});
  assert.throws(()=>status.record('not-a-task',false));
  assert.throws(()=>status.record('accountMail','secret-token'));
  assert.ok(!JSON.stringify(snapshot).includes('secret-token'));
  status.recordRetention({deliveryFailures:0,deletionFailures:0,blockedPages:2});
  assert.equal(status.snapshot().retention.lastResult,'failed');
  assert.deepEqual(status.snapshot().retentionDetails,{deliveryFailures:0,deletionFailures:0,blockedPages:2});
  status.recordRetention({deliveryFailures:0,deletionFailures:0,blockedPages:0});
  assert.equal(status.snapshot().retention.lastResult,'ok');
  assert.throws(()=>status.recordRetention({deliveryFailures:0,deletionFailures:0,blockedPages:'secret'}));
});
