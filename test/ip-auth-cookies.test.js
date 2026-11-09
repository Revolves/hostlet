import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../server/auth.js';
import { createAccountSessions, sessionSchema } from '../server/account-sessions.js';

function response() {
  return { cookie(name, value, options) { this.set = { name, value, options }; }, clearCookie(name, options) { this.cleared = { name, options }; }, json(body) { this.body = body; return this; }, status(code) { this.code = code; return this; } };
}
function assertCookie(cookie, name, secure, path) {
  assert.equal(cookie.name, name);
  assert.equal(cookie.options.secure, secure);
  assert.equal(cookie.options.path, path);
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, 'strict');
  assert.equal(cookie.options.domain, undefined);
}

test('admin cookies use the mode-specific name for issuance, reading and logout', () => {
  for (const [mode, name, secure, path] of [
    [{ ipHosting: {} }, '__Host-hostlet_admin', true, '/'],
    [{ singleDomainHosting: true }, '__Host-hostlet_admin', true, '/'],
    [{}, 'hostlet_admin', false, '/api'],
  ]) {
    const sessions = { purgeExpired() {}, create() { return { token: 'valid' }; }, find(token) { return token === 'valid' ? { id: 's' } : null; }, delete(token) { this.deleted = token; } };
    const auth = createAuth({ config: { ...mode, secureCookies: false, adminPassword: 'password', sessionTtlMs: 1000 }, sessions });
    const res = response();
    auth.login({ ip: 'test', body: { password: 'password' } }, res);
    assertCookie(res.set, name, secure, path);
    const req = raw => ({ headers: { cookie: raw } });
    auth.me(req(`${name}=valid`), res); assert.equal(res.body.authenticated, true);
    for (const raw of [`${name}=valid; ${name}=other`, `${name}=other; ${name}=valid`]) {
      auth.me(req(raw), res); assert.equal(res.body.authenticated, false);
    }
    auth.logout(req(`${name}=valid`), res);
    assert.equal(sessions.deleted, 'valid'); assertCookie(res.cleared, name, secure, path);
  }
});

test('account cookie selection isolates names and rejects duplicate cookies', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, password_hash TEXT, email_verified_at INTEGER);');
  db.exec(sessionSchema);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u', 'u@example.com', 'hash', 1);
  for (const [name, secure] of [['__Host-hostlet_account', true], ['hostlet_account', false]]) {
    const service = createAccountSessions({ db, secure: false, cookieName: name });
    const token = service.create({ id: 'u' }, service.snapshot('u@example.com'));
    const res = response(); service.setCookie(res, token); assertCookie(res.set, name, secure, '/');
    const req = raw => ({ headers: { cookie: raw } });
    assert.equal(service.find(req(`${name}=${token}`)).id, 'u');
    for (const raw of [`${name}=${token}; ${name}=other`, `${name}=other; ${name}=${token}`]) assert.equal(service.find(req(raw)), null);
    const other = name.startsWith('__Host-') ? 'hostlet_account' : '__Host-hostlet_account';
    assert.equal(service.find(req(`${other}=${token}`)), null);
    service.logout(req(`${name}=${token}`), res); assertCookie(res.cleared, name, secure, '/');
    assert.equal(service.find(req(`${name}=${token}`)), null);
  }
  for (const cookieName of ['__Host-other', 'other', '', null]) assert.throws(() => createAccountSessions({ db, secure: false, cookieName }), TypeError);
});
