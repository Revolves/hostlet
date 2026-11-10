import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createAuth } from "./auth.js";
import {
  createPageLogin,
  getPageAccessToken,
  grantFor,
  hasPageAccess,
  pageTokenPath,
  setPageAccessCookie,
  validGrant,
} from "./page-access.js";
import { PageRepository, SessionRepository, createPageId } from "./repository.js";
import { ReleaseRepository } from "./releases.js";
import { createAccounts } from "./accounts.js";
import { createAccountSessions, IP_ACCOUNT_COOKIE } from "./account-sessions.js";
import { createAccountRouter } from "./account-router.js";
import { createAccountDeletionService } from "./account-deletion.js";
import { createApiCredentials } from "./api-credentials.js";
import { createWorkspaceService } from "./workspaces.js";
import { WorkspaceError } from "./workspaces.js";
import { createWorkspaceRouter } from "./workspace-router.js";
import { createMailer } from "./mailer.js";
import { createWorkspacePagesService, createWorkspaceQuotaService } from "./workspace-pages.js";
import { createWorkspacePagesRouter } from "./workspace-pages-router.js";
import { createWorkspaceHostingService, createWorkspaceIpHostingService, createWorkspaceHostingManagementRouter, createWorkspaceHostingAppRouter } from "./workspace-hosting.js";
import { createWorkspaceIpHostingRouter } from "./workspace-ip-hosting.js";
import { createIpManagementGuard } from "./ip-management-guard.js";
import { createWorkspaceVisibilityService } from "./workspace-visibility.js";
import { createReleaseCleanup } from "./release-cleanup.js";
import { createMaintenanceGate } from "./maintenance.js";
import { createWorkspaceDeletionService } from "./workspace-deletion.js";
import { createPublicationRecovery } from "./publication-recovery.js";
import { createPublicationIdempotency } from "./publication-idempotency.js";
import { createUploadTempJournal } from "./upload-temp-recovery.js";
import { createRetentionService } from "./retention.js";
import { createRetentionCoordinator } from "./retention-coordinator.js";
import { createRetentionScheduler } from "./retention-scheduler.js";
import { createEphemeralCleanup } from "./ephemeral-cleanup.js";
import { createLegacyMigration } from "./legacy-migration.js";
import { createWorkspaceShareService } from "./workspace-shares.js";
import { createWorkspaceShareRouter, createWorkspaceCliShareRouter } from "./workspace-share-router.js";
import { createPlatformAdminService } from "./platform-admin.js";
import { createPlatformAdminRouter } from "./platform-admin-router.js";
import { createSecurityLog, createSecurityRequestLogger } from "./security-log.js";
import { createOperationsStatus } from "./operations-status.js";
import { createPublicDirectoryService } from "./public-directory.js";
import { publicIndexLanguage, readPublicIndexTemplate, renderPublicIndexHtml } from "./public-index.js";
import { publicMeta } from "../shared/public-site.js";
import { DEFAULT_QUOTAS } from "./quotas.js";
import { FileSiteStorage, sourceTypeFromFilename } from "./storage.js";
import { signGrant } from "./tokens.js";
import { languageLinks, requestLanguage, serverText } from "./locale.js";
import { createUploader, defaultsFromFilename } from "./upload.js";
import {
  ValidationError,
  slugFromFilename,
  validateAccessMode,
  validateRelativeFile,
  validateSlug,
  validateTitle,
} from "./validation.js";

const CONTENT_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".eot": "application/vnd.ms-fontobject",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};
const FONT_EXTENSIONS = new Set([".eot", ".otf", ".ttf", ".woff", ".woff2"]);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function shareAttemptLimiter() {
  const buckets = new Map();
  return (client, page) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    const key = `${client}:${page}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10000) return false;
      bucket = { count: 0, until: now + 60000 };
      buckets.set(key, bucket);
    }
    return ++bucket.count <= 20;
  };
}

function publicPage(page, config) {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    entryFile: page.entryFile,
    accessMode: page.accessMode,
    sourceType: page.sourceType,
    originalFilename: page.originalFilename,
    sizeBytes: page.sizeBytes,
    fileCount: page.fileCount,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    url: `${config.publicBaseUrl}/p/${page.slug}/`,
  };
}

function normalizeEntry(value, filename) {
  const fallback = String(filename || "").toLowerCase().endsWith(".zip") ? "index.html" : "index.html";
  return validateRelativeFile(value || fallback, { htmlOnly: true });
}

function resolveSiteFile(releaseDir, requestedPath) {
  const normalized = path.posix.normalize(`/${requestedPath}`).replace(/^\/+/, "");
  const root = path.resolve(releaseDir);
  const resolved = path.resolve(root, ...normalized.split("/"));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pageLoginDocument(page, req, error = "") {
  const language = requestLanguage(req);
  const text = (message) => escapeHtml(serverText(req, message));
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${text("Private page")} · ${escapeHtml(page.title)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f0e8; color: #22211f; }
    main { width: min(100%, 390px); border-top: 3px solid #c94a32; padding-top: 28px; }
    nav { text-align: right; margin-bottom: 28px; font-size: 13px; } nav a { color: #a33a27; padding: 8px; }
    h1 { font-family: Georgia, serif; font-size: 38px; line-height: 1.08; font-weight: 500; margin: 0 0 12px; }
    p { color: #6b675f; line-height: 1.6; margin: 0 0 28px; }
    label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    input { width: 100%; height: 46px; border: 1px solid #c8c1b5; background: #fffdf9; padding: 0 13px; font: inherit; }
    input:focus { outline: 2px solid #c94a32; outline-offset: 1px; }
    button { width: 100%; height: 46px; border: 0; margin-top: 12px; background: #c94a32; color: white; font: 700 14px/1 inherit; cursor: pointer; }
    .error { color: #a33a27; font-size: 13px; margin: 12px 0 0; }
  </style>
</head>
<body>
  <main>
    ${languageLinks(req)}
    <h1>${escapeHtml(page.title)}</h1>
    <p>${text("This page is private. Enter the host password to continue.")}</p>
    <form method="post" action="/__host/login">
      <input type="hidden" name="slug" value="${escapeHtml(page.slug)}">
      <input type="hidden" name="lang" value="${language}">
      <label for="password">${text("Password")}</label>
      <input id="password" name="password" type="password" required autofocus autocomplete="current-password">
      <button type="submit">${text("Open page")}</button>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    </form>
  </main>
</body>
</html>`;
}

function decodeTokenSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function tokenizedPagePath(page, token, relativePath = "") {
  const base = pageTokenPath(page, token);
  const cleanPath = String(relativePath || "").replace(/^\/+/, "");
  if (!cleanPath) {
    return base;
  }
  return `${base}${cleanPath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function injectBaseHref(html, href) {
  const tag = `<base href="${escapeHtml(href)}">`;
  const withoutExistingBase = html.replace(/<base\b[^>]*>/gi, "");
  const head = withoutExistingBase.match(/<head\b[^>]*>/i);
  if (head) {
    return withoutExistingBase.replace(head[0], `${head[0]}\n${tag}`);
  }

  const htmlTag = withoutExistingBase.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    return withoutExistingBase.replace(htmlTag[0], `${htmlTag[0]}\n<head>${tag}</head>`);
  }

  return `<head>${tag}</head>${withoutExistingBase}`;
}
function notFoundDocument(req) {
  const text = (message) => escapeHtml(serverText(req, message));
  return `<!doctype html>
<html lang="${requestLanguage(req)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text("Page not found")}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f0e8;color:#22211f;font-family:ui-sans-serif,system-ui,sans-serif}
main{max-width:420px;padding:32px;border-top:3px solid #c94a32}
h1{font-family:Georgia,serif;font-size:42px;font-weight:500;margin:0 0 12px}p{color:#6b675f;line-height:1.6}
</style></head>
<body><main>${languageLinks(req)}<h1>${text("Nothing here.")}</h1><p>${text("The page you are looking for does not exist or has moved.")}</p></main></body>
</html>`;
}

function createAdminRouter({ config, pages, releases, storage, uploader, auth }) {
  const router = express.Router();

  function transaction(fn) {
    pages.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); pages.db.exec("COMMIT"); return result; }
    catch (error) { pages.db.exec("ROLLBACK"); throw error; }
  }

  router.post("/auth/login", auth.login);
  router.post("/auth/logout", auth.logout);
  router.get("/auth/me", auth.me);
  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.use(auth.requireAdmin);

  router.get("/pages", (_req, res) => {
    res.json({
      pages: pages.list().map((page) => publicPage(page, config)),
      stats: pages.stats(),
    });
  });

  router.get("/pages/:id", (req, res) => {
    const page = pages.getById(req.params.id);
    if (!page) {
      return res.status(404).json({ error: "Page not found." });
    }
    return res.json({ page: publicPage(page, config) });
  });

  router.post("/pages", uploader.single("file"), asyncRoute(async (req, res) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        throw new ValidationError("Choose an HTML file or ZIP archive to upload.");
      }

      const sourceType = sourceTypeFromFilename(req.file.originalname);
      const title = validateTitle(req.body.title);
      const slug = validateSlug(req.body.slug || slugFromFilename(req.file.originalname));
      const accessMode = validateAccessMode(req.body.accessMode || "public");
      const entryFile = normalizeEntry(req.body.entryFile, req.file.originalname);

      if (pages.slugExists(slug)) {
        throw new ValidationError("That mount path is already in use.", "SLUG_CONFLICT");
      }

      const id = createPageId();
      const release = sourceType === "zip"
        ? await storage.stageZip({
            pageId: id,
            sourcePath: tempPath,
            entryFile,
            originalFilename: req.file.originalname,
          })
        : await storage.stageSingleHtml({
            pageId: id,
            sourcePath: tempPath,
            entryFile,
            originalFilename: req.file.originalname,
          });

      let page;
      try {
        page = transaction(() => {
          const created = pages.create({ id, title, slug, entryFile, accessMode, ...release });
          releases.add({ pageId: id, ...release });
          return created;
        });
      } catch (error) {
        await storage.removePage(id);
        throw error;
      }
      pages.audit("page_created", page.id, `${sourceType}:${page.originalFilename}`);
      return res.status(201).json({ page: publicPage(page, config) });
    } catch (error) {
      throw error;
    } finally {
      await storage.removeTemp(tempPath);
    }
  }));

  router.patch("/pages/:id", asyncRoute(async (req, res) => {
    const current = pages.getById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: "Page not found." });
    }

    const title = req.body.title === undefined ? current.title : validateTitle(req.body.title);
    const slug = req.body.slug === undefined ? current.slug : validateSlug(req.body.slug);
    const accessMode = req.body.accessMode === undefined
      ? current.accessMode
      : validateAccessMode(req.body.accessMode);
    const entryFile = req.body.entryFile === undefined
      ? current.entryFile
      : validateRelativeFile(req.body.entryFile, { htmlOnly: true });

    if (pages.slugExists(slug, current.id)) {
      throw new ValidationError("That mount path is already in use.", "SLUG_CONFLICT");
    }

    const releaseEntry = path.join(current.releaseDir, ...entryFile.split("/"));
    if (!fs.existsSync(releaseEntry)) {
      throw new ValidationError(`Entry file ${entryFile} does not exist in this release.`);
    }

    const page = transaction(() => {
      const latest = pages.getById(current.id);
      if (!latest || latest.releaseId !== current.releaseId || latest.accessRevision !== current.accessRevision) {
        throw new ValidationError("The page changed while settings were being saved.", "SLUG_CONFLICT");
      }
      if (!releases.setEntry(current.id, current.releaseId, entryFile)) throw new Error("Current release is missing.");
      return pages.update(current.id, { ...latest, title, slug, entryFile, accessMode });
    });
    pages.audit("page_updated", page.id, "metadata");
    return res.json({ page: publicPage(page, config) });
  }));

  router.post("/pages/:id/replace", uploader.single("file"), asyncRoute(async (req, res) => {
    const current = pages.getById(req.params.id);
    const tempPath = req.file?.path;

    try {
      if (!current) {
        throw new ValidationError("Page not found.", "NOT_FOUND");
      }
      if (!req.file) {
        throw new ValidationError("Choose an HTML file or ZIP archive to upload.");
      }

      const sourceType = sourceTypeFromFilename(req.file.originalname);
      const entryFile = normalizeEntry(req.body.entryFile || current.entryFile, req.file.originalname);
      const release = sourceType === "zip"
        ? await storage.stageZip({
            pageId: current.id,
            sourcePath: tempPath,
            entryFile,
            originalFilename: req.file.originalname,
          })
        : await storage.stageSingleHtml({
            pageId: current.id,
            sourcePath: tempPath,
            entryFile,
            originalFilename: req.file.originalname,
          });

      let page;
      try {
        page = transaction(() => {
          const latest = pages.getById(current.id);
          if (!latest || latest.releaseId !== current.releaseId || latest.accessRevision !== current.accessRevision) {
            throw new ValidationError("The page changed while the upload was in progress.", "SLUG_CONFLICT");
          }
          releases.add({ pageId: current.id, ...release });
          return pages.update(current.id, { ...latest, ...release });
        });
      } catch (error) {
        await storage.removeRelease(current.id, release.releaseDir);
        throw error;
      }
      pages.audit("page_replaced", page.id, page.releaseId);
      return res.json({ page: publicPage(page, config) });
    } finally {
      await storage.removeTemp(tempPath);
    }
  }));

  router.get("/pages/:id/releases", (req, res) => {
    const page = pages.getById(req.params.id);
    if (!page) return res.status(404).json({ error: "Page not found." });
    return res.json({ releases: releases.list(page.id).map(({ releaseDir, pageId, ...release }) => ({
      ...release, current: release.releaseId === page.releaseId,
    })) });
  });

  router.post("/pages/:id/releases/:releaseId/activate", (req, res) => {
    const page = pages.getById(req.params.id);
    const release = releases.get(req.params.id, req.params.releaseId);
    if (!page || !release) return res.status(404).json({ error: "Release not found." });
    const entry = path.join(release.releaseDir, ...release.entryFile.split("/"));
    if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) {
      return res.status(409).json({ error: "Release files are unavailable." });
    }
    const updated = transaction(() => {
      const latest = pages.getById(page.id);
      if (!latest || !releases.get(page.id, release.releaseId)) throw new ValidationError("Release not found.", "NOT_FOUND");
      return pages.update(page.id, { ...latest, ...release });
    });
    pages.audit("page_rollback", page.id, release.releaseId);
    return res.json({ page: publicPage(updated, config) });
  });

  router.post("/pages/:id/preview-link", (req, res) => {
    const page = pages.getById(req.params.id);
    if (!page) {
      return res.status(404).json({ error: "Page not found." });
    }

    const token = signGrant(grantFor(page, "preview", config.previewTtlMs), config.appSecret);
    const expiresAt = new Date(Date.now() + config.previewTtlMs).toISOString();
    pages.audit("preview_link_created", page.id, null);
    return res.json({
      url: `${config.publicBaseUrl}${pageTokenPath(page, token)}`,
      expiresAt,
    });
  });

  router.delete("/pages/:id", asyncRoute(async (req, res) => {
    const page = pages.getById(req.params.id);
    if (!page) {
      return res.status(404).json({ error: "Page not found." });
    }

    pages.delete(page.id);
    await storage.removePage(page.id);
    pages.audit("page_deleted", page.id, page.originalFilename);
    return res.status(204).end();
  }));

  router.get("/uploads/defaults", (req, res) => {
    res.json(defaultsFromFilename(req.query.filename));
  });

  return router;
}

function createPagesApp({ config, pages, pageLogin, workspaceHostingRouter, maintenance, securityLog, publicDirectory }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustedProxies.length ? config.trustedProxies : false);
  app.use(maintenance.middleware);
  app.use(createSecurityRequestLogger({ securityLog, mode: "content" }));
  if (workspaceHostingRouter) app.use(workspaceHostingRouter);
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use((req, res, next) => {
    if (req.query.lang === "zh-CN" || req.query.lang === "en") {
      res.cookie("hosting_language", req.query.lang, {
        httpOnly: true, sameSite: "lax", secure: config.secureCookies,
        path: "/", maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    }
    res.setHeader("Content-Language", requestLanguage(req));
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/__host/login", pageLogin.authenticate);

  app.get(["/p/:slug", "/p/:slug/*splat"], (req, res, next) => {
    const page = pages.getBySlug(req.params.slug);
    if (!page) {
      return res.status(404).type("html").send(notFoundDocument(req));
    }

    const requestedPath = Array.isArray(req.params.splat)
      ? req.params.splat.join("/")
      : req.params.splat || "";
    let relativePath = requestedPath;
    let accessToken = null;
    const tokenMatch = requestedPath.match(/^__host\/([^/]+)(?:\/(.*))?$/);

    if (tokenMatch) {
      const token = decodeTokenSegment(tokenMatch[1]);
      if (!token || !validGrant(token, page, config.appSecret)) {
        return res.status(401).type("html").send(pageLoginDocument(page, req));
      }
      accessToken = token;
      relativePath = tokenMatch[2] || "";
    } else {
      const previewToken = typeof req.query.preview === "string" ? req.query.preview : null;
      if (previewToken && validGrant(previewToken, page, config.appSecret)?.kind === "preview") {
        setPageAccessCookie(res, page, previewToken, config.previewTtlMs, config.secureCookies);
        return res.redirect(302, pageTokenPath(page, previewToken));
      }
    }

    if (!accessToken) {
      const accessCookie = getPageAccessToken(req, page);
      if (page.accessMode === "private" && validGrant(accessCookie, page, config.appSecret)) {
        return res.redirect(302, tokenizedPagePath(page, accessCookie, relativePath));
      }
      if (!hasPageAccess(req, page, config.appSecret)) {
        return res.status(401).type("html").send(pageLoginDocument(page, req));
      }
    }

    if (!relativePath) {
      if (!req.path.endsWith("/")) {
        return res.redirect(302, `${req.path}/${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
      }
      relativePath = page.entryFile;
    }

    const candidate = resolveSiteFile(page.releaseDir, relativePath);
    if (!candidate) {
      return res.status(400).send("Invalid path.");
    }

    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      if (!req.path.endsWith("/")) {
        return res.redirect(302, `${req.path}/`);
      }
      relativePath = `${relativePath.replace(/\/$/, "")}/index.html`;
    }

    const finalPath = resolveSiteFile(page.releaseDir, relativePath);
    if (!finalPath || !fs.existsSync(finalPath) || !fs.statSync(finalPath).isFile()) {
      return next();
    }

    const isEntryDocument = !requestedPath && page.accessMode === "public" && !accessToken;
    if (isEntryDocument && req.method === "GET" && publicDirectory) {
      try {
        publicDirectory.recordVisit({ kind: "legacy", pageId: page.id, method: req.method, entryDocument: true });
      } catch (error) {
        console.error("Public visit count failed.");
      }
    }

    const extension = path.extname(finalPath).toLowerCase();
    res.type(CONTENT_TYPES[extension] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    if (FONT_EXTENSIONS.has(extension)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    if (extension === ".html" || extension === ".htm") {
      res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads");
      if (accessToken) {
        const html = fs.readFileSync(finalPath, "utf8");
        const directory = !tokenMatch?.[2]
          ? ""
          : path.posix.dirname(relativePath);
        const base = tokenizedPagePath(page, accessToken, directory === "." ? "" : directory);
        return res.send(injectBaseHref(html, base.endsWith("/") ? base : `${base}/`));
      }
    }
    return res.sendFile(finalPath);
  });

  app.use((req, res) => {
    res.status(404).type("html").send(notFoundDocument(req));
  });

  return app;
}

export function createServices({ config, db, clock }) {
  const pages = new PageRepository(db, clock);
  const releases = new ReleaseRepository(db, clock);
  const sessions = new SessionRepository(db, clock);
  const storage = new FileSiteStorage(path.join(config.dataDir, "storage"));
  const uploader = createUploader({
    config,
    tmpDir: path.join(config.dataDir, "tmp", "uploads"),
  });
  const auth = createAuth({ config, sessions });
  const pageLogin = createPageLogin({ config, pages });
  return { pages, releases, sessions, storage, uploader, auth, pageLogin };
}

export async function createApps({ config, db, clock, accountSender, retentionSender, retentionClock }) {
  const maintenance = createMaintenanceGate();
  const operationsStatus = createOperationsStatus();
  const securityLog = createSecurityLog({
    directory: path.join(config.dataDir, "security-logs"),
    retentionDays: config.securityLogRetentionDays,
  });
  const services = createServices({ config, db, clock });
  await services.storage.ensure();
  if (!accountSender && config.multiuserEnabled && config.smtp) accountSender = createMailer(config.smtp);
  const emailRegistrationEnabled = Boolean(accountSender) || config.emailRegistrationEnabled === true ||
    (config.emailRegistrationEnabled === undefined && Boolean(config.smtp));
  const mailSender = accountSender || (async () => {
    const error = new Error('Email delivery is unavailable.');
    error.code = 'MAIL_FAILED';
    throw error;
  });
  let workspaceHostingRouter = null;
  let platformAdmin = null;
  let retentionCoordinator = null, retentionScheduler = null, ephemeralCleanupScheduler = null;
  const hostingConfig = config.ipHosting || (config.hosting ? { ...config.hosting, appDomain: config.hosting.appDomain.replace(/:443$/, "") } : null);
  const legacyUrl = (slug) => `${config.publicBaseUrl}/p/${slug}/`;
  const workspaceUrl = config.ipHosting
    ? (pageId) => `${config.ipHosting.contentOrigin}/p/${pageId}/`
    : config.hosting && hostingConfig
      ? (pageId) => `https://${pageId}.${hostingConfig.appDomain}/`
      : () => null;
  const publicDirectory = createPublicDirectoryService({
    db,
    legacyUrl,
    workspaceUrl,
  });
  const recordVisit = (kind, pageId, details) => {
    try { publicDirectory.recordVisit({ kind, pageId, ...details }); }
    catch (error) { console.error("Public visit count failed."); }
  };

  const admin = express();
  admin.disable("x-powered-by");
  if (config.ipHosting) admin.use(createIpManagementGuard({ipHosting:config.ipHosting,enableCli:true}));
  admin.use(["/api/workspaces", "/api/account", "/api/shares", "/api/platform", "/api/host", "/api/health", "/api/cli"], maintenance.middleware);
  admin.set("trust proxy", config.trustedProxies.length ? config.trustedProxies : false);
  admin.use(createSecurityRequestLogger({ securityLog, mode: "management" }));
  // Cross-origin ticket POSTs need a verifiable Origin. `no-referrer` makes
  // browsers send Origin: null for the form; strict-origin sends only the
  // management origin and never a path or fragment to the application.
  admin.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'strict-origin' } }));
  admin.use(cookieParser());
  const parseJson = express.json({ limit: "64kb" });
  admin.use((req, res, next) => {
    const pathname = req.path.toLowerCase();
    return ["/api/shares", "/api/platform"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ? next() : parseJson(req, res, next);
  });
  admin.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }
    next();
  });
  const accountsEnabled = () => Boolean(accountSender || config.multiuserEnabled);
  const registrationEnabled = () => Boolean(!config.ipHosting && accountsEnabled() && (platformAdmin && db.prepare("SELECT 1 FROM platform_settings WHERE id=1").get() ? platformAdmin.getSettings().registrationEnabled : config.registrationEnabled));
  admin.get("/api/features", (_req, res) => res.json({
    multiuser: accountsEnabled(),
    registration: registrationEnabled(),
    registrationMethods: { email: emailRegistrationEnabled, username: config.usernameRegistrationEnabled === true },
    singleDomainHosting: config.singleDomainHosting === true,
    hostingDomain: accountsEnabled() ? hostingConfig?.appDomain || null : null,
    ipHostingOrigin: accountsEnabled() ? config.ipHosting?.contentOrigin || null : null,
    github: config.publicGithub,
    retention: platformAdmin ? platformAdmin.getSettings().retention : {mode:'long-term',days:null,notifyBeforeDays:null},
    retentionActive: Boolean(retentionScheduler?.isRunning()),
  }));
  admin.get("/api/public/apps", (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(publicDirectory.list(req.query));
    } catch {
      res.status(400).json({ error: "Invalid public directory query.", code: "INVALID_QUERY" });
    }
  });
  if (accountsEnabled()) {
    ephemeralCleanupScheduler=createRetentionScheduler({coordinator:createEphemeralCleanup({db}),intervalMs:60000,
      onResult:()=>operationsStatus.record('temporaryCleanup',true),
      onError:()=>{operationsStatus.record('temporaryCleanup',false);console.error('Expired temporary records cleanup failed; check database health.');}});
    const accounts = createAccounts({ db, sender: async message => {
      try { await mailSender(message); operationsStatus.record('accountMail',true); }
      catch (error) { operationsStatus.record('accountMail',false); throw error; }
    } });
    const sessions = createAccountSessions({ db, secure: config.secureCookies, ...(config.ipHosting || config.singleDomainHosting ? {cookieName:IP_ACCOUNT_COOKIE} : {}) });
    const apiCredentials = createApiCredentials({db});
    const requireUser = (req, res, next) => sessions.requireSession(req, res, () => { req.user = req.account; next(); });
    const workspaceService = createWorkspaceService(db);
    const visibility = createWorkspaceVisibilityService({ db, authorize: workspaceService.authorize, audit: workspaceService.recordPageAudit });
    const workspaceStorage = new FileSiteStorage(path.join(config.dataDir, "workspace-storage"));
    await workspaceStorage.ensure();
    const workspaceDeletion = createWorkspaceDeletionService({ db, storageRoot: workspaceStorage.root, assertQuiescent: maintenance.isQuiescent,
      onDelete: ({pageId,workspaceId,actor}) => { db.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run(randomUUID(),actor || 'system:retention',actor ? 'workspace.delete' : 'retention.delete',pageId,Date.now()); if(actor) workspaceService.recordPageAudit(workspaceId,actor,'page.deleted',pageId); } });
    const accountDeletion = createAccountDeletionService({
      db,
      workspaceService,
      assertQuiescent: maintenance.isQuiescent,
      deletePage: args => workspaceDeletion.execute(args),
      onDelete: ({db: database,accountId,at}) => database.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run(randomUUID(),accountId,'account.deleted',accountId,at),
    });
    const legacyMigration = createLegacyMigration({db,dataDir:config.dataDir,assertOffline:maintenance.isQuiescent});
    const publicationRecovery=createPublicationRecovery({db,storageRoot:workspaceStorage.root,assertQuiescent:maintenance.isQuiescent});
    const tempFiles=createUploadTempJournal({db,storageRoot:workspaceStorage.root,assertQuiescent:maintenance.isQuiescent});
    await maintenance.runExclusive(() => { legacyMigration.recover(); workspaceDeletion.recover(); accountDeletion.recover(); publicationRecovery.recover(); tempFiles.recover(); createPublicationIdempotency(db).recover(); });
    const releaseCleanup = createReleaseCleanup({ db, storageRoot: workspaceStorage.root, authorize: workspaceService.authorize, audit: workspaceService.recordPageAudit });
    releaseCleanup.recover();
    const workspacePages = createWorkspacePagesService({ db, workspaceService, storage: workspaceStorage, quotaDefaults: () => platformAdmin ? platformAdmin.getSettings().defaultQuotas : DEFAULT_QUOTAS });
    const deleteWorkspacePage = (workspaceId, actor, pageId) => {
      const recover = () => { try { workspaceDeletion.recover(); } catch (error) { maintenance.failClosed(); throw error; } };
      recover();
      try {
        workspacePages.authorize(workspaceId,actor,'manage');
        const page=workspacePages.get(workspaceId,actor,pageId);
        const deleted=workspaceDeletion.execute({pageId,workspaceId,revision:page.revision,actor,
          validate:()=>{workspacePages.authorize(workspaceId,actor,'manage');return true;}});
        if (!deleted) throw new Error('Page changed during deletion');
      } finally { recover(); }
    };
    const deleteAccount = accountId => {
      const recover = () => { try { workspaceDeletion.recover(); } catch (error) { maintenance.failClosed(); throw error; } };
      recover();
      try { return accountDeletion.delete(accountId); }
      catch (error) {
        if (!accountDeletion.hasPending(accountId)) throw error;
        try {
          workspaceDeletion.recover();
          accountDeletion.recover();
          return { recovered: true };
        } catch (recoveryError) {
          try { maintenance.failClosed(); } catch { /* The caller is already outside a maintenance window. */ }
          throw new AggregateError([error, recoveryError], 'Account deletion recovery failed');
        }
      }
    };
    admin.use("/api/account", createAccountRouter({
      accounts,
      sessions,
      allowedOrigins: config.allowedOrigins,
      registrationEnabled,
      emailRegistrationEnabled,
      usernameRegistrationEnabled: config.usernameRegistrationEnabled === true,
      deleteAccount,
      accountDeletionStatus: accountDeletion.status,
      apiCredentials,
    }));
    const workspaceUploader = createUploader({ config, tmpDir: path.join(config.dataDir, "tmp", "workspace-uploads") });
    const cliBuckets=new Map(); let cliGlobal={count:0,until:0};
    const cliUser = (req,res,next) => {
      const at=Date.now(), ip=req.ip || 'unknown';
      for (const [key,bucket] of cliBuckets) if (bucket.until<=at) cliBuckets.delete(key);
      if (cliGlobal.until<=at) cliGlobal={count:0,until:at+60000};
      let bucket=cliBuckets.get(ip);
      if (!bucket && cliBuckets.size<10000) {bucket={count:0,until:at+60000};cliBuckets.set(ip,bucket);}
      if (++cliGlobal.count>1000 || !bucket || ++bucket.count>120) return res.status(429).json({code:'RATE_LIMITED'});
      const headers=req.rawHeaders.filter((_,i)=>i%2===0 && req.rawHeaders[i].toLowerCase()==='authorization');
      const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('Authorization') || '');
      const statusRoute=req.method==='GET' && /^\/[^/]+\/publications\/[A-Za-z0-9_-]{22,128}$/.test(req.path);
      const shareRoute=req.method!=='OPTIONS' && /^\/[^/]+\/pages\/[^/]+\/shares(?:\/[^/]+)?$/.test(req.path);
      const scopes=statusRoute ? ['publish','read'] : shareRoute ? ['share'] : [req.method==='GET' ? 'read' : 'publish'];
      const authenticate=()=>match && scopes.map(scope=>apiCredentials.authenticate(match[1],scope)).find(Boolean);
      const credential=headers.length===1 && authenticate();
      if (!credential) return res.status(401).json({code:'UNAUTHORIZED'});
      req.user={id:credential.userId};
      req.uploadSource='cli';
      req.uploadGuard=()=>{if (!authenticate()) throw new WorkspaceError('FORBIDDEN');};
      next();
    };
    admin.use('/api/cli', (req,res,next)=>{res.set('Cache-Control','no-store');next();});
    admin.get('/api/cli/workspaces',cliUser,(req,res)=>res.json(workspaceService.listWorkspaces(req.user.id)));
    const shareService = hostingConfig ? createWorkspaceShareService({ db, authorize: workspaceService.authorize, audit: workspaceService.recordPageAudit, limitAttempt: shareAttemptLimiter() }) : null;
    if (shareService) admin.use('/api/cli/workspaces', createWorkspaceCliShareRouter({service:shareService,requireUser:cliUser}));
    admin.use('/api/cli/workspaces',(req,res,next)=>{
      const p=req.path;
      const readable=req.method==='GET' && (/^\/[^/]+\/pages(?:\/[^/]+(?:\/releases)?)?$/.test(p) || /^\/[^/]+\/publications\/[A-Za-z0-9_-]{22,128}$/.test(p));
      const publish=req.method==='POST' && /^\/[^/]+\/pages(?:\/[^/]+\/replace)?$/.test(p);
      const rollback=req.method==='POST' && /^\/[^/]+\/pages\/[^/]+\/releases\/[^/]+\/activate$/.test(p);
      const visibilityChange=req.method==='PATCH' && /^\/[^/]+\/pages\/[^/]+\/visibility$/.test(p);
      return readable || publish || rollback || visibilityChange ? next() : res.sendStatus(404);
    },createWorkspacePagesRouter({service:workspacePages,requireUser:cliUser,uploader:workspaceUploader,tempFiles,visibility,receiptFactory:()=>createPublicationIdempotency(db)}));
    if (hostingConfig) {
      platformAdmin = createPlatformAdminService({ db, defaultRegistrationEnabled: config.registrationEnabled });
      if (config.ipHosting) {
        const getSettings = platformAdmin.getSettings;
        platformAdmin.getSettings = () => ({...getSettings(),registrationEnabled:false});
      }
      const sender = retentionSender ?? accountSender?.sendRetention;
      let retentionDiagnostics=null;
      if (sender !== undefined) {
        if (typeof sender !== 'function') throw new TypeError('Invalid retention sender');
        const retention = createRetentionService({db,sender,now:retentionClock || Date.now,deletion:workspaceDeletion});
        retentionDiagnostics=retention.listBlocked;
        retentionCoordinator = createRetentionCoordinator({service:retention,gate:maintenance,deletion:workspaceDeletion});
        retentionScheduler = createRetentionScheduler({coordinator:retentionCoordinator,
          onResult: result => { const failed=Boolean(result.deliveryFailures || result.deletionFailures || result.blockedPages);operationsStatus.recordRetention(result);if (failed) console.error(`Retention scan: ${result.deliveryFailures} notification failures, ${result.deletionFailures} deletion failures, ${result.blockedPages} blocked applications`); },
          onError: () => {operationsStatus.record('retention',false);console.error('Retention scan failed; check maintenance state and server configuration.');} });
      }
      const updateSettings = platformAdmin.updateSettings;
      platformAdmin.updateSettings = (actor, settings) => {
        if (config.ipHosting && settings?.registrationEnabled === true) throw Object.assign(new Error('Registration is unavailable in single IP mode.'), {code:'REGISTRATION_DISABLED'});
        if (settings?.retention?.mode === "inactivity" && !retentionScheduler?.isRunning()) {
          throw Object.assign(new Error("Automatic cleanup is not available."), { code: "RETENTION_UNAVAILABLE" });
        }
        return updateSettings(actor, settings);
      };
      const quotaService = createWorkspaceQuotaService({ db, authorize: () => {}, defaultLimits: () => platformAdmin.getSettings().defaultQuotas, onChange:(workspace,actor,action)=>db.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run(randomUUID(),actor,action,workspace,Date.now()) });
      const hosting = (config.ipHosting ? createWorkspaceIpHostingService : createWorkspaceHostingService)({ db, storageRoot: workspaceStorage.root, ...hostingConfig, isSuspended: platformAdmin.isSuspended, publicPage: visibility.publicPage });
      if (!config.ipHosting) hostingConfig.appDomain = hosting.appDomain;
      const requireInstanceAdmin = (req, res, next) => services.auth.requireAdmin(req, res, () => { req.admin = { id: "instance-admin" }; next(); });
      admin.use("/api/platform", createPlatformAdminRouter({ service: platformAdmin, quotaService, operationsStatus, retentionDiagnostics, requireAdmin: requireInstanceAdmin, managementOrigin: hosting.managementOrigin }));
      const router = config.ipHosting
        ? createWorkspaceIpHostingRouter({service:hosting,shareService,contentHost:new URL(config.ipHosting.contentOrigin).host,isSuspended:platformAdmin.isSuspended,onPublicVisit:(pageId,details)=>recordVisit('workspace',pageId,details)})
        : createWorkspaceHostingAppRouter({ service: hosting, shareService, onPublicVisit:(pageId,details)=>recordVisit('workspace',pageId,details) });
      admin.use("/api/shares", createWorkspaceShareRouter({ service: shareService, requireUser, managementOrigin: hosting.managementOrigin }));
      workspaceHostingRouter = config.ipHosting ? router : (req, res, next) => {
        const host = String(req.headers.host || "").toLowerCase();
        return host === hostingConfig.appDomain || host.endsWith(`.${hostingConfig.appDomain}`) ? router(req, res, next) : next();
      };
      admin.use("/api/host", (req, res, next) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !config.allowedOrigins.includes(req.get("Origin"))) {
          return res.status(403).json({ error: "Request origin is not allowed." });
        }
        return next();
      }, createWorkspaceHostingManagementRouter({ service: hosting, requireUser }));
    }
    admin.use("/api/workspaces", (req, res, next) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !config.allowedOrigins.includes(req.get("Origin"))) {
        return res.status(403).json({ error: "Request origin is not allowed." });
      }
      return next();
    }, createWorkspacePagesRouter({ service: workspacePages, requireUser, uploader: workspaceUploader, tempFiles, visibility, releaseCleanup, deletePage: deleteWorkspacePage }),
      createWorkspaceRouter({ service: workspaceService, requireUser }));
  }
  admin.use("/api", createAdminRouter({ ...services, config }));
  admin.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  if (fs.existsSync(config.adminDistDir)) {
    admin.get("/robots.txt", (_req, res) => {
      res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /console\nDisallow: /platform-admin\nDisallow: /workspace\nDisallow: /account\nDisallow: /share/\nSitemap: ${config.adminOrigin}/sitemap.xml\n`);
    });
    admin.get("/sitemap.xml", (_req, res) => {
      const urls = publicMeta({ origin: config.adminOrigin }).alternates;
      const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.slice(0, 2).map((url) => `<url><loc>${escape(url.href)}</loc>${urls.map((alt) => `<xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${escape(alt.href)}"/>`).join("")}</url>`).join("")}</urlset>`);
    });
    const adminIndexFile = path.join(config.adminDistDir, "index.html");
    let adminIndexTemplate;
    admin.get("/", (req, res) => {
      try {
        adminIndexTemplate ??= readPublicIndexTemplate(adminIndexFile);
        res.set("Cache-Control", "no-cache");
        res.set("Content-Language", publicIndexLanguage(req.query.lang));
        res.type("html").send(renderPublicIndexHtml(adminIndexTemplate, { origin: config.adminOrigin, lang: req.query.lang }));
      } catch {
        res.sendFile(adminIndexFile);
      }
    });
    admin.use(express.static(config.adminDistDir, { index: false, maxAge: "1h" }));
    admin.get("/{*splat}", (_req, res) => {
      res.set("X-Robots-Tag", "noindex, follow");
      res.sendFile(path.join(config.adminDistDir, "index.html"));
    });
  }

  admin.use((error, _req, res, _next) => {
    if (error instanceof ValidationError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "SLUG_CONFLICT" ? 409 : 400;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "The upload exceeds the 50 MB limit." });
    }
    if (error?.name === "MulterError" || error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: "An unexpected error occurred." });
  });

  const hosted = createPagesApp({
    config,
    pages: services.pages,
    pageLogin: services.pageLogin,
    workspaceHostingRouter,
    maintenance,
    securityLog,
    publicDirectory,
  });

  return { admin, hosted, services, maintenance, securityLog, retentionCoordinator, retentionScheduler, ephemeralCleanupScheduler };
}

