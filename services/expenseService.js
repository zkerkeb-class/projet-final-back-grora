import fs from 'fs';
import { connectDB } from '../connect.js';
import { AppError } from '../middlewares/errorHandler.js';

const CATEGORY_PERSO = 'PERSO';
const CATEGORY_COMMUN = 'COMMUN';
const CATEGORY_PENDING = 'EN_ATTENTE_VALIDATION';

let isCategoryConstraintReady = false;
let isExcludedKeywordSchemaReady = false;

function normalizeCategory(category) {
    if (category === CATEGORY_COMMUN) return CATEGORY_COMMUN;
    if (category === CATEGORY_PENDING) return CATEGORY_PENDING;
    return CATEGORY_PERSO;
}

async function ensureCategoryConstraint(db) {
    if (isCategoryConstraintReady) return;

    // Étendre la colonne pour accommoder 'EN_ATTENTE_VALIDATION' (19 caractères)
    try {
        await db.query(`
            ALTER TABLE expenses
            ALTER COLUMN category TYPE VARCHAR(25)
        `);
        console.log('[DB Migration] Colonne category agrandie à VARCHAR(25)');
    } catch (e) {
        // Colonne déjà agrandie ou autre raison
        console.log('[DB Migration] Colonne category déjà à la bonne taille ou déjà modifiée');
    }

    await db.query(`
        ALTER TABLE expenses
        DROP CONSTRAINT IF EXISTS expenses_category_check
    `);

    await db.query(`
        ALTER TABLE expenses
        ADD CONSTRAINT expenses_category_check
        CHECK (category IN ('PERSO', 'COMMUN', 'EN_ATTENTE_VALIDATION'))
    `);

    isCategoryConstraintReady = true;
}

async function ensureExcludedKeywordSchema(db) {
    if (isExcludedKeywordSchemaReady) return;

    await db.query(`
        CREATE TABLE IF NOT EXISTS excluded_keywords (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            keyword VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT excluded_keywords_user_fk
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
    `);

    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS excluded_keywords_user_keyword_unique
        ON excluded_keywords (user_id, keyword)
    `);

    isExcludedKeywordSchemaReady = true;
}

function normalizeKeyword(keyword) {
    return String(keyword || '').trim().toLowerCase();
}

async function matchesExcludedKeyword(db, userId, title, details) {
    await ensureExcludedKeywordSchema(db);

    const text = `${title || ''} ${details || ''}`.toLowerCase();
    if (!text.trim()) return false;

    const result = await db.query(
        'SELECT keyword FROM excluded_keywords WHERE user_id = $1',
        [userId]
    );

    return result.rows.some((row) => text.includes(String(row.keyword || '').toLowerCase()));
}

async function hasSimilarExpense(db, { userId, amount, date, title, excludeExpenseId = null }) {
    const result = await db.query(
        `
            SELECT id
            FROM expenses
            WHERE paid_by_user_id = $1
              AND amount = $2
              AND (
                    DATE(date) = DATE($3)
                    OR LOWER(TRIM(title)) = LOWER(TRIM($4))
              )
              AND ($5::int IS NULL OR id <> $5)
            LIMIT 1
        `,
        [userId, amount, date || new Date(), title || '', excludeExpenseId]
    );

    return result.rowCount > 0;
}

export async function insertExpense({ title, amount, details, tag, category, paid_by_user_id, date }) {
    const db = await connectDB();

    await ensureCategoryConstraint(db);
    await ensureExcludedKeywordSchema(db);

    const normalizedCategory = normalizeCategory(category);
    const isDuplicate = await hasSimilarExpense(db, {
        userId: paid_by_user_id,
        amount,
        date,
        title,
    });
    const hasExcludedKeyword = await matchesExcludedKeyword(db, paid_by_user_id, title, details);

    const shouldBePending = isDuplicate || hasExcludedKeyword;
    const finalCategory = shouldBePending ? CATEGORY_PENDING : normalizedCategory;

    await db.query(
        `
            INSERT INTO expenses (title, amount, details, tag, category, paid_by_user_id, date)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP))
        `,
        [title, amount, details, tag, finalCategory, paid_by_user_id, date || null]
    );

    return { isPendingValidation: shouldBePending, category: finalCategory };
}

export async function importExpensesFromCsv(rows, filePath) {
    const db = await connectDB();
    let pendingCount = 0;
    let insertedCount = 0;

    try {
        console.log(`[CSV Import] Début: ${rows.length} lignes à traiter`);
        await ensureCategoryConstraint(db);
        await ensureExcludedKeywordSchema(db);
        await db.query('BEGIN');

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            console.log(`[CSV Import] Ligne ${i + 1}: title="${row.title}", amount=${row.amount}, date=${row.date}, user_id=${row.user_id}`);

            try {
                const normalizedCategory = normalizeCategory(row.category || CATEGORY_PERSO);
                const isDuplicate = await hasSimilarExpense(db, {
                    userId: row.user_id,
                    amount: row.amount,
                    date: row.date,
                    title: row.title,
                });
                const hasExcludedKeyword = await matchesExcludedKeyword(db, row.user_id, row.title, row.details);

                const shouldBePending = isDuplicate || hasExcludedKeyword;
                const finalCategory = shouldBePending ? CATEGORY_PENDING : normalizedCategory;
                if (shouldBePending) {
                    console.log(`  → Mise en attente de validation (doublon ou mot-clé exclu)`);
                    pendingCount += 1;
                }

                await db.query(
                    `INSERT INTO expenses (title, details, amount, date, paid_by_user_id, category, tag)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [row.title, row.details || null, row.amount, row.date, row.user_id, finalCategory, row.tag || null]
                );
                insertedCount += 1;
            } catch (lineErr) {
                console.error(`[CSV Import] Erreur ligne ${i + 1}:`, lineErr.message);
                throw lineErr;
            }
        }

        await db.query('COMMIT');
        console.log(`[CSV Import] Succès: ${insertedCount} insérées, ${pendingCount} en attente`);
        return { insertedCount, pendingCount };
    } catch (err) {
        console.error('[CSV Import] Rollback:', err.message);
        try {
            await db.query('ROLLBACK');
        } catch (_) {}
        throw new AppError(`Erreur lors de l'insertion en base: ${err.message}`, 500);
    } finally {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
    }
}

export async function updateExpenseById(userId, expenseId, payload) {
    const db = await connectDB();
    await ensureCategoryConstraint(db);

    const existingResult = await db.query(
        'SELECT * FROM expenses WHERE id = $1 AND paid_by_user_id = $2',
        [expenseId, userId]
    );

    if (existingResult.rowCount === 0) {
        throw new AppError('Dépense introuvable', 404);
    }

    const existing = existingResult.rows[0];

    const nextTitle = payload.title ?? existing.title;
    const nextDetails = payload.details ?? existing.details;
    const nextAmount = payload.amount ?? existing.amount;
    const nextTag = payload.tag ?? existing.tag;
    const nextDate = payload.date ?? existing.date;
    const requestedCategory = payload.category ?? existing.category;
    const normalizedCategory = normalizeCategory(requestedCategory);
    const hasExplicitCategoryUpdate = Object.prototype.hasOwnProperty.call(payload, 'category');

    let isDuplicate = false;
    let finalCategory = normalizedCategory;

    if (!hasExplicitCategoryUpdate) {
        isDuplicate = await hasSimilarExpense(db, {
            userId,
            amount: nextAmount,
            date: nextDate,
            title: nextTitle,
            excludeExpenseId: expenseId,
        });

        finalCategory = isDuplicate ? CATEGORY_PENDING : normalizedCategory;
    }

    const updatedResult = await db.query(
        `
            UPDATE expenses
            SET title = $1,
                details = $2,
                amount = $3,
                tag = $4,
                date = $5,
                category = $6
            WHERE id = $7 AND paid_by_user_id = $8
            RETURNING id, title, details, amount, tag, date, category
        `,
        [nextTitle, nextDetails, nextAmount, nextTag, nextDate, finalCategory, expenseId, userId]
    );

    return {
        expense: updatedResult.rows[0],
        isPendingValidation: finalCategory === CATEGORY_PENDING,
    };
}

export async function deleteExpenseById(userId, expenseId) {
    const db = await connectDB();

    const deletedResult = await db.query(
        'DELETE FROM expenses WHERE id = $1 AND paid_by_user_id = $2 RETURNING id',
        [expenseId, userId]
    );

    if (deletedResult.rowCount === 0) {
        throw new AppError('Dépense introuvable', 404);
    }
}

export async function listExcludedKeywords(userId) {
    const db = await connectDB();
    await ensureExcludedKeywordSchema(db);

    const result = await db.query(
        `
            SELECT id, keyword, created_at
            FROM excluded_keywords
            WHERE user_id = $1
            ORDER BY keyword ASC
        `,
        [userId]
    );

    return result.rows;
}

export async function addExcludedKeyword(userId, keyword) {
    const db = await connectDB();
    await ensureExcludedKeywordSchema(db);

    const normalized = normalizeKeyword(keyword);
    if (!normalized) {
        throw new AppError('Mot-clé invalide', 400);
    }

    const exists = await db.query(
        'SELECT id FROM excluded_keywords WHERE user_id = $1 AND keyword = $2',
        [userId, normalized]
    );

    if (exists.rowCount > 0) {
        throw new AppError('Ce mot-clé est déjà exclu', 400);
    }

    const inserted = await db.query(
        `
            INSERT INTO excluded_keywords (user_id, keyword)
            VALUES ($1, $2)
            RETURNING id, keyword, created_at
        `,
        [userId, normalized]
    );

    return inserted.rows[0];
}

export async function removeExcludedKeyword(userId, keywordId) {
    const db = await connectDB();
    await ensureExcludedKeywordSchema(db);

    const deleted = await db.query(
        `
            DELETE FROM excluded_keywords
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `,
        [keywordId, userId]
    );

    if (deleted.rowCount === 0) {
        throw new AppError('Mot-clé introuvable', 404);
    }
}
