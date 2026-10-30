import crypto from "node:crypto";
import { hashToken, randomToken } from "./tokens.js";

function mapPage(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    entryFile: row.entry_file,
    accessMode: row.access_mode,
    sourceType: row.source_type,
    originalFilename: row.original_filename,
    releaseId: row.release_id,
    releaseDir: row.release_dir,
    sizeBytes: Number(row.size_bytes),
    fileCount: Number(row.file_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessRevision: Number(row.access_revision),
  };
}

export class PageRepository {
  constructor(db, clock = () => new Date()) {
    this.db = db;
    this.clock = clock;
  }

  list() {
    return this.db
      .prepare("SELECT * FROM pages ORDER BY datetime(updated_at) DESC, title COLLATE NOCASE ASC")
      .all()
      .map(mapPage);
  }

  getById(id) {
    return mapPage(this.db.prepare("SELECT * FROM pages WHERE id = ?").get(id));
  }

  getBySlug(slug) {
    return mapPage(this.db.prepare("SELECT * FROM pages WHERE slug = ?").get(slug));
  }

  slugExists(slug, exceptId = null) {
    const row = exceptId
      ? this.db.prepare("SELECT id FROM pages WHERE slug = ? AND id <> ?").get(slug, exceptId)
      : this.db.prepare("SELECT id FROM pages WHERE slug = ?").get(slug);
    return Boolean(row);
  }

  create(data) {
    const now = this.clock().toISOString();
    this.db
      .prepare(`
        INSERT INTO pages (
          id, title, slug, entry_file, access_mode, source_type, original_filename,
          release_id, release_dir, size_bytes, file_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        data.id,
        data.title,
        data.slug,
        data.entryFile,
        data.accessMode,
        data.sourceType,
        data.originalFilename,
        data.releaseId,
        data.releaseDir,
        data.sizeBytes,
        data.fileCount,
        now,
        now,
      );
    return this.getById(data.id);
  }

  update(id, data) {
    const now = this.clock().toISOString();
    this.db
      .prepare(`
        UPDATE pages SET
          title = ?, slug = ?, entry_file = ?, access_mode = ?,
          source_type = ?, original_filename = ?, release_id = ?, release_dir = ?,
          size_bytes = ?, file_count = ?, updated_at = ?,
          access_revision = access_revision + CASE WHEN release_id <> ? OR slug <> ? OR access_mode <> ? OR entry_file <> ? THEN 1 ELSE 0 END
        WHERE id = ?
      `)
      .run(
        data.title,
        data.slug,
        data.entryFile,
        data.accessMode,
        data.sourceType,
        data.originalFilename,
        data.releaseId,
        data.releaseDir,
        data.sizeBytes,
        data.fileCount,
        now,
        data.releaseId,
        data.slug,
        data.accessMode,
        data.entryFile,
        id,
      );
    return this.getById(id);
  }

  delete(id) {
    return this.db.prepare("DELETE FROM pages WHERE id = ?").run(id).changes > 0;
  }

  stats() {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN access_mode = 'public' THEN 1 ELSE 0 END) AS public_count,
          (SELECT COALESCE(SUM(size_bytes), 0) FROM page_releases) AS storage_bytes
        FROM pages
      `)
      .get();

    return {
      total: Number(row.total),
      publicCount: Number(row.public_count),
      privateCount: Number(row.total) - Number(row.public_count),
      storageBytes: Number(row.storage_bytes),
    };
  }

  audit(action, pageId = null, detail = null) {
    this.db
      .prepare("INSERT INTO audit_logs (action, page_id, detail, created_at) VALUES (?, ?, ?, ?)")
      .run(action, pageId, detail, this.clock().toISOString());
  }
}

export class SessionRepository {
  constructor(db, clock = () => new Date()) {
    this.db = db;
    this.clock = clock;
  }

  create(ttlMs) {
    const token = randomToken();
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.db
      .prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(token), now.toISOString(), expiresAt);
    return { token, expiresAt: new Date(expiresAt) };
  }

  find(token) {
    if (!token) {
      return null;
    }

    const now = this.clock().toISOString();
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(hashToken(token), now);
    return row ? { tokenHash: row.token_hash, expiresAt: row.expires_at } : null;
  }

  delete(token) {
    if (token) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    }
  }

  purgeExpired() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(this.clock().toISOString());
  }
}

export function createPageId() {
  return crypto.randomUUID();
}

