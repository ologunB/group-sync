"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rsvpSelect = exports.eventSelect = exports.NEARBY_EVENT_SORTS = exports.EVENT_VISIBILITIES = exports.RSVP_STATUSES = exports.EVENT_STATUSES = void 0;
exports.buildVenueArea = buildVenueArea;
exports.EVENT_STATUSES = ['scheduled', 'cancelled', 'completed'];
exports.RSVP_STATUSES = ['going', 'maybe', 'not_going'];
exports.EVENT_VISIBILITIES = ['public', 'private'];
// ─── Nearby event discovery ───────────────────────────────────────────────────
// Cross-group, membership-independent. Every other event read is scoped to one
// group, which is why a brand-new account with no memberships saw nothing.
exports.NEARBY_EVENT_SORTS = ['distance', 'soonest'];
exports.eventSelect = {
    id: true,
    groupId: true,
    createdBy: true,
    title: true,
    description: true,
    locationName: true,
    venueCity: true,
    venueState: true,
    venueAddress: true,
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
/** Builds the public "City, State" label from whichever venue parts were supplied. */
function buildVenueArea(event) {
    const parts = [event.venueCity, event.venueState].filter((p) => Boolean(p?.trim()));
    return parts.length > 0 ? parts.join(', ') : null;
}
//# sourceMappingURL=event.types.js.map