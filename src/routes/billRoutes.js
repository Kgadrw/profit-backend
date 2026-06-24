import express from 'express';
import {
  getBills,
  getBill,
  createBill,
  updateBill,
  markBillPaid,
  deleteBill,
} from '../controllers/billController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { validateObjectId, validateDateRange, validateBill, validateMarkBillPaid } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', validateDateRange, getBills);
router.get('/:id', validateObjectId, getBill);
router.post('/', validateBill, createBill);
router.put('/:id', validateObjectId, validateBill, updateBill);
router.post('/:id/mark-paid', validateObjectId, validateMarkBillPaid, markBillPaid);
router.delete('/:id', validateObjectId, deleteBill);

export default router;
