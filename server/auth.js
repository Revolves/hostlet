import crypto from "node:crypto";
import { FailureLimiter } from "./rate-limit.js";

export const ADMIN_COOKIE = "hostlet_admin";
export const IP_ADMIN_COOKIE = "__Host-hostlet_admin";

export function passwordMatches(candidate, expected) {
  const candidateHash = crypto.createHash("sha256").update(String(candidate ?? "")).digest();
  const expectedHash = crypto.createHash("sha256").update(String(expected ?? "")).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

export function createAuth({ config, sessions }) {
  const limiter = new FailureLimiter();
  const hardenedCookie = Boolean(config.ipHosting || config.singleDomainHosting);
  const cookieName = hardenedCookie ? IP_ADMIN_COOKIE : ADMIN_COOKIE;

  function adminCookie(req) {
    const matches = String(req.headers?.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    return matches.length === 1 ? matches[0].slice(cookieName.length + 1) : null;
  }

  function cookieOptions() {
    return {
      httpOnly: true,
      sameSite: "strict",
      secure: hardenedCookie ? true : config.secureCookies,
      path: hardenedCookie ? "/" : "/api",
    };
  }

  function clearLegacyCookies(res) {
    if (!hardenedCookie) return;
    for (const path of ["/api", "/"]) {
      res.clearCookie(ADMIN_COOKIE, { httpOnly: true, sameSite: "strict", secure: true, path });
    }
  }

  function login(req, res) {
    const key = req.ip || "unknown";
    if (limiter.isBlocked(key)) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    if (!passwordMatches(req.body?.password, config.adminPassword)) {
      limiter.fail(key);
      return res.status(401).json({ error: "Incorrect admin password." });
    }

    limiter.clear(key);
    sessions.purgeExpired();
    const session = sessions.create(config.sessionTtlMs);
    res.cookie(cookieName, session.token, {
      ...cookieOptions(),
      maxAge: config.sessionTtlMs,
    });
    clearLegacyCookies(res);
    return res.json({ authenticated: true });
  }

  function logout(req, res) {
    sessions.delete(adminCookie(req));
    clearLegacyCookies(res);
    res.clearCookie(cookieName, cookieOptions());
    return res.json({ authenticated: false });
  }

  function requireAdmin(req, res, next) {
    const session = sessions.find(adminCookie(req));
    if (!session) {
      return res.status(401).json({ error: "Sign in to continue." });
    }
    req.adminSession = session;
    return next();
  }

  function me(req, res) {
    const session = sessions.find(adminCookie(req));
    return res.json({ authenticated: Boolean(session) });
  }

  return { login, logout, requireAdmin, me, limiter };
}

