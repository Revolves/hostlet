import { randomUUID } from 'node:crypto';

// Incremental migration: apply exactly once inside the host's migration
// transaction, after workspaces exists. Enable foreign_keys on every connection.
// No data files or existing application/release rows are modified.
export const quotaMigrationSql = `
CREATE TABLE workspace_quotas (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  max_apps INTEGER NOT NULL CHECK(typeof(max_apps)='integer' AND max_apps BETWEEN 0 AND 9007199254740991),
  max_storage_bytes INTEGER NOT NULL CHECK(typeof(max_storage_bytes)='integer' AND max_storage_bytes BETWEEN 0 AND 9007199254740991),
  max_upload_bytes INTEGER NOT NULL CHECK(typeof(max_upload_bytes)='integer' AND max_upload_bytes BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE workspace_quota_reservations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  apps INTEGER NOT NULL CHECK(typeof(apps)='integer' AND apps IN (0,1)),
  bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes BETWEEN 0 AND 9007199254740991),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX workspace_quota_reservations_expiry ON workspace_quota_reservations(workspace_id,expires_at);
`;

export const DEFAULT_QUOTAS = Object.freeze({ maxApps: 20, maxStorageBytes: 1024 * 1024 * 1024, maxUploadBytes: 50 * 1024 * 1024 });
export class QuotaError extends Error {
  constructor(code, reason) { super(code); this.name = 'QuotaError'; this.code = code; this.reason = reason; }
}
const fail = (code, reason) => { throw new QuotaError(code, reason); };
const integer = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const idValid = id => typeof id === 'string' && id.length > 0 && id.length <= 200;
const sync = result => { if (result && typeof result.then === 'function') throw new TypeError('quota callbacks must be synchronous'); return result; };

/**
 * Synchronous node:sqlite service; the host must add quotaMigrationSql to its
 * migration chain. Workspace uploads use reserveUpload/commit through the page
 * service; this module itself does not expose quota configuration routes.
 * createQuotaService({db, authorize, readUsage, defaultLimits?, clock?}). Call outside any
 * transaction; configure busy_timeout and foreign_keys on every connection.
 * authorize(workspaceId, actor, action) must synchronously throw on denial;
 * actions are 'view', 'manage' (platform administrator), and 'upload'. It runs
 * under the same write lock as operations, so callers can check current roles.
 * readUsage(workspaceId) runs under that lock and returns {apps, bytes} as
 * nonnegative safe integers from authoritative SQLite rows on this connection.
 * Count each application once and sum ALL retained releases once, including the
 * current release; never add workspace_pages.size_bytes again. All competing
 * writers must use this same protocol and database; stale/external counts or
 * writers bypassing it cannot be protected by the reservation lock.
 * defaultLimits() is synchronous and evaluated inside the write transaction
 * whenever a workspace has no explicit override; it must return valid limits
 * without starting another transaction. Defaults are read again on each request.
 *
 * get(id,actor), update(id,actor,{maxApps,maxStorageBytes,maxUploadBytes}),
 * reserve(id,actor,{apps:0|1,bytes,ttlMs}), release(id,actor,reservationId),
 * reap(id,actor), commit(id,actor,reservationId,{apps,bytes},writeUsage).
 * reserveUpload(id,actor,{apps,zip,contentLength?,ttlMs}) reserves the final
 * storage upper bound independently of the returned rawLimit. It reserves
 * up to 100 MiB of available storage for ZIP and min(rawLimit, whole HTTP Content-Length) for HTML, or
 * rawLimit when no length is known. rawLimit is capped at 100 MiB. Content
 * length must come from a correctly framed HTTP request, never a client estimate.
 * cancel(id,reservationId) is a trusted server-only cleanup capability, not an
 * endpoint: the random ID must remain private. It also works after revocation.
 * reserve bytes is an upper bound on newly retained storage (including expanded
 * archives); also enforce the raw upload cap while streaming. ttlMs is 1ms to
 * 24h; expiry uses the injected wall clock (default Date.now), so all processes
 * need synchronized clocks. The caller must stop and clean up staging on failure
 * or expiry; never publish an expired reservation. release is idempotent.
 * commit runs synchronous writeUsage() in the same SQLite transaction and
 * verifies the authoritative usage delta exactly equals the supplied actual
 * values, each <= reserved. Throws roll back both the write and reservation.
 * Only database metadata belongs in writeUsage: filesystem staging/publication,
 * crash recovery and cleanup are caller responsibilities. Limits lowered after
 * reservation do not invalidate it; existing data and reservations are retained.
 * Errors: INVALID, NOT_FOUND, EXPIRED, UPLOAD_TOO_LARGE, QUOTA_EXCEEDED,
 * USAGE_MISMATCH; authorization/database errors propagate unchanged.
 */
export function createQuotaService({ db, authorize, readUsage, clock = Date.now, defaultLimits = () => DEFAULT_QUOTAS, onChange = () => {} } = {}) {
  if (!db || typeof authorize !== 'function' || typeof readUsage !== 'function' || typeof clock !== 'function' || typeof defaultLimits !== 'function' || typeof onChange !== 'function') throw new TypeError('db, authorize, readUsage, clock and defaultLimits are required');
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('foreign_keys must be enabled');
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } };
  const check = (id, actor, action) => {
    if (!idValid(id) || !idValid(actor)) fail('INVALID');
    sync(authorize(id, actor, action));
    if (!db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(id)) fail('NOT_FOUND');
  };
  const time = () => { const n=sync(clock()); if (!integer(n)) fail('INVALID'); return n; };
  const limits = id => {
    const row=db.prepare('SELECT max_apps AS maxApps,max_storage_bytes AS maxStorageBytes,max_upload_bytes AS maxUploadBytes FROM workspace_quotas WHERE workspace_id=?').get(id);
    const value=row || sync(defaultLimits());
    if (!value || !integer(value.maxApps) || !integer(value.maxStorageBytes) || !integer(value.maxUploadBytes)) fail('INVALID');
    return {maxApps:value.maxApps,maxStorageBytes:value.maxStorageBytes,maxUploadBytes:value.maxUploadBytes};
  };
  const used = id => {
    const result=sync(readUsage(id));
    if (!result || !integer(result.apps) || !integer(result.bytes)) fail('INVALID');
    return {apps:result.apps,bytes:result.bytes};
  };
  const amount = value => { if (!value || !integer(value.apps) || value.apps > 1 || !integer(value.bytes)) fail('INVALID'); };
  const insertReservation = (id,value,now,expiry,l) => {
    const u=used(id);
    let apps=BigInt(u.apps)+BigInt(value.apps), usedBytes=BigInt(u.bytes);
    for (const r of db.prepare('SELECT apps,bytes FROM workspace_quota_reservations WHERE workspace_id=? AND expires_at>?').iterate(id,now)) { apps+=BigInt(r.apps); usedBytes+=BigInt(r.bytes); }
    if (apps > BigInt(l.maxApps)) fail('QUOTA_EXCEEDED','apps');
    const available=BigInt(l.maxStorageBytes)-usedBytes;
    if(value.zip && available<=0n) fail('QUOTA_EXCEEDED','storage');
    const bytes=value.zip ? Number(available<BigInt(value.bytes) ? available : BigInt(value.bytes)) : value.bytes;
    if (BigInt(bytes) > available) fail('QUOTA_EXCEEDED','storage');
    const reservation={id:randomUUID(),workspaceId:id,apps:value.apps,bytes,expiresAt:expiry};
    db.prepare('INSERT INTO workspace_quota_reservations VALUES (?,?,?,?,?)').run(reservation.id,id,value.apps,bytes,expiry);
    return reservation;
  };
  return {
    get(id,actor) { return tx(()=>{ check(id,actor,'view'); return limits(id); }); },
    getConfig(id,actor) { return tx(()=>{ check(id,actor,'view');return {...limits(id),source:db.prepare('SELECT 1 FROM workspace_quotas WHERE workspace_id=?').get(id) ? 'override' : 'default'}; }); },
    update(id,actor,value) { return tx(()=>{
      check(id,actor,'manage');
      if (!value || !integer(value.maxApps) || !integer(value.maxStorageBytes) || !integer(value.maxUploadBytes) || value.maxUploadBytes > value.maxStorageBytes) fail('INVALID');
      db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET max_apps=excluded.max_apps,max_storage_bytes=excluded.max_storage_bytes,max_upload_bytes=excluded.max_upload_bytes').run(id,value.maxApps,value.maxStorageBytes,value.maxUploadBytes);
      sync(onChange(id,actor,'quota.override'));
      return limits(id);
    }); },
    clearOverride(id,actor) { return tx(()=>{
      check(id,actor,'manage');
      const changed=db.prepare('DELETE FROM workspace_quotas WHERE workspace_id=?').run(id).changes;
      const result={...limits(id),source:'default'};
      if(changed)sync(onChange(id,actor,'quota.default'));
      return result;
    }); },
    reserve(id,actor,value) { return tx(()=>{
      check(id,actor,'upload'); amount(value);
      if (!integer(value.ttlMs) || value.ttlMs < 1 || value.ttlMs > 86400000) fail('INVALID');
      const now=time(), expiry=now+value.ttlMs;
      if (!integer(expiry)) fail('INVALID');
      const l=limits(id);
      if (value.bytes > l.maxUploadBytes) fail('UPLOAD_TOO_LARGE');
      return insertReservation(id,value,now,expiry,l);
    }); },
    // The upload cap applies to raw bytes; expanded ZIP storage is reserved separately.
    reserveUpload(id,actor,{apps,zip,contentLength,ttlMs}={}) { return tx(()=>{
      check(id,actor,'upload');
      if (![0,1].includes(apps) || typeof zip !== 'boolean' || (contentLength !== undefined && !integer(contentLength)) || !integer(ttlMs) || ttlMs < 1 || ttlMs > 86400000) fail('INVALID');
      const now=time(), expiry=now+ttlMs; if (!integer(expiry)) fail('INVALID');
      const l=limits(id), rawLimit=Math.min(l.maxUploadBytes,100*1024*1024);
      const bytes=zip ? 100*1024*1024 : Math.min(rawLimit,contentLength ?? rawLimit);
      return {...insertReservation(id,{apps,bytes,zip},now,expiry,l),rawLimit};
    }); },
    // Internal capability cleanup: only call with the server-owned random id;
    // unlike release it works after membership revocation, without deleting data.
    cancel(id,reservationId) { return tx(()=>{
      if (!idValid(id) || !idValid(reservationId)) fail('INVALID');
      return db.prepare('DELETE FROM workspace_quota_reservations WHERE workspace_id=? AND id=?').run(id,reservationId).changes === 1;
    }); },
    release(id,actor,reservationId) { return tx(()=>{
      check(id,actor,'upload'); if (!idValid(reservationId)) fail('INVALID');
      return db.prepare('DELETE FROM workspace_quota_reservations WHERE workspace_id=? AND id=?').run(id,reservationId).changes === 1;
    }); },
    reap(id,actor) { return tx(()=>{
      check(id,actor,'manage');
      return Number(db.prepare('DELETE FROM workspace_quota_reservations WHERE workspace_id=? AND expires_at<=?').run(id,time()).changes);
    }); },
    commit(id,actor,reservationId,actual,writeUsage) { return tx(()=>{
      check(id,actor,'upload'); if (!idValid(reservationId) || typeof writeUsage !== 'function') fail('INVALID'); amount(actual);
      const r=db.prepare('SELECT apps,bytes,expires_at FROM workspace_quota_reservations WHERE workspace_id=? AND id=?').get(id,reservationId);
      if (!r) fail('NOT_FOUND'); if (r.expires_at <= time()) fail('EXPIRED');
      if (actual.apps > r.apps || actual.bytes > r.bytes) fail('INVALID');
      const before=used(id); const result=sync(writeUsage()); const after=used(id);
      if (BigInt(after.apps)-BigInt(before.apps) !== BigInt(actual.apps) || BigInt(after.bytes)-BigInt(before.bytes) !== BigInt(actual.bytes)) fail('USAGE_MISMATCH');
      db.prepare('DELETE FROM workspace_quota_reservations WHERE workspace_id=? AND id=?').run(id,reservationId);
      return result;
    }); }
  };
}
