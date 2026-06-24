import express from 'express';
import {
  getAccounts,
  getAccount,
  getAccountActivity,
  getAccountReconciliation,
  toggleReconciliation,
  createAccount,
  updateAccount,
  deleteAccount,
  createTransfer,
  getTransfers,
} from '../controllers/accountController.js';
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

router.get('/', getAccounts);
router.get('/transfers/list', getTransfers);
router.post('/transfers', createTransfer);
router.patch('/reconciliation/toggle', toggleReconciliation);
router.get('/:id/reconciliation', validateObjectId, getAccountReconciliation);
router.get('/:id/activity', validateObjectId, getAccountActivity);
router.get('/:id', validateObjectId, getAccount);
router.post('/', createAccount);
router.put('/:id', validateObjectId, updateAccount);
router.delete('/:id', validateObjectId, deleteAccount);

export default router;
