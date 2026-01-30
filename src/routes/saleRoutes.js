// Sale Routes
import express from 'express';
import {
  getSales,
  getSale,
  createSale,
  createBulkSales,
  updateSale,
  deleteSale,
  deleteAllSales,
} from '../controllers/saleController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { validateSale, validateBulkSales, validateObjectId, validateDateRange } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// All sale routes require authentication and rate limiting
router.use(authenticateUser);
router.use(rateLimiters.sales);

router.get('/', validateDateRange, getSales);
router.get('/:id', validateObjectId, getSale);
router.post('/', validateSale, createSale);
router.post('/bulk', validateBulkSales, createBulkSales);
router.put('/:id', validateObjectId, validateSale, updateSale);
router.delete('/all', deleteAllSales);
router.delete('/:id', validateObjectId, deleteSale);

export default router;
