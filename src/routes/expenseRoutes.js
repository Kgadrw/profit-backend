import express from 'express';
import {
  getExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
} from '../controllers/expenseController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { validateObjectId, validateDateRange, validateExpense } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(apiLimiter);

router.get('/', validateDateRange, getExpenses);
router.get('/:id', validateObjectId, getExpense);
router.post('/', validateExpense, createExpense);
router.put('/:id', validateObjectId, validateExpense, updateExpense);
router.delete('/:id', validateObjectId, deleteExpense);

export default router;

