import express from 'express';
import { getPublicHomepage } from '../controllers/homepageController.js';
import { getPublicPlatformContact } from '../controllers/platformContactController.js';

const router = express.Router();

router.get('/homepage', getPublicHomepage);
router.get('/contact', getPublicPlatformContact);

export default router;
