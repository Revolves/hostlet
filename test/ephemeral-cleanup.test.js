import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createEphemeralCleanup} from '../server/ephemeral-cleanup.js';
import {openDatabase} from '../server/database.js';

const tables=['account_tokens','account_sessions','workspace_host_tickets','workspace_host_sessions','workspace_share_tickets','workspace_share_sessions','workspace_quota_reservations'];
function setup(t) {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const table of tables) db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL); INSERT INTO ${table} VALUES ('expired',99),('boundary',100),('active',101);`);
 db.exec("CREATE TABLE workspace_shares(id TEXT PRIMARY KEY,expires_at INTEGER); INSERT INTO workspace_shares VALUES ('history',99);");t.after(()=>db.close());return db;
}
test('cleans only expired temporary records in bounded batches',t=>{
 const db=setup(t),cleanup=createEphemeralCleanup({db,now:()=>100,batchSize:1});
 cleanup.runOnce();for(const table of tables) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,2);
 cleanup.runOnce();cleanup.runOnce();
 for(const table of tables) assert.deepEqual(db.prepare(`SELECT id FROM ${table}`).all().map(row=>row.id),['active']);
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_shares').get().n,1);
});
test('invalid clocks fail without deleting records',t=>{
 const db=setup(t);const cleanup=createEphemeralCleanup({db,now:()=>NaN});assert.throws(()=>cleanup.runOnce(),/clock/i);
 for(const table of tables) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,3);
});
test('migrated databases index expiry scans for all temporary records',t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 for(const table of tables) {
  const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT rowid FROM ${table} WHERE expires_at <= ? LIMIT ?`).all(100,1000);
  assert.ok(plan.some(row=>/USING.*INDEX/i.test(row.detail)),`${table} expiry scan is not indexed`);
 }
});
