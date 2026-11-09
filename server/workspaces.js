import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const workspaceAuditSchema = `
CREATE TABLE IF NOT EXISTS workspace_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id), role TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_audit_order ON workspace_audit(workspace_id,id DESC);
`;
export const workspaceAuditPageSchema = `
ALTER TABLE workspace_audit ADD COLUMN page_id TEXT;
ALTER TABLE workspace_audit ADD COLUMN resource_id TEXT;
`;
// Compose into a migration after creating users(id TEXT PRIMARY KEY). Enable
// PRAGMA foreign_keys=ON on every connection before using this service.
export const workspaceBaseSchema = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('personal','team')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX workspace_one_personal ON workspaces(created_by) WHERE type='personal';
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE workspace_join_links (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE workspace_join_requests (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX workspace_one_pending ON workspace_join_requests(workspace_id,user_id) WHERE status='pending';
`;
export const workspaceSchema = workspaceBaseSchema + workspaceAuditSchema + workspaceAuditPageSchema;

export class WorkspaceError extends Error {
  constructor(code, message = code) { super(message); this.name = 'WorkspaceError'; this.code = code; }
}
const fail = code => { throw new WorkspaceError(code); };
const roles = new Set(['owner', 'editor', 'viewer']);
const permissions = { view: ['owner', 'editor', 'viewer'], edit: ['owner', 'editor'], manage: ['owner'] };
const hash = token => createHash('sha256').update(token).digest('hex');
const now = () => new Date().toISOString();
const validId = id => typeof id === 'string' && id.length > 0;
const displayEmail = alias => `CASE WHEN ${alias}.email LIKE '%@users.hostlet.invalid' THEN substr(${alias}.email,1,instr(${alias}.email,'@')-1) ELSE ${alias}.email END`;

/**
 * Synchronous service over node:sqlite DatabaseSync. All mutators take an
 * authenticated user id as actor; never accept that id from untrusted input.
 * Mutations use BEGIN IMMEDIATE; call outside any existing transaction and
 * configure busy_timeout on the connection to suit the host application.
 * API: createWorkspace(actor,{type,name}); authorize(workspace,actor,permission)
 * (view/edit/manage); resetJoinLink/revokeJoinLink(workspace,actor);
 * submitJoinRequest(token,actor); approveJoinRequest(workspace,actor,request,role);
 * rejectJoinRequest(workspace,actor,request); changeRole/removeMember(workspace,actor,target); leave(workspace,actor).
 * listWorkspaces(actor); listMembers/listRequests(workspace,actor).
 * resetJoinLink returns the sole plaintext token; store/send it securely and
 * never log it. Errors expose code INVALID, NOT_FOUND, FORBIDDEN, CONFLICT,
 * or LAST_OWNER. Authentication, rate limiting and app-resource transactions
 * are the caller's responsibility. Recheck authorization inside any resource
 * mutation's own transaction to avoid a check/use race.
 */
export function createWorkspaceService(db) {
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('foreign_keys must be enabled');
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const audit = (workspaceId,actor,action,target=null,role=null) => run('INSERT INTO workspace_audit (workspace_id,actor_id,action,target_user_id,role,created_at) VALUES (?,?,?,?,?,?)',workspaceId,actor,action,target,role,now());
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const user = id => { if (!validId(id)) fail('INVALID'); if (!q('SELECT 1 FROM users WHERE id=?', id)) fail('NOT_FOUND'); };
  const workspace = id => { if (!validId(id)) fail('INVALID'); const w = q('SELECT * FROM workspaces WHERE id=?', id); if (!w) fail('NOT_FOUND'); return w; };
  const authorize = (id, actor, permission) => {
    if (!Object.hasOwn(permissions, permission) || !validId(id) || !validId(actor)) fail('INVALID');
    const member = q('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?', id, actor);
    if (!member || !permissions[permission].includes(member.role)) fail('FORBIDDEN');
    return member.role;
  };
  const team = id => { const w = workspace(id); if (w.type !== 'team') fail('INVALID'); return w; };
  const member = (id, target) => { if (!validId(target)) fail('INVALID'); const m = q('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?', id, target); if (!m) fail('NOT_FOUND'); return m; };
  const protectOwner = (id, m) => { if (m.role === 'owner' && q("SELECT count(*) AS n FROM workspace_members WHERE workspace_id=? AND role='owner'", id).n <= 1) fail('LAST_OWNER'); };
  const request = (id, requestId) => { if (!validId(requestId)) fail('INVALID'); const r = q('SELECT * FROM workspace_join_requests WHERE workspace_id=? AND id=?', id, requestId); if (!r) fail('NOT_FOUND'); if (r.status !== 'pending') fail('CONFLICT'); return r; };
  return {
    authorize,
    recordPageAudit(workspace,actor,action,pageId,resourceId=null) {
      if (![workspace,actor,action,pageId].every(validId) || (resourceId !== null && !validId(resourceId))) fail('INVALID');
      run('INSERT INTO workspace_audit (workspace_id,actor_id,action,created_at,page_id,resource_id) VALUES (?,?,?,?,?,?)',workspace,actor,action,now(),pageId,resourceId);
    },
    listAudit(id,actor,before=null) { return tx(()=>{
      authorize(id,actor,'manage');
      if (before !== null && (!Number.isSafeInteger(before) || before < 1)) fail('INVALID');
      return db.prepare(`SELECT a.id,a.action,a.actor_id AS actorId,${displayEmail('actor')} AS actorEmail,a.target_user_id AS targetUserId,${displayEmail('target')} AS targetEmail,a.role,a.page_id AS pageId,a.resource_id AS resourceId,a.created_at AS createdAt FROM workspace_audit a JOIN users actor ON actor.id=a.actor_id LEFT JOIN users target ON target.id=a.target_user_id WHERE a.workspace_id=? AND (? IS NULL OR a.id<?) ORDER BY a.id DESC LIMIT 100`).all(id,before,before).map(row=>({...row}));
    }); },
    listWorkspaces(actor) {
      user(actor);
      return db.prepare('SELECT w.id,w.name,w.type,w.created_by AS createdBy,w.created_at AS createdAt,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at,w.id').all(actor);
    },
    listMembers(id, actor) { return tx(() => {
      authorize(id, actor, 'view');
      return db.prepare(`SELECT m.user_id AS userId,${displayEmail('u')} AS email,m.role,m.created_at AS createdAt FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,m.user_id`).all(id);
    }); },
    listRequests(id, actor) { return tx(() => {
      authorize(id, actor, 'manage'); team(id);
      return db.prepare(`SELECT r.id,r.user_id AS userId,${displayEmail('u')} AS email,r.status,r.created_at AS createdAt,r.decided_at AS decidedAt,r.decided_by AS decidedBy FROM workspace_join_requests r JOIN users u ON u.id=r.user_id WHERE r.workspace_id=? ORDER BY r.created_at,r.id`).all(id);
    }); },
    createWorkspace(actor, { type, name } = {}) {
      if (!['personal', 'team'].includes(type) || typeof name !== 'string' || !name.trim() || name.length > 200) fail('INVALID');
      return tx(() => {
        user(actor);
        if (type === 'personal' && q("SELECT 1 FROM workspaces WHERE type='personal' AND created_by=?", actor)) fail('CONFLICT');
        const id = randomUUID(), createdAt = now();
        run('INSERT INTO workspaces VALUES (?,?,?,?,?)', id, name.trim(), type, actor, createdAt);
        run('INSERT INTO workspace_members VALUES (?,?,?,?)', id, actor, 'owner', createdAt);
      audit(id,actor,'workspace.created');
        return { id, name: name.trim(), type, createdBy: actor, createdAt };
      });
    },
    resetJoinLink(id, actor) { return tx(() => {
      authorize(id, actor, 'manage'); team(id);
      const token = randomBytes(32).toString('base64url');
      run('INSERT INTO workspace_join_links VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET token_hash=excluded.token_hash, created_at=excluded.created_at', id, hash(token), now());
      audit(id,actor,'join_link.created');
      return token;
    }); },
    revokeJoinLink(id, actor) { return tx(() => { authorize(id, actor, 'manage'); team(id); if (run('DELETE FROM workspace_join_links WHERE workspace_id=?', id).changes) audit(id,actor,'join_link.revoked'); }); },
    submitJoinRequest(token, actor) { return tx(() => {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('NOT_FOUND');
      user(actor);
      const link = q('SELECT workspace_id FROM workspace_join_links WHERE token_hash=?', hash(token));
      if (!link) fail('NOT_FOUND');
      const id = link.workspace_id;
      if (q('SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?', id, actor) || q("SELECT 1 FROM workspace_join_requests WHERE workspace_id=? AND user_id=? AND status='pending'", id, actor)) fail('CONFLICT');
      const requestId = randomUUID(), createdAt = now();
      run("INSERT INTO workspace_join_requests (id,workspace_id,user_id,status,created_at) VALUES (?,?,?,'pending',?)", requestId, id, actor, createdAt);
      audit(id,actor,'join_request.submitted',actor);
      return { id: requestId, workspaceId: id, userId: actor, status: 'pending', createdAt };
    }); },
    approveJoinRequest(id, actor, requestId, role) { return tx(() => {
      authorize(id, actor, 'manage'); team(id); if (!roles.has(role)) fail('INVALID');
      const r = request(id, requestId);
      if (q('SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?', id, r.user_id)) fail('CONFLICT');
      const at = now(); run('INSERT INTO workspace_members VALUES (?,?,?,?)', id, r.user_id, role, at);
      run("UPDATE workspace_join_requests SET status='approved',decided_at=?,decided_by=? WHERE id=?", at, actor, requestId);
      audit(id,actor,'join_request.approved',r.user_id,role);
    }); },
    rejectJoinRequest(id, actor, requestId) { return tx(() => {
      authorize(id, actor, 'manage'); team(id); const r=request(id, requestId);
      run("UPDATE workspace_join_requests SET status='rejected',decided_at=?,decided_by=? WHERE id=?", now(), actor, requestId);
      audit(id,actor,'join_request.rejected',r.user_id);
    }); },
    changeRole(id, actor, target, role) { return tx(() => {
      authorize(id, actor, 'manage'); team(id); if (!roles.has(role)) fail('INVALID');
      const m = member(id, target); if (role !== 'owner') protectOwner(id, m);
      run('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?', role, id, target);
      if (m.role !== role) audit(id,actor,'member.role_changed',target,role);
    }); },
    removeMember(id, actor, target) { return tx(() => {
      authorize(id, actor, 'manage'); team(id); const m = member(id, target); protectOwner(id, m);
      run('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?', id, target);
      audit(id,actor,'member.removed',target,m.role);
    }); },
    leave(id, actor) { return tx(() => {
      authorize(id,actor,'view');team(id);const m=member(id,actor);protectOwner(id,m);
      run('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?',id,actor);
      audit(id,actor,'member.left',actor,m.role);
    }); }
  };
}
