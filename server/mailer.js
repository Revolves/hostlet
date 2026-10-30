import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Create an accounts sender. security is 'tls' (implicit TLS) or 'starttls'
 * (mandatory upgrade); auth, when supplied, is { user, pass }. adminOrigin is
 * the trusted management origin, never a request Host header. The management
 * UI must implement /verify-email and /reset-password and read #token=... .
 * The optional createTransport dependency is intended for tests.
 */
export function createMailer({ host, port, security, auth, from, adminOrigin } = {}, { createTransport } = {}) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || !['tls', 'starttls'].includes(security) ||
      typeof from !== 'string' || !from.trim() || /[\r\n]/.test(from) ||
      (createTransport !== undefined && typeof createTransport !== 'function')) throw new TypeError('Invalid mail configuration.');
  if (auth !== undefined && (!auth || typeof auth.user !== 'string' || !auth.user || typeof auth.pass !== 'string' || !auth.pass)) {
    throw new TypeError('Invalid mail authentication.');
  }
  let origin;
  try { origin = new URL(adminOrigin); } catch { throw new TypeError('Invalid admin origin.'); }
  if (origin.origin !== adminOrigin || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new TypeError('Invalid admin origin.');
  }
  const transport = (createTransport ?? require('nodemailer').createTransport)({
    host, port, secure: security === 'tls', requireTLS: security === 'starttls',
    tls: { rejectUnauthorized: true }, ...(auth === undefined ? {} : { auth: { user: auth.user, pass: auth.pass } }),
  });
  if (!transport || typeof transport.sendMail !== 'function') throw new TypeError('Invalid mail transport.');

  const accepted = info => Array.isArray(info?.accepted) && info.accepted.length === 1 && (!Array.isArray(info.rejected) || info.rejected.length === 0);
  async function sender({ to, purpose, token } = {}) {
    if (typeof to !== 'string' || !/^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+$/.test(to) ||
        !['verify', 'reset'].includes(purpose) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new TypeError('Invalid account email message.');
    }
    const link = new URL(purpose === 'verify' ? '/verify-email' : '/reset-password', origin);
    link.hash = new URLSearchParams({ token }).toString();
    const subject = purpose === 'verify' ? 'Hostlet 验证邮箱 / Verify your email address' : 'Hostlet 重置密码 / Reset your password';
    const instruction = purpose === 'verify' ? '请打开以下链接验证邮箱。\nOpen the link below to verify your email address.' : '请打开以下链接重置密码。\nOpen the link below to reset your password.';
    const text = `${instruction}\n\n${link.href}\n\n如果不是您本人操作，请忽略此邮件。\nIf you did not request this, ignore this email.`;
    const info = await transport.sendMail({ from, to, subject, text });
    if (!accepted(info)) {
      throw new Error('Email recipient was not accepted.');
    }
  }
  sender.sendRetention = async ({ to, pageId, workspaceId, deleteAfter, idempotencyKey } = {}) => {
    if (typeof to !== 'string' || !/^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+$/.test(to) ||
        typeof pageId !== 'string' || !/^w-[a-f0-9]{32}$/.test(pageId) ||
        typeof workspaceId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(workspaceId) ||
        !Number.isSafeInteger(deleteAfter) || deleteAfter < 0 || deleteAfter > 8640000000000000 ||
        typeof idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(idempotencyKey)) throw new TypeError('Invalid retention email message.');
    const subject = 'Hostlet 应用清理提醒 / Inactive application cleanup notice';
    const link = new URL('/account', origin);
    const text = `您的应用因长期未更新，计划按平台保留策略清理。\nYour inactive application is scheduled for cleanup under the retention policy.\n\n工作空间 / Workspace: ${workspaceId}\n应用 / Application: ${pageId}\n最早清理时间 / Earliest cleanup time (UTC): ${new Date(deleteAfter).toISOString()}\n\n请登录管理页面检查并更新应用：\nSign in to review and update the application:\n${link.href}\n\n如需继续保留，请在清理前更新应用。\nUpdate the application before cleanup if you want to keep it.`;
    const info = await transport.sendMail({ from, to, subject, text });
    if (!accepted(info)) throw new Error('Email recipient was not accepted.');
    // SMTP does not guarantee exactly-once delivery; retries may send duplicates.
    return true;
  };
  return sender;
}
