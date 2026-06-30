import express from 'express';
import {
  getPushVapidPublicKey,
  subscribePush,
  unsubscribePush,
} from '../controllers/pushController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/vapid-public-key', rateLimiters.general, getPushVapidPublicKey);

router.use(authenticateUser);
router.use(rateLimiters.general);

router.post('/subscribe', subscribePush);
router.delete('/subscribe', unsubscribePush);

export default router;
