import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { getDashboard } from '../controllers/dashboardController.js';
import { getStats } from '../controllers/statsController.js';

const router = Router();

router.get('/', authenticate, getDashboard);
router.get('/stats', authenticate, getStats);

export { router as dashboardRoutes };
