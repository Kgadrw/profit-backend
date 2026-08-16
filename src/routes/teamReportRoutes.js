import express from 'express';
import {
  getTeamReports,
  getTeamReportSummary,
  createTeamReport,
  updateTeamReport,
  reviewTeamReport,
  rejectTeamReport,
  requestTeamReportChanges,
  resubmitTeamReport,
  deleteTeamReport,
} from '../controllers/teamReportController.js';
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

router.get('/summary', getTeamReportSummary);
router.get('/', getTeamReports);
router.post('/', createTeamReport);
router.put('/:id', validateObjectId, updateTeamReport);
router.post('/:id/review', validateObjectId, reviewTeamReport);
router.post('/:id/reject', validateObjectId, rejectTeamReport);
router.post('/:id/request-changes', validateObjectId, requestTeamReportChanges);
router.post('/:id/resubmit', validateObjectId, resubmitTeamReport);
router.delete('/:id', validateObjectId, deleteTeamReport);

export default router;
