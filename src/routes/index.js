// Main Routes Index
import express from 'express';
import productRoutes from './productRoutes.js';
import saleRoutes from './saleRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';

const router = express.Router();

// API Routes
router.use('/products', productRoutes);
router.use('/sales', saleRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);

export default router;
