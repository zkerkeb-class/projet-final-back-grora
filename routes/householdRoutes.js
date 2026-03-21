import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import {
    addMemberByEmail,
    createHousehold,
    getHousehold,
    leaveHousehold,
    removeMember,
} from '../controllers/householdController.js';

const router = Router();

router.use(authenticate);

router.get('/me', getHousehold);
router.post('/create', createHousehold);
router.post('/members', addMemberByEmail);
router.delete('/members/:userId', removeMember);
router.post('/leave', leaveHousehold);

export { router as householdRoutes };
