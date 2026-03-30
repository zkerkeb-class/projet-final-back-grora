import { getExpenseStats } from '../services/statsService.js';

export async function getStats(req, res, next) {
    try {
        const userId = req.user.id;
        const { month, year, category } = req.query;

        const stats = await getExpenseStats(userId, { month, year, category });

        return res.status(200).json(stats);
    } catch (err) {
        next(err);
    }
}
