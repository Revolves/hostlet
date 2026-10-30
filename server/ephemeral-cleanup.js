// Expiry is enforced at read/commit time; this only reclaims database rows.
// Never remove users, shares, applications or files as part of this job.
const tables = ['account_tokens','account_sessions','workspace_host_tickets','workspace_host_sessions','workspace_share_tickets','workspace_share_sessions','workspace_quota_reservations'];
export const ephemeralCleanupIndexesSql = `
CREATE INDEX workspace_host_tickets_expiry ON workspace_host_tickets(expires_at);
CREATE INDEX workspace_host_sessions_expiry ON workspace_host_sessions(expires_at);
CREATE INDEX workspace_share_tickets_expiry ON workspace_share_tickets(expires_at);
CREATE INDEX workspace_share_sessions_expiry ON workspace_share_sessions(expires_at);
CREATE INDEX workspace_quota_reservations_expiry_global ON workspace_quota_reservations(expires_at);
`;

export function createEphemeralCleanup({db,now=Date.now,batchSize=1000}={}) {
  if (!db || typeof now!=='function' || !Number.isSafeInteger(batchSize) || batchSize<1 || batchSize>10000) throw new TypeError('Invalid cleanup configuration');
  const statements=tables.map(table=>db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at <= ? LIMIT ?)`));
  return {
    runOnce() {
      const at=now();if (!Number.isSafeInteger(at) || at<0) throw new Error('Invalid cleanup clock');
      return Object.fromEntries(tables.map((table,i)=>[table,Number(statements[i].run(at,batchSize).changes)]));
    }
  };
}
