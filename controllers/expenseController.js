import {
    insertExpense,
    importExpensesFromCsv,
    updateExpenseById,
    deleteExpenseById,
    listExcludedKeywords,
    addExcludedKeyword,
    removeExcludedKeyword,
} from '../services/expenseService.js';
import { parseBankCsv } from '../utils/csvParser.js';
import { AppError } from '../middlewares/errorHandler.js';

export async function createExpense(req, res, next) {
    try {
        const userId = req.user.id;
        const { title, amount, details, tag, category, paid_by_user_id, date } = req.body;

        if (userId !== Number(paid_by_user_id)) {
            throw new AppError('Vous ne pouvez pas créer une dépense pour un autre utilisateur', 403);
        }

        const result = await insertExpense({ title, amount, details, tag, category, paid_by_user_id, date });

        return res.status(201).json({
            message: result.isPendingValidation
                ? 'Dépense ajoutée en attente de validation.'
                : 'Dépense enregistrée avec succès !',
            isPendingValidation: result.isPendingValidation,
            category: result.category,
        });
    } catch (err) {
        next(err);
    }
}

export async function uploadBankCsv(req, res, next) {
    try {
        const userId = req.user.id;
        const filePath = req.file.path;

        console.log(`[Upload CSV] Fichier reçu: ${filePath} pour user_id=${userId}`);
        const rows = await parseBankCsv(filePath, userId);
        console.log(`[Upload CSV] ${rows.length} lignes parsées`);
        
        const { insertedCount, pendingCount } = await importExpensesFromCsv(rows, filePath);

        return res.status(200).json({
            message: `${insertedCount} lignes importées avec succès ! ${pendingCount} en attente de validation.`,
            insertedCount,
            pendingCount,
        });
    } catch (err) {
        console.error('[Upload CSV] Erreur globale:', err.message);
        next(err);
    }
}

export async function updateExpense(req, res, next) {
    try {
        const userId = req.user.id;
        const expenseId = Number(req.params.id);

        if (!Number.isInteger(expenseId)) {
            throw new AppError('ID de dépense invalide', 400);
        }

        const result = await updateExpenseById(userId, expenseId, req.body);

        return res.status(200).json({
            message: result.isPendingValidation
                ? 'Dépense modifiée, puis marquée en attente de validation (similarité détectée).'
                : 'Dépense modifiée avec succès.',
            expense: result.expense,
            isPendingValidation: result.isPendingValidation,
        });
    } catch (err) {
        next(err);
    }
}

export async function deleteExpense(req, res, next) {
    try {
        const userId = req.user.id;
        const expenseId = Number(req.params.id);

        if (!Number.isInteger(expenseId)) {
            throw new AppError('ID de dépense invalide', 400);
        }

        await deleteExpenseById(userId, expenseId);

        return res.status(200).json({ message: 'Dépense supprimée avec succès.' });
    } catch (err) {
        next(err);
    }
}

export async function getExcludedKeywords(req, res, next) {
    try {
        const keywords = await listExcludedKeywords(req.user.id);
        return res.status(200).json({ keywords });
    } catch (err) {
        next(err);
    }
}

export async function createExcludedKeyword(req, res, next) {
    try {
        const keyword = await addExcludedKeyword(req.user.id, req.body?.keyword);
        return res.status(201).json({
            message: 'Mot-clé exclu ajouté',
            keyword,
        });
    } catch (err) {
        next(err);
    }
}

export async function deleteExcludedKeyword(req, res, next) {
    try {
        const keywordId = Number(req.params.id);
        if (!Number.isInteger(keywordId)) {
            throw new AppError('ID de mot-clé invalide', 400);
        }

        await removeExcludedKeyword(req.user.id, keywordId);
        return res.status(200).json({ message: 'Mot-clé exclu supprimé' });
    } catch (err) {
        next(err);
    }
}
