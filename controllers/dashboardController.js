import { getUserDashboard } from '../services/dashboardService.js';

export async function getDashboard(req, res, next) {
    try {
        const userId = req.user.id;
        const { month, year, category } = req.query;

        const data = await getUserDashboard(userId, { month, year, category });

        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }
}
