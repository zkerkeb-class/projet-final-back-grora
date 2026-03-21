import { connectDB } from '../connect.js';

export async function getExpenseStats(userId, { month, year, category }) {
    const db = await connectDB();

    // Récupérer le household_id si mode COMMUN
    let householdId = null;
    if (category === 'COMMUN') {
        const userResult = await db.query('SELECT household_id FROM users WHERE id = $1', [userId]);
        householdId = userResult.rows[0]?.household_id;
    }

    const { timeFilter, params } = buildTimeFilter(userId, { month, year, category, householdId });

    const [summary, byTag, dailyTrend] = await Promise.all([
        getSummary(db, timeFilter, params),
        getByTag(db, timeFilter, params),
        getDailyTrend(db, timeFilter, params),
    ]);

    return { summary, byTag, dailyTrend };
}

function buildTimeFilter(userId, { month, year, category, householdId }) {
    const isCommon = category === 'COMMUN';
    const params = [isCommon ? householdId : userId];

    // Filtre de base : par user ou par household
    const ownerFilter = isCommon
        ? "u.household_id = $1 AND e.category = 'COMMUN'"
        : "e.paid_by_user_id = $1 AND e.category IN ('PERSO', 'COMMUN')";

    let timeFilter = '';

    if (month && year) {
        const expenseDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        params.push(expenseDate);
        timeFilter = "AND DATE_TRUNC('month', e.date) = $2::DATE";
    } else if (year) {
        const expenseDate = `${year}-01-01`;
        params.push(expenseDate);
        timeFilter = "AND DATE_TRUNC('year', e.date) = $2::DATE";
    } else {
        timeFilter = "AND DATE_TRUNC('month', e.date) = DATE_TRUNC('month', CURRENT_DATE)";
    }

    return { timeFilter: `${ownerFilter} ${timeFilter}`, params, needsJoin: isCommon };
}

async function getSummary(db, timeFilter, params) {
    const needsJoin = timeFilter.includes('u.household_id');
    const join = needsJoin ? 'JOIN users u ON e.paid_by_user_id = u.id' : '';

    const result = await db.query(`
        SELECT 
            COUNT(*)::int AS count,
            COALESCE(SUM(amount), 0)::float AS total,
            COALESCE(AVG(amount), 0)::float AS average,
            COALESCE(MIN(amount), 0)::float AS min,
            COALESCE(MAX(amount), 0)::float AS max
        FROM expenses e
        ${join}
        WHERE ${timeFilter}
    `, params);

    return result.rows[0];
}

async function getByTag(db, timeFilter, params) {
    const needsJoin = timeFilter.includes('u.household_id');
    const join = needsJoin ? 'JOIN users u ON e.paid_by_user_id = u.id' : '';

    const [expensesResult, incomeResult] = await Promise.all([
        db.query(`
            SELECT 
                COALESCE(tag, 'autre') AS tag,
                COUNT(*)::int AS count,
                COALESCE(SUM(amount), 0)::float AS total
            FROM expenses e
            ${join}
            WHERE ${timeFilter} AND e.amount < 0
            GROUP BY tag
            ORDER BY total ASC
            LIMIT 10
        `, params),
        db.query(`
            SELECT 
                COALESCE(tag, 'autre') AS tag,
                COUNT(*)::int AS count,
                COALESCE(SUM(amount), 0)::float AS total
            FROM expenses e
            ${join}
            WHERE ${timeFilter} AND e.amount > 0
            GROUP BY tag
            ORDER BY total ASC
            LIMIT 10
        `, params),
    ]);

    return { expenses: expensesResult.rows, income: incomeResult.rows };
}

async function getDailyTrend(db, timeFilter, params) {
    const needsJoin = timeFilter.includes('u.household_id');
    const join = needsJoin ? 'JOIN users u ON e.paid_by_user_id = u.id' : '';

    const result = await db.query(`
        SELECT 
            e.date::date AS day,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::float AS expenses,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::float AS income
        FROM expenses e
        ${join}
        WHERE ${timeFilter}
        GROUP BY e.date::date
        ORDER BY day ASC
    `, params);

    return result.rows;
}
