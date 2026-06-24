import express from 'express';
import {
  getLoans,
  getLoan,
  getLoanSummary,
  createLoan,
  updateLoan,
  recordLoanPayment,
  deleteLoan,
} from '../controllers/loanController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getLoanSummary);
router.get('/', getLoans);
router.get('/:id', getLoan);
router.post('/', createLoan);
router.put('/:id', updateLoan);
router.post('/:id/record-payment', recordLoanPayment);
router.delete('/:id', deleteLoan);

export default router;
