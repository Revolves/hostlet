import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Execute before workspaceSchema in the same versioned migration transaction.
// Both schemas must be installed before registering accounts.
// Enable SQLite foreign_keys on every connection before using the module.
export const accountMigrationSql = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, purpose)
);
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
`;

// Apply in a new versioned migration transaction after v3. Preserve v3's SQL:
// already-migrated databases need a table rebuild to remove its UNIQUE constraint.
export const accountTokensMultiUseMigrationSql = `
CREATE TABLE account_tokens_replacement (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO account_tokens_replacement (token_hash, user_id, purpose, expires_at, created_at)
  SELECT token_hash, user_id, purpose, expires_at, created_at FROM account_tokens;
DROP TABLE account_tokens;
ALTER TABLE account_tokens_replacement RENAME TO account_tokens;
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
CREATE INDEX account_tokens_user_purpose ON account_tokens(user_id, purpose);
`;

const scrypt = promisify(scryptCallback);
const HASH_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
const USERNAME_DOMAIN = 'users.hostlet.invalid';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'api', 'app', 'apps', 'help', 'hostlet', 'mail', 'root', 'security', 'status', 'support', 'system', 'www']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw fail('INVALID_EMAIL', 'Invalid email address.');
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  if (email.length > 254 || parts.length !== 2 || parts[0].length > 64 ||
      !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(parts[0]) ||
      parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..') ||
      parts[1].length > 253 || !parts[1].includes('.') ||
      !parts[1].split('.').every(label => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
    throw fail('INVALID_EMAIL', 'Invalid email address.');
  }
  return email;
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') throw fail('INVALID_USERNAME', 'Invalid username.');
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(username)) {
    throw fail('INVALID_USERNAME', 'Username must be 3 to 32 characters using letters, numbers, underscores or hyphens.');
  }
  return username;
}

export function usernameEmail(username) {
  return `${normalizeUsername(username)}@${USERNAME_DOMAIN}`;
}

export function usernameFromEmail(email) {
  if (typeof email !== 'string') return null;
  const suffix = `@${USERNAME_DOMAIN}`;
  if (!email.endsWith(suffix)) return null;
  try { return normalizeUsername(email.slice(0, -suffix.length)); }
  catch { return null; }
}

export function resolveAccountEmail(input) {
  if (typeof input === 'string') {
    const value = input.trim();
    if (!value) throw fail('INVALID_EMAIL', 'Invalid account identifier.');
    return value.includes('@') ? normalizeEmail(value) : usernameEmail(value);
  }
  if (input && typeof input === 'object') {
    if (typeof input.email === 'string' && input.email.trim()) return normalizeEmail(input.email);
    if (typeof input.username === 'string' && input.username.trim()) return usernameEmail(input.username);
    if (typeof input.identifier === 'string' && input.identifier.trim()) return resolveAccountEmail(input.identifier);
  }
  throw fail('INVALID_EMAIL', 'Invalid account identifier.');
}

export function accountView(user) {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') return null;
  return { id: user.id, email: user.email, username: user.username ?? usernameFromEmail(user.email) };
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw fail('INVALID_PASSWORD', 'Password must be at least 12 characters and at most 1024 UTF-8 bytes.');
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, HASH_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function checkPassword(password, stored) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) return false;
  const match = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored);
  if (!match) return false;
  const expected = Buffer.from(match[2], 'hex');
  const actual = await scrypt(password, Buffer.from(match[1], 'hex'), expected.length, HASH_OPTIONS);
  return timingSafeEqual(actual, expected);
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  }
}

function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

export function createAccounts({ db, sender, now = Date.now, verificationTtlMs = 24 * 60 * 60 * 1000, resetTtlMs = 60 * 60 * 1000 }) {
  if (!db || typeof sender !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(verificationTtlMs) || verificationTtlMs <= 0 ||
      !Number.isSafeInteger(resetTtlMs) || resetTtlMs <= 0) throw new TypeError('Invalid accounts configuration.');
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('SQLite foreign_keys must be enabled.');
  const find = db.prepare('SELECT id, email, password_hash, email_verified_at FROM users WHERE email = ?');

  function issue(user, purpose, ttl) {
    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    const time = now();
    if (!Number.isSafeInteger(time) || !Number.isSafeInteger(time + ttl)) throw new Error('Invalid clock value.');
    db.prepare('DELETE FROM account_tokens WHERE user_id = ? AND purpose = ? AND expires_at <= ?').run(user.id, purpose, time);
    db.prepare('INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(hash, user.id, purpose, time + ttl, time);
    return { to: user.email, purpose, token, expiresAt: time + ttl };
  }

  async function send(message) {
    try { await sender(message); }
    catch {
      db.prepare('DELETE FROM account_tokens WHERE token_hash = ?').run(tokenHash(message.token));
      throw fail('MAIL_FAILED', 'Unable to send email.');
    }
  }

  async function register({ email, username, password }, { onReady } = {}) {
    if (onReady !== undefined && typeof onReady !== 'function') throw new TypeError('Invalid registration callback.');
    if (email !== undefined && username !== undefined) throw fail('INVALID_EMAIL', 'Choose an email or a username.');
    const normalizedUsername = username === undefined ? null : normalizeUsername(username);
    email = normalizedUsername ? usernameEmail(normalizedUsername) : normalizeEmail(email);
    if (!normalizedUsername && email.endsWith(`@${USERNAME_DOMAIN}`)) {
      throw fail('INVALID_EMAIL', 'This email domain is reserved for username accounts.');
    }
    validatePassword(password);
    const passwordHash = await hashPassword(password);
    const user = { id: randomUUID(), email, username: normalizedUsername };
    const message = transaction(db, () => {
      if (find.get(email)) throw fail('EMAIL_EXISTS', 'Email is already registered.');
      const time = now();
      const workspaceId = randomUUID();
      const workspaceCreatedAt = new Date(time).toISOString();
      db.prepare('INSERT INTO users (id, email, password_hash, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, email, passwordHash, normalizedUsername ? time : null, time);
      db.prepare("INSERT INTO workspaces (id, name, type, created_by, created_at) VALUES (?, 'Personal', 'personal', ?, ?)").run(workspaceId, user.id, workspaceCreatedAt);
      db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(workspaceId, user.id, workspaceCreatedAt);
      return normalizedUsername ? null : issue(user, 'verify', verificationTtlMs);
    });
    onReady?.();
    if (message) await send(message);
    return user;
  }

  async function sendVerification({ email }) {
    email = normalizeEmail(email);
    if (usernameFromEmail(email)) return;
    const message = transaction(db, () => {
      const user = find.get(email);
      return user && user.email_verified_at === null ? issue(user, 'verify', verificationTtlMs) : null;
    });
    if (message) await send(message);
  }

  function verifyEmail(token) {
    const hash = tokenHash(token);
    if (!hash) return false;
    return transaction(db, () => {
      const time = now();
      const row = db.prepare("DELETE FROM account_tokens WHERE token_hash = ? AND purpose = 'verify' AND expires_at > ? RETURNING user_id").get(hash, time);
      if (!row) return false;
      db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'verify'").run(row.user_id);
      db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').run(time, row.user_id);
      return true;
    });
  }

  async function authenticate(input) {
    const password = input?.password;
    let normalized;
    try { normalized = resolveAccountEmail(input); } catch { normalized = ''; }
    const user = find.get(normalized);
    const valid = await checkPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!valid || !user || user.email_verified_at === null) return null;
    return { id: user.id, email: user.email, username: usernameFromEmail(user.email) };
  }

  async function requestPasswordReset({ email }) {
    email = normalizeEmail(email);
    if (usernameFromEmail(email)) return;
    const message = transaction(db, () => {
      const user = find.get(email);
      return user && user.email_verified_at !== null ? issue(user, 'reset', resetTtlMs) : null;
    });
    if (message) await send(message);
  }

  async function resetPassword({ token, password }) {
    const hash = tokenHash(token);
    if (!hash) return false;
    validatePassword(password);
    const passwordHash = await hashPassword(password);
    return transaction(db, () => {
      const row = db.prepare("DELETE FROM account_tokens WHERE token_hash = ? AND purpose = 'reset' AND expires_at > ? RETURNING user_id").get(hash, now());
      if (!row) return false;
      db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'reset'").run(row.user_id);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
      return true;
    });
  }

  return { register, sendVerification, verifyEmail, authenticate, requestPasswordReset, resetPassword };
}
