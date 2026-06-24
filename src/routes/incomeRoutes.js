import express from 'express';
import {
  getIncomes,
  getIncome,
  createIncome,
  updateIncome,
  deleteIncome,
} from '../controllers/incomeController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { validateObjectId, validateDateRange, validateIncome } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', validateDateRange, getIncomes);
router.get('/:id', validateObjectId, getIncome);
router.post('/', validateIncome, createIncome);
router.put('/:id', validateObjectId, validateIncome, updateIncome);
router.delete('/:id', validateObjectId, deleteIncome);

export default router;
