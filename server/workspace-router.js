import { Router } from 'express';
import { WorkspaceError } from './workspaces.js';

// Per-process default: ten submissions per authenticated user per ten minutes.
// Deployments with multiple instances should inject a shared-store middleware.
function defaultJoinRequestLimiter() {
  const records = new Map();
  const windowMs = 10 * 60 * 1000;
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, record] of records) if (record.until <= now) records.delete(key);
    const key = req.user.id;
    let record = records.get(key);
    if (!record) {
      if (records.size >= 10000) return res.status(429).json({ code: 'RATE_LIMITED', error: 'Too many requests' });
      record = { count: 0, until: now + windowMs }; records.set(key, record);
    }
    if (record.count >= 10) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((record.until - now) / 1000))));
      return res.status(429).json({ code: 'RATE_LIMITED', error: 'Too many requests' });
    }
    record.count++;
    next();
  };
}

/**
 * Mount at an application-selected prefix, after JSON parsing. `requireUser`
 * must authenticate and populate req.user.id; `joinRequestLimiter` is an
 * optional Express middleware invoked after authentication on submissions.
 * `service` is the result of createWorkspaceService(db).
 */
export function createWorkspaceRouter({ service, requireUser, joinRequestLimiter = defaultJoinRequestLimiter() }) {
  if (!service || typeof requireUser !== 'function' || typeof joinRequestLimiter !== 'function') {
    throw new TypeError('service, requireUser and a valid joinRequestLimiter are required');
  }
  const router = Router();
  router.use(requireUser);
  router.use((req, res, next) => {
    if (typeof req.user?.id !== 'string' || !req.user.id) return res.status(401).json({ code: 'UNAUTHORIZED', error: 'Unauthorized' });
    next();
  });
  router.get('/', (req, res) => res.json(service.listWorkspaces(req.user.id)));
  router.post('/', (req, res) => res.status(201).json(service.createWorkspace(req.user.id, {
    type: req.body?.type, name: req.body?.name
  })));
  router.post('/join-requests', joinRequestLimiter, (req, res) => res.status(201).json(service.submitJoinRequest(req.body?.token, req.user.id)));
  router.post('/:workspaceId/leave', (req,res) => { service.leave(req.params.workspaceId,req.user.id);res.sendStatus(204); });
  router.get('/:workspaceId/members', (req, res) => res.json(service.listMembers(req.params.workspaceId, req.user.id)));
  router.get('/:workspaceId/audit', (req,res) => res.json(service.listAudit(req.params.workspaceId,req.user.id)));
  router.get('/:workspaceId/audit/before/:id', (req,res) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({code:'INVALID'});
    return res.json(service.listAudit(req.params.workspaceId,req.user.id,Number(req.params.id)));
  });
  router.get('/:workspaceId/join-requests', (req, res) => res.json(service.listRequests(req.params.workspaceId, req.user.id)));
  router.post('/:workspaceId/join-link', (req, res) => {
    const token = service.resetJoinLink(req.params.workspaceId, req.user.id);
    res.set('Cache-Control', 'no-store').status(201).json({ token });
  });
  router.delete('/:workspaceId/join-link', (req, res) => {
    service.revokeJoinLink(req.params.workspaceId, req.user.id); res.sendStatus(204);
  });
  router.post('/:workspaceId/join-requests/:requestId/approve', (req, res) => {
    service.approveJoinRequest(req.params.workspaceId, req.user.id, req.params.requestId, req.body?.role); res.sendStatus(204);
  });
  router.post('/:workspaceId/join-requests/:requestId/reject', (req, res) => {
    service.rejectJoinRequest(req.params.workspaceId, req.user.id, req.params.requestId); res.sendStatus(204);
  });
  router.patch('/:workspaceId/members/:userId', (req, res) => {
    service.changeRole(req.params.workspaceId, req.user.id, req.params.userId, req.body?.role); res.sendStatus(204);
  });
  router.delete('/:workspaceId/members/:userId', (req, res) => {
    service.removeMember(req.params.workspaceId, req.user.id, req.params.userId); res.sendStatus(204);
  });
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const statuses = { INVALID: 400, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, LAST_OWNER: 409 };
    if (error instanceof WorkspaceError && Object.hasOwn(statuses, error.code)) {
      return res.status(statuses[error.code]).json({ code: error.code, error: error.code });
    }
    return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'An unexpected error occurred' });
  });
  return router;
}
