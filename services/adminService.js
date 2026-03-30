import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { connectDB } from '../connect.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ensureAuthSchema } from './authService.js';

const ROLE_USER = 'user';
const ROLE_ADMIN = 'admin';
const ROLE_SUPERADMIN = 'superadmin';

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function assertRoleCanBeAssigned(actorRole, requestedRole) {
    const role = normalizeRole(requestedRole);

    if (role === ROLE_SUPERADMIN) {
        throw new AppError('Le rôle superadmin ne peut pas être attribué', 403);
    }

    if (actorRole === ROLE_ADMIN && role !== ROLE_USER) {
        throw new AppError('Un admin ne peut créer ou modifier que des users', 403);
    }

    if (actorRole === ROLE_SUPERADMIN && ![ROLE_USER, ROLE_ADMIN].includes(role)) {
        throw new AppError('Rôle non autorisé', 400);
    }

    if (![ROLE_USER, ROLE_ADMIN].includes(role)) {
        throw new AppError('Rôle invalide', 400);
    }

    return role;
}

function assertTargetManageable(actorRole, targetRole) {
    if (targetRole === ROLE_SUPERADMIN) {
        throw new AppError('Un superadmin ne peut pas gérer un autre superadmin', 403);
    }

    if (actorRole === ROLE_ADMIN && targetRole !== ROLE_USER) {
        throw new AppError('Un admin ne peut gérer que des users', 403);
    }
}

async function handleHouseholdBeforeUserDeletion(db, targetUser) {
    if (!targetUser.household_id) return;

    const householdResult = await db.query(
        'SELECT id, admin_user_id FROM households WHERE id::text = $1',
        [String(targetUser.household_id)]
    );

    if (householdResult.rowCount === 0) return;

    const household = householdResult.rows[0];

    if (Number(household.admin_user_id) !== Number(targetUser.id)) {
        return;
    }

    const otherMembersResult = await db.query(
        `
            SELECT id
            FROM users
            WHERE household_id = $1
              AND id <> $2
            ORDER BY id ASC
        `,
        [String(targetUser.household_id), targetUser.id]
    );

    if (otherMembersResult.rowCount > 0) {
        const nextAdminId = otherMembersResult.rows[0].id;
        await db.query(
            'UPDATE households SET admin_user_id = $1 WHERE id = $2',
            [nextAdminId, household.id]
        );
        return;
    }

    await db.query('DELETE FROM households WHERE id = $1', [household.id]);
}

function generateTemporaryPassword(length = 14) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function listManagedUsers(actorRole) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const visibleRoles = actorRole === ROLE_SUPERADMIN
        ? [ROLE_USER, ROLE_ADMIN]
        : [ROLE_USER];

    const result = await db.query(
        `
            SELECT id, name, email, role, household_id, first_login_required, created_at
            FROM users
            WHERE role = ANY($1)
            ORDER BY created_at DESC
        `,
        [visibleRoles]
    );

    return result.rows;
}

export async function createManagedUser(actorRole, payload) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();

    if (!name || !email) {
        throw new AppError('Champs requis: name, email', 400);
    }

    const role = assertRoleCanBeAssigned(actorRole, payload.role || ROLE_USER);

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const result = await db.query(
        `
            INSERT INTO users (name, email, password_hash, household_id, role, first_login_required)
            VALUES ($1, $2, $3, $4, $5, TRUE)
            RETURNING id, name, email, household_id, role, first_login_required, created_at
        `,
        [name, email, passwordHash, null, role]
    );

    return {
        user: result.rows[0],
        temporaryPassword: tempPassword,
    };
}

export async function updateManagedUserRole(actorRole, actorUserId, userId, newRole) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    if (Number(actorUserId) === Number(userId)) {
        throw new AppError('Vous ne pouvez pas modifier votre propre rôle', 403);
    }

    const targetResult = await db.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (targetResult.rowCount === 0) {
        throw new AppError('Utilisateur introuvable', 404);
    }

    const target = targetResult.rows[0];
    assertTargetManageable(actorRole, target.role);

    const normalizedRole = assertRoleCanBeAssigned(actorRole, newRole);

    await db.query('UPDATE users SET role = $1 WHERE id = $2', [normalizedRole, userId]);

    const updated = await db.query(
        'SELECT id, name, email, household_id, role, first_login_required, created_at FROM users WHERE id = $1',
        [userId]
    );

    return updated.rows[0];
}

export async function deleteManagedUser(actorRole, actorUserId, userId) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    if (Number(actorUserId) === Number(userId)) {
        throw new AppError('Vous ne pouvez pas supprimer votre propre compte', 403);
    }

    const targetResult = await db.query(
        'SELECT id, role, household_id FROM users WHERE id = $1',
        [userId]
    );

    if (targetResult.rowCount === 0) {
        throw new AppError('Utilisateur introuvable', 404);
    }

    const target = targetResult.rows[0];
    assertTargetManageable(actorRole, target.role);

    await db.query('BEGIN');
    try {
        await handleHouseholdBeforeUserDeletion(db, target);

        const deletedResult = await db.query(
            'DELETE FROM users WHERE id = $1 RETURNING id, name, email',
            [userId]
        );

        await db.query('COMMIT');
        return deletedResult.rows[0];
    } catch (err) {
        await db.query('ROLLBACK');
        throw err;
    }
}
