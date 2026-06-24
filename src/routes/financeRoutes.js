import express from 'express';
import {
  getFinanceSummary,
  getIncomeBySource,
  getTransactions,
  getProfitLoss,
  getBalanceSheet,
  getCashFlow,
} from '../controllers/financeController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getFinanceSummary);
router.get('/income-by-source', getIncomeBySource);
router.get('/transactions', getTransactions);
router.get('/statements/profit-loss', getProfitLoss);
router.get('/statements/balance-sheet', getBalanceSheet);
router.get('/statements/cash-flow', getCashFlow);

export default router;
