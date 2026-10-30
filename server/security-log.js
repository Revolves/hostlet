import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const FILE_PATTERN = /^security-(\d{4}-\d{2}-\d{2})\.ndjson$/;
const SAFE_ROUTE = /^\/[a-z0-9/_.*-]*$/i;
const SAFE_METHOD = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER)$/;

function clean(value, fallback = '', limit = 128) {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, limit) : fallback;
}

function dayStart(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function dayName(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Append-only, one-file-per-UTC-day security event log. Entries contain only
 * server-selected route templates and request metadata. Callers must never pass
 * paths, query strings, headers, bodies, cookies or credentials.
 */
export function createSecurityLog({ directory, retentionDays = 180, now = Date.now } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) ||
      !Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650 ||
      typeof now !== 'function') throw new TypeError('Invalid security log configuration');
  const root = path.resolve(directory);
  let lastCleanupDay = null;
  function ensureDirectory() {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe security log directory');
    fs.chmodSync(root, 0o700);
  }
  function safeFile(name) {
    const file = path.join(root, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe security log file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return file;
  }
  function cleanup() {
    const at = now();
    if (!Number.isSafeInteger(at)) throw new Error('Invalid clock value');
    ensureDirectory();
    const cutoff = dayStart(at) - retentionDays * DAY;
    let removed = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = FILE_PATTERN.exec(entry.name);
      if (!match) continue;
      const day = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (!Number.isSafeInteger(day) || day >= cutoff) continue;
      try {
        const file = safeFile(entry.name);
        fs.unlinkSync(file);
        removed++;
      } catch { /* A single rotation failure must not affect request handling. */ }
    }
    lastCleanupDay = dayName(at);
    return removed;
  }
  function record(value) {
    try {
      const at = now();
      const day = dayName(at);
      if (lastCleanupDay !== day) cleanup();
      const method = typeof value?.method === 'string' && SAFE_METHOD.test(value.method) ? value.method : 'OTHER';
      const route = typeof value?.route === 'string' && SAFE_ROUTE.test(value.route) ? clean(value.route, '/other', 120) : '/other';
      const status = Number.isSafeInteger(value?.status) && value.status >= 0 && value.status <= 599 ? value.status : 0;
      const durationMs = Number.isSafeInteger(value?.durationMs) && value.durationMs >= 0 ? value.durationMs : 0;
      const client = clean(value?.client, 'unknown');
      const row = {
        time: new Date(at).toISOString(),
        event: 'http_request',
        method,
        route,
        status,
        durationMs,
        client,
      };
      const file = safeFile(`security-${day}.ndjson`);
      const fd = fs.openSync(file, 'a', 0o600);
      try { fs.writeSync(fd, `${JSON.stringify(row)}\n`); }
      finally { fs.closeSync(fd); }
      try { fs.chmodSync(file, 0o600); } catch { /* Best effort on platforms without POSIX modes. */ }
      return true;
    } catch { return false; }
  }
  return { record, cleanup };
}

function routeTemplate(req, mode) {
  const pathname = String(req.path || '').toLowerCase();
  if (mode === 'content') {
    if (pathname === '/__host/exchange') return '/app/exchange';
    if (pathname === '/__host/login') return '/legacy/login';
    if (pathname.startsWith('/p/')) return '/legacy/page';
    return '/application';
  }
  if (pathname === '/api/account' || pathname.startsWith('/api/account/')) return '/api/account';
  if (pathname === '/api/workspaces' || pathname.startsWith('/api/workspaces/')) return '/api/workspaces';
  if (pathname === '/api/shares' || pathname.startsWith('/api/shares/')) return '/api/shares';
  if (pathname === '/api/platform' || pathname.startsWith('/api/platform/')) return '/api/platform';
  if (pathname === '/api/host' || pathname.startsWith('/api/host/')) return '/api/host';
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return '/api/auth';
  if (pathname === '/api/health' || pathname.startsWith('/api/health/')) return '/api/health';
  if (pathname === '/api' || pathname.startsWith('/api/')) return '/api';
  return null;
}

/** Express middleware. It writes only after the response and never inspects input. */
export function createSecurityRequestLogger({ securityLog, mode = 'management' } = {}) {
  if (!securityLog || typeof securityLog.record !== 'function' || !['management', 'content'].includes(mode)) {
    throw new TypeError('Invalid security request logger configuration');
  }
  return (req, res, next) => {
    const started = Date.now();
    const route = routeTemplate(req, mode);
    let written = false;
    const finish = () => {
      if (written) return;
      written = true;
      if (!route) return;
      const status = res.writableEnded ? res.statusCode : 499;
      if (mode === 'content' && route !== '/app/exchange' && status < 400) return;
      securityLog.record({
        method: req.method,
        route,
        status,
        durationMs: Math.max(0, Date.now() - started),
        client: req.ip,
      });
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  };
}
