import express from 'express';
import {
  getRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  markRecurringExpensePaid,
} from '../controllers/recurringExpenseController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { validateObjectId, validateRecurringExpense } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(apiLimiter);

router.get('/', getRecurringExpenses);
router.post('/', validateRecurringExpense, createRecurringExpense);
router.put('/:id', validateObjectId, validateRecurringExpense, updateRecurringExpense);
router.delete('/:id', validateObjectId, deleteRecurringExpense);
router.post('/:id/mark-paid', validateObjectId, markRecurringExpensePaid);

export default router;
