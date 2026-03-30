import dotenv from 'dotenv';
dotenv.config({ path: '../../.env', quiet: true });

export const getJWTSecretKey = () => {
    const secret = process.env.JWT_SECRET_KEY;
    
    if (!secret) {
        throw new Error("FATAL ERROR: La variable JWT_SECRET_KEY est introuvable dans le fichier .env !");
    }
    
    return secret;
};