// Main Routes Index
import express from 'express';
import productRoutes from './productRoutes.js';
import saleRoutes from './saleRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';
import clientRoutes from './clientRoutes.js';
import scheduleRoutes from './scheduleRoutes.js';
import barberRoutes from './barberRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import serviceBarberPriceRoutes from './serviceBarberPriceRoutes.js';
import barberReportRoutes from './barberReportRoutes.js';
import barberAuthRoutes from './barberAuthRoutes.js';

const router = express.Router();

// API Routes
router.use('/products', productRoutes);
router.use('/sales', saleRoutes);
router.use('/auth', authRoutes);
router.use('/barber-auth', barberAuthRoutes);
router.use('/admin', adminRoutes);
router.use('/clients', clientRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/barbers', barberRoutes);
router.use('/services', serviceRoutes);
router.use('/service-barber-prices', serviceBarberPriceRoutes);
router.use('/barber-reports', barberReportRoutes);

export default router;
