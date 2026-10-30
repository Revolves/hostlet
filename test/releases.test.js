import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createReleaseSchema, ReleaseRepository } from "../server/releases.js";
import { openDatabase } from "../server/database.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE pages (id TEXT PRIMARY KEY, release_id TEXT NOT NULL)");
  createReleaseSchema(db);
  db.exec("INSERT INTO pages VALUES ('a','old'),('b','other')");
  const releases = new ReleaseRepository(db);
  releases.add({ pageId: "a", releaseId: "old", releaseDir: "/a/old", entryFile: "index.html", sourceType: "html", originalFilename: "old.html", sizeBytes: 5, fileCount: 1 });
  releases.add({ pageId: "a", releaseId: "new", releaseDir: "/a/new", entryFile: "index.html", sourceType: "html", originalFilename: "new.html", sizeBytes: 10, fileCount: 1 });
  releases.add({ pageId: "b", releaseId: "other", releaseDir: "/b/other", entryFile: "index.html", sourceType: "html", originalFilename: "b.html", sizeBytes: 7, fileCount: 1 });
  return { db, releases };
}

test("release history is scoped to its page and sums all stored versions", () => {
  const { db, releases } = fixture();
  assert.deepEqual(releases.list("a").map((r) => r.releaseId).sort(), ["new", "old"]);
  assert.equal(releases.totalBytes("a"), 15);
  assert.equal(releases.get("a", "other"), null);
  db.close();
});

test("duplicate release identifiers do not overwrite history", () => {
  const { db, releases } = fixture();
  assert.throws(() => releases.add({ pageId: "a", releaseId: "old", releaseDir: "/other", entryFile: "index.html", sourceType: "html", originalFilename: "bad.html", sizeBytes: 0, fileCount: 1 }));
  assert.equal(releases.get("a", "old").releaseDir, "/a/old");
  db.close();
});

test("upgrading a version 1 database records the current legacy release", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "hostlet-releases-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "legacy.sqlite");
  const old = new DatabaseSync(filename);
  const template = openDatabase(":memory:");
  const legacySql = template.prepare("SELECT sql FROM sqlite_master WHERE name IN ('pages','sessions','audit_logs','idx_sessions_expires','idx_audit_created') ORDER BY type DESC").all();
  template.close();
  for (const item of legacySql) old.exec(item.sql.replace(/, access_revision INTEGER NOT NULL DEFAULT 0/i, ""));
  old.exec(`PRAGMA user_version=1; INSERT INTO pages VALUES ('id','title','slug','index.html','private','html','index.html','r1','/old',4,1,'then','now')`);
  old.close();
  const db = openDatabase(filename);
  const history = new ReleaseRepository(db).list("id");
  assert.equal(history.length, 1);
  assert.equal(history[0].releaseId, "r1");
  assert.equal(db.prepare("SELECT access_mode FROM pages WHERE id='id'").get().access_mode, "private");
  db.close();
});
