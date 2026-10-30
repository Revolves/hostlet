import { randomUUID } from 'node:crypto';

export const accountDeletionJournalSql = `
CREATE TABLE IF NOT EXISTS account_deletion_journal (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  personal_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
`;

export class AccountDeletionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AccountDeletionError';
    this.code = code;
  }
}

const fail = code => { throw new AccountDeletionError(code); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

/**
 * Deletes an account without destroying team-owned applications or moderation
 * records. The caller must first authenticate the password and invoke this
 * service inside an exclusive maintenance window. Page deletion is delegated to
 * the journaled deletion service; the account row is retained as a pseudonymous
 * tombstone so existing team audit and content foreign keys remain valid.
 */
export function createAccountDeletionService({
  db,
  workspaceService,
  deletePage,
  assertQuiescent,
  now = Date.now,
  onDelete = () => {},
} = {}) {
  if (!db || !workspaceService || typeof workspaceService.authorize !== 'function' ||
      typeof deletePage !== 'function' || typeof assertQuiescent !== 'function' ||
      typeof now !== 'function' || typeof onDelete !== 'function' ||
      db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
    throw new TypeError('Invalid account deletion configuration');
  }
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    }
  };
  const account = id => {
    if (!validId(id)) fail('INVALID');
    const row = db.prepare(
      "SELECT id,email FROM users WHERE id=? AND email_verified_at IS NOT NULL AND password_hash NOT LIKE '!%'",
    ).get(id);
    if (!row) fail('NOT_FOUND');
    return row;
  };
  const blockedTeams = id => db.prepare(
    `SELECT w.id,w.name FROM workspaces w
     JOIN workspace_members m ON m.workspace_id=w.id
     WHERE w.type='team' AND m.user_id=? AND m.role='owner'
       AND (SELECT count(*) FROM workspace_members owner
            WHERE owner.workspace_id=w.id AND owner.role='owner')=1
     ORDER BY w.created_at,w.id`,
  ).all(id).map(row => ({ id: row.id, name: row.name }));
  const pending = id => db.prepare(
    'SELECT user_id,personal_workspace_id,created_at FROM account_deletion_journal WHERE user_id=?',
  ).get(id);
  const personalPages = workspaceId => workspaceId ? db.prepare(
    `SELECT p.id,r.revision FROM workspace_pages p
     JOIN workspace_page_revisions r ON r.page_id=p.id
     WHERE p.workspace_id=? ORDER BY p.id`,
  ).all(workspaceId) : [];
  const finalize = (accountId, personalId, at, deletedPages) => tx(() => {
    account(accountId);
    if (blockedTeams(accountId).length) fail('LAST_OWNER');
    const personal = personalId ? db.prepare(
      "SELECT id FROM workspaces WHERE id=? AND type='personal' AND created_by=?",
    ).get(personalId, accountId) : null;
    if (personal && db.prepare('SELECT 1 FROM workspace_pages WHERE workspace_id=? LIMIT 1').get(personal.id)) {
      fail('CONFLICT');
    }

    db.prepare('DELETE FROM workspace_join_requests WHERE user_id=?').run(accountId);
    db.prepare('DELETE FROM workspace_members WHERE user_id=?').run(accountId);
    db.prepare('DELETE FROM account_tokens WHERE user_id=?').run(accountId);
    db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(accountId);
    db.prepare('DELETE FROM workspace_host_tickets WHERE user_id=?').run(accountId);
    db.prepare('DELETE FROM workspace_host_sessions WHERE user_id=?').run(accountId);
    if (personal) db.prepare("DELETE FROM workspaces WHERE id=? AND type='personal' AND created_by=?").run(personal.id, accountId);

    db.prepare(
      "UPDATE users SET email=?,password_hash='!deleted',email_verified_at=NULL WHERE id=?",
    ).run(`deleted-${randomUUID()}@deleted.invalid`, accountId);
    onDelete({ db, accountId, at, personalWorkspaceId: personal?.id ?? null });
    db.prepare('DELETE FROM account_deletion_journal WHERE user_id=?').run(accountId);
    return { deletedPages };
  });
  const resume = accountId => {
    const job = pending(accountId);
    if (!job) return null;
    account(accountId);
    if (blockedTeams(accountId).length) fail('LAST_OWNER');
    if (db.prepare('SELECT 1 FROM workspace_deletion_journal LIMIT 1').get()) fail('RECOVERY_REQUIRED');
    const pages = personalPages(job.personal_workspace_id);
    for (const page of pages) {
      workspaceService.authorize(job.personal_workspace_id, accountId, 'manage');
      const deleted = deletePage({
        pageId: page.id,
        workspaceId: job.personal_workspace_id,
        revision: page.revision,
        actor: accountId,
        validate: () => workspaceService.authorize(job.personal_workspace_id, accountId, 'manage') === 'owner',
      });
      if (deleted === false && db.prepare('SELECT 1 FROM workspace_pages WHERE id=? AND workspace_id=?').get(page.id, job.personal_workspace_id)) {
        fail('CONFLICT');
      }
    }
    return finalize(accountId, job.personal_workspace_id, job.created_at, pages.length);
  };

  function status(accountId) {
    const current = account(accountId);
    return { email: current.email, canDelete: blockedTeams(accountId).length === 0, blockedTeams: blockedTeams(accountId) };
  }

  function remove(accountId) {
    if (assertQuiescent() !== true) fail('MAINTENANCE_REQUIRED');
    account(accountId);
    const blockers = blockedTeams(accountId);
    if (blockers.length) fail('LAST_OWNER');
    if (db.prepare('SELECT 1 FROM workspace_deletion_journal LIMIT 1').get()) fail('RECOVERY_REQUIRED');
    if (db.prepare('SELECT 1 FROM account_deletion_journal LIMIT 1').get()) fail('RECOVERY_REQUIRED');

    const personal = db.prepare(
      "SELECT id FROM workspaces WHERE type='personal' AND created_by=?",
    ).get(accountId);
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid clock value');
    tx(() => db.prepare('INSERT INTO account_deletion_journal VALUES (?,?,?)').run(accountId, personal?.id ?? null, at));
    return resume(accountId);
  }

  function recover() {
    if (assertQuiescent() !== true) fail('MAINTENANCE_REQUIRED');
    for (const row of db.prepare('SELECT user_id FROM account_deletion_journal ORDER BY user_id').all()) resume(row.user_id);
  }

  return { status, delete: remove, recover, hasPending: accountId => Boolean(pending(accountId)) };
}
