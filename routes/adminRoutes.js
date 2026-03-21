import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middlewares/auth.js';
import { getManagedUsers, createUserByAdmin, updateUserRole, deleteUserByAdmin } from '../controllers/adminController.js';

const router = Router();

router.use(authenticate);
router.use(authorizeRoles('admin', 'superadmin'));

router.get('/users', getManagedUsers);
router.post('/users', createUserByAdmin);
router.patch('/users/:id/role', updateUserRole);
router.delete('/users/:id', deleteUserByAdmin);

export { router as adminRoutes };
