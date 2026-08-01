"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rsvpSelect = exports.eventSelect = exports.EVENT_VISIBILITIES = exports.RSVP_STATUSES = exports.EVENT_STATUSES = void 0;
exports.EVENT_STATUSES = ['scheduled', 'cancelled', 'completed'];
exports.RSVP_STATUSES = ['going', 'maybe', 'not_going'];
exports.EVENT_VISIBILITIES = ['public', 'private'];
exports.eventSelect = {
    id: true,
    groupId: true,
    createdBy: true,
    title: true,
    description: true,
    locationName: true,
    startsAt: true,
    endsAt: true,
    rsvpLimit: true,
    rsvpCount: true,
    status: true,
    visibility: true,
    createdAt: true,
    updatedAt: true,
};
exports.rsvpSelect = {
    id: true,
    eventId: true,
    userId: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    user: {
        select: {
            id: true,
            displayName: true,
            profilePhotoUrl: true,
        },
    },
};
//# sourceMappingURL=event.types.js.map