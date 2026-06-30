import express from 'express';
import {
  getCrmSummary,
  getCrmContacts,
  createCrmContact,
  updateCrmContact,
  getCrmContactProfile,
  getDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  getQuotes,
  createQuote,
  updateQuote,
  deleteQuote,
  convertQuoteToInvoice,
  getContracts,
  createContract,
  updateContract,
  deleteContract,
  createCrmActivity,
  deleteCrmActivity,
} from '../controllers/crmController.js';
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

router.get('/summary', getCrmSummary);

router.get('/contacts', getCrmContacts);
router.post('/contacts', createCrmContact);
router.get('/contacts/:id/profile', validateObjectId, getCrmContactProfile);
router.put('/contacts/:id', validateObjectId, updateCrmContact);

router.get('/deals', getDeals);
router.post('/deals', createDeal);
router.put('/deals/:id', validateObjectId, updateDeal);
router.delete('/deals/:id', validateObjectId, deleteDeal);

router.get('/quotes', getQuotes);
router.post('/quotes', createQuote);
router.put('/quotes/:id', validateObjectId, updateQuote);
router.delete('/quotes/:id', validateObjectId, deleteQuote);
router.post('/quotes/:id/convert-invoice', validateObjectId, convertQuoteToInvoice);

router.get('/contracts', getContracts);
router.post('/contracts', createContract);
router.put('/contracts/:id', validateObjectId, updateContract);
router.delete('/contracts/:id', validateObjectId, deleteContract);

router.post('/activities', createCrmActivity);
router.delete('/activities/:id', validateObjectId, deleteCrmActivity);

export default router;
