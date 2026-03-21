import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { connectDB } from '../connect.js';
import { getJWTSecretKey } from '../getJWT.js';
import { AppError } from '../middlewares/errorHandler.js';

let isAuthSchemaReady = false;

export async function ensureAuthSchema(db) {
    if (isAuthSchemaReady) return;

    await db.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS first_login_required BOOLEAN DEFAULT FALSE
    `);

    await db.query(`
        ALTER TABLE users
        ALTER COLUMN household_id DROP NOT NULL
    `);

    await db.query(`
        ALTER TABLE users
        DROP COLUMN IF EXISTS is_household_admin
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS households (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            admin_user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.query(`
        ALTER TABLE households
        DROP CONSTRAINT IF EXISTS households_admin_user_fk
    `);

    await db.query(`
        ALTER TABLE households
        ADD CONSTRAINT households_admin_user_fk
        FOREIGN KEY (admin_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    `);

    isAuthSchemaReady = true;
}

function signAccessToken({ id, role, firstLoginRequired }) {
    return jwt.sign(
        {
            id,
            role,
            firstLoginRequired: Boolean(firstLoginRequired),
        },
        getJWTSecretKey(),
        { expiresIn: '1h' }
    );
}

export async function authenticateUser(email, password) {
    const db = await connectDB();
    await ensureAuthSchema(db);

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
        throw new AppError('Identifiants incorrects', 401);
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
        throw new AppError('Identifiants incorrects', 401);
    }

    const mustChangePassword = Boolean(user.first_login_required);
    const token = signAccessToken({
        id: user.id,
        role: user.role,
        firstLoginRequired: mustChangePassword,
    });

    return {
        token,
        mustChangePassword,
    };
}

export async function getCurrentUser(userId) {
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
        [userId]
    );

    if (result.rowCount === 0) {
        throw new AppError('Utilisateur introuvable', 404);
    }

    const user = result.rows[0];
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        householdId: user.household_id,
        isHouseholdAdmin: Boolean(user.household_id) && Number(user.admin_user_id) === Number(user.id),
        firstLoginRequired: Boolean(user.first_login_required),
    };
}

export async function changeTemporaryPassword(userId, currentPassword, newPassword) {
    if (!newPassword) {
        throw new AppError('Le nouveau mot de passe est requis', 400);
    }

    const db = await connectDB();
    await ensureAuthSchema(db);

    const result = await db.query(
        'SELECT id, role, password_hash, first_login_required FROM users WHERE id = $1',
        [userId]
    );

    if (result.rowCount === 0) {
        throw new AppError('Utilisateur introuvable', 404);
    }

    const user = result.rows[0];
    const isCurrentValid = await bcrypt.compare(currentPassword || '', user.password_hash);

    if (!isCurrentValid) {
        throw new AppError('Mot de passe actuel invalide', 401);
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await db.query(
        `
            UPDATE users
            SET password_hash = $1,
                first_login_required = FALSE
            WHERE id = $2
        `,
        [newHash, userId]
    );

    return {
        token: signAccessToken({
            id: userId,
            role: user.role,
            firstLoginRequired: false,
        }),
        mustChangePassword: false,
    };
}
