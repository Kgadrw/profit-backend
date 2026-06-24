import express from 'express';
import {
  getInvoices,
  getInvoice,
  getInvoiceSummary,
  createInvoice,
  updateInvoice,
  markInvoiceSent,
  markInvoicePaid,
  deleteInvoice,
} from '../controllers/invoiceController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getInvoiceSummary);
router.get('/', getInvoices);
router.get('/:id', getInvoice);
router.post('/', createInvoice);
router.put('/:id', updateInvoice);
router.post('/:id/mark-sent', markInvoiceSent);
router.post('/:id/mark-paid', markInvoicePaid);
router.delete('/:id', deleteInvoice);

export default router;
