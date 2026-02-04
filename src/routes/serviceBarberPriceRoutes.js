// Service-Barber Price Routes
import express from 'express';
import {
  getPrices,
  getPrice,
  setPrice,
  bulkSetPrices,
  deletePrice,
} from '../controllers/serviceBarberPriceController.js';

const router = express.Router();

router.get('/', getPrices);
router.get('/:serviceId/:barberId', getPrice);
router.post('/', setPrice);
router.post('/bulk', bulkSetPrices);
router.delete('/:serviceId/:barberId', deletePrice);

export default router;
