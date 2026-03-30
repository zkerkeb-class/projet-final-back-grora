export class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
    }
}

export function errorHandler(err, _req, res, _next) {
    console.error('Erreur serveur :', err);

    const statusCode = err.statusCode || 500;
    const message = err.isOperational
        ? err.message
        : "Erreur interne du serveur";

    res.status(statusCode).json({ message });
}
