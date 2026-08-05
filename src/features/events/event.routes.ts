import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { authorizeGroupRole } from '../../shared/middleware/auth.middleware';
import { authenticateContactVerified } from '../../shared/middleware/verification.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { eventController } from './event.controller';
import {
    groupIdParamValidator,
    eventIdParamValidator,
    createEventValidator,
    updateEventValidator,
    rsvpValidator,
    listEventsValidator,
    nearbyEventsValidator,
} from './event.validator';

const router = Router();

// Group-scoped event routes
router.post(
    '/groups/:id/events',
    authenticate,
    validateRequest([...groupIdParamValidator, ...createEventValidator]),
    authorizeGroupRole('super_admin', 'admin'),
    eventController.createEvent,
);

router.get(
    '/groups/:id/events',
    authenticate,
    validateRequest([...groupIdParamValidator, ...listEventsValidator]),
    eventController.listEvents,
);

// Event-level routes
// NOTE: must stay above '/events/:id' — otherwise ':id' matches the literal 'near'
// and the UUID validator rejects it with a 400.
router.get(
    '/events/near',
    authenticate,
    validateRequest(nearbyEventsValidator),
    eventController.listNearbyEvents,
);

// Returns a text/calendar file rather than the JSON envelope — calendar clients follow
// this URL directly. Visibility rules match GET /events/:id.
router.get(
    '/events/:id/calendar.ics',
    authenticate,
    validateRequest(eventIdParamValidator),
    eventController.downloadCalendar,
);

router.get(
    '/events/:id',
    authenticate,
    validateRequest(eventIdParamValidator),
    eventController.getEvent,
);

router.patch(
    '/events/:id',
    authenticate,
    validateRequest([...eventIdParamValidator, ...updateEventValidator]),
    eventController.updateEvent,
);

router.delete(
    '/events/:id',
    authenticate,
    validateRequest(eventIdParamValidator),
    eventController.deleteEvent,
);

// RSVP routes — attending an event is tier 1 (email + phone verified)
router.post(
    '/events/:id/rsvp',
    authenticateContactVerified,
    validateRequest([...eventIdParamValidator, ...rsvpValidator]),
    eventController.rsvp,
);

router.patch(
    '/events/:id/rsvp',
    authenticateContactVerified,
    validateRequest([...eventIdParamValidator, ...rsvpValidator]),
    eventController.updateRsvp,
);

router.delete(
    '/events/:id/rsvp',
    authenticate,
    validateRequest(eventIdParamValidator),
    eventController.cancelRsvp,
);

router.get(
    '/events/:id/rsvps',
    authenticate,
    validateRequest([...eventIdParamValidator, ...listEventsValidator]),
    eventController.listRsvps,
);

export default router;
