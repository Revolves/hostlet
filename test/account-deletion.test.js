import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { accountMigrationSql, accountTokensMultiUseMigrationSql } from '../server/accounts.js';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';
import { sessionSchema } from '../server/account-sessions.js';
import {
  workspacePagesSchema,
  workspacePageReleasesMigrationSql,
} from '../server/workspace-pages.js';
import { workspaceVisibilitySchema } from '../server/workspace-visibility.js';
import { quotaMigrationSql } from '../server/quotas.js';
import { platformAdminSchema } from '../server/platform-admin.js';
import { workspaceShareSchema } from '../server/workspace-shares.js';
import { workspaceHostingSchema } from '../server/workspace-hosting.js';
import { deletionJournalSql } from '../server/workspace-deletion.js';
import { accountDeletionJournalSql, createAccountDeletionService } from '../server/account-deletion.js';

const pageId = `w-${'a'.repeat(32)}`;
const teamPageId = `w-${'b'.repeat(32)}`;
const accountId = 'account-1';
const teamId = 'team-1';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(accountMigrationSql);
  db.exec(workspaceSchema);
  db.exec(sessionSchema);
  db.exec(accountTokensMultiUseMigrationSql);
  db.exec(workspacePagesSchema);
  db.exec(workspacePageReleasesMigrationSql);
  db.exec(workspaceVisibilitySchema);
  db.exec(quotaMigrationSql);
  db.exec(platformAdminSchema);
  db.exec(workspaceShareSchema);
  db.exec(workspaceHostingSchema);
  db.exec(deletionJournalSql);
  db.exec(accountDeletionJournalSql);
  t.after(() => db.close());

  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(accountId, 'person@example.org', 'hash', 100, 1);
  db.prepare("INSERT INTO workspaces VALUES (?,?,?,?,?)").run('personal-1', 'Personal', 'personal', accountId, 'now');
  db.prepare("INSERT INTO workspace_members VALUES (?,?,?,?)").run('personal-1', accountId, 'owner', 'now');
  db.prepare("INSERT INTO workspaces VALUES (?,?,?,?,?)").run(teamId, 'Shared', 'team', accountId, 'now');
  db.prepare("INSERT INTO workspace_members VALUES (?,?,?,?)").run(teamId, accountId, 'owner', 'now');
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run('other-owner', 'other@example.org', 'hash', 100, 1);
  db.prepare("INSERT INTO workspace_members VALUES (?,?,?,?)").run(teamId, 'other-owner', 'owner', 'now');
  db.prepare('INSERT INTO account_sessions VALUES (?,?,?,?)').run('session-hash', accountId, 1, 9999999999999);
  db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?)').run('token-hash', accountId, 'verify', 9999999999999, 1);
  db.prepare('INSERT INTO workspace_join_requests VALUES (?,?,?,?,?,?,?)').run('request-1', teamId, accountId, 'pending', 'now', null, null);

  const workspaceService = createWorkspaceService(db);
  let time = 5000;
  const calls = [];
  const service = createAccountDeletionService({
    db,
    workspaceService,
    now: () => time,
    assertQuiescent: () => true,
    deletePage: ({ pageId: id, workspaceId, revision, actor }) => {
      calls.push({ id, workspaceId, revision, actor });
      const changes = db.prepare('DELETE FROM workspace_pages WHERE id=? AND workspace_id=?').run(id, workspaceId).changes;
      return changes === 1;
    },
    onDelete: ({ db: database, accountId: id }) => {
      database.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run('audit-1', id, 'account.deleted', id, time);
    },
  });
  return { db, service, calls, addPage(id, workspaceId) {
    db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id);
    db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, workspaceId, accountId, 'Application', 'private', id, 'release-1',
      'index.html', 'html', 'index.html', 10, 1, 'now', 'now',
    );
    db.prepare('INSERT INTO workspace_page_revisions VALUES (?,0)').run(id);
    db.prepare('INSERT INTO workspace_page_releases VALUES (?,?,?,?,?,?,?,?)').run(
      id, 'release-1', 'index.html', 'html', 'index.html', 10, 1, 'now',
    );
  }, setTime(value) { time = value; } };
}

test('account deletion blocks the last owner before touching pages', async t => {
  const x = setup(t);
  x.db.prepare("UPDATE workspace_members SET role='editor' WHERE workspace_id=? AND user_id='other-owner'").run(teamId);
  x.addPage(pageId, 'personal-1');
  const status = x.service.status(accountId);
  assert.deepEqual(status.blockedTeams, [{ id: teamId, name: 'Shared' }]);
  assert.throws(() => x.service.delete(accountId), { code: 'LAST_OWNER' });
  assert.equal(x.calls.length, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n, 1);
  assert.equal(x.db.prepare('SELECT count(*) n FROM users WHERE id=? AND email=?').get(accountId, 'person@example.org').n, 1);
});

test('account deletion removes personal pages, memberships, tokens and sessions', async t => {
  const x = setup(t);
  x.db.prepare("UPDATE workspace_members SET role='editor' WHERE workspace_id=? AND user_id=?").run(teamId, accountId);
  x.addPage(pageId, 'personal-1');
  x.addPage(teamPageId, teamId);
  const result = await x.service.delete(accountId);
  assert.deepEqual(result, { deletedPages: 1 });
  assert.deepEqual(x.calls, [{ id: pageId, workspaceId: 'personal-1', revision: 0, actor: accountId }]);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages WHERE id=?').get(teamPageId).n, 1);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages WHERE workspace_id=?').get('personal-1').n, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspaces WHERE id=?').get('personal-1').n, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_members WHERE user_id=?').get(accountId).n, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_join_requests WHERE user_id=?').get(accountId).n, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM account_sessions WHERE user_id=?').get(accountId).n, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM account_tokens WHERE user_id=?').get(accountId).n, 0);
  const user = x.db.prepare('SELECT email,password_hash,email_verified_at FROM users WHERE id=?').get(accountId);
  assert.match(user.email, /^deleted-[0-9a-f-]+@deleted\.invalid$/);
  assert.equal(user.password_hash, '!deleted');
  assert.equal(user.email_verified_at, null);
  assert.equal(x.db.prepare("SELECT count(*) n FROM platform_admin_audit WHERE action='account.deleted' AND actor_id=?").get(accountId).n, 1);
  assert.deepEqual(x.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('page deletion failure leaves account data and login state intact', async t => {
  const x = setup(t);
  x.addPage(pageId, 'personal-1');
  const failing = createAccountDeletionService({
    db: x.db,
    workspaceService: createWorkspaceService(x.db),
    assertQuiescent: () => true,
    deletePage: () => { throw new Error('page deletion failed'); },
  });
  assert.throws(() => failing.delete(accountId), /page deletion failed/);
  assert.equal(x.db.prepare('SELECT email FROM users WHERE id=?').get(accountId).email, 'person@example.org');
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n, 1);
  assert.equal(x.db.prepare('SELECT count(*) n FROM account_sessions WHERE user_id=?').get(accountId).n, 1);
});

test('a new service recovers account deletion after interruption between personal pages', async t => {
  const x = setup(t);
  x.db.prepare("UPDATE workspace_members SET role='editor' WHERE workspace_id=? AND user_id=?").run(teamId, accountId);
  x.addPage(pageId, 'personal-1');
  x.addPage(`w-${'c'.repeat(32)}`, 'personal-1');
  let attempts = 0;
  const interrupted = createAccountDeletionService({
    db: x.db,
    workspaceService: createWorkspaceService(x.db),
    assertQuiescent: () => true,
    deletePage: ({ pageId: id, workspaceId }) => {
      attempts++;
      if (attempts === 2) throw new Error('simulated process interruption');
      return x.db.prepare('DELETE FROM workspace_pages WHERE id=? AND workspace_id=?').run(id, workspaceId).changes === 1;
    },
  });
  assert.throws(() => interrupted.delete(accountId), /simulated process interruption/);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages WHERE workspace_id=?').get('personal-1').n, 1);

  const recoveredCalls = [];
  const recovered = createAccountDeletionService({
    db: x.db,
    workspaceService: createWorkspaceService(x.db),
    assertQuiescent: () => true,
    deletePage: ({ pageId: id, workspaceId, revision, actor }) => {
      recoveredCalls.push({ id, workspaceId, revision, actor });
      return x.db.prepare('DELETE FROM workspace_pages WHERE id=? AND workspace_id=?').run(id, workspaceId).changes === 1;
    },
    onDelete: ({ db: database, accountId: id, at }) => {
      database.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run('audit-recovered', id, 'account.deleted', id, at);
    },
  });
  recovered.recover();
  assert.deepEqual(recoveredCalls, [{ id: `w-${'c'.repeat(32)}`, workspaceId: 'personal-1', revision: 0, actor: accountId }]);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages WHERE workspace_id=?').get('personal-1').n, 0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM workspaces WHERE id=?').get('personal-1').n, 0);
  assert.match(x.db.prepare('SELECT email FROM users WHERE id=?').get(accountId).email, /^deleted-/);
  assert.equal(x.db.prepare("SELECT count(*) n FROM platform_admin_audit WHERE action='account.deleted'").get().n, 1);
});

test('deletion requires an exclusive maintenance state', async t => {
  const x = setup(t);
  const failing = createAccountDeletionService({
    db: x.db,
    workspaceService: createWorkspaceService(x.db),
    assertQuiescent: () => false,
    deletePage: () => true,
  });
  assert.throws(() => failing.delete(accountId), { code: 'MAINTENANCE_REQUIRED' });
});
