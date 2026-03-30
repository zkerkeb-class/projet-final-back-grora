import { AppError } from '../middlewares/errorHandler.js';
import {
    addHouseholdMemberByEmail,
    createMyHousehold,
    getMyHousehold,
    leaveMyHousehold,
    removeHouseholdMember,
} from '../services/householdService.js';

export async function getHousehold(req, res, next) {
    try {
        const household = await getMyHousehold(req.user.id);
        return res.status(200).json(household);
    } catch (err) {
        next(err);
    }
}

export async function createHousehold(req, res, next) {
    try {
        const household = await createMyHousehold(req.user.id);
        return res.status(201).json({
            message: 'Foyer créé avec succès',
            ...household,
        });
    } catch (err) {
        next(err);
    }
}

export async function addMemberByEmail(req, res, next) {
    try {
        const email = String(req.body?.email || '').trim();
        if (!email) {
            throw new AppError('Email requis', 400);
        }

        const household = await addHouseholdMemberByEmail(req.user.id, email);
        return res.status(200).json({
            message: 'Membre ajouté au foyer',
            ...household,
        });
    } catch (err) {
        next(err);
    }
}

export async function removeMember(req, res, next) {
    try {
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(targetUserId)) {
            throw new AppError('ID utilisateur invalide', 400);
        }

        const household = await removeHouseholdMember(req.user.id, targetUserId);
        return res.status(200).json({
            message: 'Membre retiré du foyer',
            ...household,
        });
    } catch (err) {
        next(err);
    }
}

export async function leaveHousehold(req, res, next) {
    try {
        const result = await leaveMyHousehold(req.user.id);
        return res.status(200).json({
            message: 'Vous avez quitté le foyer',
            ...result,
        });
    } catch (err) {
        next(err);
    }
}
