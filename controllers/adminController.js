import { AppError } from '../middlewares/errorHandler.js';
import { listManagedUsers, createManagedUser, updateManagedUserRole, deleteManagedUser } from '../services/adminService.js';

export async function getManagedUsers(req, res, next) {
    try {
        const users = await listManagedUsers(req.user.role);
        return res.status(200).json({ users });
    } catch (err) {
        next(err);
    }
}

export async function createUserByAdmin(req, res, next) {
    try {
        const result = await createManagedUser(req.user.role, req.body);

        return res.status(201).json({
            message: 'Utilisateur créé avec succès',
            user: result.user,
            temporaryPassword: result.temporaryPassword,
        });
    } catch (err) {
        next(err);
    }
}

export async function updateUserRole(req, res, next) {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId)) {
            throw new AppError('ID utilisateur invalide', 400);
        }

        const { role } = req.body;
        const user = await updateManagedUserRole(req.user.role, req.user.id, userId, role);

        return res.status(200).json({
            message: 'Rôle mis à jour',
            user,
        });
    } catch (err) {
        next(err);
    }
}

export async function deleteUserByAdmin(req, res, next) {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId)) {
            throw new AppError('ID utilisateur invalide', 400);
        }

        const user = await deleteManagedUser(req.user.role, req.user.id, userId);

        return res.status(200).json({
            message: 'Utilisateur supprimé',
            user,
        });
    } catch (err) {
        next(err);
    }
}
