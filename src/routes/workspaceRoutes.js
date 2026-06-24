import express from 'express';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspaceMembers,
  inviteToWorkspace,
  previewWorkspaceInvite,
  acceptWorkspaceInvite,
  updateWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
} from '../controllers/workspaceController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/invites/:token', rateLimiters.general, previewWorkspaceInvite);

router.use(authenticateUser);
router.use(rateLimiters.general);

router.get('/', listWorkspaces);
router.post('/', createWorkspace);
router.get('/:workspaceId/members', getWorkspaceMembers);
router.post('/:workspaceId/invites', inviteToWorkspace);
router.post('/invites/:token/accept', acceptWorkspaceInvite);
router.patch('/:workspaceId/members/:memberId', updateWorkspaceMember);
router.delete('/:workspaceId/members/:memberId', removeWorkspaceMember);
router.delete('/:workspaceId/invites/:inviteId', revokeWorkspaceInvite);

export default router;
