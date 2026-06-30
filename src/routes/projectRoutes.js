import express from 'express';
import {
  getProjects,
  getProjectsSummary,
  getProject,
  getProjectProfile,
  createProject,
  updateProject,
  deleteProject,
  createProjectMilestone,
  updateProjectMilestone,
  deleteProjectMilestone,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  addProjectMember,
  removeProjectMember,
  createTimeEntry,
  deleteTimeEntry,
} from '../controllers/projectController.js';
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

router.get('/summary', getProjectsSummary);
router.get('/', getProjects);
router.post('/', createProject);
router.get('/:id/profile', validateObjectId, getProjectProfile);
router.get('/:id', validateObjectId, getProject);
router.put('/:id', validateObjectId, updateProject);
router.delete('/:id', validateObjectId, deleteProject);

router.post('/:projectId/milestones', validateObjectId, createProjectMilestone);
router.put('/:projectId/milestones/:id', validateObjectId, updateProjectMilestone);
router.delete('/:projectId/milestones/:id', validateObjectId, deleteProjectMilestone);

router.post('/:projectId/tasks', validateObjectId, createProjectTask);
router.put('/:projectId/tasks/:id', validateObjectId, updateProjectTask);
router.delete('/:projectId/tasks/:id', validateObjectId, deleteProjectTask);

router.post('/:projectId/members', validateObjectId, addProjectMember);
router.delete('/:projectId/members/:id', validateObjectId, removeProjectMember);

router.post('/:projectId/time-entries', validateObjectId, createTimeEntry);
router.delete('/:projectId/time-entries/:id', validateObjectId, deleteTimeEntry);

export default router;
