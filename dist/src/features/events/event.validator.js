"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nearbyEventsValidator = exports.listEventsValidator = exports.rsvpValidator = exports.updateEventValidator = exports.createEventValidator = exports.groupIdParamValidator = exports.eventIdParamValidator = void 0;
const express_validator_1 = require("express-validator");
const event_types_1 = require("./event.types");
exports.eventIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Event ID must be a valid UUID'),
];
exports.groupIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Group ID must be a valid UUID'),
];
exports.createEventValidator = [
    (0, express_validator_1.body)('title')
        .exists().withMessage('title is required')
        .isString().withMessage('title must be a string')
        .isLength({ min: 1, max: 200 }).withMessage('title must be between 1 and 200 characters'),
    (0, express_validator_1.body)('description')
        .optional()
        .isString().withMessage('description must be a string'),
    (0, express_validator_1.body)('location_name')
        .optional()
        .isString().withMessage('location_name must be a string')
        .isLength({ max: 255 }).withMessage('location_name must be 255 characters or fewer'),
    // Public area label. Shown on every event card so people can judge distance.
    (0, express_validator_1.body)('venue_city')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('venue_city must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('venue_city must be 100 characters or fewer'),
    (0, express_validator_1.body)('venue_state')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('venue_state must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('venue_state must be 100 characters or fewer'),
    // Exact street address — members only, and gated on a verified ID in the service.
    (0, express_validator_1.body)('venue_address')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('venue_address must be a string')
        .trim()
        .isLength({ min: 5, max: 500 }).withMessage('venue_address must be between 5 and 500 characters'),
    (0, express_validator_1.body)('lat')
        .optional()
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
    (0, express_validator_1.body)('lng')
        .optional()
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
    (0, express_validator_1.body)('starts_at')
        .exists().withMessage('starts_at is required')
        .isISO8601().withMessage('starts_at must be a valid ISO 8601 date')
        .custom((value) => {
        if (new Date(value) <= new Date()) {
            throw new Error('starts_at must be in the future');
        }
        return true;
    }),
    (0, express_validator_1.body)('ends_at')
        .optional()
        .isISO8601().withMessage('ends_at must be a valid ISO 8601 date')
        .custom((value, { req }) => {
        if (req.body.starts_at && new Date(value) <= new Date(req.body.starts_at)) {
            throw new Error('ends_at must be after starts_at');
        }
        return true;
    }),
    (0, express_validator_1.body)('rsvp_limit')
        .optional()
        .isInt({ min: 1 }).withMessage('rsvp_limit must be a positive integer'),
    (0, express_validator_1.body)('visibility')
        .optional()
        .isIn(event_types_1.EVENT_VISIBILITIES)
        .withMessage(`visibility must be one of: ${event_types_1.EVENT_VISIBILITIES.join(', ')}`),
];
exports.updateEventValidator = [
    (0, express_validator_1.body)('title')
        .optional()
        .isString().withMessage('title must be a string')
        .isLength({ min: 1, max: 200 }).withMessage('title must be between 1 and 200 characters'),
    (0, express_validator_1.body)('description')
        .optional()
        .isString().withMessage('description must be a string'),
    (0, express_validator_1.body)('location_name')
        .optional()
        .isString().withMessage('location_name must be a string'),
    // Public area label. Shown on every event card so people can judge distance.
    (0, express_validator_1.body)('venue_city')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('venue_city must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('venue_city must be 100 characters or fewer'),
    (0, express_validator_1.body)('venue_state')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('venue_state must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('venue_state must be 100 characters or fewer'),
    // Exact street address — members only, and gated on a verified ID in the service.
    (0, express_validator_1.body)('venue_address')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('venue_address must be a string')
        .trim()
        .isLength({ min: 5, max: 500 }).withMessage('venue_address must be between 5 and 500 characters'),
    (0, express_validator_1.body)('lat')
        .optional()
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
    (0, express_validator_1.body)('lng')
        .optional()
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
    (0, express_validator_1.body)('starts_at')
        .optional()
        .isISO8601().withMessage('starts_at must be a valid ISO 8601 date'),
    (0, express_validator_1.body)('ends_at')
        .optional()
        .isISO8601().withMessage('ends_at must be a valid ISO 8601 date'),
    (0, express_validator_1.body)('rsvp_limit')
        .optional()
        .isInt({ min: 1 }).withMessage('rsvp_limit must be a positive integer'),
    (0, express_validator_1.body)('visibility')
        .optional()
        .isIn(event_types_1.EVENT_VISIBILITIES)
        .withMessage(`visibility must be one of: ${event_types_1.EVENT_VISIBILITIES.join(', ')}`),
    (0, express_validator_1.body)('status')
        .optional()
        .isIn(event_types_1.EVENT_STATUSES).withMessage(`status must be one of: ${event_types_1.EVENT_STATUSES.join(', ')}`),
];
exports.rsvpValidator = [
    (0, express_validator_1.body)('status')
        .exists().withMessage('status is required')
        .isIn(event_types_1.RSVP_STATUSES).withMessage(`status must be one of: ${event_types_1.RSVP_STATUSES.join(', ')}`),
];
exports.listEventsValidator = [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
    (0, express_validator_1.query)('visibility')
        .optional()
        .isIn(event_types_1.EVENT_VISIBILITIES)
        .withMessage(`visibility must be one of: ${event_types_1.EVENT_VISIBILITIES.join(', ')}`),
];
// Nearby discovery. lat/lng are required — without a location there is nothing to
// anchor the search to, and silently returning global results would be misleading.
exports.nearbyEventsValidator = [
    (0, express_validator_1.query)('lat')
        .exists().withMessage('lat is required')
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90'),
    (0, express_validator_1.query)('lng')
        .exists().withMessage('lng is required')
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be between -180 and 180'),
    (0, express_validator_1.query)('radius_km')
        .optional()
        .isFloat({ min: 0.1, max: 500 }).withMessage('radius_km must be between 0.1 and 500'),
    (0, express_validator_1.query)('category').optional().isString().withMessage('category must be a string'),
    (0, express_validator_1.query)('sort')
        .optional()
        .isIn(event_types_1.NEARBY_EVENT_SORTS)
        .withMessage(`sort must be one of: ${event_types_1.NEARBY_EVENT_SORTS.join(', ')}`),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
];
//# sourceMappingURL=event.validator.js.map