import express from 'express';
import {
  getBookings,
  createBooking,
  updateBooking,
  deleteBooking,
} from '../controllers/bookingController.js';
import { apiLimiter } from '../middleware/security.js';
import { validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';

const router = express.Router();

router.use(authenticateUser);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', getBookings);
router.post('/', createBooking);
router.put('/:id', validateObjectId, updateBooking);
router.delete('/:id', validateObjectId, deleteBooking);

export default router;
