import { connectDB } from '../connect.js';

export async function getUserDashboard(userId, { month, year, category }) {
    const db = await connectDB();

    const userResult = await db.query(
        'SELECT name, email, role, household_id FROM users WHERE id = $1',
        [userId]
    );

    const householdId = userResult.rows[0]?.household_id;
    const householdMembersResult = householdId
        ? await db.query(
            'SELECT id, name FROM users WHERE household_id = $1 ORDER BY name ASC',
            [householdId]
        )
        : { rows: [] };

    const { query, params } = buildExpensesQuery(userId, { month, year, category, householdId });
    const expensesResult = await db.query(query, params);

    return {
        user: userResult.rows[0],
        householdMembers: householdMembersResult.rows,
        expenses: expensesResult.rows,
    };
}

function buildExpensesQuery(userId, { month, year, category, householdId }) {
    // En mode COMMUN on récupère les dépenses de tout le foyer
    const isCommon = category === 'COMMUN';

    const baseQuery = isCommon
        ? `
            SELECT e.id, e.amount, e.title, e.details, e.tag, e.category, e.date, u.name AS paid_by
            FROM expenses e
            JOIN users u ON e.paid_by_user_id = u.id
            WHERE u.household_id = $1
            AND e.category = 'COMMUN'
        `
        : `
            SELECT e.id, e.amount, e.title, e.details, e.tag, e.category, e.date
            FROM expenses e
            WHERE e.paid_by_user_id = $1
            AND e.category IN ('PERSO', 'COMMUN', 'EN_ATTENTE_VALIDATION')
        `;

    const params = [isCommon ? householdId : userId];

    if (month && year) {
        const expenseDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        params.push(expenseDate);
        return {
            query: baseQuery + " AND DATE_TRUNC('month', e.date) = $2::DATE ORDER BY e.date DESC",
            params,
        };
    }

    if (year) {
        const expenseDate = `${year}-01-01`;
        params.push(expenseDate);
        return {
            query: baseQuery + " AND DATE_TRUNC('year', e.date) = $2::DATE ORDER BY e.date DESC",
            params,
        };
    }

    return {
        query: baseQuery + " AND DATE_TRUNC('month', e.date) = DATE_TRUNC('month', CURRENT_DATE) ORDER BY e.date DESC",
        params,
    };
}
