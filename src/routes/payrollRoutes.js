import express from 'express';
import {
  getPayrolls,
  getPayroll,
  createPayroll,
  updatePayroll,
  deletePayroll,
} from '../controllers/payrollController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { validateObjectId, validateDateRange, validatePayroll } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', validateDateRange, getPayrolls);
router.get('/:id', validateObjectId, getPayroll);
router.post('/', validatePayroll, createPayroll);
router.put('/:id', validateObjectId, validatePayroll, updatePayroll);
router.delete('/:id', validateObjectId, deletePayroll);

export default router;
