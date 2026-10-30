// Disposable local experiment. Never use this server or its demo password in production.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createLab({ now = Date.now } = {}) {
  const tickets = new Map(), sessions = new Map();
  const token = () => randomBytes(32).toString('base64url');
  const apps = new Set(['a', 'b']);
  const resources = new Map([
    ['/', ['text/html; charset=utf-8', '<!doctype html><title>Private lab</title><link rel="stylesheet" href="/nested/style.css"><h1>Private lab</h1><img src="/nested/image.svg"><p id="script">waiting</p><script src="/nested/app.js"></script>']],
    ['/nested/style.css', ['text/css', 'h1 { color: rgb(0, 80, 0) }']],
    ['/nested/app.js', ['text/javascript', "document.querySelector('#script').textContent = 'script loaded';"]],
    ['/nested/image.svg', ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>']]
  ]);
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = req.headers.host;
    const port = req.socket.localPort;
    if (!['auth', 'a', 'b'].some(name => host === `${name}.localhost:${port}`)) { res.writeHead(421).end(); return; }
    const name = host.slice(0, host.indexOf('.'));
    const url = new URL(req.url, `http://${host}`);
    if (name === 'auth') {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Trusted lab authorization</title><h1>Trusted lab authorization</h1><form action="/issue" method="post"><label>Application <select name="app"><option>a</option><option>b</option></select></label><label>Demo password <input name="password" type="password"></label><button>Authorize</button></form><p>Test password: lab-only</p>'); return;
      }
      if (req.method === 'POST' && ['/issue', '/revoke'].includes(url.pathname)) {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1024) { res.writeHead(413).end(); return; } }
        const input = new URLSearchParams(body), app = input.get('app');
        if (!apps.has(app) || input.get('password') !== 'lab-only') { res.writeHead(403).end(); return; }
        if (url.pathname === '/revoke') {
          for (const [key, value] of tickets) if (value.app === app) tickets.delete(key);
          for (const [key, value] of sessions) if (value.app === app) sessions.delete(key);
          res.writeHead(204).end(); return;
        }
        const ticket = token(); tickets.set(ticket, { app, expires: now() + 30000 });
        res.writeHead(303, { Location: `http://${app}.localhost:${port}/exchange?ticket=${ticket}` }).end(); return;
      }
      res.writeHead(404).end(); return;
    }
    if (req.method === 'GET' && url.pathname === '/exchange') {
      const key = url.searchParams.get('ticket'), record = tickets.get(key);
      if (!record || record.app !== name || record.expires <= now()) { res.writeHead(401).end(); return; }
      tickets.delete(key);
      const session = token(); sessions.set(session, { app: name, expires: now() + 60000 });
      res.writeHead(303, { Location: '/', 'Set-Cookie': `lab_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60` }).end(); return;
    }
    const cookies = (req.headers.cookie || '').split(';').map(v => v.trim().split('='));
    const values = cookies.filter(([key]) => key === 'lab_session');
    const session = values.length === 1 ? sessions.get(values[0][1]) : null;
    if (!session || session.app !== name || session.expires <= now()) { res.writeHead(401).end('Authorization required'); return; }
    const resource = resources.get(url.pathname);
    if (req.method !== 'GET' || !resource) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': resource[0] }).end(resource[1]);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PRIVATE_LAB_PORT || 43172);
  createLab().listen(port, '127.0.0.1', () => console.log(`Private authorization lab: http://auth.localhost:${port}/`));
}
