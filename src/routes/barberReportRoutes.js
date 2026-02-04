// Barber Report Routes
import express from 'express';
import {
  getDailyBarberReport,
  getBarberSales,
  getBarberStats,
} from '../controllers/barberReportController.js';

const router = express.Router();

router.get('/daily', getDailyBarberReport);
router.get('/barber/:barberId/sales', getBarberSales);
router.get('/barber/:barberId/stats', getBarberStats);

export default router;
