import express from 'express';
import {
  getLeaveRequests,
  getLeaveSummary,
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  deleteLeaveRequest,
} from '../controllers/leaveRequestController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { validateObjectId } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getLeaveSummary);
router.get('/', getLeaveRequests);
router.post('/', createLeaveRequest);
router.post('/:id/approve', validateObjectId, approveLeaveRequest);
router.post('/:id/reject', validateObjectId, rejectLeaveRequest);
router.post('/:id/cancel', validateObjectId, cancelLeaveRequest);
router.delete('/:id', validateObjectId, deleteLeaveRequest);

export default router;
