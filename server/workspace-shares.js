import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Apply after workspaces and workspace_pages, in a versioned migration. Enable
// foreign_keys on every connection. This module does not run migrations.
export const workspaceShareSchema = `
CREATE TABLE workspace_shares (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 page_id TEXT NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, password_hash TEXT, created_at INTEGER NOT NULL,
 expires_at INTEGER, revoked_at INTEGER
);
CREATE INDEX workspace_shares_page ON workspace_shares(workspace_id,page_id);
CREATE TABLE workspace_share_tickets (
 token_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES workspace_shares(id) ON DELETE CASCADE,
 page_id TEXT NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE TABLE workspace_share_sessions (
 token_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES workspace_shares(id) ON DELETE CASCADE,
 page_id TEXT NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
`;

const scrypt = promisify(scryptCallback);
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validPassword = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 0 && Buffer.byteLength(value, 'utf8') <= 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const metadata = row => ({ id: row.id, workspaceId: row.workspace_id, pageId: row.page_id,
  passwordProtected: row.password_hash !== null, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at });

/**
 * Data service only; not connected to HTTP, hosting, or a migration.
 * create(workspaceId, actorId, pageId, {password?, expiresAt?}) returns metadata
 * plus token once. list(workspaceId, actorId, pageId) returns metadata only.
 * revoke(workspaceId, actorId, pageId, shareId) invalidates all grants.
 * issue(pageId, token, password, clientKey) returns a one-use ticket or null.
 * exchange(pageId, ticket) returns {value,maxAge} or null; authorize(pageId,
 * session) returns current page or null. purgeExpired() deletes expired grants.
 * Times are integer epoch milliseconds; default ticket/session TTLs 30s/5min.
 * authorize(workspace, actor, 'edit') is synchronous, trusted, must throw on
 * denial and consult current membership on the same DB connection. limitAttempt
 * is synchronous and MUST return true only if the attempt is allowed; called
 * for every issue before token/password processing, including invalid tokens.
 * Caller must supply a trusted clientKey, enforce distributed/IP and per-share
 * limits (also for exchange), and fail closed if limiter fails. Do not log secrets.
 *
 * Integration boundary: management origin handles token/password via POST body,
 * never URL/query/log/referrer; transfer ticket only by HTTPS form POST to the
 * exact app origin. Validate Origin, CSRF, Host, body sizes and proxy headers;
 * set a host-only __Host- cookie, Secure, HttpOnly, Path=/, SameSite=Lax, no
 * Domain, with maxAge from exchange. Never expose management cookies to apps.
 * Call authorize on EVERY HTML and nested resource request and fail closed.
 * Protect content from caches (private/no-store) and avoid secret-bearing logs.
 * Browser origin isolation, CSRF, cookie issuance, abuse resistance, migration,
 * deployment and concurrent resource streaming are NOT implemented/tested here.
 * Caller owns cleanup, DB busy timeout, HTTPS and secure handling of credentials.
 * Transactions cannot be nested; all service calls use the same DB connection.
 */
export function createWorkspaceShareService({ db, authorize, limitAttempt, audit = () => {}, now = Date.now, ticketTtlMs = 30000, sessionTtlMs = 300000 }) {
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || typeof authorize !== 'function' || typeof limitAttempt !== 'function' || typeof audit !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(ticketTtlMs) || ticketTtlMs < 1000 || ticketTtlMs > 120000 || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 3600000) throw new TypeError('Invalid share configuration');
  const clock = () => { const t = now(); if (!Number.isSafeInteger(t) || t < 0 || t > Number.MAX_SAFE_INTEGER - 3600000) throw new Error('Invalid clock'); return t; };
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (err) { db.exec('ROLLBACK'); throw err; } };
  const page = (workspace, id) => db.prepare("SELECT * FROM workspace_pages WHERE workspace_id=? AND id=? AND access_mode='private'").get(workspace,id);
  const manage = (workspace, actor, id) => { authorize(workspace,actor,'edit'); if (!page(workspace,id)) fail('NOT_FOUND'); };
  const active = (id, pageId, at) => db.prepare(`SELECT s.* FROM workspace_shares s JOIN workspace_pages p ON p.id=s.page_id AND p.workspace_id=s.workspace_id
    WHERE s.id=? AND s.page_id=? AND p.access_mode='private' AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?)`).get(id,pageId,at);
  return {
    async create(workspace, actor, pageId, options = {}) {
      manage(workspace,actor,pageId);
      if (!options || typeof options !== 'object' || (options.password !== undefined && !validPassword(options.password)) || (options.expiresAt != null && (!Number.isSafeInteger(options.expiresAt) || options.expiresAt <= clock()))) fail('INVALID');
      let passwordHash = null;
      if (options.password !== undefined) { const salt = randomBytes(16); const digest = await scrypt(options.password,salt,64); passwordHash = `scrypt$${salt.toString('hex')}$${digest.toString('hex')}`; }
      return tx(() => {
        manage(workspace,actor,pageId); const at = clock();
        if (options.expiresAt != null && options.expiresAt <= at) fail('INVALID');
        const id = randomUUID(), value = secret();
        db.prepare('INSERT INTO workspace_shares VALUES (?,?,?,?,?,?,?,NULL)').run(id,workspace,pageId,hash(value),passwordHash,at,options.expiresAt ?? null);
        audit(workspace,actor,'share.created',pageId,id);
        return { ...metadata(db.prepare('SELECT * FROM workspace_shares WHERE id=?').get(id)), token:value };
      });
    },
    list(workspace, actor, pageId) { manage(workspace,actor,pageId); return db.prepare('SELECT * FROM workspace_shares WHERE workspace_id=? AND page_id=? ORDER BY created_at,id').all(workspace,pageId).map(metadata); },
    revoke(workspace, actor, pageId, shareId) { return tx(() => { manage(workspace,actor,pageId); const existing=db.prepare('SELECT revoked_at FROM workspace_shares WHERE workspace_id=? AND page_id=? AND id=?').get(workspace,pageId,shareId); if (!existing) fail('NOT_FOUND'); if (existing.revoked_at === null) {db.prepare('UPDATE workspace_shares SET revoked_at=? WHERE workspace_id=? AND page_id=? AND id=?').run(clock(),workspace,pageId,shareId);audit(workspace,actor,'share.revoked',pageId,shareId);} }); },
    async issue(pageId, value, password, clientKey) {
      if (typeof clientKey !== 'string' || !clientKey || clientKey.length > 512) fail('INVALID');
      if (limitAttempt(clientKey, pageId) !== true) fail('RATE_LIMITED');
      if (!validSecret(value)) return null;
      const row=db.prepare('SELECT * FROM workspace_shares WHERE token_hash=? AND page_id=?').get(hash(value),pageId);
      if (!row || !active(row.id,pageId,clock())) return null;
      if (row.password_hash !== null) {
        if (!validPassword(password)) return null;
        const parts=/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(row.password_hash); if (!parts) return null;
        const expected=Buffer.from(parts[2],'hex'), actual=await scrypt(password,Buffer.from(parts[1],'hex'),expected.length);
        if (!timingSafeEqual(actual,expected)) return null;
      }
      return tx(() => { const at=clock(), current=active(row.id,pageId,at); if (!current || current.token_hash !== row.token_hash || current.password_hash !== row.password_hash) return null;
        const ticket=secret(); db.prepare('INSERT INTO workspace_share_tickets VALUES (?,?,?,?)').run(hash(ticket),row.id,pageId,Math.min(at+ticketTtlMs,current.expires_at ?? Infinity)); return ticket; });
    },
    exchange(pageId, ticket) { if (!validSecret(ticket)) return null; return tx(() => {
      const at=clock(), row=db.prepare('SELECT * FROM workspace_share_tickets WHERE token_hash=? AND page_id=? AND expires_at>?').get(hash(ticket),pageId,at);
      const share=row && active(row.share_id,pageId,at); if (!share) return null;
      if (db.prepare('DELETE FROM workspace_share_tickets WHERE token_hash=?').run(row.token_hash).changes !== 1) return null;
      const value=secret(), expires=Math.min(at+sessionTtlMs,share.expires_at ?? Infinity);
      db.prepare('INSERT INTO workspace_share_sessions VALUES (?,?,?,?)').run(hash(value),row.share_id,pageId,expires);
      return {value,maxAge:expires-at};
    }); },
    authorize(pageId, value) { if (!validSecret(value)) return null; const at=clock(); const row=db.prepare('SELECT * FROM workspace_share_sessions WHERE token_hash=? AND page_id=? AND expires_at>?').get(hash(value),pageId,at); const share=row && active(row.share_id,pageId,at); return share ? page(share.workspace_id,pageId) : null; },
    purgeExpired() { return tx(() => { const at=clock(); return {tickets:db.prepare('DELETE FROM workspace_share_tickets WHERE expires_at<=?').run(at).changes, sessions:db.prepare('DELETE FROM workspace_share_sessions WHERE expires_at<=?').run(at).changes}; }); }
  };
}
