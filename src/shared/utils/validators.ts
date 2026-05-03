import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ValidationChain, validationResult } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../middleware/error.middleware';
import {Messages} from "./response.constants";

/**
 * Wraps an array of express-validator ValidationChain objects into Express
 * middleware. All chains run in parallel; on failure, a 422 ApiError is thrown
 * with an array of human-readable messages.
 */
export const validateRequest = (chains: ValidationChain[]): RequestHandler[] => {
    return [
        ...chains,
        (req: Request, _res: Response, next: NextFunction): void => {
            const result = validationResult(req);
            if (!result.isEmpty()) {
                const messages = result.array().map((e) => e.msg as string);
                return next(
                    new ApiError(Messages.VALIDATION_FAILED, StatusCodes.UNPROCESSABLE_ENTITY, messages),
                );
            }
            next();
        },
    ];
};
