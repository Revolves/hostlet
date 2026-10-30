import path from 'node:path';
import { createAccounts, normalizeEmail } from './accounts.js';
import { openDatabase } from './database.js';
import { acquireInstanceLock } from './instance-lock.js';

const messages = {
  INVALID_INPUT: 'Invalid provisioning configuration.',
  INVALID_EMAIL: 'Invalid email address.',
  INVALID_PASSWORD: 'Invalid password.',
  EMAIL_EXISTS: 'Email is already registered.',
  MAIL_FAILED: 'Verification email could not be sent; the new account was removed.',
  LOCKED: 'Data directory is in use or requires offline lock recovery.',
  PROVISION_FAILED: 'Account provisioning failed.',
  CLEANUP_FAILED: 'Account provisioning cleanup failed; inspect the data directory offline.',
};

function failure(code) {
  const error = new Error(messages[code]);
  error.code = code;
  return error;
}

/**
 * Trusted offline operation. The caller supplies the normal mail sender (for
 * example createMailer(config.smtp)); no secrets are logged or returned.
 * The shared instance lock must be obtainable before opening the database.
 * A failed email removes only the account created by this invocation.
 */
export async function provisionAccount({ dataDir, email, password, sender } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || typeof sender !== 'function') {
    throw failure('INVALID_INPUT');
  }
  let lock;
  try { lock = acquireInstanceLock(dataDir); }
  catch { throw failure('LOCKED'); }

  let db;
  let result;
  let errorCode;
  try {
    db = openDatabase(path.join(dataDir, 'hostlet.sqlite'));
    const accounts = createAccounts({ db, sender });
    let createdId;
    try {
      result = await accounts.register({ email, password }, { onReady: () => {
        createdId = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizeEmail(email)).id;
      } });
    } catch (error) {
      if (error?.code === 'MAIL_FAILED' && createdId) {
        try {
          db.exec('BEGIN IMMEDIATE');
          db.prepare('DELETE FROM workspaces WHERE created_by = ?').run(createdId);
          db.prepare('DELETE FROM users WHERE id = ?').run(createdId);
          db.exec('COMMIT');
        } catch {
          try { db.exec('ROLLBACK'); } catch { /* Keep the safe error below. */ }
          throw failure('CLEANUP_FAILED');
        }
      }
      throw error;
    }
  } catch (error) {
    errorCode = Object.hasOwn(messages, error?.code) ? error.code : 'PROVISION_FAILED';
  } finally {
    try { db?.close(); } catch { errorCode = 'CLEANUP_FAILED'; }
    // If the database could not be closed, retain the lock for offline recovery.
    if (errorCode !== 'CLEANUP_FAILED' || !db) {
      try { lock.release(); } catch { errorCode = 'CLEANUP_FAILED'; }
    }
  }
  if (errorCode) throw failure(errorCode);
  return result;
}
