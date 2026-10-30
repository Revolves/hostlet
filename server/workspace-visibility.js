import { WorkspaceError } from './workspaces.js';

// Public access is opt-in; absence of a row always means private.
export const workspaceVisibilitySchema = `
CREATE TABLE workspace_page_visibility (
 page_id TEXT PRIMARY KEY REFERENCES workspace_pages(id) ON DELETE CASCADE
);
`;

export function createWorkspaceVisibilityService({ db, authorize, audit = () => {} }) {
  if (!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 || typeof authorize !== 'function' || typeof audit !== 'function') throw new TypeError('Invalid visibility configuration');
  const find = (workspace, page) => {
    const row = db.prepare('SELECT id FROM workspace_pages WHERE workspace_id=? AND id=?').get(workspace, page);
    if (!row) throw new WorkspaceError('NOT_FOUND');
    return row;
  };
  const publicPage = page => db.prepare('SELECT p.* FROM workspace_pages p JOIN workspace_page_visibility v ON v.page_id=p.id WHERE p.id=?').get(page) || null;
  return {
    publicPage,
    get(workspace, actor, page) {
      authorize(workspace, actor, 'view'); find(workspace, page);
      return { visibility: publicPage(page) ? 'public' : 'private' };
    },
    set(workspace, actor, page, visibility) {
      if (!['public', 'private'].includes(visibility)) throw new WorkspaceError('INVALID');
      db.exec('BEGIN IMMEDIATE');
      try {
        authorize(workspace, actor, 'edit'); find(workspace, page);
        const changed=visibility === 'public' ? db.prepare('INSERT OR IGNORE INTO workspace_page_visibility VALUES (?)').run(page) : db.prepare('DELETE FROM workspace_page_visibility WHERE page_id=?').run(page);
        if (changed.changes) { db.prepare('UPDATE workspace_pages SET updated_at=? WHERE workspace_id=? AND id=?').run(new Date().toISOString(),workspace,page); audit(workspace,actor,`page.visibility_${visibility}`,page); }
        db.exec('COMMIT');
        return { visibility };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
}
