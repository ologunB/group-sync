"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequest = void 0;
const express_validator_1 = require("express-validator");
const http_status_codes_1 = require("http-status-codes");
const error_middleware_1 = require("../middleware/error.middleware");
const response_constants_1 = require("./response.constants");
/**
 * Wraps an array of express-validator ValidationChain objects into Express
 * middleware. All chains run in parallel; on failure, a 422 ApiError is thrown
 * with an array of human-readable messages.
 */
const validateRequest = (chains) => {
    return [
        ...chains,
        (req, _res, next) => {
            const result = (0, express_validator_1.validationResult)(req);
            if (!result.isEmpty()) {
                const messages = result.array().map((e) => e.msg);
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.VALIDATION_FAILED, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY, messages));
            }
            next();
        },
    ];
};
exports.validateRequest = validateRequest;
//# sourceMappingURL=validators.js.map