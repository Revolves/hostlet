import fs from 'node:fs';
import path from 'node:path';
import { WorkspacePageError } from './workspace-pages.js';

// Entries remain until the corresponding files have been removed. Their size
// must be counted against quota while cleanup is pending.
export const releaseCleanupSchema = `
CREATE TABLE workspace_release_cleanup (
 page_id TEXT NOT NULL, workspace_id TEXT NOT NULL, release_id TEXT NOT NULL, storage_root TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
 PRIMARY KEY(page_id, release_id)
);
`;
const pageIdPattern = /^w-[a-f0-9]{32}$/;
const releaseIdPattern = /^[0-9]+-[a-f0-9]{10}$/;
const fail = code => { throw new WorkspacePageError(code); };

function verifyTree(dir) {
  const info = fs.lstatSync(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe release directory');
  for (const name of fs.readdirSync(dir)) {
    const item = path.join(dir, name), stat = fs.lstatSync(item);
    if (stat.isSymbolicLink()) throw new Error('Unsafe release entry');
    if (stat.isDirectory()) verifyTree(item);
    else if (!stat.isFile()) throw new Error('Unsafe release entry');
  }
}

// The caller must ensure exclusive ownership of the local storage directory.
// Recovery runs before accepting requests, and cleanup never deletes a release
// still referenced by metadata. Files and journal rows survive interrupted work.
export function createReleaseCleanup({ db, storageRoot, authorize, audit = () => {}, onCommitted = () => {} }) {
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || !path.isAbsolute(storageRoot || '') || typeof authorize !== 'function' || typeof audit !== 'function' || typeof onCommitted !== 'function') throw new TypeError('Invalid release cleanup configuration');
  const root = path.resolve(storageRoot);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  function clean(row) {
    if (!pageIdPattern.test(row.page_id) || !releaseIdPattern.test(row.release_id) || row.storage_root !== root) throw new Error('Invalid cleanup record or storage root');
    tx(() => {
      if (db.prepare('SELECT 1 FROM workspace_page_releases WHERE page_id=? AND release_id=?').get(row.page_id,row.release_id) || db.prepare('SELECT 1 FROM workspace_pages WHERE id=? AND release_id=?').get(row.page_id,row.release_id)) throw new Error('Release is still referenced');
      let current = path.parse(root).root;
      const dir = path.join(root, 'sites', row.page_id, 'releases', row.release_id);
      const parts = path.relative(current, dir).split(path.sep);
      let missing = false;
      for (const part of parts) {
        current = path.join(current, part);
        let stat; try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') { missing = true; break; } throw error; }
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe release ancestor');
      }
      if (!missing) { verifyTree(dir); fs.rmSync(dir, { recursive: true }); }
      db.prepare('DELETE FROM workspace_release_cleanup WHERE page_id=? AND release_id=?').run(row.page_id,row.release_id);
    });
  }
  return {
    recover() { for (const row of db.prepare('SELECT * FROM workspace_release_cleanup ORDER BY page_id,release_id').all()) clean(row); },
    remove(workspace, actor, pageId, releaseId, expectedRevision) {
      if (!pageIdPattern.test(pageId || '') || !releaseIdPattern.test(releaseId || '') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID');
      const row = tx(() => {
        authorize(workspace, actor, 'edit');
        const page = db.prepare('SELECT p.*,r.revision FROM workspace_pages p JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.workspace_id=? AND p.id=?').get(workspace,pageId);
        if (!page) fail('NOT_FOUND');
        const release = db.prepare('SELECT * FROM workspace_page_releases WHERE page_id=? AND release_id=?').get(pageId,releaseId);
        if (!release) fail('NOT_FOUND');
        if (page.revision !== expectedRevision || page.release_id === releaseId || page.storage_id !== pageId) fail('CONFLICT');
        const changed=db.prepare('UPDATE workspace_page_revisions SET revision=revision+1 WHERE page_id=? AND revision=? AND revision < 9007199254740991').run(pageId,expectedRevision);
        if (changed.changes !== 1) fail('CONFLICT');
        db.prepare('INSERT INTO workspace_release_cleanup VALUES (?,?,?,?,?)').run(pageId,workspace,releaseId,root,release.size_bytes);
        db.prepare('DELETE FROM workspace_page_releases WHERE page_id=? AND release_id=?').run(pageId,releaseId);
        audit(workspace,actor,'page.version_deleted',pageId,releaseId);
        return { page_id:pageId, release_id:releaseId, storage_root:root };
      });
      onCommitted();
      clean(row);
      return { revision: expectedRevision + 1 };
    }
  };
}
