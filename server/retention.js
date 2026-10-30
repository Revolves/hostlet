import { createHash, randomUUID } from 'node:crypto';

// Install once, in a host migration after accounts, workspaces, page revisions and platform settings.
export const retentionSchema = `
CREATE TABLE retention_batches(id TEXT PRIMARY KEY,page_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 revision INTEGER NOT NULL,updated_at TEXT NOT NULL,settings_fingerprint TEXT NOT NULL,
 owners_fingerprint TEXT NOT NULL,valid INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX retention_one_active ON retention_batches(page_id) WHERE valid=1;
CREATE TABLE retention_deliveries(batch_id TEXT NOT NULL REFERENCES retention_batches(id),user_id TEXT NOT NULL,
 email TEXT NOT NULL,delivery_key TEXT NOT NULL UNIQUE,sent_at INTEGER,lease_until INTEGER,lease_id TEXT,
 PRIMARY KEY(batch_id,user_id));
CREATE TRIGGER retention_settings_update AFTER UPDATE ON platform_settings BEGIN UPDATE retention_batches SET valid=0 WHERE valid=1; END;
CREATE TRIGGER retention_settings_insert AFTER INSERT ON platform_settings BEGIN UPDATE retention_batches SET valid=0 WHERE valid=1; END;
CREATE TRIGGER retention_settings_delete AFTER DELETE ON platform_settings BEGIN UPDATE retention_batches SET valid=0 WHERE valid=1; END;
CREATE TRIGGER retention_page_update AFTER UPDATE ON workspace_pages BEGIN UPDATE retention_batches SET valid=0 WHERE page_id=OLD.id AND valid=1; END;
CREATE TRIGGER retention_page_delete AFTER DELETE ON workspace_pages BEGIN UPDATE retention_batches SET valid=0 WHERE page_id=OLD.id AND valid=1; END;
CREATE TRIGGER retention_revision_update AFTER UPDATE ON workspace_page_revisions BEGIN UPDATE retention_batches SET valid=0 WHERE page_id=OLD.page_id AND valid=1; END;
CREATE TRIGGER retention_revision_delete AFTER DELETE ON workspace_page_revisions BEGIN UPDATE retention_batches SET valid=0 WHERE page_id=OLD.page_id AND valid=1; END;
CREATE TRIGGER retention_member_insert AFTER INSERT ON workspace_members BEGIN UPDATE retention_batches SET valid=0 WHERE workspace_id=NEW.workspace_id AND valid=1; END;
CREATE TRIGGER retention_member_update AFTER UPDATE ON workspace_members BEGIN UPDATE retention_batches SET valid=0 WHERE workspace_id IN (OLD.workspace_id,NEW.workspace_id) AND valid=1; END;
CREATE TRIGGER retention_member_delete AFTER DELETE ON workspace_members BEGIN UPDATE retention_batches SET valid=0 WHERE workspace_id=OLD.workspace_id AND valid=1; END;
CREATE TRIGGER retention_user_update AFTER UPDATE OF email,email_verified_at ON users BEGIN UPDATE retention_batches SET valid=0 WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=OLD.id) AND valid=1; END;
CREATE TRIGGER retention_user_delete AFTER DELETE ON users BEGIN UPDATE retention_batches SET valid=0 WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=OLD.id) AND valid=1; END;
CREATE TRIGGER retention_workspace_delete AFTER DELETE ON workspaces BEGIN UPDATE retention_batches SET valid=0 WHERE workspace_id=OLD.id AND valid=1; END;
`;
const DAY=86400000, LEASE=300000;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const emailOk=x=>typeof x==='string' && /^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+$/.test(x);

/** Standalone worker; host provides authorization, migration, scheduler and trusted adapters. */
export function createRetentionService({db, sender, now=Date.now, deletion, deletePage}={}) {
 if(!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1 || typeof sender!=='function' || typeof now!=='function' || deletePage!==undefined || (deletion!==undefined && (!deletion || typeof deletion.execute!=='function'))) throw new TypeError('Invalid retention configuration');
 const clock=()=>{const n=now();if(!Number.isSafeInteger(n)||n<0) throw new Error('Invalid clock');return n;};
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try {const v=fn();db.exec('COMMIT');return v;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}};
 const settings=()=>{
  const row=db.prepare('SELECT value FROM platform_settings WHERE id=1').get(); if(!row) return null;
  let p;try{p=JSON.parse(row.value).retention;}catch{throw new Error('Invalid retention settings');}
  if(p?.mode==='long-term' && p.days===null && p.notifyBeforeDays===null) return null;
  if(p?.mode!=='inactivity'||!Number.isSafeInteger(p.days)||p.days<1||p.days>36500||!Number.isSafeInteger(p.notifyBeforeDays)||p.notifyBeforeDays<1||p.notifyBeforeDays>=p.days) throw new Error('Invalid retention settings');
  return {mode:p.mode,days:p.days,notifyBeforeDays:p.notifyBeforeDays};
 };
 const inspect=(id,p)=>{
  const page=db.prepare('SELECT p.id,p.workspace_id,p.updated_at,r.revision FROM workspace_pages p JOIN workspaces w ON w.id=p.workspace_id JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.id=?').get(id);
  if(!page||!Number.isSafeInteger(page.revision)||page.revision<0||typeof page.updated_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(page.updated_at)) return {reason:'metadata'};
  const updated=Date.parse(page.updated_at);if(!Number.isSafeInteger(updated)||new Date(updated).toISOString()!==page.updated_at) return {reason:'metadata'};
  const owners=db.prepare("SELECT m.user_id,u.email,u.email_verified_at FROM workspace_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.role='owner' ORDER BY m.user_id").all(page.workspace_id);
  if(!owners.length||owners.some(o=>o.email_verified_at===null||o.email_verified_at===undefined||!emailOk(o.email))) return {reason:'owners'};
  return {value:{page,updated,owners,settingsHash:hash(p),ownersHash:hash(owners.map(o=>[o.user_id,o.email,o.email_verified_at]))}};
 };
 const state=(id,p)=>inspect(id,p).value || null;
 const matches=(b,s)=>s && b.workspace_id===s.page.workspace_id && b.revision===s.page.revision && b.updated_at===s.page.updated_at && b.settings_fingerprint===s.settingsHash && b.owners_fingerprint===s.ownersHash;
 const prepare=id=>tx(()=>{
  const at=clock(),p=settings();if(!p)return;
  const s=state(id,p);if(!s)return false;
  if(at<s.updated+(p.days-p.notifyBeforeDays)*DAY)return true;
  let b=db.prepare('SELECT * FROM retention_batches WHERE page_id=? AND valid=1').get(id);
  if(b&&!matches(b,s)){db.prepare('UPDATE retention_batches SET valid=0 WHERE id=?').run(b.id);b=null;}
  if(!b){const bid=randomUUID();db.prepare('INSERT INTO retention_batches VALUES (?,?,?,?,?,?,?,?,?)').run(bid,id,s.page.workspace_id,s.page.revision,s.page.updated_at,s.settingsHash,s.ownersHash,1,at);
   for(const o of s.owners) db.prepare('INSERT INTO retention_deliveries VALUES (?,?,?,?,NULL,NULL,NULL)').run(bid,o.user_id,o.email,randomUUID());
  }
  return true;
 });
 const claim=id=>tx(()=>{
  const at=clock(),p=settings();if(!p)return null;
  const b=db.prepare('SELECT * FROM retention_batches WHERE page_id=? AND valid=1').get(id),s=state(id,p);
  if(!b||!matches(b,s))return null;
  const d=db.prepare('SELECT * FROM retention_deliveries WHERE batch_id=? AND sent_at IS NULL AND (lease_until IS NULL OR lease_until<=?) ORDER BY user_id LIMIT 1').get(b.id,at);
  if(!d)return null;
  const lease=randomUUID();
  db.prepare('UPDATE retention_deliveries SET lease_until=?,lease_id=? WHERE batch_id=? AND user_id=?').run(at+LEASE,lease,b.id,d.user_id);
  return {batch:b.id,user:d.user_id,lease,to:d.email,idempotencyKey:d.delivery_key,pageId:id,workspaceId:b.workspace_id,deleteAfter:Math.max(s.updated+p.days*DAY,at+p.notifyBeforeDays*DAY)};
 });
 const finish=(m,ok)=>tx(()=>{
  const b=db.prepare('SELECT * FROM retention_batches WHERE id=? AND valid=1').get(m.batch),p=settings();
  if(!b||!p||!matches(b,state(b.page_id,p)))return;
  db.prepare('UPDATE retention_deliveries SET sent_at=?,lease_until=NULL,lease_id=NULL WHERE batch_id=? AND user_id=? AND sent_at IS NULL AND lease_id=?').run(ok?clock():null,m.batch,m.user,m.lease);
 });
 const eligible=(id,batchId)=>{
  const at=clock(),p=settings();if(!p)return;
  const b=db.prepare('SELECT * FROM retention_batches WHERE page_id=? AND valid=1').get(id),s=state(id,p);
  if(!b||batchId && b.id!==batchId||!matches(b,s)||at<s.updated+p.days*DAY)return;
  const deliveries=db.prepare('SELECT user_id,email,sent_at FROM retention_deliveries WHERE batch_id=? ORDER BY user_id').all(b.id);
  if(deliveries.length!==s.owners.length || deliveries.some((d,i)=>d.user_id!==s.owners[i].user_id||d.email!==s.owners[i].email||d.sent_at===null||at<d.sent_at+p.notifyBeforeDays*DAY))return;
  return b;
 };
 const cleanup=id=>{
  if(!deletion)return;
  const b=tx(()=>eligible(id));if(!b)return;
  const result=deletion.execute({pageId:id,workspaceId:b.workspace_id,revision:b.revision,validate:({db:activeDb}={})=>activeDb===db && !!eligible(id,b.id)});
  if(result && typeof result.then==='function') throw new Error('deletion must be synchronous');
 };
 const notify=async()=>{
  const result={deliveryFailures:0,blockedPages:0};
  if(!settings())return result;
  const ids=db.prepare('SELECT id FROM workspace_pages ORDER BY id').all().map(r=>r.id);
  for(const id of ids){if(prepare(id)===false){result.blockedPages++;continue;} for(;;){const m=claim(id);if(!m)break;let ok=false;try{ok=(await sender({to:m.to,pageId:m.pageId,workspaceId:m.workspaceId,deleteAfter:m.deleteAfter,idempotencyKey:m.idempotencyKey}))===true;}catch{}finish(m,ok);if(!ok){result.deliveryFailures++;break;}}}
  return result;
 };
 const cleanupAll=()=>{
  const result={deletionFailures:0};
  for(const {id} of db.prepare('SELECT id FROM workspace_pages ORDER BY id').all()) {try{cleanup(id);}catch{result.deletionFailures++;}}
  return result;
 };
 const hasCleanupWork=()=>{
  if(!deletion)return false;
  for(const {page_id} of db.prepare('SELECT page_id FROM retention_batches WHERE valid=1 ORDER BY page_id').iterate()) if(eligible(page_id)) return true;
  return false;
 };
 const listBlocked=(after=null)=>{
  if(after!==null && (typeof after!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(after))) throw new TypeError('Invalid cursor');
  const policy=settings();if(!policy)return {issues:[],nextCursor:null};
  const rows=db.prepare('SELECT id,workspace_id FROM workspace_pages WHERE id>? ORDER BY id LIMIT 201').all(after || '');
  const current=rows.slice(0,200),issues=[];
  for(const row of current){const result=inspect(row.id,policy);if(result.reason)issues.push({pageId:row.id,workspaceId:row.workspace_id,reason:result.reason});}
  return {issues,nextCursor:rows.length>200 ? current.at(-1).id : null};
 };
 return {notify,hasCleanupWork,cleanup:cleanupAll,listBlocked,async scan(){return {...await notify(),...cleanupAll()};}};
}
