"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseHelper = void 0;
const http_status_codes_1 = require("http-status-codes");
class ResponseHelper {
    static success(res, data, message = 'Success', statusCode = http_status_codes_1.StatusCodes.OK, pagination) {
        const body = { success: true, message, data };
        if (pagination)
            body.pagination = pagination;
        res.status(statusCode).json(body);
    }
    static cursor(res, data, next_cursor = null, has_more = false, message = 'Success') {
        const body = { success: true, message, data, next_cursor, has_more };
        res.status(http_status_codes_1.StatusCodes.OK).json(body);
    }
    static error(res, message, statusCode = http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR, error = null) {
        const body = { success: false, message, data: null, error };
        res.status(statusCode).json(body);
    }
}
exports.ResponseHelper = ResponseHelper;
//# sourceMappingURL=response.helper.js.map