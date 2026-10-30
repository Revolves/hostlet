import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateRelativeFile, validateTitle, ValidationError } from './validation.js';
import { sourceTypeFromFilename } from './storage.js';
import { inspectZipSite } from './archive.js';
import { createQuotaService, QuotaError } from './quotas.js';

// Apply after users and workspaces; foreign_keys must be enabled on every connection.
// IDs are permanently reserved, including after deletion.
export const workspacePagesSchema = `
CREATE TABLE workspace_page_ids (id TEXT PRIMARY KEY);
CREATE TABLE workspace_pages (
 id TEXT PRIMARY KEY REFERENCES workspace_page_ids(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 created_by TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, access_mode TEXT NOT NULL CHECK(access_mode='private'),
 storage_id TEXT NOT NULL UNIQUE, release_id TEXT NOT NULL,
 entry_file TEXT NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('html','zip')),
 original_filename TEXT NOT NULL, size_bytes INTEGER NOT NULL, file_count INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX workspace_pages_workspace ON workspace_pages(workspace_id,created_at,id);
`;

// Apply exactly once, transactionally, after workspacePagesSchema (v6).
// No filesystem paths are migrated: release directories are derived from
// trusted storage root + page storage_id + release_id.
export const workspacePageReleasesMigrationSql = `
CREATE TABLE workspace_page_revisions (
 page_id TEXT PRIMARY KEY REFERENCES workspace_pages(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
);
CREATE TABLE workspace_page_releases (
 page_id TEXT NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
 release_id TEXT NOT NULL, entry_file TEXT NOT NULL,
 source_type TEXT NOT NULL CHECK(source_type IN ('html','zip')),
 original_filename TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
 file_count INTEGER NOT NULL CHECK(file_count > 0), created_at TEXT NOT NULL,
 PRIMARY KEY(page_id,release_id)
);
CREATE INDEX workspace_page_releases_created ON workspace_page_releases(page_id,created_at DESC,release_id DESC);
INSERT INTO workspace_page_revisions(page_id,revision) SELECT id,0 FROM workspace_pages;
INSERT INTO workspace_page_releases(page_id,release_id,entry_file,source_type,original_filename,size_bytes,file_count,created_at)
 SELECT id,release_id,entry_file,source_type,original_filename,size_bytes,file_count,updated_at FROM workspace_pages;
`;

export class WorkspacePageError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new WorkspacePageError(code); };
const validId = id => typeof id === 'string' && /^w-[a-f0-9]{32}$/.test(id);
const privateOnly = mode => { if (mode !== 'private') throw new ValidationError('Only private pages are supported.'); return mode; };
const portablePath = value => {
  const clean = validateRelativeFile(value);
  if (clean.split('/').some(s => /[\x00-\x1f<>:"|?*]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw new ValidationError('Unsafe file path.');
  return clean;
};
const metadata = r => ({ id: r.id, workspaceId: r.workspace_id, createdBy: r.created_by, title: r.title,
  accessMode: r.access_mode, entryFile: r.entry_file, sourceType: r.source_type,
  originalFilename: r.original_filename, sizeBytes: r.size_bytes, fileCount: r.file_count,
  createdAt: r.created_at, updatedAt: r.updated_at, releaseId: r.release_id, revision: r.revision });
const releaseMetadata = (r, current) => ({ releaseId: r.release_id, entryFile: r.entry_file, sourceType: r.source_type,
  originalFilename: r.original_filename, sizeBytes: r.size_bytes, fileCount: r.file_count, createdAt: r.created_at, current: r.release_id === current });
const expectedRevision = value => {
  if (!(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) && !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)))) throw new ValidationError('A valid revision is required.');
  return Number(value);
};

/**
 * Construct the quota service against the same authoritative workspace usage as
 * uploads. The host MUST inject its own synchronous authorize(workspace, actor,
 * action), which throws on denial, including for 'view' and 'manage'; platform
 * administrators need not be workspace members. Never expose the internal
 * cancel capability or allow callers to select an actor. defaultLimits is a
 * synchronous provider, read inside the quota transaction, and must not open a
 * nested transaction. Use get(workspace, actor) and update(workspace, actor,
 * {maxApps,maxStorageBytes,maxUploadBytes}) for a platform management API.
 * Apply both release and quota migrations before using this service.
 */
export function createWorkspaceQuotaService({db, authorize, defaultLimits, clock, onChange} = {}) {
  return createQuotaService({db, authorize, defaultLimits, clock, onChange,
    readUsage: workspace => ({
      apps: db.prepare('SELECT count(*) n FROM workspace_pages WHERE workspace_id=?').get(workspace).n,
      bytes: db.prepare('SELECT COALESCE((SELECT sum(r.size_bytes) FROM workspace_page_releases r JOIN workspace_pages p ON p.id=r.page_id WHERE p.workspace_id=?),0) + COALESCE((SELECT sum(size_bytes) FROM workspace_release_cleanup WHERE workspace_id=?),0) n').get(workspace,workspace).n
    }) });
}

/** Storage must be a FileSiteStorage on a trusted local filesystem, with a root
 * dedicated to workspace pages and never mounted by the legacy hosted app.
 * Apply workspacePageReleasesMigrationSql then quotaMigrationSql separately in
 * the host migration chain before enabling uploads. This service shares the
 * workspace connection and owns its transactions; do not wrap calls in one.
 * The caller provides authentication and CSRF protection. beginUpload precedes
 * reading the file; pass its server-owned result to create/replace and always
 * call cancelUpload after all file writes have stopped, even on failure.
 * The router enforces raw bytes while streaming; ZIP extraction enforces 100 MiB.
 * ZIPs reserve up to 100 MiB of available storage, HTML reserves a request length bound or
 * the raw cap, at most 100 MiB. Expired operations cannot commit. Staged files
 * and upload temp files consume additional disk outside quota. Publication
 * journal recovery must run with all writers stopped before accepting requests.
 * An interruption before the journal insert can leave an empty directory; raw
 * upload temp files and older unrecorded orphans require separate review.
 */
export function createWorkspacePagesService({ db, workspaceService, storage, quotaClock, quotaDefaults, maxReleases = 20 }) {
  if (!db || !workspaceService || typeof workspaceService.authorize !== 'function' || !storage || !path.isAbsolute(storage.root)) throw new TypeError('db, workspaceService and storage are required');
  if (!Number.isSafeInteger(maxReleases) || maxReleases < 1) throw new TypeError('Invalid version limit');
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('foreign_keys must be enabled');
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const auth = (workspace, actor, permission) => workspaceService.authorize(workspace, actor, permission);
  const quotas = createWorkspaceQuotaService({ db, clock: quotaClock, defaultLimits: quotaDefaults,
    authorize: (workspace,actor,action) => auth(workspace,actor,action === 'upload' ? 'edit' : action) });
  const pending = new Map();
  const find = (workspace, id) => {
    if (!validId(id)) fail('NOT_FOUND');
    const row = db.prepare('SELECT p.*,r.revision FROM workspace_pages p JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.workspace_id=? AND p.id=?').get(workspace, id);
    if (!row) fail('NOT_FOUND'); return row;
  };
  const sites = path.join(storage.root, 'sites');
  const addRelease = (id, release) => db.prepare('INSERT INTO workspace_page_releases VALUES (?,?,?,?,?,?,?,?)').run(id, release.releaseId, release.entryFile, release.sourceType, release.originalFilename, release.sizeBytes, release.fileCount, new Date().toISOString());
  const stage = async (pageId, file, entryFile, storageLimit) => {
    const sourceType = sourceTypeFromFilename(file.originalname);
    try {
      if (sourceType === 'zip') {
        const { directory, entryFile: selected } = await inspectZipSite({ archivePath: file.path, requestedEntry: entryFile, validatePath:portablePath });
        entryFile=selected;
        for (const item of directory.files) {
          const name = String(item.path || '').replace(/^\.\//, '').replace(/\/$/, '');
          if (name) portablePath(name);
        }
      }
      const args = { pageId, sourcePath: file.path, entryFile, originalFilename: path.basename(file.originalname), maxTotalBytes:storageLimit };
      return sourceType === 'html' ? await storage.stageSingleHtml(args) : await storage.stageZip(args);
    } catch (error) {
      if(error.code==='ZIP_STORAGE_LIMIT') throw new QuotaError('QUOTA_EXCEEDED','storage');
      if (sourceType === 'zip' && ['FILE_ENDED', 'MISSING CENTRAL DIRECTORY RECORD', 'INVALID_SIGNATURE'].includes(error.message)) throw new ValidationError('Invalid ZIP archive.');
      throw error;
    }
  };
  const entryFor=(fields,type)=>{
    if (fields.entryFile !== undefined && typeof fields.entryFile !== 'string') throw new ValidationError('Invalid entry file.');
    const value=fields.entryFile?.trim();
    return type === 'zip' && !value ? undefined : portablePath(validateRelativeFile(value || 'index.html',{htmlOnly:true}));
  };
  const advance = (id, revision) => {
    const result = db.prepare('UPDATE workspace_page_revisions SET revision=revision+1 WHERE page_id=? AND revision=? AND revision < 9007199254740991').run(id, revision);
    if (result.changes !== 1) fail('CONFLICT');
  };
  const useRelease = (workspace, id, release) => db.prepare('UPDATE workspace_pages SET release_id=?,entry_file=?,source_type=?,original_filename=?,size_bytes=?,file_count=?,updated_at=? WHERE workspace_id=? AND id=?')
    .run(release.release_id, release.entry_file, release.source_type, release.original_filename, release.size_bytes, release.file_count, new Date().toISOString(), workspace, id);
  const releasePath = (row, release) => {
    if (!validId(row.storage_id) || row.storage_id !== row.id || !/^[0-9]+-[a-f0-9]{10}$/.test(release.release_id)) throw new Error('Invalid storage identifier');
    return path.join(sites, row.storage_id, 'releases', release.release_id);
  };
  const ensureReleaseExists = (row, release) => {
    const dir = releasePath(row, release);
    const entry = portablePath(validateRelativeFile(release.entry_file, { htmlOnly: true }));
    try {
      if (!fs.statSync(path.join(dir, ...entry.split('/'))).isFile()) fail('CONFLICT');
    } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') fail('CONFLICT'); throw e; }
  };
  return {
    authorize: auth,
    uploadTempDir: path.join(storage.root, 'tmp'),
    beginUpload(workspace,actor,filename,contentLength,pageId,guard = () => {},source = 'web') {
      if (typeof guard !== 'function') throw new TypeError('Invalid upload guard');
      if (!['web','cli'].includes(source)) throw new TypeError('Invalid upload source');
      guard();
      const type=sourceTypeFromFilename(filename);
      if (pageId) { auth(workspace,actor,'edit'); find(workspace,pageId); }
      const reservation=quotas.reserveUpload(workspace,actor,{apps:pageId ? 0 : 1,zip:type === 'zip',contentLength,ttlMs:60*60*1000});
      pending.set(reservation.id,{workspace,actor,pageId:pageId || null,filename,type,guard,source,...reservation});
      return {...reservation, type};
    },
    cancelUpload(reservation) {
      if (!reservation || !pending.has(reservation.id)) return;
      const state=pending.get(reservation.id);
      quotas.cancel(state.workspace,state.id); pending.delete(state.id);
    },
    list(workspace, actor) { auth(workspace, actor, 'view'); return db.prepare('SELECT p.*,r.revision FROM workspace_pages p JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.workspace_id=? ORDER BY p.created_at,p.id').all(workspace).map(metadata); },
    get(workspace, actor, id) { auth(workspace, actor, 'view'); return metadata(find(workspace, id)); },
    async create(workspace, actor, file, fields = {}, reservation) {
      auth(workspace, actor, 'edit');
      if (!file?.path || !file.originalname) throw new ValidationError('File is required.');
      const held=pending.get(reservation?.id);
      if (!held || held.workspace!==workspace || held.actor!==actor || held.pageId!==null || held.filename!==file.originalname || file.size > held.rawLimit || (held.type==='html' && file.size > held.bytes) || !Number.isSafeInteger(file.size) || file.size<0) throw new ValidationError('Invalid upload reservation.');
      const title = validateTitle(fields.title), accessMode = privateOnly(fields.accessMode ?? 'private');
      const entryFile = entryFor(fields,held.type);
      const id = `w-${crypto.randomBytes(16).toString('hex')}`;
      const pageDir = path.join(sites, id);
      let owned = false, journaled = false, committed = false;
      try {
        // Exclusive creation prevents touching any existing directory, even on collision.
        await fs.promises.mkdir(pageDir); owned = true;
        db.prepare('INSERT INTO workspace_publication_journal VALUES (?,?,NULL,?)').run(id,id,storage.root); journaled=true;
        const release = await stage(id, file, entryFile, held.type==='zip' ? held.bytes : undefined);
        const result=quotas.commit(workspace,actor,held.id,{apps:1,bytes:release.sizeBytes},() => {
          held.guard();
          auth(workspace, actor, 'edit');
          const now = new Date().toISOString();
          db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id);
          db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspace, actor, title, accessMode, id, release.releaseId, release.entryFile, release.sourceType, release.originalFilename, release.sizeBytes, release.fileCount, now, now);
          db.prepare('INSERT INTO workspace_page_revisions VALUES (?,0)').run(id);
          addRelease(id, release);
          workspaceService.recordPageAudit?.(workspace,actor,'page.created',id,release.releaseId);
          if (held.source==='cli') workspaceService.recordPageAudit?.(workspace,actor,'page.cli_published',id,release.releaseId);
          return metadata(find(workspace, id));
        });
        committed=true;
        pending.delete(held.id);
        try { db.prepare('DELETE FROM workspace_publication_journal WHERE staging_id=?').run(id); } catch { /* Startup recovery preserves committed pages. */ }
        return result;
      } catch (error) {
        if (owned && !committed) { await storage.removePage(id); if (journaled) db.prepare('DELETE FROM workspace_publication_journal WHERE staging_id=?').run(id); }
        throw error;
      }
    },
    listReleases(workspace, actor, id) {
      auth(workspace, actor, 'view'); const page = find(workspace, id);
      return db.prepare('SELECT * FROM workspace_page_releases WHERE page_id=? ORDER BY created_at DESC,release_id DESC').all(id).map(r => releaseMetadata(r, page.release_id));
    },
    async replace(workspace, actor, id, file, fields = {}, reservation) {
      auth(workspace, actor, 'edit'); const initial = find(workspace, id);
      const revision = expectedRevision(fields.revision);
      if (initial.revision !== revision) fail('CONFLICT');
      if (!file?.path || !file.originalname) throw new ValidationError('File is required.');
      const held=pending.get(reservation?.id);
      if (!held || held.workspace!==workspace || held.actor!==actor || held.pageId!==id || held.filename!==file.originalname || file.size > held.rawLimit || (held.type==='html' && file.size > held.bytes) || !Number.isSafeInteger(file.size) || file.size<0) throw new ValidationError('Invalid upload reservation.');
      const entryFile = entryFor(fields,held.type);
      // Each request owns an isolated staging page; no request removes a real page directory.
      const stagingId = `w-${crypto.randomBytes(16).toString('hex')}`;
      let owned = false, journaled = false, moved, committed = false, cleaned = false, destinationClean = true;
      try {
        await fs.promises.mkdir(path.join(sites, stagingId)); owned = true;
        db.prepare('INSERT INTO workspace_publication_journal VALUES (?,?,NULL,?)').run(stagingId,id,storage.root); journaled=true;
        const release = await stage(stagingId, file, entryFile, held.type==='zip' ? held.bytes : undefined);
        // No asynchronous work may intervene between recording the destination
        // and the transaction: an existing directory is never claimed as ours.
        const current=find(workspace,id), destination=releasePath(current,{release_id:release.releaseId});
        if (fs.existsSync(destination)) fail('CONFLICT');
        db.prepare('UPDATE workspace_publication_journal SET release_id=? WHERE staging_id=?').run(release.releaseId,stagingId);
        const result=quotas.commit(workspace,actor,held.id,{apps:0,bytes:release.sizeBytes},() => {
          held.guard();
          auth(workspace, actor, 'edit'); const page = find(workspace, id);
          if (db.prepare('SELECT count(*) n FROM workspace_page_releases WHERE page_id=?').get(id).n >= maxReleases) fail('HISTORY_LIMIT');
          advance(id, revision);
          const dest = releasePath(page, { release_id: release.releaseId });
          if (fs.existsSync(dest)) fail('CONFLICT');
          addRelease(id, release);
          useRelease(workspace, id, { release_id: release.releaseId, entry_file: release.entryFile, source_type: release.sourceType, original_filename: release.originalFilename, size_bytes: release.sizeBytes, file_count: release.fileCount });
          workspaceService.recordPageAudit?.(workspace,actor,'page.replaced',id,release.releaseId);
          if (held.source==='cli') workspaceService.recordPageAudit?.(workspace,actor,'page.cli_published',id,release.releaseId);
          // Destination parent must already exist; never recreate a concurrently deleted page.
          fs.renameSync(release.releaseDir, dest);
          moved=dest; destinationClean=false;
          return metadata(find(workspace, id));
        });
        committed=true;
        destinationClean=true;
        pending.delete(held.id);
        return result;
      } catch (error) {
        if (moved && !committed) { await fs.promises.rm(moved, {recursive:true,force:true}); destinationClean=true; }
        throw error;
      } finally {
        if (owned) {
          if (committed) { try { await storage.removePage(stagingId); cleaned=true; } catch { /* Startup recovery handles the recorded directory. */ } }
          else { await storage.removePage(stagingId); cleaned=true; }
          if (cleaned && destinationClean && journaled) { try { db.prepare('DELETE FROM workspace_publication_journal WHERE staging_id=?').run(stagingId); } catch { /* Startup recovery completes cleanup. */ } }
        }
      }
    },
    activate(workspace, actor, id, releaseId, revisionInput) {
      const revision = expectedRevision(revisionInput);
      return tx(() => {
        auth(workspace, actor, 'edit'); const page = find(workspace, id);
        const release = db.prepare('SELECT * FROM workspace_page_releases WHERE page_id=? AND release_id=?').get(id, releaseId);
        if (!release) fail('NOT_FOUND');
        if (page.revision !== revision) fail('CONFLICT');
        ensureReleaseExists(page, release); advance(id, revision); useRelease(workspace, id, release);
        workspaceService.recordPageAudit?.(workspace,actor,'page.restored',id,releaseId);
        return metadata(find(workspace, id));
      });
    },
    update(workspace, actor, id, fields = {}) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ValidationError('Invalid update.');
      const hasTitle = Object.hasOwn(fields, 'title'), hasAccess = Object.hasOwn(fields, 'accessMode');
      if (!hasTitle && !hasAccess || Object.keys(fields).some(k => !['title', 'accessMode'].includes(k))) throw new ValidationError('Invalid update.');
      const title = hasTitle ? validateTitle(fields.title) : undefined;
      const access = hasAccess ? privateOnly(fields.accessMode) : undefined;
      return tx(() => {
        auth(workspace, actor, hasAccess ? 'manage' : 'edit'); const row = find(workspace, id);
        db.prepare('UPDATE workspace_pages SET title=?,access_mode=?,updated_at=? WHERE workspace_id=? AND id=?').run(title ?? row.title, access ?? row.access_mode, new Date().toISOString(), workspace, id);
        if (title !== undefined && title !== row.title) workspaceService.recordPageAudit?.(workspace,actor,'page.renamed',id);
        return metadata(find(workspace, id));
      });
    },
    async delete(workspace, actor, id) {
      let from, quarantine, moved = false;
      try {
        tx(() => {
          auth(workspace, actor, 'manage'); const row = find(workspace, id);
          if (!validId(row.storage_id) || row.storage_id !== id) throw new Error('Invalid storage id');
          from = path.join(sites, row.storage_id); quarantine = path.join(sites, `.deleted-${crypto.randomBytes(16).toString('hex')}`);
          fs.renameSync(from, quarantine); moved = true;
          db.prepare('DELETE FROM workspace_pages WHERE workspace_id=? AND id=?').run(workspace, id);
        });
      } catch (error) {
        if (moved) fs.renameSync(quarantine, from);
        throw error;
      }
      await fs.promises.rm(quarantine, { recursive: true, force: true });
    }
  };
}
