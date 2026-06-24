import express from 'express';
import {
  getCategoryBudgets,
  createCategoryBudget,
  updateCategoryBudget,
  deleteCategoryBudget,
  getCategoryBudgetSummary,
} from '../controllers/categoryBudgetController.js';
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

router.get('/summary', getCategoryBudgetSummary);
router.get('/', getCategoryBudgets);
router.post('/', createCategoryBudget);
router.put('/:id', validateObjectId, updateCategoryBudget);
router.delete('/:id', validateObjectId, deleteCategoryBudget);

export default router;
