import crypto from "node:crypto";
import { passwordMatches } from "./auth.js";
import { FailureLimiter } from "./rate-limit.js";
import { signGrant, verifyGrant } from "./tokens.js";
import { serverText } from "./locale.js";

function cookieName(pageId) {
  const digest = crypto.createHash("sha256").update(pageId).digest("hex").slice(0, 14);
  return `hostlet_access_${digest}`;
}

function pageCookiePath(slug) {
  return `/p/${slug}`;
}

export function grantFor(page, kind, ttlMs) {
  return {
    kind,
    pageId: page.id,
    releaseId: page.releaseId,
    slug: page.slug,
    revision: page.accessRevision,
    exp: Date.now() + ttlMs,
  };
}

export function validGrant(token, page, secret) {
  const grant = verifyGrant(token, secret);
  if (!grant) {
    return null;
  }
  if (
    grant.pageId !== page.id ||
    grant.releaseId !== page.releaseId ||
    grant.slug !== page.slug ||
    grant.revision !== page.accessRevision ||
    (grant.kind !== "preview" && grant.kind !== "login")
  ) {
    return null;
  }
  return grant;
}

export function pageTokenPath(page, token) {
  return `/p/${page.slug}/__host/${token}/`;
}

export function setPageAccessCookie(res, page, token, maxAge, secure) {
  res.cookie(cookieName(page.id), token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: pageCookiePath(page.slug),
    maxAge,
  });
}

export function getPageAccessToken(req, page) {
  return req.cookies?.[cookieName(page.id)];
}

export function hasPageAccess(req, page, secret) {
  if (page.accessMode === "public") {
    return true;
  }
  const candidates = [getPageAccessToken(req, page)].filter(Boolean);
  return candidates.some((token) => Boolean(validGrant(token, page, secret)));
}

export function createPageLogin({ config, pages, clock = () => Date.now() }) {
  const limiter = new FailureLimiter({ clock });

  function authenticate(req, res) {
    const slug = String(req.body?.slug ?? "");
    const page = pages.getBySlug(slug);
    if (!page) {
      return res.status(404).send(serverText(req, "Page not found."));
    }

    const key = `${req.ip || "unknown"}:${slug}`;
    if (limiter.isBlocked(key)) {
      return res.status(429).send(serverText(req, "Too many attempts. Try again later."));
    }
    if (!passwordMatches(req.body?.password, config.adminPassword)) {
      limiter.fail(key);
      return res.status(401).send(serverText(req, "Incorrect password."));
    }

    limiter.clear(key);
    const token = signGrant(grantFor(page, "login", config.pageAccessTtlMs), config.appSecret);
    setPageAccessCookie(res, page, token, config.pageAccessTtlMs, config.secureCookies);
    pages.audit("private_page_login", page.id, req.ip || null);
    return res.redirect(303, pageTokenPath(page, token));
  }

  return { authenticate, limiter };
}

