// Main Routes Index
import express from 'express';
import productRoutes from './productRoutes.js';
import saleRoutes from './saleRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';
import clientRoutes from './clientRoutes.js';
import scheduleRoutes from './scheduleRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import expenseRoutes from './expenseRoutes.js';
import recurringExpenseRoutes from './recurringExpenseRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';

const router = express.Router();

// API Routes
router.use('/products', productRoutes);
router.use('/sales', saleRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/clients', clientRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/services', serviceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/expenses', expenseRoutes);
router.use('/recurring-expenses', recurringExpenseRoutes);
router.use('/inventories', inventoryRoutes);

export default router;
