"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const auth_middleware_2 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const event_controller_1 = require("./event.controller");
const event_validator_1 = require("./event.validator");
const router = (0, express_1.Router)();
// Group-scoped event routes
router.post('/groups/:id/events', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...event_validator_1.groupIdParamValidator, ...event_validator_1.createEventValidator]), (0, auth_middleware_2.authorizeGroupRole)('super_admin', 'admin'), event_controller_1.eventController.createEvent);
router.get('/groups/:id/events', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...event_validator_1.groupIdParamValidator, ...event_validator_1.listEventsValidator]), event_controller_1.eventController.listEvents);
// Event-level routes
router.get('/events/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(event_validator_1.eventIdParamValidator), event_controller_1.eventController.getEvent);
router.patch('/events/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...event_validator_1.eventIdParamValidator, ...event_validator_1.updateEventValidator]), event_controller_1.eventController.updateEvent);
router.delete('/events/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(event_validator_1.eventIdParamValidator), event_controller_1.eventController.deleteEvent);
// RSVP routes
router.post('/events/:id/rsvp', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...event_validator_1.eventIdParamValidator, ...event_validator_1.rsvpValidator]), event_controller_1.eventController.rsvp);
router.patch('/events/:id/rsvp', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...event_validator_1.eventIdParamValidator, ...event_validator_1.rsvpValidator]), event_controller_1.eventController.updateRsvp);
router.delete('/events/:id/rsvp', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(event_validator_1.eventIdParamValidator), event_controller_1.eventController.cancelRsvp);
router.get('/events/:id/rsvps', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...event_validator_1.eventIdParamValidator, ...event_validator_1.listEventsValidator]), event_controller_1.eventController.listRsvps);
exports.default = router;
//# sourceMappingURL=event.routes.js.map