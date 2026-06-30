import express from 'express';
import {
  getTeamMembers,
  getTeamMember,
  getTeamMemberProfile,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from '../controllers/teamMemberController.js';
import { apiLimiter } from '../middleware/security.js';
import { validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', getTeamMembers);
router.get('/:id/profile', validateObjectId, getTeamMemberProfile);
router.get('/:id', validateObjectId, getTeamMember);
router.post('/', createTeamMember);
router.put('/:id', validateObjectId, updateTeamMember);
router.delete('/:id', validateObjectId, deleteTeamMember);

export default router;
