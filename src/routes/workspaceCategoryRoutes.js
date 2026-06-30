import express from 'express';
import {
  getWorkspaceCategories,
  createWorkspaceCategory,
  updateWorkspaceCategory,
  deleteWorkspaceCategory,
} from '../controllers/workspaceCategoryController.js';
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

router.get('/', getWorkspaceCategories);
router.post('/', createWorkspaceCategory);
router.patch('/:id', validateObjectId, updateWorkspaceCategory);
router.delete('/:id', validateObjectId, deleteWorkspaceCategory);

export default router;
