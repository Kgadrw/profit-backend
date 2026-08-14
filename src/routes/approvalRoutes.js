import express from 'express';
import {
  getApprovalQueue,
  getApprovalSummary,
  approveRecord,
  rejectRecord,
  requestChangesRecord,
  resubmitRecord,
} from '../controllers/approvalController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getApprovalSummary);
router.get('/', getApprovalQueue);
router.post('/:entityType/:id/approve', approveRecord);
router.post('/:entityType/:id/reject', rejectRecord);
router.post('/:entityType/:id/request-changes', requestChangesRecord);
router.post('/:entityType/:id/resubmit', resubmitRecord);

export default router;
