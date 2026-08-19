import express from 'express';
import {
  requestCloseProject,
  requestDeadlineExtension,
  getProjectApprovals,
  getProjectApprovalsByProject,
  respondToProjectApproval,
} from '../controllers/projectApprovalController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', getProjectApprovals);
router.get('/project/:projectId', getProjectApprovalsByProject);
router.post('/close/:projectId', requestCloseProject);
router.post('/extend-deadline/:projectId', requestDeadlineExtension);
router.post('/:id/respond', respondToProjectApproval);

export default router;
