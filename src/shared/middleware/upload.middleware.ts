import multer, { FileFilterCallback } from 'multer';
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from './error.middleware';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE      = 5 * 1024 * 1024; // 5 MB

function imageFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
}

const multerInstance = multer({
    storage:    multer.memoryStorage(),
    limits:     { fileSize: MAX_FILE_SIZE },
    fileFilter: imageFilter,
});

// Wraps multer.single() so that:
//   - LIMIT_FILE_SIZE   → 413 Payload Too Large
//   - fileFilter errors → 422 Unprocessable Entity
//   - Other multer errors → 422
export const uploadImage = (fieldName: string) =>
    (req: Request, res: Response, next: NextFunction): void => {
        multerInstance.single(fieldName)(req, res, (err) => {
            if (!err) return next();

            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new ApiError(`File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`, StatusCodes.REQUEST_TOO_LONG));
                }
                return next(new ApiError(err.message, StatusCodes.UNPROCESSABLE_ENTITY));
            }

            // fileFilter rejection (plain Error)
            return next(new ApiError(err.message, StatusCodes.UNPROCESSABLE_ENTITY));
        });
    };
