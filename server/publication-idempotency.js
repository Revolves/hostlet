import { createHash, randomBytes } from 'node:crypto';

export const publicationIdempotencySchema = `
CREATE TABLE publication_idempotency (
  actor TEXT NOT NULL, workspace TEXT NOT NULL, key_hash TEXT NOT NULL,
  header_fingerprint TEXT NOT NULL, fingerprint TEXT,
  status TEXT NOT NULL CHECK(status IN ('in_progress','interrupted','succeeded')),
  owner_hash TEXT, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(actor, workspace, key_hash),
  CHECK ((status = 'in_progress' AND owner_hash IS NOT NULL AND result IS NULL)
    OR (status = 'interrupted' AND owner_hash IS NULL AND result IS NULL)
    OR (status = 'succeeded' AND owner_hash IS NULL AND fingerprint IS NOT NULL AND result IS NOT NULL))
);
CREATE TRIGGER publication_idempotency_account_deleted
AFTER UPDATE OF password_hash ON users WHEN NEW.password_hash = '!deleted'
BEGIN DELETE FROM publication_idempotency WHERE actor = NEW.id; END;
CREATE TRIGGER publication_idempotency_workspace_deleted
AFTER DELETE ON workspaces
BEGIN DELETE FROM publication_idempotency WHERE workspace = OLD.id; END;`;

const hash = value => createHash('sha256').update(value).digest('hex');
const publicationTransactions = new WeakSet();
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function identity({ actor, workspace, key } = {}) {
  if (typeof actor !== 'string' || !actor.length || actor.length > 200 ||
      typeof workspace !== 'string' || !workspace.length || workspace.length > 200 ||
      typeof key !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(key)) fail('INVALID');
  return [actor, workspace, hash(key)];
}
const publicStatus = row => !row ? { status: 'not_found' } : row.status === 'succeeded'
  ? { status: row.status, result: JSON.parse(row.result) } : { status: row.status };

// For Node versions without DatabaseSync.isTransaction. The callback owns no
// transaction control and must perform publication and receipt writes on db.
export function withPublicationTransaction(db, callback) {
  if (!db || typeof db.exec !== 'function' || typeof callback !== 'function') throw new TypeError('db and callback are required');
  db.exec('BEGIN IMMEDIATE');
  publicationTransactions.add(db);
  try {
    const result = callback();
    if (result && typeof result.then === 'function') throw new TypeError('transaction callback must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    publicationTransactions.delete(db);
  }
}

/** One instance per publication attempt. Caller owns authorization, upload validation,
 * cleanup, and result sanitization. recover requires the exclusive instance lock and
 * completed publication-journal recovery. Receipts are never automatically deleted.
 * succeed runs within the caller's transaction (and never opens a transaction). */
export function createPublicationIdempotency(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');
  let ownerHash, ownerIdentity;
  const get = db.prepare('SELECT * FROM publication_idempotency WHERE actor=? AND workspace=? AND key_hash=?');
  const owns = ids => ownerHash && ownerIdentity.every((value, i) => value === ids[i]);
  const status = args => publicStatus(get.get(...identity(args)));
  return {
    claim(args) {
      const ids = identity(args);
      if (!digest(args.headerFingerprint)) fail('INVALID');
      if (ownerHash) fail('INSTANCE_USED');
      const tokenHash = hash(randomBytes(32));
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = get.get(...ids);
        let response;
        if (row && row.header_fingerprint !== args.headerFingerprint) response = { status: 'conflict' };
        else if (row && row.status !== 'interrupted') response = { status: row.status };
        else {
          const now = Date.now();
          if (row) db.prepare("UPDATE publication_idempotency SET status='in_progress', owner_hash=?, updated_at=? WHERE actor=? AND workspace=? AND key_hash=?").run(tokenHash, now, ...ids);
          else db.prepare("INSERT INTO publication_idempotency (actor,workspace,key_hash,header_fingerprint,status,owner_hash,created_at,updated_at) VALUES (?,?,?,?,'in_progress',?,?,?)").run(...ids, args.headerFingerprint, tokenHash, now, now);
          response = { status: 'claimed' };
        }
        db.exec('COMMIT');
        if (response.status === 'claimed') { ownerHash = tokenHash; ownerIdentity = ids; }
        return response;
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    },
    bind(args) {
      const ids = identity(args);
      if (!digest(args.fingerprint)) fail('INVALID');
      const row = get.get(...ids);
      if (row?.status === 'succeeded') return row.fingerprint === args.fingerprint ? publicStatus(row) : { status: 'conflict' };
      if (!owns(ids) || !row || row.status !== 'in_progress' || row.owner_hash !== ownerHash) fail('NOT_OWNER');
      if (row.fingerprint !== null && row.fingerprint !== args.fingerprint) return { status: 'conflict' };
      const changed = db.prepare("UPDATE publication_idempotency SET fingerprint=?, updated_at=? WHERE actor=? AND workspace=? AND key_hash=? AND status='in_progress' AND owner_hash=? AND (fingerprint IS NULL OR fingerprint=?)").run(args.fingerprint, Date.now(), ...ids, ownerHash, args.fingerprint).changes;
      if (!changed) fail('NOT_OWNER');
      return { status: 'bound' };
    },
    succeed(args) {
      const ids = identity(args);
      if (!digest(args.fingerprint) || !args.result || typeof args.result !== 'object' || Array.isArray(args.result)) fail('INVALID');
      if (!owns(ids)) fail('NOT_OWNER');
      if (typeof db.isTransaction === 'boolean') {
        if (!db.isTransaction) fail('TRANSACTION_REQUIRED');
      } else if (!publicationTransactions.has(db)) fail('TRANSACTION_STATE_UNAVAILABLE');
      let serialized;
      try { serialized = JSON.stringify(args.result); } catch { fail('INVALID'); }
      if (!serialized) fail('INVALID');
      const changed = db.prepare("UPDATE publication_idempotency SET status='succeeded', owner_hash=NULL, result=?, updated_at=? WHERE actor=? AND workspace=? AND key_hash=? AND status='in_progress' AND owner_hash=? AND fingerprint=?").run(serialized, Date.now(), ...ids, ownerHash, args.fingerprint).changes;
      if (!changed) fail('NOT_OWNER');
      return { status: 'succeeded', result: JSON.parse(serialized) };
    },
    interrupt(args) {
      const ids = identity(args);
      if (owns(ids)) db.prepare("UPDATE publication_idempotency SET status='interrupted', owner_hash=NULL, updated_at=? WHERE actor=? AND workspace=? AND key_hash=? AND status='in_progress' AND owner_hash=?").run(Date.now(), ...ids, ownerHash);
      return publicStatus(get.get(...ids));
    },
    status,
    recover() {
      return db.prepare("UPDATE publication_idempotency SET status='interrupted', owner_hash=NULL, updated_at=? WHERE status='in_progress'").run(Date.now()).changes;
    }
  };
}
