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

const router = express.Router();

router.get('/', getSales);
router.get('/:id', getSale);
router.post('/', createSale);
router.post('/bulk', createBulkSales);
router.put('/:id', updateSale);
router.delete('/all', deleteAllSales);
router.delete('/:id', deleteSale);

export default router;
