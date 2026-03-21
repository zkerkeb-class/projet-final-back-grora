import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import {
	createExpense,
	uploadBankCsv,
	updateExpense,
	deleteExpense,
	getExcludedKeywords,
	createExcludedKeyword,
	deleteExcludedKeyword,
} from '../controllers/expenseController.js';
import { upload } from '../config/multer.js';

const router = Router();

router.post('/', authenticate, createExpense);
router.get('/excluded-keywords', authenticate, getExcludedKeywords);
router.post('/excluded-keywords', authenticate, createExcludedKeyword);
router.delete('/excluded-keywords/:id', authenticate, deleteExcludedKeyword);
router.post('/upload-csv', authenticate, upload.single('file'), uploadBankCsv);
router.patch('/:id', authenticate, updateExpense);
router.delete('/:id', authenticate, deleteExpense);

export { router as expenseRoutes };
