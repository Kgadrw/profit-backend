// Barber Routes
import express from 'express';
import {
  getBarbers,
  getBarber,
  createBarber,
  updateBarber,
  deleteBarber,
} from '../controllers/barberController.js';

const router = express.Router();

router.get('/', getBarbers);
router.get('/:id', getBarber);
router.post('/', createBarber);
router.put('/:id', updateBarber);
router.delete('/:id', deleteBarber);

export default router;
