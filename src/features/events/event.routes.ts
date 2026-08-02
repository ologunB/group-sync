import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { authorizeGroupRole } from '../../shared/middleware/auth.middleware';
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

// RSVP routes
router.post(
    '/events/:id/rsvp',
    authenticate,
    validateRequest([...eventIdParamValidator, ...rsvpValidator]),
    eventController.rsvp,
);

router.patch(
    '/events/:id/rsvp',
    authenticate,
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
