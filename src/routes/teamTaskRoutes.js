import express from 'express';
import {
  getTeamTasks,
  getTeamTask,
  getTeamTaskSummary,
  createTeamTask,
  updateTeamTask,
  completeTeamTask,
  deleteTeamTask,
} from '../controllers/teamTaskController.js';
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

router.get('/summary', getTeamTaskSummary);
router.get('/', getTeamTasks);
router.get('/:id', validateObjectId, getTeamTask);
router.post('/', createTeamTask);
router.put('/:id', validateObjectId, updateTeamTask);
router.post('/:id/complete', validateObjectId, completeTeamTask);
router.delete('/:id', validateObjectId, deleteTeamTask);

export default router;
