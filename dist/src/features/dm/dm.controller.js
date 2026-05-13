"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dmController = exports.DmController = void 0;
const http_status_codes_1 = require("http-status-codes");
const response_helper_1 = require("../../shared/utils/response.helper");
const dm_service_1 = require("./dm.service");
class DmController {
    listConversations = async (req, res, next) => {
        try {
            const query = {
                type: req.query.type,
            };
            const data = await dm_service_1.dmService.listConversations(req.user, query);
            response_helper_1.ResponseHelper.success(res, data, 'Conversations retrieved.');
        }
        catch (error) {
            next(error);
        }
    };
    getThread = async (req, res, next) => {
        try {
            const query = {
                cursor: req.query.cursor,
                limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            };
            const result = await dm_service_1.dmService.getThread(req.params.userId, query, req.user);
            response_helper_1.ResponseHelper.success(res, result.data, 'Thread retrieved.', http_status_codes_1.StatusCodes.OK, {
                next_cursor: result.next_cursor,
                has_more: result.has_more,
            });
        }
        catch (error) {
            next(error);
        }
    };
    sendDm = async (req, res, next) => {
        try {
            const media = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : undefined;
            const dm = await dm_service_1.dmService.sendDm(req.params.userId, req.body, req.user, media);
            response_helper_1.ResponseHelper.success(res, dm, 'DM sent.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    markRead = async (req, res, next) => {
        try {
            const result = await dm_service_1.dmService.markRead(req.params.userId, req.user);
            response_helper_1.ResponseHelper.success(res, result, 'Thread marked as read.');
        }
        catch (error) {
            next(error);
        }
    };
    deleteDm = async (req, res, next) => {
        try {
            await dm_service_1.dmService.deleteDm(req.params.dmId, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Message deleted.');
        }
        catch (error) {
            next(error);
        }
    };
}
exports.DmController = DmController;
exports.dmController = new DmController();
//# sourceMappingURL=dm.controller.js.map