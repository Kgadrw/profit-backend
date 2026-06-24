import express from 'express';
import {
  getTaxes,
  getTax,
  createTax,
  updateTax,
  markTaxPaid,
  deleteTax,
} from '../controllers/taxController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', getTaxes);
router.get('/:id', getTax);
router.post('/', createTax);
router.put('/:id', updateTax);
router.post('/:id/mark-paid', markTaxPaid);
router.delete('/:id', deleteTax);

export default router;
