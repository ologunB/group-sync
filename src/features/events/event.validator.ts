import { body, param, query } from 'express-validator';
import { RSVP_STATUSES, EVENT_STATUSES, EVENT_VISIBILITIES, NEARBY_EVENT_SORTS } from './event.types';

export const eventIdParamValidator = [
    param('id').isUUID().withMessage('Event ID must be a valid UUID'),
];

export const groupIdParamValidator = [
    param('id').isUUID().withMessage('Group ID must be a valid UUID'),
];

export const createEventValidator = [
    body('title')
        .exists().withMessage('title is required')
        .isString().withMessage('title must be a string')
        .isLength({ min: 1, max: 200 }).withMessage('title must be between 1 and 200 characters'),

    body('description')
        .optional()
        .isString().withMessage('description must be a string'),

    body('location_name')
        .optional()
        .isString().withMessage('location_name must be a string')
        .isLength({ max: 255 }).withMessage('location_name must be 255 characters or fewer'),

    body('lat')
        .optional()
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),

    body('lng')
        .optional()
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),

    body('starts_at')
        .exists().withMessage('starts_at is required')
        .isISO8601().withMessage('starts_at must be a valid ISO 8601 date')
        .custom((value: string) => {
            if (new Date(value) <= new Date()) {
                throw new Error('starts_at must be in the future');
            }
            return true;
        }),

    body('ends_at')
        .optional()
        .isISO8601().withMessage('ends_at must be a valid ISO 8601 date')
        .custom((value: string, { req }) => {
            if (req.body.starts_at && new Date(value) <= new Date(req.body.starts_at)) {
                throw new Error('ends_at must be after starts_at');
            }
            return true;
        }),

    body('rsvp_limit')
        .optional()
        .isInt({ min: 1 }).withMessage('rsvp_limit must be a positive integer'),

    body('visibility')
        .optional()
        .isIn(EVENT_VISIBILITIES)
        .withMessage(`visibility must be one of: ${EVENT_VISIBILITIES.join(', ')}`),
];

export const updateEventValidator = [
    body('title')
        .optional()
        .isString().withMessage('title must be a string')
        .isLength({ min: 1, max: 200 }).withMessage('title must be between 1 and 200 characters'),

    body('description')
        .optional()
        .isString().withMessage('description must be a string'),

    body('location_name')
        .optional()
        .isString().withMessage('location_name must be a string'),

    body('lat')
        .optional()
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),

    body('lng')
        .optional()
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),

    body('starts_at')
        .optional()
        .isISO8601().withMessage('starts_at must be a valid ISO 8601 date'),

    body('ends_at')
        .optional()
        .isISO8601().withMessage('ends_at must be a valid ISO 8601 date'),

    body('rsvp_limit')
        .optional()
        .isInt({ min: 1 }).withMessage('rsvp_limit must be a positive integer'),

    body('visibility')
        .optional()
        .isIn(EVENT_VISIBILITIES)
        .withMessage(`visibility must be one of: ${EVENT_VISIBILITIES.join(', ')}`),

    body('status')
        .optional()
        .isIn(EVENT_STATUSES).withMessage(`status must be one of: ${EVENT_STATUSES.join(', ')}`),
];

export const rsvpValidator = [
    body('status')
        .exists().withMessage('status is required')
        .isIn(RSVP_STATUSES).withMessage(`status must be one of: ${RSVP_STATUSES.join(', ')}`),
];

export const listEventsValidator = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
    query('visibility')
        .optional()
        .isIn(EVENT_VISIBILITIES)
        .withMessage(`visibility must be one of: ${EVENT_VISIBILITIES.join(', ')}`),
];

// Nearby discovery. lat/lng are required — without a location there is nothing to
// anchor the search to, and silently returning global results would be misleading.
export const nearbyEventsValidator = [
    query('lat')
        .exists().withMessage('lat is required')
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90'),

    query('lng')
        .exists().withMessage('lng is required')
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be between -180 and 180'),

    query('radius_km')
        .optional()
        .isFloat({ min: 0.1, max: 500 }).withMessage('radius_km must be between 0.1 and 500'),

    query('category').optional().isString().withMessage('category must be a string'),

    query('sort')
        .optional()
        .isIn(NEARBY_EVENT_SORTS)
        .withMessage(`sort must be one of: ${NEARBY_EVENT_SORTS.join(', ')}`),

    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
];
