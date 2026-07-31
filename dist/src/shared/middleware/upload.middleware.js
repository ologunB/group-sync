"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImages = exports.uploadMedia = exports.uploadImage = void 0;
const multer_1 = __importDefault(require("multer"));
const http_status_codes_1 = require("http-status-codes");
const error_middleware_1 = require("./error.middleware");
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/opus',
    'audio/flac', 'audio/webm',
    'video/webm']; // Chrome/Edge MediaRecorder reports audio as video/webm
const IMAGE_MAX = 5 * 1024 * 1024; // 5 MB
const AUDIO_MAX = 20 * 1024 * 1024; // 20 MB
function makeFilter(cb, file, allowed, label) {
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error(`Only ${label} files are allowed`));
    }
}
// Image-only uploader (existing behaviour, unchanged)
const imageMulter = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: IMAGE_MAX },
    fileFilter: (_req, file, cb) => makeFilter(cb, file, ALLOWED_IMAGE_TYPES, 'JPEG, PNG, and WebP image'),
});
// Image + audio uploader (for group messages and DMs)
const mediaMulter = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: AUDIO_MAX },
    fileFilter: (_req, file, cb) => {
        if ([...ALLOWED_IMAGE_TYPES, ...ALLOWED_AUDIO_TYPES].includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image (JPEG/PNG/WebP) or audio (MP3/OGG/WAV/M4A/AAC/OPUS) files are allowed'));
        }
    },
});
// Multi-image uploader (for feed posts — up to 4 images)
const multiImageMulter = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: IMAGE_MAX, files: 4 },
    fileFilter: (_req, file, cb) => makeFilter(cb, file, ALLOWED_IMAGE_TYPES, 'JPEG, PNG, and WebP image'),
});
function wrapMulter(instance, fieldName, maxMb) {
    return (req, res, next) => {
        instance.single(fieldName)(req, res, (err) => {
            if (!err)
                return next();
            if (err instanceof multer_1.default.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new error_middleware_1.ApiError(`File too large. Maximum allowed size is ${maxMb} MB.`, http_status_codes_1.StatusCodes.REQUEST_TOO_LONG));
                }
                return next(new error_middleware_1.ApiError(err.message, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
            }
            return next(new error_middleware_1.ApiError(err.message, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
        });
    };
}
function wrapMulterArray(instance, fieldName, maxFiles, maxMb) {
    return (req, res, next) => {
        instance.array(fieldName, maxFiles)(req, res, (err) => {
            if (!err)
                return next();
            if (err instanceof multer_1.default.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new error_middleware_1.ApiError(`File too large. Maximum allowed size is ${maxMb} MB.`, http_status_codes_1.StatusCodes.REQUEST_TOO_LONG));
                }
                if (err.code === 'LIMIT_FILE_COUNT') {
                    return next(new error_middleware_1.ApiError(`Too many files. Maximum ${maxFiles} images allowed.`, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
                }
                return next(new error_middleware_1.ApiError(err.message, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
            }
            return next(new error_middleware_1.ApiError(err.message, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
        });
    };
}
const uploadImage = (fieldName) => wrapMulter(imageMulter, fieldName, IMAGE_MAX / (1024 * 1024));
exports.uploadImage = uploadImage;
const uploadMedia = (fieldName) => wrapMulter(mediaMulter, fieldName, AUDIO_MAX / (1024 * 1024));
exports.uploadMedia = uploadMedia;
const uploadImages = (fieldName, maxFiles = 4) => wrapMulterArray(multiImageMulter, fieldName, maxFiles, IMAGE_MAX / (1024 * 1024));
exports.uploadImages = uploadImages;
//# sourceMappingURL=upload.middleware.js.map