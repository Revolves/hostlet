import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer } from '../server/mailer.js';

const config = { host: 'smtp.example.com', port: 587, security: 'starttls', from: 'Hostlet <mail@example.com>', adminOrigin: 'https://admin.example.com' };

function setup(overrides = {}, sendMail = async () => ({ accepted: ['user@example.com'], rejected: [] })) {
  let options;
  const messages = [];
  const sender = createMailer({ ...config, ...overrides }, { createTransport(value) {
    options = value;
    return { sendMail: async message => { messages.push(message); return sendMail(message); } };
  } });
  return { sender, options, messages };
}

test('sends account links to the configured origin with the token in the fragment', async () => {
  const { sender, options, messages } = setup();
  for (const purpose of ['verify', 'reset']) await sender({ to: 'user@example.com', purpose, token: 'a'.repeat(43), expiresAt: 1234 });
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.auth, undefined);
  for (const [i, path] of ['/verify-email', '/reset-password'].entries()) {
    assert.equal(messages[i].from, config.from);
    assert.equal(messages[i].to, 'user@example.com');
    const url = new URL(messages[i].text.match(/https:\/\/[^\s]+/)[0]);
    assert.equal(url.origin, config.adminOrigin);
    assert.equal(url.pathname, path);
    assert.equal(url.search, '');
    assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), 'a'.repeat(43));
    assert.match(messages[i].subject,i === 0 ? /验证邮箱.*Verify/ : /重置密码.*Reset/);
    assert.match(messages[i].text,/如果不是您本人操作/);
    assert.match(messages[i].text,/If you did not request this/);
    assert.equal((messages[i].text.match(/https:\/\//g) || []).length,1);
  }
});

test('direct TLS and optional authentication use secure transport settings', () => {
  const { options } = setup({ port: 465, security: 'tls', auth: { user: 'user', pass: 'secret' } });
  assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.deepEqual(options.auth, { user: 'user', pass: 'secret' });
});

test('rejects unsafe or incomplete configuration before creating a transport', () => {
  for (const override of [
    { host: '' }, { host: 'smtp://example.com' }, { port: 0 }, { port: 65536 }, { port: '587' },
    { security: 'plain' }, { security: undefined }, { from: '' }, { from: 'x\r\nBcc: y' },
    { auth: { user: 'u' } }, { auth: { user: '', pass: 'p' } },
    { adminOrigin: 'http://admin.example.com' }, { adminOrigin: 'https://evil@example.com' },
    { adminOrigin: 'https://example.com/path' }, { adminOrigin: 'https://example.com?x=1' },
    { adminOrigin: 'https://example.com/#fragment' },
  ]) assert.throws(() => setup(override), TypeError);
});

test('rejects invalid message data without sending', async () => {
  const { sender, messages } = setup();
  for (const message of [
    { to: 'user@example.com', purpose: 'other', token: 'a'.repeat(43) },
    { to: 'user@example.com', purpose: 'verify', token: 'bad' },
    { to: 'user@example.com\r\nBcc: attacker@example.com', purpose: 'verify', token: 'a'.repeat(43) },
  ]) await assert.rejects(sender(message), TypeError);
  assert.equal(messages.length, 0);
});

test('propagates transport failures and rejects recipients not accepted', async () => {
  const failure = new Error('transport failed');
  const message = { to: 'user@example.com', purpose: 'reset', token: 'a'.repeat(43) };
  await assert.rejects(setup({}, async () => { throw failure; }).sender(message), error => error === failure);
  await assert.rejects(setup({}, async () => ({ accepted: [], rejected: ['user@example.com'] })).sender(message), /not accepted/i);
});

test('retention notifications contain a management link and confirmed earliest deletion time', async () => {
  const { sender, messages }=setup();
  const message={to:'user@example.com',pageId:'w-'+'a'.repeat(32),workspaceId:'space-1',deleteAfter:Date.parse('2026-02-01T00:00:00Z'),idempotencyKey:'12345678-1234-4123-8123-123456789012'};
  assert.equal(await sender.sendRetention(message),true);
  assert.match(messages[0].text,/2026-02-01T00:00:00.000Z/);
  assert.match(messages[0].text,/https:\/\/admin\.example\.com\/account/);
  assert.match(messages[0].text,new RegExp(message.pageId));
  assert.match(messages[0].text,/inactive/i);
  assert.match(messages[0].text,/更新应用/);
  assert.match(messages[0].subject,/清理提醒.*cleanup/i);
  assert.doesNotMatch(JSON.stringify(messages[0]),/12345678-1234-4123-8123-123456789012/);
  for (const invalid of [{...message,to:'x\r\nBcc: y'}, {...message,pageId:'../secret'}, {...message,workspaceId:'x\nBcc:y'}, {...message,deleteAfter:Infinity}, {...message,idempotencyKey:'bad'}]) await assert.rejects(sender.sendRetention(invalid),TypeError);
  assert.equal(messages.length,1);
  await assert.rejects(setup({},async()=>({accepted:[],rejected:['user@example.com']})).sender.sendRetention(message),/not accepted/i);
  await assert.rejects(setup({},async()=>{throw Error('transport failure');}).sender.sendRetention(message),/transport failure/);
});
