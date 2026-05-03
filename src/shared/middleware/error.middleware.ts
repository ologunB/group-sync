import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asLogger } from '../utils/asLogger';
import { ResponseHelper } from '../utils/response.helper';

// ─── ApiError ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
    public readonly statusCode: number;
    public readonly errors?: string[];
    public readonly isOperational: boolean;

    constructor(
        message: string,
        statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR,
        errors?: string[],
    ) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.errors = errors;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

// ─── Global error handler ─────────────────────────────────────────────────────

export const errorMiddleware = (
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void => {
    // Known operational error — return as-is
    if (error instanceof ApiError) {
        ResponseHelper.error(res, error.message, error.statusCode, error.errors ?? null);
        return;
    }

    // Prisma unique constraint violation
    if ((error as any).code === 'P2002') {
        const targets: string[] = (error as any).meta?.target ?? [];
        const field = targets[0] ?? 'field';
        ResponseHelper.error(
            res,
            `A record with this ${field} already exists.`,
            StatusCodes.CONFLICT,
        );
        return;
    }

    // Prisma record not found
    if ((error as any).code === 'P2025') {
        ResponseHelper.error(res, 'The requested record was not found.', StatusCodes.NOT_FOUND);
        return;
    }

    // Prisma foreign key constraint
    if ((error as any).code === 'P2003') {
        ResponseHelper.error(
            res,
            'Operation failed due to a related record constraint.',
            StatusCodes.UNPROCESSABLE_ENTITY,
        );
        return;
    }

    // JWT errors that bubble up outside auth middleware
    if (error.name === 'JsonWebTokenError') {
        ResponseHelper.error(res, 'Invalid authentication token.', StatusCodes.UNAUTHORIZED);
        return;
    }

    if (error.name === 'TokenExpiredError') {
        ResponseHelper.error(res, 'Authentication token has expired.', StatusCodes.UNAUTHORIZED);
        return;
    }

    // CORS errors
    if (error.message === 'Not allowed by CORS') {
        ResponseHelper.error(res, 'CORS: request origin not allowed.', StatusCodes.FORBIDDEN);
        return;
    }

    // Unknown / programmer error
    asLogger.error('Unhandled application error:', error);
    ResponseHelper.error(
        res,
        'An internal server error occurred.',
        StatusCodes.INTERNAL_SERVER_ERROR,
    );
};

// ─── 404 catch-all (must be registered last) ─────────────────────────────────

export const notFoundMiddleware = (req: Request, res: Response): void => {
    ResponseHelper.error(
        res,
        `Cannot ${req.method} ${req.originalUrl}`,
        StatusCodes.NOT_FOUND,
    );
};
