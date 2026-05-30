import multer, { FileFilterCallback } from 'multer';
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from './error.middleware';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav',
                              'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/opus',
                              'audio/flac', 'audio/webm',
                              'video/webm']; // Chrome/Edge MediaRecorder reports audio as video/webm

const IMAGE_MAX = 5  * 1024 * 1024; // 5 MB
const AUDIO_MAX = 20 * 1024 * 1024; // 20 MB

function makeFilter(cb: FileFilterCallback, file: Express.Multer.File, allowed: string[], label: string): void {
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Only ${label} files are allowed`));
    }
}

// Image-only uploader (existing behaviour, unchanged)
const imageMulter = multer({
    storage:    multer.memoryStorage(),
    limits:     { fileSize: IMAGE_MAX },
    fileFilter: (_req, file, cb) => makeFilter(cb, file, ALLOWED_IMAGE_TYPES, 'JPEG, PNG, and WebP image'),
});

// Image + audio uploader (for group messages and DMs)
const mediaMulter = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: AUDIO_MAX },
    fileFilter: (_req, file, cb) => {
        if ([...ALLOWED_IMAGE_TYPES, ...ALLOWED_AUDIO_TYPES].includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image (JPEG/PNG/WebP) or audio (MP3/OGG/WAV/M4A/AAC/OPUS) files are allowed'));
        }
    },
});

// Multi-image uploader (for feed posts — up to 4 images)
const multiImageMulter = multer({
    storage:    multer.memoryStorage(),
    limits:     { fileSize: IMAGE_MAX, files: 4 },
    fileFilter: (_req, file, cb) => makeFilter(cb, file, ALLOWED_IMAGE_TYPES, 'JPEG, PNG, and WebP image'),
});

function wrapMulter(instance: multer.Multer, fieldName: string, maxMb: number) {
    return (req: Request, res: Response, next: NextFunction): void => {
        instance.single(fieldName)(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new ApiError(`File too large. Maximum allowed size is ${maxMb} MB.`, StatusCodes.REQUEST_TOO_LONG));
                }
                return next(new ApiError(err.message, StatusCodes.UNPROCESSABLE_ENTITY));
            }
            return next(new ApiError(err.message, StatusCodes.UNPROCESSABLE_ENTITY));
        });
    };
}

function wrapMulterArray(instance: multer.Multer, fieldName: string, maxFiles: number, maxMb: number) {
    return (req: Request, res: Response, next: NextFunction): void => {
        instance.array(fieldName, maxFiles)(req, res, (err) => {
            if (!err) return next();
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new ApiError(`File too large. Maximum allowed size is ${maxMb} MB.`, StatusCodes.REQUEST_TOO_LONG));
                }
                if (err.code === 'LIMIT_FILE_COUNT') {
                    return next(new ApiError(`Too many files. Maximum ${maxFiles} images allowed.`, StatusCodes.UNPROCESSABLE_ENTITY));
                }
                return next(new ApiError(err.message, StatusCodes.UNPROCESSABLE_ENTITY));
            }
            return next(new ApiError(err.message, StatusCodes.UNPROCESSABLE_ENTITY));
        });
    };
}

export const uploadImage  = (fieldName: string) => wrapMulter(imageMulter, fieldName, IMAGE_MAX / (1024 * 1024));
export const uploadMedia  = (fieldName: string) => wrapMulter(mediaMulter, fieldName, AUDIO_MAX / (1024 * 1024));
export const uploadImages = (fieldName: string, maxFiles = 4) => wrapMulterArray(multiImageMulter, fieldName, maxFiles, IMAGE_MAX / (1024 * 1024));
