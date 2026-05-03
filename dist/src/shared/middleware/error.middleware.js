"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundMiddleware = exports.errorMiddleware = exports.ApiError = void 0;
const http_status_codes_1 = require("http-status-codes");
const asLogger_1 = require("../utils/asLogger");
const response_helper_1 = require("../utils/response.helper");
// ─── ApiError ─────────────────────────────────────────────────────────────────
class ApiError extends Error {
    statusCode;
    errors;
    isOperational;
    constructor(message, statusCode = http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, errors) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.errors = errors;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.ApiError = ApiError;
// ─── Global error handler ─────────────────────────────────────────────────────
const errorMiddleware = (error, _req, res, _next) => {
    // Known operational error — return as-is
    if (error instanceof ApiError) {
        response_helper_1.ResponseHelper.error(res, error.message, error.statusCode, error.errors ?? null);
        return;
    }
    // Prisma unique constraint violation
    if (error.code === 'P2002') {
        const targets = error.meta?.target ?? [];
        const field = targets[0] ?? 'field';
        response_helper_1.ResponseHelper.error(res, `A record with this ${field} already exists.`, http_status_codes_1.StatusCodes.CONFLICT);
        return;
    }
    // Prisma record not found
    if (error.code === 'P2025') {
        response_helper_1.ResponseHelper.error(res, 'The requested record was not found.', http_status_codes_1.StatusCodes.NOT_FOUND);
        return;
    }
    // Prisma foreign key constraint
    if (error.code === 'P2003') {
        response_helper_1.ResponseHelper.error(res, 'Operation failed due to a related record constraint.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
        return;
    }
    // JWT errors that bubble up outside auth middleware
    if (error.name === 'JsonWebTokenError') {
        response_helper_1.ResponseHelper.error(res, 'Invalid authentication token.', http_status_codes_1.StatusCodes.UNAUTHORIZED);
        return;
    }
    if (error.name === 'TokenExpiredError') {
        response_helper_1.ResponseHelper.error(res, 'Authentication token has expired.', http_status_codes_1.StatusCodes.UNAUTHORIZED);
        return;
    }
    // CORS errors
    if (error.message === 'Not allowed by CORS') {
        response_helper_1.ResponseHelper.error(res, 'CORS: request origin not allowed.', http_status_codes_1.StatusCodes.FORBIDDEN);
        return;
    }
    // Unknown / programmer error
    asLogger_1.asLogger.error('Unhandled application error:', error);
    response_helper_1.ResponseHelper.error(res, 'An internal server error occurred.', http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
};
exports.errorMiddleware = errorMiddleware;
// ─── 404 catch-all (must be registered last) ─────────────────────────────────
const notFoundMiddleware = (req, res) => {
    response_helper_1.ResponseHelper.error(res, `Cannot ${req.method} ${req.originalUrl}`, http_status_codes_1.StatusCodes.NOT_FOUND);
};
exports.notFoundMiddleware = notFoundMiddleware;
//# sourceMappingURL=error.middleware.js.map