import jwt from 'jsonwebtoken';
import { getJWTSecretKey } from '../getJWT.js';
import { connectDB } from '../connect.js';
import { ensureAuthSchema } from '../services/authService.js';

export async function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Accès non autorisé : token manquant' });
    }

    try {
        const decoded = jwt.verify(token, getJWTSecretKey());
        const db = await connectDB();
        await ensureAuthSchema(db);

        const result = await db.query(
            `
                SELECT u.id, u.name, u.email, u.role, u.first_login_required, u.household_id,
                       h.admin_user_id
                FROM users u
                LEFT JOIN households h ON h.id::text = u.household_id
                WHERE u.id = $1
            `,
            [decoded.id]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({ message: 'Utilisateur introuvable' });
        }

        const user = result.rows[0];
        req.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            householdId: user.household_id,
            isHouseholdAdmin: Boolean(user.household_id) && Number(user.admin_user_id) === Number(user.id),
            firstLoginRequired: Boolean(user.first_login_required),
        };

        next();
    } catch {
        return res.status(401).json({ message: 'Token invalide ou expiré' });
    }
}

export function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Non authentifié' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Accès refusé pour ce rôle' });
        }

        next();
    };
}
