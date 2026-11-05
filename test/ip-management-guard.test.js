import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createIpManagementGuard } from '../server/ip-management-guard.js';

const ipHosting = { managementOrigin: 'https://192.0.2.1:30006', contentOrigin: 'https://192.0.2.1:30007' };
const host = '192.0.2.1:30006';

async function fixture(t, options = {}) {
  const app = express();
  app.use(createIpManagementGuard(options));
  app.use((req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (method, headers = {}, path = '/api/account') => new Promise((resolve, reject) => {
    const rawHeaders = Object.entries({ Host: host, ...headers }).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).flatMap(item => [name, item]));
    const request = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers: rawHeaders }, res => {
      res.resume(); res.on('end', () => resolve(res));
    });
    request.on('error', reject); request.end();
  });
}

test('inactive mode passes through without changing headers', async t => {
  const send = await fixture(t);
  const res = await send('POST', { Host: 'other.example', Origin: 'https://evil.example' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cross-origin-resource-policy'], undefined);
});

test('enabled mode requires exact management host and unique headers', async t => {
  const send = await fixture(t, { ipHosting });
  for (const bad of ['192.0.2.1:30007', '192.0.2.1', 'evil.example:30006', '192.0.2.1:30006, evil.example']) {
    assert.equal((await send('GET', { Host: bad })).statusCode, 403, bad);
  }
  assert.equal((await send('GET', { Host: [host, host] })).statusCode, 403);
  assert.equal((await send('POST', { Origin: [ipHosting.managementOrigin, ipHosting.managementOrigin] })).statusCode, 403);
  assert.equal((await send('GET', { 'Sec-Fetch-Site': ['same-origin', 'same-origin'] })).statusCode, 403);
});

test('writes require the sole exact management origin', async t => {
  const send = await fixture(t, { ipHosting });
  for (const headers of [{}, { Origin: ipHosting.contentOrigin }, { Origin: 'null' }, { Origin: `${ipHosting.managementOrigin} ${ipHosting.contentOrigin}` }, { Origin: 'https://192.0.2.1:30008' }, { Authorization: 'Bearer arbitrary' }]) {
    assert.equal((await send('POST', headers)).statusCode, 403, JSON.stringify(headers));
  }
  assert.equal((await send('POST', { Origin: ipHosting.managementOrigin, Cookie: 'session=fixture' })).statusCode, 200);
});

test('sensitive GET rejects cross-origin or uncertain browser requests and sends CORP', async t => {
  const send = await fixture(t, { ipHosting });
  for (const headers of [
    { Origin: ipHosting.contentOrigin },
    { 'Sec-Fetch-Site': 'same-site', Cookie: 'session=fixture' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'invalid' },
    { Cookie: 'session=fixture' },
    { Authorization: 'Basic Zm9vOmJhcg==' },
  ]) assert.equal((await send('GET', headers)).statusCode, 403, JSON.stringify(headers));
  for (const headers of [{ 'Sec-Fetch-Site': 'same-origin', Cookie: 'session=fixture' }, { 'Sec-Fetch-Site': 'none', Cookie: 'session=fixture' }, {}, { Origin: ipHosting.managementOrigin }]) {
    const res = await send('GET', headers);
    assert.equal(res.statusCode, 200, JSON.stringify(headers));
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
  }
});

test('a share link can be opened as a top-level navigation from another site', async t => {
  const send=await fixture(t,{ipHosting});
  const headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
  assert.equal((await send('GET',headers,'/share')).statusCode,200);
  assert.equal((await send('GET',{...headers,'Sec-Fetch-Site':'same-site'},'/share')).statusCode,200);
  assert.equal((await send('GET',headers,'/api/account/me')).statusCode,403);
  assert.equal((await send('GET',{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'},'/share')).statusCode,403);
});

test('CLI exception is explicit, cookie-free, non-browser and limited to exact method and path', async t => {
  const send = await fixture(t, { ipHosting, bearerOnlyRoutes: [{ method: 'POST', path: '/api/cli/publish' }, { method: 'GET', path: '/api/cli/workspaces' }] });
  const authorization = `Bearer ${'a'.repeat(43)}`;
  assert.equal((await send('POST', { Authorization: authorization }, '/api/cli/publish')).statusCode, 200);
  assert.equal((await send('GET', { Authorization: authorization }, '/api/cli/workspaces')).statusCode, 200);
  for (const [method, headers, path] of [
    ['POST', { Authorization: authorization }, '/api/account'],
    ['POST', { Authorization: authorization, Cookie: 'session=fixture' }, '/api/cli/publish'],
    ['POST', { Authorization: authorization, Origin: ipHosting.contentOrigin }, '/api/cli/publish'],
    ['POST', { Authorization: authorization, 'Sec-Fetch-Site': 'same-origin' }, '/api/cli/publish'],
    ['POST', { Authorization: [authorization, authorization] }, '/api/cli/publish'],
    ['POST', { Authorization: 'Bearer arbitrary' }, '/api/cli/publish'],
    ['POST', { Authorization: authorization }, '/api/cli/publish/extra'],
    ['GET', { Authorization: authorization }, '/api/account'],
  ]) assert.equal((await send(method, headers, path)).statusCode, 403, JSON.stringify([method, headers, path]));
});

test('malformed enabled configuration fails closed', () => {
  for (const bad of [{}, { managementOrigin: 'http://192.0.2.1:30006' }, { managementOrigin: 'https://example.org:30006' }, { managementOrigin: ipHosting.managementOrigin, contentOrigin: ipHosting.managementOrigin }]) {
    assert.throws(() => createIpManagementGuard({ ipHosting: bad }));
  }
});

test('enableCli permits only the existing Bearer-only workspace routes without browser credentials', async t => {
  const send = await fixture(t, { ipHosting, enableCli: true });
  const authorization = `Bearer ${'a'.repeat(43)}`;
  const headers = { Authorization: authorization };
  for (const [method, path] of [
    ['GET', '/api/cli/workspaces'],
    ['GET', '/api/cli/workspaces/ws-123/pages'],
    ['GET', '/api/cli/workspaces/ws-123/pages/page_456'],
    ['GET', '/api/cli/workspaces/ws-123/pages/page_456/releases'],
    ['POST', '/api/cli/workspaces/ws-123/pages'],
    ['POST', '/api/cli/workspaces/ws-123/pages/page_456/replace'],
    ['POST', '/api/cli/workspaces/ws-123/pages/page_456/releases/release-1/activate'],
    ['GET', '/api/cli/workspaces/ws-123/pages/page_456/shares'],
    ['POST', '/api/cli/workspaces/ws-123/pages/page_456/shares'],
    ['DELETE', '/api/cli/workspaces/ws-123/pages/page_456/shares/share-1'],
    ['GET', '/api/cli/workspaces/ws-123/pages?limit=5'],
  ]) assert.equal((await send(method, headers, path)).statusCode, 200, `${method} ${path}`);

  for (const [method, path] of [
    ['GET', '/api/account'], ['POST', '/api/cli/publish'],
    ['POST', '/api/cli/workspaces'], ['GET', '/api/cli/workspaces/ws/pages/page/replace'],
    ['POST', '/api/cli/workspaces/ws/pages/page'], ['DELETE', '/api/cli/workspaces/ws/pages/page'],
    ['PATCH', '/api/cli/workspaces/ws/pages/page/replace'],
    ['GET', '/api/cli/workspaces/ws/pages/page/releases/extra'],
    ['PATCH', '/api/cli/workspaces/ws/pages/page/shares'],
    ['GET', '/api/cli/workspaces/ws/pages/page/shares/extra/extra'],
    ['POST', '/api/cli/workspaces/ws/pages/page/shares/share-1'],
    ['DELETE', '/api/cli/workspaces/ws/pages/page/shares'],
    ['POST', '/api/cli/workspaces/ws/pages/page/releases/release-1'],
    ['GET', '/api/cli/workspaces/ws%2fadmin/pages'],
    ['POST', '/api/cli/workspaces/ws/pages/%2e%2e/replace'],
    ['GET', '/api/cli/workspaces/../pages'],
    ['GET', '/api/cli/workspaces/ws//pages'],
    ['GET', '/api/cli/workspaces/ws\\admin/pages'],
  ]) assert.equal((await send(method, headers, path)).statusCode, 403, `${method} ${path}`);

  for (const extra of [
    { Cookie: 'session=fixture' }, { Origin: ipHosting.contentOrigin },
    { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Mode': 'cors' },
    { Authorization: 'Bearer invalid' }, { Authorization: [authorization, authorization] },
  ]) assert.equal((await send('POST', { ...headers, ...extra }, '/api/cli/workspaces/ws/pages')).statusCode, 403, JSON.stringify(extra));
});

test('dynamic CLI routes remain disabled by default', async t => {
  const send = await fixture(t, { ipHosting });
  assert.equal((await send('POST', { Authorization: `Bearer ${'a'.repeat(43)}` }, '/api/cli/workspaces/ws/pages')).statusCode, 403);
});
