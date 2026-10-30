export function createReleaseSchema(db) {
  db.exec(`
    CREATE TABLE page_releases (
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      release_id TEXT NOT NULL,
      release_dir TEXT NOT NULL,
      entry_file TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('html', 'zip')),
      original_filename TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      file_count INTEGER NOT NULL CHECK(file_count > 0),
      created_at TEXT NOT NULL,
      PRIMARY KEY (page_id, release_id)
    );
    CREATE INDEX idx_page_releases_created ON page_releases(page_id, created_at DESC);
  `);
}

function mapRelease(row) {
  if (!row) return null;
  return {
    pageId: row.page_id, releaseId: row.release_id, releaseDir: row.release_dir,
    entryFile: row.entry_file, sourceType: row.source_type,
    originalFilename: row.original_filename, sizeBytes: Number(row.size_bytes),
    fileCount: Number(row.file_count), createdAt: row.created_at,
  };
}

export class ReleaseRepository {
  constructor(db, clock = () => new Date()) {
    this.db = db;
    this.clock = clock;
  }

  add(release) {
    this.db.prepare(`INSERT INTO page_releases
      (page_id, release_id, release_dir, entry_file, source_type, original_filename, size_bytes, file_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(release.pageId, release.releaseId, release.releaseDir, release.entryFile,
        release.sourceType, release.originalFilename, release.sizeBytes, release.fileCount,
        this.clock().toISOString());
    return this.get(release.pageId, release.releaseId);
  }

  get(pageId, releaseId) {
    return mapRelease(this.db.prepare("SELECT * FROM page_releases WHERE page_id = ? AND release_id = ?").get(pageId, releaseId));
  }

  list(pageId) {
    return this.db.prepare("SELECT * FROM page_releases WHERE page_id = ? ORDER BY created_at DESC, release_id DESC")
      .all(pageId).map(mapRelease);
  }

  totalBytes(pageId) {
    return Number(this.db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM page_releases WHERE page_id = ?").get(pageId).total);
  }

  setEntry(pageId, releaseId, entryFile) {
    return this.db.prepare("UPDATE page_releases SET entry_file = ? WHERE page_id = ? AND release_id = ?")
      .run(entryFile, pageId, releaseId).changes;
  }
}
