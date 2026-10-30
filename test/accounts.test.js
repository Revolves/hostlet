import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { accountMigrationSql, accountTokensMultiUseMigrationSql, createAccounts, normalizeEmail } from '../server/accounts.js';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';

function setup(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('BEGIN IMMEDIATE');
  db.exec(accountMigrationSql);
  db.exec(workspaceSchema);
  db.exec(accountTokensMultiUseMigrationSql);
  db.exec('COMMIT');
  t.after(() => db.close());
  const mail = [];
  let time = 1000000;
  const accounts = createAccounts({ db, sender: async message => mail.push(message), now: () => time, verificationTtlMs: 1000, resetTtlMs: 500, ...options });
  return { db, mail, accounts, setTime: value => { time = value; } };
}

test('normalizes and validates email and rejects weak or oversized passwords', async t => {
  const { accounts } = setup(t);
  assert.equal(normalizeEmail('  Alice+tag@EXAMPLE.COM '), 'alice+tag@example.com');
  for (const email of ['', 'a@localhost', 'a..b@example.com', 'a@-example.com', 'x y@example.com', 'x@example.com\n']) {
    if (email === 'x@example.com\n') continue; // surrounding whitespace is normalized
    assert.throws(() => normalizeEmail(email));
  }
  for (const password of ['short', 'x'.repeat(1025)]) await assert.rejects(accounts.register({ email: 'a@example.com', password }));
});

test('registration is atomic, stores no secrets, verifies once and creates a personal space', async t => {
  const { db, accounts, mail } = setup(t);
  const user = await accounts.register({ email: ' Alice@Example.com ', password: 'long password 123' });
  assert.equal(user.email, 'alice@example.com');
  assert.equal(await accounts.authenticate({ email: user.email, password: 'long password 123' }), null);
  await assert.rejects(accounts.register({ email: 'ALICE@example.com', password: 'another password' }));
  assert.equal(mail.length, 1);
  const { token } = mail[0];
  const rows = JSON.stringify(db.prepare('SELECT * FROM users').all()) + JSON.stringify(db.prepare('SELECT * FROM account_tokens').all());
  assert.ok(!rows.includes(token));
  assert.ok(!rows.includes('long password 123'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM workspaces WHERE created_by = ? AND type = 'personal'").get(user.id).n, 1);
  assert.equal(accounts.verifyEmail(token), true);
  assert.equal(accounts.verifyEmail(token), false);
  assert.equal((await accounts.authenticate({ email: user.email, password: 'long password 123' })).id, user.id);
  assert.equal(await accounts.authenticate({ email: user.email, password: 'wrong password' }), null);
});

test('tokens expire at the deadline and are purpose-bound', async t => {
  const { accounts, mail, setTime } = setup(t);
  await accounts.register({ email: 'a@example.com', password: 'long password 123' });
  const first = mail[0].token;
  await accounts.sendVerification({ email: 'a@example.com' });
  const second = mail[1].token;
  assert.notEqual(first, second);
  assert.equal(await accounts.resetPassword({ token: second, password: 'replacement password' }), false);
  setTime(1001000);
  assert.equal(accounts.verifyEmail(second), false);
  await accounts.sendVerification({ email: 'a@example.com' });
  assert.equal(accounts.verifyEmail(mail[2].token), true);
});

test('password reset is single use and preserves login on expiry', async t => {
  const { accounts, mail, setTime } = setup(t);
  await accounts.register({ email: 'a@example.com', password: 'long password 123' });
  accounts.verifyEmail(mail[0].token);
  await accounts.requestPasswordReset({ email: 'missing@example.com' });
  assert.equal(mail.length, 1);
  await accounts.requestPasswordReset({ email: 'a@example.com' });
  const old = mail[1].token;
  await accounts.requestPasswordReset({ email: 'a@example.com' });
  const token = mail[2].token;
  assert.notEqual(old, token);
  setTime(1000500);
  assert.equal(await accounts.resetPassword({ token, password: 'replacement password' }), false);
  assert.ok(await accounts.authenticate({ email: 'a@example.com', password: 'long password 123' }));
  await accounts.requestPasswordReset({ email: 'a@example.com' });
  const valid = mail[3].token;
  const results = await Promise.all([accounts.resetPassword({ token: valid, password: 'replacement password' }), accounts.resetPassword({ token: valid, password: 'replacement password' })]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await accounts.authenticate({ email: 'a@example.com', password: 'long password 123' }), null);
  assert.ok(await accounts.authenticate({ email: 'a@example.com', password: 'replacement password' }));
});

test('sender failures are sanitized, failed links revoked, and registration can be retried by resending', async t => {
  let captured;
  const { db, accounts } = setup(t, { sender: async message => { captured = message; throw new Error(`private ${message.token}`); } });
  await assert.rejects(accounts.register({ email: 'a@example.com', password: 'long password 123' }), error => error.code === 'MAIL_FAILED' && !error.message.includes(captured.token));
  assert.equal(accounts.verifyEmail(captured.token), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  await assert.rejects(accounts.sendVerification({ email: 'a@example.com' }), { code: 'MAIL_FAILED' });
});

test('concurrent registration creates exactly one user and one space', async t => {
  const { db, accounts, mail } = setup(t);
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => accounts.register({ email: 'same@example.com', password: 'long password 123' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'EMAIL_EXISTS'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspaces').get().n, 1);
  assert.equal(mail.length, 1);
});

test('workspace creation failure rolls back the account and sends no email', async t => {
  const { db, accounts, mail } = setup(t);
  db.exec("CREATE TRIGGER reject_workspace BEFORE INSERT ON workspace_members BEGIN SELECT RAISE(ABORT, 'injected'); END");
  await assert.rejects(accounts.register({ email: 'a@example.com', password: 'long password 123' }), /injected/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspaces').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspace_members').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_tokens').get().n, 0);
  assert.equal(mail.length, 0);
});

test('registered personal spaces are visible to workspace service and isolated between users', async t => {
  const { db, accounts } = setup(t);
  const first = await accounts.register({ email: 'first@example.com', password: 'long password 123' });
  const second = await accounts.register({ email: 'second@example.com', password: 'long password 123' });
  const workspaceService = createWorkspaceService(db);
  const [space] = workspaceService.listWorkspaces(first.id);
  assert.equal(space.type, 'personal');
  assert.equal(space.createdBy, first.id);
  assert.equal(space.role, 'owner');
  for (const permission of ['view', 'edit', 'manage']) assert.equal(workspaceService.authorize(space.id, first.id, permission), 'owner');
  assert.throws(() => workspaceService.authorize(space.id, second.id, 'view'), { code: 'FORBIDDEN' });
  assert.equal(workspaceService.listWorkspaces(second.id).length, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('registration requires workspace migration and leaves no partial user', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(accountMigrationSql);
  const accounts = createAccounts({ db, sender: async () => {} });
  await assert.rejects(accounts.register({ email: 'a@example.com', password: 'long password 123' }), /workspaces/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
});

test('incremental migration preserves v3 tokens and supports multiple tokens', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(accountMigrationSql);
  db.exec("INSERT INTO users VALUES ('u', 'u@example.com', 'hash', NULL, 10); INSERT INTO account_tokens VALUES ('h1', 'u', 'verify', 100, 10)");
  db.exec('BEGIN IMMEDIATE');
  db.exec(accountTokensMultiUseMigrationSql);
  db.exec('COMMIT');
  assert.deepEqual({ ...db.prepare('SELECT * FROM account_tokens WHERE token_hash = ?').get('h1') }, { token_hash: 'h1', user_id: 'u', purpose: 'verify', expires_at: 100, created_at: 10 });
  db.exec("INSERT INTO account_tokens VALUES ('h2', 'u', 'verify', 200, 20)");
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_tokens').get().n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.exec("INSERT INTO account_tokens VALUES ('h3', 'missing', 'verify', 200, 20)"));
  db.exec("DELETE FROM users WHERE id='u'");
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_tokens').get().n, 0);
});

test('out-of-order verification delivery leaves both links valid until either is consumed', async t => {
  const pending = [];
  const { accounts, db } = setup(t, { sender: message => new Promise((resolve, reject) => pending.push({ message, resolve, reject })) });
  const registering = accounts.register({ email: 'a@example.com', password: 'long password 123' });
  while (!pending.length) await new Promise(resolve => setImmediate(resolve));
  const resending = accounts.sendVerification({ email: 'a@example.com' });
  assert.equal(pending.length, 2);
  pending[1].resolve(); await resending;
  pending[0].resolve(); await registering;
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_tokens WHERE purpose='verify'").get().n, 2);
  assert.equal(accounts.verifyEmail(pending[0].message.token), true);
  assert.equal(accounts.verifyEmail(pending[1].message.token), false);
  assert.equal(accounts.verifyEmail(pending[0].message.token), false);
});

test('out-of-order reset delivery permits either token but only one concurrent reset', async t => {
  const pending = [];
  const { accounts } = setup(t, { sender: message => new Promise((resolve, reject) => pending.push({ message, resolve, reject })) });
  const registering = accounts.register({ email: 'a@example.com', password: 'long password 123' });
  while (!pending.length) await new Promise(resolve => setImmediate(resolve));
  pending[0].resolve(); await registering;
  assert.equal(accounts.verifyEmail(pending[0].message.token), true);
  const first = accounts.requestPasswordReset({ email: 'a@example.com' });
  const second = accounts.requestPasswordReset({ email: 'a@example.com' });
  pending[2].resolve(); await second;
  pending[1].resolve(); await first;
  const results = await Promise.all([
    accounts.resetPassword({ token: pending[1].message.token, password: 'replacement password one' }),
    accounts.resetPassword({ token: pending[2].message.token, password: 'replacement password two' }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await accounts.resetPassword({ token: pending[1].message.token, password: 'replacement password three' }), false);
  assert.equal(await accounts.resetPassword({ token: pending[2].message.token, password: 'replacement password three' }), false);
});

test('a failed send revokes only its own token, for verification and reset', async t => {
  const pending = [];
  const { accounts } = setup(t, { sender: message => new Promise((resolve, reject) => pending.push({ message, resolve, reject })) });
  const registering = accounts.register({ email: 'a@example.com', password: 'long password 123' });
  while (!pending.length) await new Promise(resolve => setImmediate(resolve));
  const resend = accounts.sendVerification({ email: 'a@example.com' });
  pending[1].resolve(); await resend;
  pending[0].reject(new Error('send failed'));
  await assert.rejects(registering, { code: 'MAIL_FAILED' });
  assert.equal(accounts.verifyEmail(pending[0].message.token), false);
  assert.equal(accounts.verifyEmail(pending[1].message.token), true);
  const first = accounts.requestPasswordReset({ email: 'a@example.com' });
  const second = accounts.requestPasswordReset({ email: 'a@example.com' });
  pending[3].resolve(); await second;
  pending[2].reject(new Error('send failed'));
  await assert.rejects(first, { code: 'MAIL_FAILED' });
  assert.equal(await accounts.resetPassword({ token: pending[2].message.token, password: 'replacement password' }), false);
  assert.equal(await accounts.resetPassword({ token: pending[3].message.token, password: 'replacement password' }), true);
});

test('tokens have independent deadlines and consuming one does not revoke another user or purpose', async t => {
  const { accounts, mail, db, setTime } = setup(t);
  const user = await accounts.register({ email: 'a@example.com', password: 'long password 123' });
  await accounts.register({ email: 'b@example.com', password: 'long password 123' });
  setTime(1000500);
  await accounts.sendVerification({ email: 'a@example.com' });
  setTime(1001000);
  assert.equal(accounts.verifyEmail(mail[0].token), false);
  // Inject a separate-purpose token to verify purpose scoping independently of API state rules.
  db.prepare("INSERT INTO account_tokens VALUES ('other-purpose', ?, 'reset', 2000000, 1000000)").run(user.id);
  assert.equal(accounts.verifyEmail(mail[2].token), true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_tokens WHERE user_id <> ? AND purpose = 'verify'").get(user.id).n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_tokens WHERE token_hash='other-purpose'").get().n, 1);
  await accounts.sendVerification({ email: 'b@example.com' });
  assert.equal(accounts.verifyEmail(mail[3].token), true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_tokens WHERE token_hash='other-purpose'").get().n, 1);
});

test('failure updating a user rolls back token consumption and sibling revocation', async t => {
  const { accounts, mail, db } = setup(t);
  await accounts.register({ email: 'a@example.com', password: 'long password 123' });
  await accounts.sendVerification({ email: 'a@example.com' });
  db.exec("CREATE TRIGGER reject_verify BEFORE UPDATE OF email_verified_at ON users BEGIN SELECT RAISE(ABORT, 'injected'); END");
  assert.throws(() => accounts.verifyEmail(mail[0].token), /injected/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_tokens WHERE purpose='verify'").get().n, 2);
  db.exec('DROP TRIGGER reject_verify');
  assert.equal(accounts.verifyEmail(mail[1].token), true);
  await accounts.requestPasswordReset({ email: 'a@example.com' });
  await accounts.requestPasswordReset({ email: 'a@example.com' });
  db.exec("CREATE TRIGGER reject_reset BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT, 'injected'); END");
  await assert.rejects(accounts.resetPassword({ token: mail[2].token, password: 'replacement password' }), /injected/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM account_tokens WHERE purpose='reset'").get().n, 2);
  db.exec('DROP TRIGGER reject_reset');
  assert.equal(await accounts.resetPassword({ token: mail[3].token, password: 'replacement password' }), true);
});

test('unverified users cannot request reset and foreign keys are required', async t => {
  const { accounts, mail } = setup(t);
  await accounts.register({ email: 'a@example.com', password: 'long password 123' });
  await accounts.requestPasswordReset({ email: 'a@example.com' });
  assert.equal(mail.length, 1);
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=OFF');
  assert.throws(() => createAccounts({ db, sender: async () => {} }), /foreign_keys/);
});
