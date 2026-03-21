import { Router } from 'express';
import { login, me, changePassword } from '../controllers/authController.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.post('/login', login);
router.get('/me', authenticate, me);
router.post('/change-password', authenticate, changePassword);

export { router as authRoutes };
