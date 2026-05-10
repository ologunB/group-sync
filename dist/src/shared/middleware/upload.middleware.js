"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImage = void 0;
const multer_1 = __importDefault(require("multer"));
const http_status_codes_1 = require("http-status-codes");
const error_middleware_1 = require("./error.middleware");
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
function imageFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
}
const multerInstance = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: imageFilter,
});
// Wraps multer.single() so that:
//   - LIMIT_FILE_SIZE   → 413 Payload Too Large
//   - fileFilter errors → 422 Unprocessable Entity
//   - Other multer errors → 422
const uploadImage = (fieldName) => (req, res, next) => {
    multerInstance.single(fieldName)(req, res, (err) => {
        if (!err)
            return next();
        if (err instanceof multer_1.default.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return next(new error_middleware_1.ApiError(`File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`, http_status_codes_1.StatusCodes.REQUEST_TOO_LONG));
            }
            return next(new error_middleware_1.ApiError(err.message, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
        }
        // fileFilter rejection (plain Error)
        return next(new error_middleware_1.ApiError(err.message, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY));
    });
};
exports.uploadImage = uploadImage;
//# sourceMappingURL=upload.middleware.js.map