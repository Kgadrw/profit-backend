import express from 'express';
import {
  getBankDeposits,
  getBankDeposit,
  createBankDeposit,
  updateBankDeposit,
  deleteBankDeposit,
  getBankDepositSummary,
} from '../controllers/bankDepositController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getBankDepositSummary);
router.get('/', getBankDeposits);
router.get('/:id', getBankDeposit);
router.post('/', createBankDeposit);
router.put('/:id', updateBankDeposit);
router.delete('/:id', deleteBankDeposit);

export default router;
