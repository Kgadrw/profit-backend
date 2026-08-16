import express from 'express';
import { getMotivationalGreeting } from '../controllers/greetingController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.use(authenticateUser);
router.use(rateLimiters.general);

router.get('/motivational', getMotivationalGreeting);

export default router;
