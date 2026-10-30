import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import { createAccounts } from '../server/accounts.js';
import { createApiCredentials } from '../server/api-credentials.js';

test('credentials are scoped, expire, and can be revoked without storing the secret', async () => {
  const db = openDatabase(':memory:');
  try {
    let message;
    const accounts = createAccounts({db, sender: async value => { message = value; }});
    const user = await accounts.register({email:'cli@example.org',password:'a sufficiently long password'});
    accounts.verifyEmail(message.token);
    let now = 1000;
    const credentials = createApiCredentials({db, now: () => now});
    const issued = credentials.create(user.id, {name:'test', scopes:['read','publish'], expiresAt:2000});
    assert.equal(credentials.authenticate(issued.token, 'publish').userId, user.id);
    assert.equal(credentials.authenticate(issued.token, 'share'), null);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM api_credentials').all()).includes(issued.token), false);
    assert.equal(credentials.list(user.id)[0].name, 'test');
    now = 2000;
    assert.equal(credentials.authenticate(issued.token, 'read'), null);
    now = 1000;
    credentials.revoke(user.id, issued.id);
    assert.equal(credentials.authenticate(issued.token, 'read'), null);
    const second = credentials.create(user.id, {name:'reset', scopes:['read'], expiresAt:2000});
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('changed',user.id);
    assert.equal(credentials.authenticate(second.token, 'read'), null);
  } finally { db.close(); }
});
