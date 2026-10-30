import { randomUUID } from 'node:crypto';
import { DEFAULT_QUOTAS } from './quotas.js';

// Apply once in a host migration after workspace_pages and workspace_page_ids;
// enable foreign_keys on every connection. References use permanently reserved
// IDs so deleting an active page does not remove its reports or suspension.
// No data is deleted by this service. Times are epoch ms.
export const platformAdminSchema = `
CREATE TABLE platform_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE platform_reports (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES workspace_page_ids(id),
  category TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','resolved')),
  created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT
);
CREATE INDEX platform_reports_order ON platform_reports(created_at DESC,id);
CREATE TABLE platform_page_suspensions (
  page_id TEXT PRIMARY KEY REFERENCES workspace_page_ids(id), suspended_at INTEGER NOT NULL, suspended_by TEXT NOT NULL
);
CREATE TABLE platform_admin_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  target_id TEXT, created_at INTEGER NOT NULL
);
`;
const fail = code => { throw Object.assign(new Error(code), {code}); };
const idOk = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 200;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, names) => object(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
const uint = x => Number.isSafeInteger(x) && x >= 0;
const defaults = registrationEnabled => ({registrationEnabled,retention:{mode:'long-term',days:null,notifyBeforeDays:null},defaultQuotas:{...DEFAULT_QUOTAS}});
function validateSettings(s) {
  if (!keys(s,['registrationEnabled','retention','defaultQuotas']) || typeof s.registrationEnabled !== 'boolean' ||
      !keys(s.retention,['mode','days','notifyBeforeDays']) ||
      !(s.retention.mode === 'long-term' && s.retention.days === null && s.retention.notifyBeforeDays === null ||
      s.retention.mode === 'inactivity' && Number.isSafeInteger(s.retention.days) && s.retention.days >= 1 && s.retention.days <= 36500 && uint(s.retention.notifyBeforeDays) && s.retention.notifyBeforeDays >= 1 && s.retention.notifyBeforeDays < s.retention.days) ||
      !keys(s.defaultQuotas,['maxApps','maxStorageBytes','maxUploadBytes']) ||
      !Object.values(s.defaultQuotas).every(uint) || s.defaultQuotas.maxUploadBytes > s.defaultQuotas.maxStorageBytes) fail('INVALID');
}
/**
 * Independent synchronous service. Host owns admin authorization and calls
 * mutation methods only after authenticating the actor. No nested transactions.
 * getSettings/updateSettings use whole-object replacement. Long-term uses null
 * days/notice; inactivity requires 1..36500 days and 1 <= notice < days.
 * submitReport accepts pageId (<=200), category (<=64), description (<=2000)
 * as nonblank strings. listReports supports {limit,offset}, default 50/0.
 * Audit records operation, trusted actor, target and time, never request bodies.
 * Integrators must check isSuspended on every content/resource request and
 * implement enforcement of registration/quotas, migrations, notification and
 * retention separately. Settings alone do not send mail or delete content.
 */
export function createPlatformAdminService({db, now=Date.now, defaultRegistrationEnabled=false} = {}) {
  if (!db || typeof now !== 'function' || typeof defaultRegistrationEnabled !== 'boolean' || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new TypeError('Invalid platform admin configuration');
  const clock=()=>{const t=now(); if (!uint(t)) throw new Error('Invalid clock'); return t;};
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try {const result=fn();db.exec('COMMIT');return result;} catch(e){try{db.exec('ROLLBACK');}catch{} throw e;}};
  const actorOk=actor=>{if(!idOk(actor)) fail('INVALID');};
  const pageOk=id=>{if(!idOk(id)) fail('INVALID'); if(!db.prepare('SELECT 1 FROM workspace_pages WHERE id=?').get(id)) fail('NOT_FOUND');};
  const audit=(actor,action,target,at)=>db.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run(randomUUID(),actor,action,target,at);
  const read=()=>{const row=db.prepare('SELECT value FROM platform_settings WHERE id=1').get(); if(!row) return defaults(defaultRegistrationEnabled); const value=JSON.parse(row.value);validateSettings(value);return value;};
  return {
    getSettings:read,
    listWorkspaces(offset = 0) {
      if (!uint(offset)) fail('INVALID');
      const rows = db.prepare(`SELECT w.id,w.name,w.type,w.created_by AS ownerId,u.email AS ownerEmail,w.created_at AS createdAt
        FROM workspaces w JOIN users u ON u.id=w.created_by ORDER BY w.created_at,w.id LIMIT 101 OFFSET ?`).all(offset).map(row => ({...row}));
      return { workspaces: rows.slice(0,100), nextOffset: rows.length > 100 ? offset + 100 : null };
    },
    updateSettings(actor,value) { return tx(()=>{actorOk(actor);validateSettings(value);const at=clock();db.prepare('INSERT INTO platform_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(value));audit(actor,'settings.update',null,at);return read();}); },
    submitReport(value) { return tx(()=>{
      if(!keys(value,['pageId','category','description']) || !idOk(value.pageId) || typeof value.category !== 'string' || !value.category.trim() || value.category.length>64 || typeof value.description !== 'string' || !value.description.trim() || value.description.length>2000) fail('INVALID');
      pageOk(value.pageId);const id=randomUUID(),at=clock();db.prepare("INSERT INTO platform_reports VALUES (?,?,?,?, 'pending',?,NULL,NULL)").run(id,value.pageId,value.category.trim(),value.description.trim(),at);return {id};
    }); },
    listReports({limit=50,offset=0}={}) {if(!Number.isSafeInteger(limit)||limit<1||limit>100||!uint(offset)) fail('INVALID');return db.prepare('SELECT id,page_id AS pageId,category,description,status,created_at AS createdAt,resolved_at AS resolvedAt,resolved_by AS resolvedBy FROM platform_reports ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(limit,offset).map(row=>({...row}));},
    listReportPage(cursor = null) {
      if (cursor !== null && (!keys(cursor,['createdAt','id']) || !uint(cursor.createdAt) || !idOk(cursor.id))) fail('INVALID');
      const columns="r.id,r.page_id AS pageId,r.category,r.description,r.status,r.created_at AS createdAt,r.resolved_at AS resolvedAt,r.resolved_by AS resolvedBy,CASE WHEN p.id IS NULL THEN 'deleted' WHEN s.page_id IS NOT NULL THEN 'suspended' ELSE 'active' END AS pageState";
      const from='FROM platform_reports r LEFT JOIN workspace_pages p ON p.id=r.page_id LEFT JOIN platform_page_suspensions s ON s.page_id=r.page_id';
      const rows = cursor === null
        ? db.prepare(`SELECT ${columns} ${from} ORDER BY r.created_at DESC,r.id LIMIT 51`).all()
        : db.prepare(`SELECT ${columns} ${from} WHERE r.created_at < ? OR (r.created_at = ? AND r.id > ?) ORDER BY r.created_at DESC,r.id LIMIT 51`).all(cursor.createdAt,cursor.createdAt,cursor.id);
      const reports=rows.slice(0,50).map(row=>({...row}));
      const last=reports.at(-1);
      return {reports,nextCursor:rows.length>50 ? {createdAt:last.createdAt,id:last.id} : null};
    },
    resolveReport(actor,id) {return tx(()=>{actorOk(actor);if(!idOk(id)) fail('INVALID');const at=clock();if(!db.prepare("UPDATE platform_reports SET status='resolved',resolved_at=?,resolved_by=? WHERE id=? AND status='pending'").run(at,actor,id).changes) {if(!db.prepare('SELECT 1 FROM platform_reports WHERE id=?').get(id)) fail('NOT_FOUND');fail('CONFLICT');}audit(actor,'report.resolve',id,at);});},
    suspendPage(actor,id) {return tx(()=>{actorOk(actor);pageOk(id);const at=clock();if(!db.prepare('INSERT INTO platform_page_suspensions VALUES (?,?,?) ON CONFLICT(page_id) DO NOTHING').run(id,at,actor).changes) fail('CONFLICT');audit(actor,'page.suspend',id,at);});},
    restorePage(actor,id) {return tx(()=>{actorOk(actor);pageOk(id);const at=clock();if(!db.prepare('DELETE FROM platform_page_suspensions WHERE page_id=?').run(id).changes) fail('CONFLICT');audit(actor,'page.restore',id,at);});},
    isSuspended(id) {if(!idOk(id)) fail('INVALID');return !!db.prepare('SELECT 1 FROM platform_page_suspensions WHERE page_id=?').get(id);}
  };
}
