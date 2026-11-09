import { createHash, randomBytes } from 'node:crypto';
import { resolveAccountEmail, usernameFromEmail } from './accounts.js';

// Run after accountMigrationSql, with foreign_keys enabled on every connection.
// The trigger makes password reset and revocation one SQLite transaction.
export const sessionSchema = `
CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_sessions_user ON account_sessions(user_id);
CREATE INDEX account_sessions_expiry ON account_sessions(expires_at);
CREATE TRIGGER account_sessions_password_change AFTER UPDATE OF password_hash ON users
WHEN OLD.password_hash <> NEW.password_hash
BEGIN DELETE FROM account_sessions WHERE user_id = NEW.id; END;
`;
export const ACCOUNT_COOKIE = 'hostlet_account';
export const IP_ACCOUNT_COOKIE = '__Host-hostlet_account';
const digest = token => createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

/** Independent account identity only; never grants legacy administrator or workspace access.
 * db: DatabaseSync with sessionSchema and foreign_keys enabled. ttlMs: milliseconds.
 * secure must be true for HTTPS production; defaults to NODE_ENV === production.
 * Mount requireSession on account-aware routes and authorize each resource separately.
 */
export function createAccountSessions({ db, ttlMs = 7 * 86400000, secure = process.env.NODE_ENV === 'production', now = Date.now, cookieName = ACCOUNT_COOKIE }) {
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || typeof now !== 'function' || typeof secure !== 'boolean' || ![ACCOUNT_COOKIE, IP_ACCOUNT_COOKIE].includes(cookieName) || (process.env.NODE_ENV === 'production' && !secure && cookieName !== IP_ACCOUNT_COOKIE)) throw new TypeError('Invalid account session configuration.');
  if (cookieName === IP_ACCOUNT_COOKIE) secure = true;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure, path: '/' };
  const clearLegacy = res => {
    if (cookieName !== ACCOUNT_COOKIE) res.clearCookie(ACCOUNT_COOKIE, cookieOptions);
  };
  function read(req) {
    const entries = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${cookieName}=`));
    if (entries.length !== 1) return null;
    const token = entries[0].slice(cookieName.length + 1);
    return validToken(token) ? token : null;
  }
  function snapshot(identifier) {
    try { return db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(resolveAccountEmail(identifier)) || null; }
    catch { return null; }
  }
  function create(user, before) {
    if (!before || before.id !== user.id) return null;
    const time = now();
    if (!Number.isSafeInteger(time) || !Number.isSafeInteger(time + ttlMs)) throw new Error('Invalid clock value.');
    const token = randomBytes(32).toString('base64url');
    const result = db.prepare(`INSERT INTO account_sessions (token_hash,user_id,created_at,expires_at)
      SELECT ?, id, ?, ? FROM users WHERE id = ? AND password_hash = ? AND email_verified_at IS NOT NULL`).run(digest(token), time, time + ttlMs, user.id, before.password_hash);
    return result.changes === 1 ? token : null;
  }
  function find(req) {
    const token = read(req);
    if (!token) return null;
    const user = db.prepare(`SELECT u.id, u.email FROM account_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.email_verified_at IS NOT NULL`).get(digest(token), now()) || null;
    return user ? { ...user, username: usernameFromEmail(user.email) } : null;
  }
  function requireSession(req, res, next) {
    const user = find(req);
    if (!user) return res.status(401).json({ error: 'Authentication required.' });
    req.account = { id: user.id, email: user.email, username: user.username ?? null };
    return next();
  }
  function logout(req, res) {
    const token = read(req);
    if (token) db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(digest(token));
    clearLegacy(res);
    res.clearCookie(cookieName, cookieOptions);
  }
  function setCookie(res, token) { res.cookie(cookieName, token, { ...cookieOptions, maxAge: ttlMs }); clearLegacy(res); }
  function purgeExpired() { return db.prepare('DELETE FROM account_sessions WHERE expires_at<=?').run(now()).changes; }
  return { snapshot, create, find, requireSession, logout, setCookie, purgeExpired };
}
