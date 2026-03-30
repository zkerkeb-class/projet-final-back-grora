import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
dotenv.config({ path: '../../.env', quiet: true });

const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;

const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

// Création du Pool (bassin de connexions)
// C'est l'objet qui gérera les connexions multiples pour vos utilisateurs
const pool = new Pool({
  connectionString: DATABASE_URL,
});

export const connectDB = async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Connected to PostgreSQL successfully.');
        return pool;
    } catch (error) {
        console.error('❌ Error connecting to PostgreSQL:', error);
        process.exit(1);
    }
};