import { DatabaseSync } from "node:sqlite";
import { createReleaseSchema } from "./releases.js";
import { accountMigrationSql, accountTokensMultiUseMigrationSql } from "./accounts.js";
import { workspaceBaseSchema, workspaceAuditSchema, workspaceAuditPageSchema } from "./workspaces.js";
import { sessionSchema } from "./account-sessions.js";
import { workspacePagesSchema, workspacePageReleasesMigrationSql } from "./workspace-pages.js";
import { workspaceHostingSchema } from "./workspace-hosting.js";
import { workspaceShareSchema } from "./workspace-shares.js";
import { quotaMigrationSql } from "./quotas.js";
import { platformAdminSchema } from "./platform-admin.js";
import { workspaceVisibilitySchema } from "./workspace-visibility.js";
import { releaseCleanupSchema } from "./release-cleanup.js";
import { deletionJournalSql } from "./workspace-deletion.js";
import { retentionSchema } from "./retention.js";
import { legacyMigrationSchema } from "./legacy-migration.js";
import { publicationJournalSql } from './publication-recovery.js';
import { ephemeralCleanupIndexesSql } from './ephemeral-cleanup.js';
import { uploadTempJournalSql } from './upload-temp-recovery.js';
import { accountDeletionJournalSql } from './account-deletion.js';
import { apiCredentialsSchema } from './api-credentials.js';

// Version 1 exactly represents the schema shipped before migrations existed.
const baselineSchema = `

  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    entry_file TEXT NOT NULL,
    access_mode TEXT NOT NULL CHECK (access_mode IN ('public', 'private')),
    source_type TEXT NOT NULL CHECK (source_type IN ('html', 'zip')),
    original_filename TEXT NOT NULL,
    release_id TEXT NOT NULL,
    release_dir TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    page_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

function canonicalSql(sql) {
  // Ignore formatting outside string literals, never alter constraint values.
  return sql.split(/('(?:''|[^'])*')/g).map((part, i) => i % 2 ? part : part.toLowerCase().replace(/\bif\s+not\s+exists\b/g, '').replace(/\s+/g, '')).join('');
}

function objects(db) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
}

function establishBaseline(db) {
  const found = objects(db);
  if (found.length === 0) {
    db.exec(baselineSchema);
    return;
  }
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec(baselineSchema);
    const expected = objects(reference);
    if (found.length !== expected.length || found.some((item, i) =>
      item.type !== expected[i].type || item.name !== expected[i].name ||
      !item.sql || canonicalSql(item.sql) !== canonicalSql(expected[i].sql))) {
      throw new Error('Unrecognized legacy database schema; migration refused.');
    }
  } finally {
    reference.close();
  }
}

const migrations = [
  { version: 1, apply: establishBaseline },
  { version: 2, apply(db) {
    createReleaseSchema(db);
    db.exec(`INSERT INTO page_releases
      (page_id, release_id, release_dir, entry_file, source_type, original_filename, size_bytes, file_count, created_at)
      SELECT id, release_id, release_dir, entry_file, source_type, original_filename, size_bytes, file_count, updated_at FROM pages`);
  } },
  { version: 3, apply(db) { db.exec(accountMigrationSql); db.exec(workspaceBaseSchema); } },
  { version: 4, apply(db) { db.exec("ALTER TABLE pages ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 0"); } },
  { version: 5, apply(db) { db.exec(sessionSchema); } },
  { version: 6, apply(db) { db.exec(workspacePagesSchema); } },
  { version: 7, apply(db) { db.exec(accountTokensMultiUseMigrationSql); } },
  { version: 8, apply(db) { db.exec(workspaceHostingSchema); } },
  { version: 9, apply(db) { db.exec(workspacePageReleasesMigrationSql); } },
  { version: 10, apply(db) { db.exec(workspaceShareSchema); } },
  { version: 11, apply(db) { db.exec(quotaMigrationSql); } },
  { version: 12, apply(db) { db.exec(platformAdminSchema); } },
  { version: 13, apply(db) { db.exec(workspaceVisibilitySchema); } },
  { version: 14, apply(db) { db.exec(releaseCleanupSchema); } },
  { version: 15, apply(db) { db.exec(deletionJournalSql); } },
  { version: 16, apply(db) { db.exec(retentionSchema); } },
  { version: 17, apply(db) { db.exec(legacyMigrationSchema); } },
  { version: 18, apply(db) { db.exec(publicationJournalSql); } },
  { version: 19, apply(db) { db.exec(ephemeralCleanupIndexesSql); } },
  { version: 20, apply(db) { db.exec(uploadTempJournalSql); } },
  { version: 21, apply(db) { db.exec(workspaceAuditSchema); } },
  { version: 22, apply(db) { db.exec(workspaceAuditPageSchema); } },
  { version: 23, apply(db) { db.exec(accountDeletionJournalSql); } },
  { version: 24, apply(db) { db.exec(apiCredentialsSchema); } },
];
export const latestDatabaseVersion = migrations.length;

// The write lock protects version checks and all schema changes as one unit.
export function runMigrations(db, steps = migrations) {
  if (steps.some((step, i) => step.version !== i + 1 || typeof step.apply !== 'function')) {
    throw new Error('Invalid database migration versions.');
  }
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA user_version').get().user_version;
    if (current > steps.length) throw new Error(`Unsupported database version ${current}; latest supported is ${steps.length}.`);
    for (const step of steps.slice(current)) {
      step.apply(db);
      db.exec(`PRAGMA user_version = ${step.version}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  }
}
