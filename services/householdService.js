import crypto from 'crypto';
import { connectDB } from '../connect.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ensureAuthSchema } from './authService.js';

async function getActor(db, userId) {
    const actorResult = await db.query(
        `SELECT id, name, email, household_id
         FROM users
         WHERE id = $1`,
        [userId]
    );

    if (actorResult.rowCount === 0) {
        throw new AppError('Utilisateur introuvable', 404);
    }

    return actorResult.rows[0];
}

async function getHouseholdByUser(db, actor) {
    if (!actor.household_id) {
        return null;
    }

    const householdResult = await db.query(
        `
            SELECT id, name, admin_user_id
            FROM households
            WHERE id::text = $1
        `,
        [String(actor.household_id)]
    );

    if (householdResult.rowCount === 0) {
        throw new AppError('Foyer introuvable', 404);
    }

    return householdResult.rows[0];
}

async function assertHouseholdAdmin(db, actor) {
    if (!actor.household_id) {
        throw new AppError('Vous devez d\'abord créer ou rejoindre un foyer', 400);
    }

    const household = await getHouseholdByUser(db, actor);
    if (Number(household.admin_user_id) !== Number(actor.id)) {
        throw new AppError('Seul l\'admin du foyer peut gérer les membres', 403);
    }

    return household;
}

async function getMembersByHouseholdId(db, householdId, adminUserId) {
    const membersResult = await db.query(
        `
            SELECT id, name, email
            FROM users
            WHERE household_id = $1
            ORDER BY name ASC
        `,
        [String(householdId)]
    );

    return membersResult.rows.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        isHouseholdAdmin: Number(member.id) === Number(adminUserId),
    }));
}

export async function getMyHousehold(userId) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const actor = await getActor(db, userId);

    if (!actor.household_id) {
        return {
            currentUserId: actor.id,
            householdId: null,
            householdName: null,
            isHouseholdAdmin: false,
            members: [],
        };
    }

    const household = await getHouseholdByUser(db, actor);
    const members = await getMembersByHouseholdId(db, actor.household_id, household.admin_user_id);

    return {
        currentUserId: actor.id,
        householdId: actor.household_id,
        householdName: household.name,
        isHouseholdAdmin: Number(household.admin_user_id) === Number(actor.id),
        members,
    };
}

export async function createMyHousehold(userId) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const actor = await getActor(db, userId);

    if (actor.household_id) {
        throw new AppError('Vous avez déjà un foyer', 400);
    }

    const householdName = `Foyer de ${actor.name || 'Utilisateur'} ${crypto.randomUUID().slice(0, 6)}`;
    const householdResult = await db.query(
        `
            INSERT INTO households (name, admin_user_id)
            VALUES ($1, $2)
            RETURNING id, name, admin_user_id
        `,
        [householdName, userId]
    );

    const household = householdResult.rows[0];
    const householdId = String(household.id);

    await db.query(
        `
            UPDATE users
            SET household_id = $1
            WHERE id = $2
        `,
        [householdId, userId]
    );

    const members = await getMembersByHouseholdId(db, householdId, userId);

    return {
        currentUserId: userId,
        householdId,
        householdName: household.name,
        isHouseholdAdmin: true,
        members,
    };
}

export async function addHouseholdMemberByEmail(userId, email) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new AppError('Email invalide', 400);
    }

    const actor = await getActor(db, userId);
    await assertHouseholdAdmin(db, actor);

    const targetResult = await db.query(
        `
            SELECT id, name, email, household_id
            FROM users
            WHERE LOWER(email) = $1
        `,
        [normalizedEmail]
    );

    if (targetResult.rowCount === 0) {
        throw new AppError('Aucun utilisateur trouvé avec cet email', 404);
    }

    const target = targetResult.rows[0];

    if (Number(target.id) === Number(userId)) {
        throw new AppError('Vous êtes déjà membre de ce foyer', 400);
    }

    if (target.household_id && target.household_id !== actor.household_id) {
        throw new AppError('Cet utilisateur appartient déjà à un autre foyer', 400);
    }

    if (target.household_id === actor.household_id) {
        throw new AppError('Cet utilisateur est déjà membre du foyer', 400);
    }

    await db.query(
        `
            UPDATE users
            SET household_id = $1
            WHERE id = $2
        `,
        [actor.household_id, target.id]
    );

    return getMyHousehold(userId);
}

export async function removeHouseholdMember(userId, targetUserId) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const actor = await getActor(db, userId);
    const household = await assertHouseholdAdmin(db, actor);

    if (Number(targetUserId) === Number(userId)) {
        throw new AppError('Vous ne pouvez pas vous retirer vous-même du foyer', 400);
    }

    const targetResult = await db.query(
        `
            SELECT id, household_id
            FROM users
            WHERE id = $1
        `,
        [targetUserId]
    );

    if (targetResult.rowCount === 0) {
        throw new AppError('Membre introuvable', 404);
    }

    const target = targetResult.rows[0];

    if (target.household_id !== actor.household_id) {
        throw new AppError('Cet utilisateur ne fait pas partie de votre foyer', 400);
    }

    if (Number(target.id) === Number(household.admin_user_id)) {
        throw new AppError('Impossible de retirer un autre admin du foyer', 400);
    }

    await db.query(
        `
            UPDATE users
            SET household_id = NULL
            WHERE id = $1
        `,
        [targetUserId]
    );

    return getMyHousehold(userId);
}

export async function leaveMyHousehold(userId) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const actor = await getActor(db, userId);

    if (!actor.household_id) {
        throw new AppError('Vous ne faites partie d\'aucun foyer', 400);
    }

    const household = await getHouseholdByUser(db, actor);

    const membersResult = await db.query(
        `
            SELECT id
            FROM users
            WHERE household_id = $1
            ORDER BY id ASC
        `,
        [String(actor.household_id)]
    );

    const memberIds = membersResult.rows.map((row) => Number(row.id));
    const isAdmin = Number(household.admin_user_id) === Number(actor.id);

    await db.query('BEGIN');
    try {
        if (!isAdmin) {
            await db.query(
                'UPDATE users SET household_id = NULL WHERE id = $1',
                [userId]
            );

            await db.query('COMMIT');
            return {
                householdDeleted: false,
                adminTransferred: false,
            };
        }

        if (memberIds.length <= 1) {
            await db.query(
                'UPDATE users SET household_id = NULL WHERE id = $1',
                [userId]
            );

            await db.query(
                'DELETE FROM households WHERE id = $1',
                [household.id]
            );

            await db.query('COMMIT');
            return {
                householdDeleted: true,
                adminTransferred: false,
            };
        }

        const nextAdminId = memberIds.find((id) => id !== Number(userId));
        if (!nextAdminId) {
            throw new AppError('Impossible de déterminer le prochain admin du foyer', 500);
        }

        await db.query(
            'UPDATE households SET admin_user_id = $1 WHERE id = $2',
            [nextAdminId, household.id]
        );

        await db.query(
            'UPDATE users SET household_id = NULL WHERE id = $1',
            [userId]
        );

        await db.query('COMMIT');
        return {
            householdDeleted: false,
            adminTransferred: true,
            newAdminUserId: nextAdminId,
        };
    } catch (err) {
        await db.query('ROLLBACK');
        throw err;
    }
}
