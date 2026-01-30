// Product Routes
import express from 'express';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/productController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { validateProduct, validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// All product routes require authentication and rate limiting
router.use(authenticateUser);
router.use(rateLimiters.products);

router.get('/', getProducts);
router.get('/:id', validateObjectId, getProduct);
router.post('/', validateProduct, createProduct);
router.put('/:id', validateObjectId, validateProduct, updateProduct);
router.delete('/:id', validateObjectId, deleteProduct);

export default router;
