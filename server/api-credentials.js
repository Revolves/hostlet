import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const apiCredentialsSchema = `
CREATE TABLE api_credentials (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX api_credentials_user ON api_credentials(user_id);
CREATE TRIGGER api_credentials_password_change AFTER UPDATE OF password_hash ON users
WHEN OLD.password_hash <> NEW.password_hash
BEGIN DELETE FROM api_credentials WHERE user_id=NEW.id; END;
`;
const allowed = new Set(['read', 'publish', 'share', 'admin']);
const digest = value => createHash('sha256').update(value).digest('hex');
const invalid = () => { throw new TypeError('Invalid API credential'); };

export function createApiCredentials({db, now = Date.now}) {
  if (!db || typeof now !== 'function' || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) invalid();
  const clock = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; };
  return {
    create(userId, {name, scopes, expiresAt} = {}) {
      const at = clock();
      if (typeof name !== 'string' || !name.trim() || name.length > 100 || !Array.isArray(scopes) || !scopes.length || scopes.some(s => !allowed.has(s)) || new Set(scopes).size !== scopes.length || !Number.isSafeInteger(expiresAt) || expiresAt <= at || expiresAt-at > 365*86400000) invalid();
      if (!db.prepare("SELECT 1 FROM users WHERE id=? AND email_verified_at IS NOT NULL AND password_hash NOT LIKE '!%'").get(userId)) invalid();
      const id = randomUUID(), token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO api_credentials VALUES (?,?,?,?,?,?,?,NULL)').run(id,userId,name.trim(),digest(token),JSON.stringify(scopes),at,expiresAt);
      return {id, token};
    },
    list(userId) {
      return db.prepare('SELECT id,name,scopes,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM api_credentials WHERE user_id=? ORDER BY created_at,id').all(userId).map(row => ({...row,scopes:JSON.parse(row.scopes)}));
    },
    revoke(userId,id) { return db.prepare('UPDATE api_credentials SET revoked_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL').run(clock(),userId,id).changes === 1; },
    authenticate(token,scope) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !allowed.has(scope)) return null;
      const row = db.prepare("SELECT c.id,c.user_id,c.scopes FROM api_credentials c JOIN users u ON u.id=c.user_id WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND u.email_verified_at IS NOT NULL AND u.password_hash NOT LIKE '!%'").get(digest(token),clock());
      return row && JSON.parse(row.scopes).includes(scope) ? {id:row.id,userId:row.user_id} : null;
    }
  };
}
