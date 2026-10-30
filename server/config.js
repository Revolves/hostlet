import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function required(value, name) {
  if (!value || !value.trim()) {
    throw new Error(`${name} is required. Copy .env.example to .env and configure it.`);
  }

  return value.trim();
}

export function loadConfig(env = process.env, overrides = {}) {
  const adminPort = positiveInteger(env.ADMIN_PORT, 3000, "ADMIN_PORT");
  const pagesPort = positiveInteger(env.PAGES_PORT, 8080, "PAGES_PORT");
  const bindAddress = env.BIND_ADDRESS || undefined;
  if (bindAddress !== undefined && !isIP(bindAddress)) throw new Error("BIND_ADDRESS must be a literal IPv4 or IPv6 address.");
  const dataDir = path.resolve(projectRoot, env.DATA_DIR || "data");
  const adminOrigin = (env.ADMIN_ORIGIN || `http://localhost:${adminPort}`).replace(/\/$/, "");
  const configuredOrigins = String(env.ADMIN_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const multiuserEnabled = env.MULTIUSER_ENABLED === "true";
  let ipHosting = null;
  if (env.SINGLE_IP_CONTENT_ORIGIN) {
    let adminUrl, contentUrl;
    try { adminUrl = new URL(adminOrigin); contentUrl = new URL(env.SINGLE_IP_CONTENT_ORIGIN); }
    catch { throw new Error('Invalid single IP hosting origin.'); }
    const canonical = (url, input) => url.protocol === 'https:' && url.origin === input && !url.username && !url.password && isIP(url.hostname) === 4 && Boolean(url.port);
    if (!multiuserEnabled || env.REGISTRATION_ENABLED === 'true' || env.APPS_DOMAIN || env.COOKIE_SECURE !== 'true' ||
        !canonical(adminUrl, adminOrigin) || !canonical(contentUrl, env.SINGLE_IP_CONTENT_ORIGIN) || adminUrl.hostname !== contentUrl.hostname || adminUrl.port === contentUrl.port ||
        configuredOrigins.some(origin => origin !== adminUrl.origin)) {
      throw new Error('Invalid single IP hosting configuration: require multiuser, closed registration, secure cookies and distinct HTTPS ports on the same IP.');
    }
    ipHosting = { managementOrigin: adminUrl.origin, contentOrigin: contentUrl.origin };
  }
  const securityLogRetentionDays = positiveInteger(env.SECURITY_LOG_RETENTION_DAYS, 180, "SECURITY_LOG_RETENTION_DAYS");
  if (securityLogRetentionDays > 3650) throw new Error("SECURITY_LOG_RETENTION_DAYS must be at most 3650.");
  let smtp = null;
  if (multiuserEnabled) {
    const security = env.SMTP_SECURITY || "starttls";
    if (!["starttls", "tls"].includes(security)) throw new Error("SMTP_SECURITY must be starttls or tls.");
    const host = required(env.SMTP_HOST, "SMTP_HOST");
    const from = required(env.SMTP_FROM, "SMTP_FROM");
    const port = positiveInteger(env.SMTP_PORT, security === "tls" ? 465 : 587, "SMTP_PORT");
    if (port > 65535) throw new Error("SMTP_PORT must be at most 65535.");
    const auth = env.SMTP_USER ? { user: env.SMTP_USER, pass: required(env.SMTP_PASSWORD, "SMTP_PASSWORD") } : undefined;
    if (!env.SMTP_USER && env.SMTP_PASSWORD) throw new Error("SMTP_USER is required when SMTP_PASSWORD is set.");
    smtp = { host, from, port, security, auth, adminOrigin };
  }

  const config = {
    projectRoot,
    adminPort,
    pagesPort,
    bindAddress,
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${pagesPort}`).replace(/\/$/, ""),
    adminOrigin,
    allowedOrigins: configuredOrigins.length > 0 ? configuredOrigins : [adminOrigin],
    trustedProxies: String(env.TRUSTED_PROXY_IPS || "").split(",").map((ip) => ip.trim()).filter(Boolean),
    dataDir,
    adminPassword: required(env.ADMIN_PASSWORD, "ADMIN_PASSWORD"),
    appSecret: required(env.APP_SECRET, "APP_SECRET"),
    secureCookies: env.COOKIE_SECURE === "true",
    securityLogRetentionDays,
    multiuserEnabled,
    registrationEnabled: env.REGISTRATION_ENABLED === "true",
    smtp,
    hosting: multiuserEnabled && env.APPS_DOMAIN ? { appDomain: env.APPS_DOMAIN, managementOrigin: adminOrigin } : null,
    ipHosting,
    maxUploadBytes: positiveInteger(env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024, "MAX_UPLOAD_BYTES"),
    adminDistDir: path.join(projectRoot, "dist", "admin"),
    sessionTtlMs: 12 * 60 * 60 * 1000,
    previewTtlMs: 15 * 60 * 1000,
    pageAccessTtlMs: 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  };

  if (config.adminPort === config.pagesPort) {
    throw new Error("ADMIN_PORT and PAGES_PORT must be different.");
  }

  if (config.appSecret.length < 32) {
    throw new Error("APP_SECRET must be at least 32 characters.");
  }

  if (["replace-with-a-long-password", "REPLACE_WITH_PRIVATE_PASSWORD"].includes(config.adminPassword)) {
    throw new Error("ADMIN_PASSWORD must be replaced with a private password.");
  }
  if (["replace-with-at-least-32-random-characters", "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS"].includes(config.appSecret)) {
    throw new Error("APP_SECRET must be replaced with a random secret.");
  }

  if (config.multiuserEnabled && config.adminOrigin.startsWith("https://") && !config.secureCookies) {
    throw new Error("COOKIE_SECURE=true is required for multiuser HTTPS.");
  }

  return config;
}

