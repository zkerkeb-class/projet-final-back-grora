import { authenticateUser, getCurrentUser, changeTemporaryPassword } from '../services/authService.js';

export async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        const { token, mustChangePassword } = await authenticateUser(email, password);

        return res.status(200).json({
            message: 'Connexion réussie',
            token,
            mustChangePassword,
        });
    } catch (err) {
        next(err);
    }
}

export async function me(req, res, next) {
    try {
        const user = await getCurrentUser(req.user.id);
        return res.status(200).json({ user });
    } catch (err) {
        next(err);
    }
}

export async function changePassword(req, res, next) {
    try {
        const { currentPassword, newPassword } = req.body;
        const result = await changeTemporaryPassword(req.user.id, currentPassword, newPassword);

        return res.status(200).json({
            message: 'Mot de passe mis à jour avec succès',
            token: result.token,
            mustChangePassword: result.mustChangePassword,
        });
    } catch (err) {
        next(err);
    }
}
