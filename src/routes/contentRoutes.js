import express from 'express';
import { getPublicHomepage } from '../controllers/homepageController.js';

const router = express.Router();

router.get('/homepage', getPublicHomepage);

export default router;
