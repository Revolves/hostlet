import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { getDomain } from "tldts";

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

function publicGithub(value, label) {
  const configured = value === undefined ? "https://github.com/Revolves/hostlet" : String(value).trim();
  if (!configured) return null;
  if (/\/(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(configured)) {
    throw new Error("PUBLIC_GITHUB_URL must not contain dot path segments.");
  }
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("PUBLIC_GITHUB_URL must be a valid GitHub URL.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    segments.length < 1 ||
    segments.length > 2 ||
    segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))
  ) {
    throw new Error("PUBLIC_GITHUB_URL must be an https://github.com/<owner>[/<repository>] URL.");
  }
  const customLabel = String(label ?? "").trim();
  if (/[\u0000-\u001f\u007f]/.test(customLabel) || customLabel.length > 64) {
    throw new Error("PUBLIC_GITHUB_LABEL must be at most 64 characters without control characters.");
  }
  return {
    url: `https://github.com/${segments.join("/")}`,
    label: customLabel || (segments.length === 2 ? segments.join("/") : `@${segments[0]}`),
  };
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
  const singleDomainHosting = env.SINGLE_DOMAIN_HOSTING === "true";
  const appDomain = String(env.APPS_DOMAIN || "").trim();
  if (singleDomainHosting) {
    if (!multiuserEnabled) throw new Error("SINGLE_DOMAIN_HOSTING requires MULTIUSER_ENABLED=true.");
    if (!appDomain) throw new Error("SINGLE_DOMAIN_HOSTING requires APPS_DOMAIN.");
    if (env.COOKIE_SECURE !== "true") throw new Error("SINGLE_DOMAIN_HOSTING requires COOKIE_SECURE=true.");
    if (appDomain.includes(":") || appDomain !== appDomain.toLowerCase()) {
      throw new Error("SINGLE_DOMAIN_HOSTING requires a lowercase APPS_DOMAIN without a port.");
    }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(appDomain)) {
      throw new Error("APPS_DOMAIN must be a valid DNS name.");
    }
    let adminUrl;
    try { adminUrl = new URL(adminOrigin); }
    catch { throw new Error("ADMIN_ORIGIN must be a valid HTTPS origin for SINGLE_DOMAIN_HOSTING."); }
    if (adminUrl.protocol !== "https:" || adminUrl.origin !== adminOrigin || adminUrl.username || adminUrl.password) {
      throw new Error("SINGLE_DOMAIN_HOSTING requires an exact HTTPS ADMIN_ORIGIN.");
    }
    if (adminUrl.hostname === appDomain || adminUrl.hostname.endsWith(`.${appDomain}`)) {
      throw new Error("APPS_DOMAIN must be a subdomain of the management registrable domain, not its parent.");
    }
    const appSite = getDomain(appDomain, { allowPrivateDomains: true });
    const managementSite = getDomain(adminUrl.hostname, { allowPrivateDomains: true });
    if (!appSite || !managementSite || appSite !== managementSite || appDomain === appSite) {
      throw new Error("SINGLE_DOMAIN_HOSTING requires APPS_DOMAIN to be a subdomain of the management registrable domain.");
    }
  }
  if (!singleDomainHosting && appDomain) {
    let adminUrl;
    try { adminUrl = new URL(adminOrigin); } catch { adminUrl = null; }
    if (adminUrl) {
      const appSite = getDomain(appDomain.split(":")[0], { allowPrivateDomains: true });
      const managementSite = getDomain(adminUrl.hostname, { allowPrivateDomains: true });
      if (appSite && managementSite && appSite === managementSite) {
        throw new Error("APPS_DOMAIN shares the management registrable domain; set SINGLE_DOMAIN_HOSTING=true to opt in.");
      }
    }
  }
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
  const usernameRegistrationEnabled = env.USERNAME_REGISTRATION_ENABLED === "true";
  const smtpConfigured = Boolean(env.SMTP_HOST || env.SMTP_FROM || env.SMTP_USER || env.SMTP_PASSWORD);
  if (multiuserEnabled && smtpConfigured) {
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
  if (multiuserEnabled && !smtp && !usernameRegistrationEnabled) {
    throw new Error("SMTP_HOST is required unless USERNAME_REGISTRATION_ENABLED=true.");
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
    emailRegistrationEnabled: Boolean(smtp),
    usernameRegistrationEnabled,
    smtp,
    singleDomainHosting,
    hosting: multiuserEnabled && appDomain ? { appDomain, managementOrigin: adminOrigin, allowSameSite: singleDomainHosting } : null,
    ipHosting,
    publicGithub: publicGithub(env.PUBLIC_GITHUB_URL, env.PUBLIC_GITHUB_LABEL),
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

