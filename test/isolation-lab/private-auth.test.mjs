import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLab } from './private-auth-server.mjs';

test('private resources require app-bound, expiring and revocable authorization', async () => {
  let now = 1000;
  const lab = createLab({ now: () => now });
  await new Promise(resolve => lab.listen(0, '127.0.0.1', resolve));
  const port = lab.address().port;
  const request = (host, path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: options.method || 'GET', headers: { host: `${host}:${port}`, ...options.headers } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => Array.isArray(res.headers[name]) ? res.headers[name][0] : res.headers[name] } }));
    });
    req.on('error', reject); req.end(options.body);
  });
  const issue = async app => {
    const r = await request('auth.localhost', '/issue', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `app=${app}&password=lab-only` });
    assert.equal(r.status, 303);
    return new URL(r.headers.get('location')).searchParams.get('ticket');
  };
  const exchange = (app, ticket) => request(`${app}.localhost`, `/exchange?ticket=${ticket}`);
  try {
    assert.equal((await request('unknown.localhost', '/')).status, 421);
    assert.equal((await request('auth.localhost', '/issue', { method: 'POST', body: 'app=a&password=wrong' })).status, 403);
    assert.equal((await request('auth.localhost', '/issue', { method: 'POST', body: 'app=unknown&password=lab-only' })).status, 403);
    for (const path of ['/', '/nested/style.css', '/nested/app.js', '/nested/image.svg']) assert.equal((await request('a.localhost', path)).status, 401);
    const ticket = await issue('a');
    assert.equal((await exchange('b', ticket)).status, 401);
    const r = await exchange('a', ticket);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/');
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i); assert.doesNotMatch(cookie, /Domain=/i);
    assert.equal((await exchange('a', ticket)).status, 401);
    for (const path of ['/', '/nested/style.css', '/nested/app.js', '/nested/image.svg']) {
      const asset = await request('a.localhost', path, { headers: { cookie: cookie.split(';')[0] } });
      assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /no-store/);
    }
    assert.equal((await request('b.localhost', '/', { headers: { cookie: cookie.split(';')[0] } })).status, 401);
    assert.equal((await request('a.localhost', '/', { headers: { cookie: `${cookie.split(';')[0]}; ${cookie.split(';')[0]}` } })).status, 401);
    await request('auth.localhost', '/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'app=a&password=lab-only' });
    assert.equal((await request('a.localhost', '/nested/app.js', { headers: { cookie: cookie.split(';')[0] } })).status, 401);
    const expiredTicket = await issue('a'); now += 30001;
    assert.equal((await exchange('a', expiredTicket)).status, 401);
    const freshTicket = await issue('a'); const fresh = await exchange('a', freshTicket);
    const freshCookie = fresh.headers.get('set-cookie').split(';')[0]; now += 60001;
    assert.equal((await request('a.localhost', '/', { headers: { cookie: freshCookie } })).status, 401);
    const beforeRevoke = await issue('a');
    await request('auth.localhost', '/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'app=a&password=lab-only' });
    assert.equal((await exchange('a', beforeRevoke)).status, 401);
  } finally { await new Promise(resolve => lab.close(resolve)); }
});
