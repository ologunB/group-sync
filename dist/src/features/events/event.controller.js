"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventController = exports.EventController = void 0;
const http_status_codes_1 = require("http-status-codes");
const response_helper_1 = require("../../shared/utils/response.helper");
const event_service_1 = require("./event.service");
class EventController {
    createEvent = async (req, res, next) => {
        try {
            const event = await event_service_1.eventService.createEvent(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, event, 'Event created successfully.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    listEvents = async (req, res, next) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 20, 50);
            const visibility = req.query.visibility;
            const result = await event_service_1.eventService.listEvents(req.params.id, page, limit, req.user, visibility);
            response_helper_1.ResponseHelper.success(res, result.data, 'Events retrieved successfully.', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // GET /events/:id/calendar.ics
    //
    // The one endpoint that does not use ResponseHelper: it returns a file, not the JSON
    // envelope. Calendar clients follow this URL directly and would choke on JSON.
    downloadCalendar = async (req, res, next) => {
        try {
            const { filename, content } = await event_service_1.eventService.getCalendarFile(req.params.id, req.user);
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(content);
        }
        catch (error) {
            next(error);
        }
    };
    listNearbyEvents = async (req, res, next) => {
        try {
            const result = await event_service_1.eventService.listNearbyEvents({
                lat: parseFloat(req.query.lat),
                lng: parseFloat(req.query.lng),
                radius_km: req.query.radius_km ? parseFloat(req.query.radius_km) : undefined,
                category: req.query.category,
                sort: req.query.sort,
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            }, req.user.userId);
            response_helper_1.ResponseHelper.success(res, result.data, 'Nearby events retrieved successfully.', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    getEvent = async (req, res, next) => {
        try {
            const event = await event_service_1.eventService.getEvent(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, event, 'Event retrieved successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    updateEvent = async (req, res, next) => {
        try {
            const event = await event_service_1.eventService.updateEvent(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, event, 'Event updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    deleteEvent = async (req, res, next) => {
        try {
            await event_service_1.eventService.deleteEvent(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Event cancelled.');
        }
        catch (error) {
            next(error);
        }
    };
    rsvp = async (req, res, next) => {
        try {
            const rsvp = await event_service_1.eventService.rsvp(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, rsvp, 'RSVP submitted successfully.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    updateRsvp = async (req, res, next) => {
        try {
            const rsvp = await event_service_1.eventService.updateRsvp(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, rsvp, 'RSVP updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    cancelRsvp = async (req, res, next) => {
        try {
            await event_service_1.eventService.cancelRsvp(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'RSVP cancelled.');
        }
        catch (error) {
            next(error);
        }
    };
    listRsvps = async (req, res, next) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 20, 50);
            const result = await event_service_1.eventService.listRsvps(req.params.id, page, limit, req.user);
            response_helper_1.ResponseHelper.success(res, result.data, 'RSVPs retrieved successfully.', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
}
exports.EventController = EventController;
exports.eventController = new EventController();
//# sourceMappingURL=event.controller.js.map