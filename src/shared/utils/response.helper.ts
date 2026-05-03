import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { PaginationMeta } from '../types/common.types';

interface SuccessResponse<T> {
    success: true;
    message: string;
    data: T;
    pagination?: PaginationMeta;
}

interface CursorResponse<T> {
    success: true;
    message: string;
    data: T[];
    next_cursor: string | null;
    has_more: boolean;
}

interface ErrorResponse {
    success: false;
    message: string;
    data: null;
    error: string | string[] | null;
}

export class ResponseHelper {
    static success<T>(
        res: Response,
        data: T,
        message = 'Success',
        statusCode = StatusCodes.OK,
        pagination?: PaginationMeta,
    ): void {
        const body: SuccessResponse<T> = { success: true, message, data };
        if (pagination) body.pagination = pagination;
        res.status(statusCode).json(body);
    }

    static cursor<T>(
        res: Response,
        data: T[],
        next_cursor: string | null = null,
        has_more = false,
        message = 'Success',
    ): void {
        const body: CursorResponse<T> = { success: true, message, data, next_cursor, has_more };
        res.status(StatusCodes.OK).json(body);
    }

    static error(
        res: Response,
        message: string,
        statusCode = StatusCodes.INTERNAL_SERVER_ERROR,
        error: string | string[] | null = null,
    ): void {
        const body: ErrorResponse = { success: false, message, data: null, error };
        res.status(statusCode).json(body);
    }
}
