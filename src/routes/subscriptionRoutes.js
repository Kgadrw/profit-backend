import express from 'express';
import {
  getSubscriptionStatus,
  initiateSubscriptionPayment,
  getSubscriptionPaymentStatus,
  mtnPaymentCallback,
} from '../controllers/subscriptionController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/callback', rateLimiters.general, mtnPaymentCallback);

router.get('/status', authenticateUser, getSubscriptionStatus);
router.post('/pay', authenticateUser, rateLimiters.general, initiateSubscriptionPayment);
router.get('/payments/:referenceId', authenticateUser, getSubscriptionPaymentStatus);

export default router;
