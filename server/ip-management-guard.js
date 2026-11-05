import { isIP } from 'node:net';

// Install before management routes and response-header middleware. The caller must
// ensure each bearerOnlyRoutes entry and, when enabled, the CLI workspace routes
// are handled exclusively by Bearer authentication, never by session/cookie
// fallback. This guard does not authenticate credentials.
export function createIpManagementGuard({ ipHosting = null, bearerOnlyRoutes = [], enableCli = false } = {}) {
  if (ipHosting == null || ipHosting === false) return (_req, _res, next) => next();

  const parseOrigin = value => {
    let url;
    try { url = new URL(value); } catch { throw new TypeError('Invalid IP hosting origin'); }
    if (url.protocol !== 'https:' || url.origin !== value || isIP(url.hostname) !== 4 || !url.port) {
      throw new TypeError('Invalid IP hosting origin');
    }
    return url;
  };
  const management = parseOrigin(ipHosting.managementOrigin);
  const content = parseOrigin(ipHosting.contentOrigin);
  if (management.hostname !== content.hostname || management.port === content.port) throw new TypeError('Invalid IP hosting origins');
  if (!Array.isArray(bearerOnlyRoutes) || bearerOnlyRoutes.some(route =>
    !route || !['GET', 'POST'].includes(route.method) || typeof route.path !== 'string' ||
    !route.path.startsWith('/api/cli/') || /[?#%\\]/.test(route.path) || route.path.includes('//') || route.path.includes('/../') || route.path.endsWith('/..')
  )) throw new TypeError('Invalid Bearer-only routes');
  const cliRoutes = new Set(bearerOnlyRoutes.map(route => `${route.method} ${route.path}`));

  return (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, no-store');
    const count = name => {
      let total = 0;
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) total++;
      return total;
    };
    const reject = () => res.status(403).json({ error: 'Request not allowed.' });
    if (count('host') !== 1 || req.headers.host !== management.host ||
        ['origin', 'authorization', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].some(name => count(name) > 1)) return reject();

    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const shareNavigation = req.method === 'GET' && req.path === '/share' && origin === undefined &&
      ['cross-site','same-site'].includes(site) && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (shareNavigation) return next();
    if (origin !== undefined && origin !== management.origin) return reject();
    if (site !== undefined && !['same-origin', 'none'].includes(site)) return reject();

    const hasFetchMetadata = req.rawHeaders.some((name, i) => i % 2 === 0 && name.toLowerCase().startsWith('sec-fetch-'));
    const cliWorkspacePath = enableCli === true && (
      (req.method === 'GET' && /^\/api\/cli\/workspaces(?:\/[A-Za-z0-9_-]+\/pages(?:\/[A-Za-z0-9_-]+(?:\/releases)?)?)?$/.test(req.path)) ||
      (req.method === 'GET' && /^\/api\/cli\/workspaces\/[A-Za-z0-9_-]+\/publications\/[A-Za-z0-9_-]{22,128}$/.test(req.path)) ||
      (req.method === 'GET' && /^\/api\/cli\/workspaces\/[A-Za-z0-9_-]+\/pages\/[A-Za-z0-9_-]+\/shares$/.test(req.path)) ||
      (req.method === 'POST' && /^\/api\/cli\/workspaces\/[A-Za-z0-9_-]+\/pages(?:\/[A-Za-z0-9_-]+\/replace)?$/.test(req.path)) ||
      (req.method === 'POST' && /^\/api\/cli\/workspaces\/[A-Za-z0-9_-]+\/pages\/[A-Za-z0-9_-]+\/releases\/[A-Za-z0-9_-]+\/activate$/.test(req.path)) ||
      (req.method === 'POST' && /^\/api\/cli\/workspaces\/[A-Za-z0-9_-]+\/pages\/[A-Za-z0-9_-]+\/shares$/.test(req.path)) ||
      (req.method === 'DELETE' && /^\/api\/cli\/workspaces\/[A-Za-z0-9_-]+\/pages\/[A-Za-z0-9_-]+\/shares\/[A-Za-z0-9_-]+$/.test(req.path))
    );
    const isCli = origin === undefined && !hasFetchMetadata && count('cookie') === 0 &&
      count('authorization') === 1 && /^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization || '') &&
      (cliWorkspacePath || cliRoutes.has(`${req.method} ${req.path}`));
    if (isCli) return next();

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (origin !== management.origin) return reject();
    } else if (origin === undefined && site === undefined && (count('cookie') !== 0 || count('authorization') !== 0)) {
      return reject();
    }
    return next();
  };
}
