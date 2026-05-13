"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageController = exports.MessageController = void 0;
const http_status_codes_1 = require("http-status-codes");
const response_helper_1 = require("../../shared/utils/response.helper");
const message_service_1 = require("./message.service");
class MessageController {
    listMessages = async (req, res, next) => {
        try {
            const query = {
                cursor: req.query.cursor,
                limit: req.query.limit ? parseInt(req.query.limit) : undefined,
                direction: req.query.direction,
            };
            const result = await message_service_1.messageService.listMessages(req.params.id, query, req.user);
            response_helper_1.ResponseHelper.success(res, result.data, 'Messages retrieved.', http_status_codes_1.StatusCodes.OK, {
                next_cursor: result.next_cursor,
                has_more: result.has_more,
            });
        }
        catch (error) {
            next(error);
        }
    };
    sendMessage = async (req, res, next) => {
        try {
            const media = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : undefined;
            const message = await message_service_1.messageService.sendMessage(req.params.id, req.body, req.user, media);
            response_helper_1.ResponseHelper.success(res, message, 'Message sent.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    deleteMessage = async (req, res, next) => {
        try {
            await message_service_1.messageService.deleteMessage(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Message deleted.');
        }
        catch (error) {
            next(error);
        }
    };
    togglePin = async (req, res, next) => {
        try {
            const message = await message_service_1.messageService.togglePin(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, message, 'Message pin updated.');
        }
        catch (error) {
            next(error);
        }
    };
    addReaction = async (req, res, next) => {
        try {
            await message_service_1.messageService.addReaction(req.params.id, req.body.emoji, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Reaction added.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    removeReaction = async (req, res, next) => {
        try {
            await message_service_1.messageService.removeReaction(req.params.id, req.body.emoji, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Reaction removed.');
        }
        catch (error) {
            next(error);
        }
    };
    listPinned = async (req, res, next) => {
        try {
            const messages = await message_service_1.messageService.listPinned(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, messages, 'Pinned messages retrieved.');
        }
        catch (error) {
            next(error);
        }
    };
    toggleChatLock = async (req, res, next) => {
        try {
            const result = await message_service_1.messageService.toggleChatLock(req.params.id, req.body.locked, req.user);
            response_helper_1.ResponseHelper.success(res, result, `Chat ${result.is_chat_locked ? 'locked' : 'unlocked'}.`);
        }
        catch (error) {
            next(error);
        }
    };
}
exports.MessageController = MessageController;
exports.messageController = new MessageController();
//# sourceMappingURL=message.controller.js.map