import { WorkspaceError } from './workspaces.js';

// Public access is opt-in; absence of a row always means private.
export const workspaceVisibilitySchema = `
CREATE TABLE workspace_page_visibility (
 page_id TEXT PRIMARY KEY REFERENCES workspace_pages(id) ON DELETE CASCADE
);
`;

export const publicationReviewSchema = `
CREATE TABLE workspace_publication_review (
 page_id TEXT PRIMARY KEY REFERENCES workspace_pages(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, release_id TEXT NOT NULL, submitted_by TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), comment TEXT NOT NULL DEFAULT '',
 decided_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL
);
CREATE TRIGGER workspace_public_team_release_guard BEFORE UPDATE OF release_id, entry_file ON workspace_pages
WHEN (NEW.release_id <> OLD.release_id OR NEW.entry_file <> OLD.entry_file)
 AND EXISTS (SELECT 1 FROM workspaces w JOIN workspace_page_visibility v ON v.page_id=OLD.id WHERE w.id=OLD.workspace_id AND w.type='team')
BEGIN SELECT RAISE(ABORT,'PUBLIC_REVIEW_REQUIRED'); END;
`;

export function createWorkspaceVisibilityService({ db, authorize, audit = () => {} }) {
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || typeof authorize !== 'function' || typeof audit !== 'function') throw new TypeError('Invalid visibility configuration');
  const find = (workspace, page) => {
    const row = db.prepare('SELECT id FROM workspace_pages WHERE workspace_id=? AND id=?').get(workspace, page);
    if (!row) throw new WorkspaceError('NOT_FOUND');
    return row;
  };
  const publicPage = page => db.prepare('SELECT p.* FROM workspace_pages p JOIN workspace_page_visibility v ON v.page_id=p.id WHERE p.id=?').get(page) || null;
  const review = page => {
    const row=db.prepare('SELECT q.status,q.revision,q.release_id AS releaseId,q.submitted_by AS submittedBy,q.comment,q.decided_by AS decidedBy,q.updated_at AS updatedAt,p.release_id AS currentRelease,r.revision AS currentRevision FROM workspace_publication_review q JOIN workspace_pages p ON p.id=q.page_id JOIN workspace_page_revisions r ON r.page_id=p.id WHERE q.page_id=?').get(page);
    if (!row) return null;
    const {currentRelease,currentRevision,...result}=row;
    if (result.status==='pending' && (result.revision!==currentRevision || result.releaseId!==currentRelease)) result.status='stale';
    return result;
  };
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  return {
    publicPage,
    get(workspace, actor, page) {
      authorize(workspace, actor, 'view'); find(workspace, page);
      return { visibility: publicPage(page) ? 'public' : 'private', review: review(page) };
    },
    set(workspace, actor, page, visibility) {
      if (!['public', 'private'].includes(visibility)) throw new WorkspaceError('INVALID');
      db.exec('BEGIN IMMEDIATE');
      try {
        const role=authorize(workspace, actor, 'edit'); find(workspace, page);
        const space=db.prepare('SELECT type FROM workspaces WHERE id=?').get(workspace);
        if (visibility==='public' && space.type==='team' && role!=='owner') throw new WorkspaceError('FORBIDDEN');
        const changed=visibility === 'public' ? db.prepare('INSERT OR IGNORE INTO workspace_page_visibility VALUES (?)').run(page) : db.prepare('DELETE FROM workspace_page_visibility WHERE page_id=?').run(page);
        if (visibility==='public') db.prepare('DELETE FROM workspace_publication_review WHERE page_id=? AND status=?').run(page,'pending');
        if (changed.changes) { db.prepare('UPDATE workspace_pages SET updated_at=? WHERE workspace_id=? AND id=?').run(new Date().toISOString(),workspace,page); audit(workspace,actor,`page.visibility_${visibility}`,page); }
        db.exec('COMMIT');
        return { visibility };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    ,submitReview(workspace,actor,page) {
      return transaction(()=>{
        authorize(workspace,actor,'edit'); find(workspace,page);
        if (db.prepare('SELECT type FROM workspaces WHERE id=?').get(workspace).type!=='team' || publicPage(page)) throw new WorkspaceError('CONFLICT');
        const current=db.prepare('SELECT p.release_id,r.revision FROM workspace_pages p JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.id=?').get(page);
        db.prepare(`INSERT INTO workspace_publication_review VALUES (?,?,?,?,'pending','',NULL,?) ON CONFLICT(page_id) DO UPDATE SET revision=excluded.revision,release_id=excluded.release_id,submitted_by=excluded.submitted_by,status='pending',comment='',decided_by=NULL,updated_at=excluded.updated_at`).run(page,current.revision,current.release_id,actor,new Date().toISOString());
        audit(workspace,actor,'page.review_submitted',page); return {visibility:'private',review:review(page)};
      });
    },
    decideReview(workspace,actor,page,decision,comment='') {
      if (!['approve','reject'].includes(decision) || typeof comment!=='string' || comment.length>1000) throw new WorkspaceError('INVALID');
      return transaction(()=>{
        authorize(workspace,actor,'manage'); find(workspace,page);
        const pending=db.prepare('SELECT q.*,p.release_id AS current_release,r.revision AS current_revision FROM workspace_publication_review q JOIN workspace_pages p ON p.id=q.page_id JOIN workspace_page_revisions r ON r.page_id=p.id WHERE q.page_id=?').get(page);
        if (!pending || pending.status!=='pending' || pending.revision!==pending.current_revision || pending.release_id!==pending.current_release || publicPage(page)) throw new WorkspaceError('CONFLICT');
        const status=decision==='approve'?'approved':'rejected';
        db.prepare('UPDATE workspace_publication_review SET status=?,comment=?,decided_by=?,updated_at=? WHERE page_id=?').run(status,comment,actor,new Date().toISOString(),page);
        if (decision==='approve') { db.prepare('INSERT INTO workspace_page_visibility VALUES (?)').run(page); db.prepare('UPDATE workspace_pages SET updated_at=? WHERE workspace_id=? AND id=?').run(new Date().toISOString(),workspace,page); }
        audit(workspace,actor,`page.review_${status}`,page); return {visibility:decision==='approve'?'public':'private',review:review(page)};
      });
    }
  };
}
