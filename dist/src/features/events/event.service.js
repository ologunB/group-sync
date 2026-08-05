"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventService = exports.EventService = void 0;
const http_status_codes_1 = require("http-status-codes");
const client_1 = require("@prisma/client");
const connection_1 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const app_config_1 = require("../../shared/config/app.config");
const verification_middleware_1 = require("../../shared/middleware/verification.middleware");
const notification_dispatcher_1 = require("../notifications/notification.dispatcher");
const calendar_1 = require("../../shared/utils/calendar");
const event_types_1 = require("./event.types");
function calendarLinks(event, location) {
    const calendarEvent = {
        id: event.id,
        title: event.title,
        description: event.description,
        location,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        url: (0, calendar_1.buildEventUrl)(event.id),
    };
    return {
        // Relative so the client is not tied to whichever host served the JSON.
        ics: `${app_config_1.config.server.apiPrefix}/events/${event.id}/calendar.ics`,
        google: (0, calendar_1.buildGoogleCalendarUrl)(calendarEvent),
    };
}
/**
 * The one place an event becomes a response body.
 *
 * `venueAddress` is deleted rather than nulled for non-members: a null would tell a
 * stranger the field exists but is hidden, and the distinction between "no address set"
 * and "address withheld" is not theirs to learn. Everything else — including the public
 * `venueArea` label and the calendar links — is the same for every caller.
 */
function serializeEvent(event, canSeeExactAddress) {
    const venueArea = (0, event_types_1.buildVenueArea)(event);
    const { venueAddress, ...rest } = event;
    return {
        ...rest,
        venueArea,
        ...(canSeeExactAddress ? { venueAddress } : {}),
        canSeeExactAddress,
        // Members get the exact address in their calendar entry; everyone else gets the
        // area label, so the .ics is still useful without leaking the street.
        calendar: calendarLinks(event, (canSeeExactAddress ? venueAddress : null) ?? venueArea),
    };
}
async function requireGroupAdmin(groupId, userId) {
    const membership = await connection_1.prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
    if (!membership || membership.status !== 'active' || !['super_admin', 'admin'].includes(membership.role)) {
        throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
    }
}
// Non-members get the public preview: public events only. Reads used to apply no membership
// check at all, so any authenticated user could read every event of any group.
async function isActiveMember(groupId, userId) {
    const membership = await connection_1.prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { status: true },
    });
    return membership?.status === 'active';
}
/**
 * Who may see the exact street address.
 *
 * Active members, plus anyone holding a going/maybe RSVP. The RSVP clause matters:
 * public events can be RSVP'd by non-members, and telling someone they are attending
 * while withholding where it is makes the RSVP useless. Declining ('not_going') does
 * not qualify — that person opted out.
 */
async function canSeeExactAddress(eventId, groupId, userId) {
    const [member, rsvp] = await Promise.all([
        isActiveMember(groupId, userId),
        connection_1.prisma.eventRsvp.findUnique({
            where: { eventId_userId: { eventId, userId } },
            select: { status: true },
        }),
    ]);
    return member || rsvp?.status === 'going' || rsvp?.status === 'maybe';
}
class EventService {
    // ── createEvent ───────────────────────────────────────────────────────────
    async createEvent(groupId, dto, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { id: true, name: true, slug: true, status: true },
            });
            if (!group || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Tier 3: publishing a street address means real people show up at a real
            // place, so the organiser has to have cleared ID verification first.
            if (dto.venue_address?.trim() && !(await (0, verification_middleware_1.hasVerifiedId)(actor.userId))) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ID_REQUIRED_FOR_PHYSICAL_EVENT, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const event = await connection_1.prisma.event.create({
                data: {
                    groupId,
                    createdBy: actor.userId,
                    title: dto.title.trim(),
                    description: dto.description?.trim() ?? null,
                    locationName: dto.location_name?.trim() ?? null,
                    venueCity: dto.venue_city?.trim() ?? null,
                    venueState: dto.venue_state?.trim() ?? null,
                    venueAddress: dto.venue_address?.trim() ?? null,
                    startsAt: new Date(dto.starts_at),
                    endsAt: dto.ends_at ? new Date(dto.ends_at) : null,
                    rsvpLimit: dto.rsvp_limit ?? null,
                    status: 'scheduled',
                    visibility: dto.visibility ?? 'private',
                },
                select: event_types_1.eventSelect,
            });
            // Set PostGIS location if provided
            if (dto.lat !== undefined && dto.lng !== undefined) {
                await connection_1.prisma.$executeRaw `
                    UPDATE events
                    SET location_point = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
                    WHERE id = ${event.id}::uuid
                `;
            }
            const venueArea = (0, event_types_1.buildVenueArea)(event);
            // In-app + email to every member except the organiser, who already knows.
            await notification_dispatcher_1.NotificationDispatcher.dispatchToGroup(groupId, {
                type: 'event_created',
                title: `New event in ${group.name}`,
                body: venueArea ? `${event.title} — ${venueArea}` : event.title,
                referenceType: 'event',
                referenceId: event.id,
                email: {
                    subject: `New event in ${group.name}: ${event.title}`,
                    template: 'event_created',
                    data: {
                        groupName: group.name,
                        eventTitle: event.title,
                        eventDescription: event.description ?? '',
                        venueArea: venueArea ?? 'Location to be announced',
                        startsAt: event.startsAt.toISOString(),
                        eventUrl: (0, calendar_1.buildEventUrl)(event.id),
                        googleCalendarUrl: (0, calendar_1.buildGoogleCalendarUrl)({
                            id: event.id,
                            title: event.title,
                            description: event.description,
                            location: venueArea,
                            startsAt: event.startsAt,
                            endsAt: event.endsAt,
                            url: (0, calendar_1.buildEventUrl)(event.id),
                        }),
                    },
                },
            }, { excludeUserIds: [actor.userId] });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_CREATE, audit_logger_1.ResourceTypes.EVENT, event.id, 1, { groupId });
            // The organiser is an active member, so they always see the exact address.
            return serializeEvent(event, true);
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_CREATE, audit_logger_1.ResourceTypes.EVENT, null, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.createEvent error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── listEvents ────────────────────────────────────────────────────────────
    async listEvents(groupId, page, limit, actor, visibility) {
        try {
            const skip = (page - 1) * limit;
            const isMember = await isActiveMember(groupId, actor.userId);
            // Intersect what was asked for with what the caller may see, rather than overriding
            // it. Overriding meant a non-member asking ?visibility=private got the *public*
            // events back — not a leak, but it answered a different question than it was asked.
            // An empty intersection yields `in: []`, which correctly matches nothing.
            const allowed = isMember ? ['public', 'private'] : ['public'];
            const effective = visibility ? allowed.filter((v) => v === visibility) : allowed;
            const where = {
                groupId,
                status: { not: 'cancelled' },
                visibility: { in: effective },
            };
            const [rows, total] = await Promise.all([
                connection_1.prisma.event.findMany({
                    where,
                    select: event_types_1.eventSelect,
                    orderBy: { startsAt: 'asc' },
                    skip,
                    take: limit,
                }),
                connection_1.prisma.event.count({ where }),
            ]);
            return {
                data: rows.map((row) => serializeEvent(row, isMember)),
                pagination: { page, limit, total },
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.listEvents error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── listNearbyEvents ──────────────────────────────────────────────────────
    // Cross-group discovery. Deliberately NOT scoped to the caller's memberships:
    // every other event read is group-scoped, so a new account with no groups had
    // nothing to show. Only public events from discoverable groups surface here.
    async listNearbyEvents(query, actorId) {
        try {
            const page = Math.max(1, query.page ?? 1);
            const limit = Math.min(50, Math.max(1, query.limit ?? 20));
            const skip = (page - 1) * limit;
            const radiusMeters = (query.radius_km ?? 50) * 1000;
            const sort = query.sort ?? 'distance';
            const conditions = [
                // Only events the caller is allowed to discover without membership.
                client_1.Prisma.sql `e.visibility = 'public'`,
                client_1.Prisma.sql `e.status <> 'cancelled'`,
                // Discovery is forward-looking; past events are not "near you" any more.
                client_1.Prisma.sql `e.starts_at >= NOW()`,
                client_1.Prisma.sql `e.location_point IS NOT NULL`,
                // The group must itself be discoverable, or this would leak the existence
                // of invite-only groups through their events. Members still see their own
                // groups' public events here, matching GroupService.listGroups.
                client_1.Prisma.sql `g.status = 'active'`,
                client_1.Prisma.sql `g.deleted_at IS NULL`,
                client_1.Prisma.sql `
                    (g.is_discoverable = TRUE OR EXISTS (
                        SELECT 1 FROM memberships m
                        WHERE m.group_id = g.id
                          AND m.user_id = ${actorId}::uuid
                          AND m.status = 'active'
                    ))
                `,
                client_1.Prisma.sql `
                    ST_DWithin(
                        e.location_point::geography,
                        ST_MakePoint(${query.lng}, ${query.lat})::geography,
                        ${radiusMeters}
                    )
                `,
            ];
            if (query.category) {
                conditions.push(client_1.Prisma.sql `g.category ILIKE ${query.category}`);
            }
            const whereClause = client_1.Prisma.sql `WHERE ${client_1.Prisma.join(conditions, ' AND ')}`;
            const orderClause = sort === 'soonest'
                ? client_1.Prisma.sql `ORDER BY e.starts_at ASC`
                : client_1.Prisma.sql `ORDER BY distance_m ASC, e.starts_at ASC`;
            const [data, countResult] = await Promise.all([
                connection_1.prisma.$queryRaw `
                    SELECT
                        e.id, e.group_id AS "groupId", e.title, e.description,
                        e.location_name AS "locationName",
                        -- venue_address is deliberately absent: nearby results are
                        -- cross-group discovery, so the caller is a non-member by default.
                        e.venue_city AS "venueCity", e.venue_state AS "venueState",
                        e.starts_at AS "startsAt", e.ends_at AS "endsAt",
                        e.rsvp_limit AS "rsvpLimit", e.rsvp_count AS "rsvpCount",
                        e.status, e.visibility, e.created_at AS "createdAt",
                        ROUND((ST_Distance(
                            e.location_point::geography,
                            ST_MakePoint(${query.lng}, ${query.lat})::geography
                        ) / 1000)::numeric, 2)::float8 AS "distanceKm",
                        ST_Distance(
                            e.location_point::geography,
                            ST_MakePoint(${query.lng}, ${query.lat})::geography
                        ) AS distance_m,
                        g.name AS "groupName", g.slug AS "groupSlug",
                        g.logo_url AS "groupLogoUrl", g.category AS "groupCategory"
                    FROM events e
                    JOIN groups g ON g.id = e.group_id
                    ${whereClause}
                    ${orderClause}
                    LIMIT ${limit} OFFSET ${skip}
                `,
                connection_1.prisma.$queryRaw `
                    SELECT COUNT(*) as count
                    FROM events e
                    JOIN groups g ON g.id = e.group_id
                    ${whereClause}
                `,
            ]);
            return {
                data: data.map(({ ...row }) => {
                    delete row.distance_m;
                    const venueArea = (0, event_types_1.buildVenueArea)(row);
                    return {
                        ...row,
                        venueArea,
                        calendar: {
                            ics: `${app_config_1.config.server.apiPrefix}/events/${row.id}/calendar.ics`,
                            google: (0, calendar_1.buildGoogleCalendarUrl)({
                                id: row.id,
                                title: row.title,
                                description: row.description,
                                location: venueArea,
                                startsAt: new Date(row.startsAt),
                                endsAt: row.endsAt ? new Date(row.endsAt) : null,
                                url: (0, calendar_1.buildEventUrl)(row.id),
                            }),
                        },
                    };
                }),
                pagination: { page, limit, total: Number(countResult[0]?.count ?? 0) },
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.listNearbyEvents error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getEvent ──────────────────────────────────────────────────────────────
    async getEvent(eventId, actor) {
        try {
            const event = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: event_types_1.eventSelect,
            });
            if (!event) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const isMember = await isActiveMember(event.groupId, actor.userId);
            // Private events are members-only. 404 rather than 403 so a non-member can't probe
            // for the existence of a group's private events.
            if (event.visibility !== 'public' && !isMember) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const myRsvp = await connection_1.prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { status: true },
            });
            const showAddress = isMember || myRsvp?.status === 'going' || myRsvp?.status === 'maybe';
            return { ...serializeEvent(event, showAddress), myRsvp: myRsvp?.status ?? null };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.getEvent error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── updateEvent ───────────────────────────────────────────────────────────
    async updateEvent(eventId, dto, actor) {
        try {
            const existing = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, groupId: true },
            });
            if (!existing) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await requireGroupAdmin(existing.groupId, actor.userId);
            // Same tier 3 gate as create — adding an address after the fact is the same act.
            if (dto.venue_address?.trim() && !(await (0, verification_middleware_1.hasVerifiedId)(actor.userId))) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ID_REQUIRED_FOR_PHYSICAL_EVENT, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const event = await connection_1.prisma.event.update({
                where: { id: eventId },
                data: {
                    ...(dto.title !== undefined && { title: dto.title.trim() }),
                    ...(dto.description !== undefined && { description: dto.description.trim() }),
                    ...(dto.location_name !== undefined && { locationName: dto.location_name.trim() }),
                    ...(dto.venue_city !== undefined && { venueCity: dto.venue_city?.trim() || null }),
                    ...(dto.venue_state !== undefined && { venueState: dto.venue_state?.trim() || null }),
                    ...(dto.venue_address !== undefined && { venueAddress: dto.venue_address?.trim() || null }),
                    ...(dto.starts_at !== undefined && { startsAt: new Date(dto.starts_at) }),
                    ...(dto.ends_at !== undefined && { endsAt: new Date(dto.ends_at) }),
                    ...(dto.rsvp_limit !== undefined && { rsvpLimit: dto.rsvp_limit }),
                    ...(dto.status !== undefined && { status: dto.status }),
                    ...(dto.visibility !== undefined && { visibility: dto.visibility }),
                },
                select: event_types_1.eventSelect,
            });
            if (dto.lat !== undefined && dto.lng !== undefined) {
                await connection_1.prisma.$executeRaw `
                    UPDATE events
                    SET location_point = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
                    WHERE id = ${event.id}::uuid
                `;
            }
            // Time and place changes are the ones people need to hear about — a typo fix in
            // the description is not worth a notification.
            const materialChange = dto.starts_at !== undefined ||
                dto.ends_at !== undefined ||
                dto.venue_address !== undefined ||
                dto.venue_city !== undefined ||
                dto.venue_state !== undefined;
            if (materialChange) {
                await this.notifyRsvpHolders(event, 'event_updated', {
                    title: `${event.title} was updated`,
                    body: 'The time or place of an event you RSVP\'d to has changed.',
                });
            }
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_UPDATE, audit_logger_1.ResourceTypes.EVENT, eventId, 1, { groupId: existing.groupId });
            return serializeEvent(event, true);
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_UPDATE, audit_logger_1.ResourceTypes.EVENT, eventId, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.updateEvent error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── deleteEvent ───────────────────────────────────────────────────────────
    async deleteEvent(eventId, actor) {
        try {
            const existing = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, groupId: true },
            });
            if (!existing) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await requireGroupAdmin(existing.groupId, actor.userId);
            const cancelled = await connection_1.prisma.event.update({
                where: { id: eventId },
                data: { status: 'cancelled' },
                select: event_types_1.eventSelect,
            });
            // Anyone who said they were coming needs to know they no longer are.
            await this.notifyRsvpHolders(cancelled, 'event_cancelled', {
                title: `${cancelled.title} was cancelled`,
                body: 'An event you RSVP\'d to has been cancelled.',
                email: {
                    subject: `Cancelled: ${cancelled.title}`,
                    template: 'event_cancelled',
                    data: {
                        eventTitle: cancelled.title,
                        startsAt: cancelled.startsAt.toISOString(),
                        eventUrl: (0, calendar_1.buildEventUrl)(cancelled.id),
                    },
                },
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_DELETE, audit_logger_1.ResourceTypes.EVENT, eventId, 1, { groupId: existing.groupId });
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_DELETE, audit_logger_1.ResourceTypes.EVENT, eventId, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.deleteEvent error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── rsvp ─────────────────────────────────────────────────────────────────
    // Idempotent by design. The client updates the RSVP optimistically and disables the
    // button the instant it is tapped, so a retry — a double tap, a flaky network, a
    // resumed request — must land on the same state instead of a 409 that would force
    // the UI to roll an already-correct button back.
    async rsvp(eventId, dto, actor) {
        try {
            const event = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, status: true, rsvpLimit: true, rsvpCount: true },
            });
            if (!event) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (event.status === 'cancelled') {
                throw new error_middleware_1.ApiError('Cannot RSVP to a cancelled event.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const existing = await connection_1.prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { id: true, status: true },
            });
            // Same answer as last time — return it without touching rsvpCount.
            if (existing?.status === dto.status) {
                return connection_1.prisma.eventRsvp.findUniqueOrThrow({
                    where: { eventId_userId: { eventId, userId: actor.userId } },
                    select: event_types_1.rsvpSelect,
                });
            }
            const wasGoing = existing?.status === 'going';
            const willBeGoing = dto.status === 'going';
            if (willBeGoing && !wasGoing && event.rsvpLimit !== null && event.rsvpCount >= event.rsvpLimit) {
                throw new error_middleware_1.ApiError('This event has reached its RSVP limit.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const countDelta = (willBeGoing ? 1 : 0) - (wasGoing ? 1 : 0);
            const [rsvp] = await connection_1.prisma.$transaction([
                connection_1.prisma.eventRsvp.upsert({
                    where: { eventId_userId: { eventId, userId: actor.userId } },
                    create: { eventId, userId: actor.userId, status: dto.status },
                    update: { status: dto.status },
                    select: event_types_1.rsvpSelect,
                }),
                ...(countDelta !== 0
                    ? [connection_1.prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { increment: countDelta } } })]
                    : []),
            ]);
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_RSVP, audit_logger_1.ResourceTypes.EVENT, eventId, 1, { status: dto.status });
            return rsvp;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.rsvp error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── updateRsvp ────────────────────────────────────────────────────────────
    async updateRsvp(eventId, dto, actor) {
        try {
            const event = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, status: true, rsvpLimit: true, rsvpCount: true },
            });
            if (!event) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (event.status === 'cancelled') {
                throw new error_middleware_1.ApiError('Cannot update RSVP for a cancelled event.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const existing = await connection_1.prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { id: true, status: true },
            });
            if (!existing) {
                throw new error_middleware_1.ApiError('No RSVP found. Use POST to create an RSVP first.', http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Adjust rsvpCount based on going/not-going transitions
            const wasGoing = existing.status === 'going';
            const willBeGoing = dto.status === 'going';
            if (willBeGoing && !wasGoing && event.rsvpLimit !== null && event.rsvpCount >= event.rsvpLimit) {
                throw new error_middleware_1.ApiError('This event has reached its RSVP limit.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const countDelta = (willBeGoing ? 1 : 0) - (wasGoing ? 1 : 0);
            const [rsvp] = await connection_1.prisma.$transaction([
                connection_1.prisma.eventRsvp.update({
                    where: { eventId_userId: { eventId, userId: actor.userId } },
                    data: { status: dto.status },
                    select: event_types_1.rsvpSelect,
                }),
                ...(countDelta !== 0
                    ? [connection_1.prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { increment: countDelta } } })]
                    : []),
            ]);
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_RSVP_UPDATE, audit_logger_1.ResourceTypes.EVENT, eventId, 1, { status: dto.status });
            return rsvp;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.updateRsvp error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── cancelRsvp ────────────────────────────────────────────────────────────
    async cancelRsvp(eventId, actor) {
        try {
            const event = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true },
            });
            if (!event) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const existing = await connection_1.prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { id: true, status: true },
            });
            if (!existing) {
                throw new error_middleware_1.ApiError('No RSVP found to cancel.', http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const wasGoing = existing.status === 'going';
            await connection_1.prisma.$transaction([
                connection_1.prisma.eventRsvp.delete({ where: { eventId_userId: { eventId, userId: actor.userId } } }),
                ...(wasGoing
                    ? [connection_1.prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { decrement: 1 } } })]
                    : []),
            ]);
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_RSVP_CANCEL, audit_logger_1.ResourceTypes.EVENT, eventId, 1);
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.cancelRsvp error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getCalendarFile ───────────────────────────────────────────────────────
    // Streams an .ics for a single event. Applies exactly the same visibility rules as
    // getEvent — the calendar file must not become a side door to a private event or to
    // an address the caller cannot otherwise see.
    async getCalendarFile(eventId, actor) {
        try {
            const event = await connection_1.prisma.event.findUnique({
                where: { id: eventId },
                select: event_types_1.eventSelect,
            });
            if (!event) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const [isMember, showAddress] = await Promise.all([
                isActiveMember(event.groupId, actor.userId),
                canSeeExactAddress(event.id, event.groupId, actor.userId),
            ]);
            if (event.visibility !== 'public' && !isMember) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const venueArea = (0, event_types_1.buildVenueArea)(event);
            const location = (showAddress ? event.venueAddress : null) ?? venueArea;
            const content = (0, calendar_1.buildIcs)({
                id: event.id,
                title: event.title,
                description: event.description,
                location,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                url: (0, calendar_1.buildEventUrl)(event.id),
            });
            // Slugify the title for the download name; fall back to the id when a title is
            // entirely non-ASCII, so the filename never collapses to an empty string.
            const slug = event.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            return { filename: `${slug || event.id}.ics`, content };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.getCalendarFile error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── sendUpcomingReminders ─────────────────────────────────────────────────
    // Driven by the hourly `event-reminders` cron.
    //
    // A sweep rather than a per-event delayed job: a delayed job scheduled at creation
    // time would still fire after the event was cancelled or moved, and would need
    // cancelling and rescheduling on every edit. Sweeping the window reads current state
    // every time, so a cancelled or rescheduled event simply falls out of it.
    //
    // The window is 23–25h wide against an hourly cron, so it overlaps deliberately;
    // a Redis SET NX marker makes the send exactly-once per event.
    async sendUpcomingReminders() {
        const now = Date.now();
        const windowStart = new Date(now + 23 * 60 * 60 * 1000);
        const windowEnd = new Date(now + 25 * 60 * 60 * 1000);
        const events = await connection_1.prisma.event.findMany({
            where: {
                status: 'scheduled',
                startsAt: { gte: windowStart, lte: windowEnd },
            },
            select: { ...event_types_1.eventSelect, group: { select: { name: true } } },
        });
        let eventsReminded = 0;
        for (const { group, ...event } of events) {
            const claimed = await connection_1.redis.set(`event:reminded:${event.id}`, '1', 'EX', 48 * 60 * 60, 'NX');
            if (claimed !== 'OK')
                continue;
            const venueArea = (0, event_types_1.buildVenueArea)(event);
            // The reminder is the one place the exact address is pushed rather than
            // pulled — everyone receiving it holds a going/maybe RSVP, which is exactly
            // the audience allowed to see it.
            await this.notifyRsvpHolders(event, 'event_reminder', {
                title: `${event.title} is tomorrow`,
                body: event.venueAddress ?? venueArea ?? 'Check the event page for details.',
                email: {
                    subject: `Tomorrow: ${event.title}`,
                    template: 'event_reminder',
                    data: {
                        groupName: group.name,
                        eventTitle: event.title,
                        startsAt: event.startsAt.toISOString(),
                        venueArea: venueArea ?? '',
                        venueAddress: event.venueAddress ?? '',
                        venue: event.venueAddress ?? venueArea ?? 'To be announced',
                        eventUrl: (0, calendar_1.buildEventUrl)(event.id),
                        googleCalendarUrl: (0, calendar_1.buildGoogleCalendarUrl)({
                            id: event.id,
                            title: event.title,
                            description: event.description,
                            location: event.venueAddress ?? venueArea,
                            startsAt: event.startsAt,
                            endsAt: event.endsAt,
                            url: (0, calendar_1.buildEventUrl)(event.id),
                        }),
                    },
                },
            });
            eventsReminded += 1;
        }
        return { eventsReminded };
    }
    // ── notifyRsvpHolders ─────────────────────────────────────────────────────
    // Notifies everyone who said they were going or might be. 'not_going' is excluded —
    // they already opted out of caring about this event.
    async notifyRsvpHolders(event, type, payload) {
        const rsvps = await connection_1.prisma.eventRsvp.findMany({
            where: { eventId: event.id, status: { in: ['going', 'maybe'] } },
            select: { userId: true },
        });
        if (rsvps.length === 0)
            return;
        await notification_dispatcher_1.NotificationDispatcher.dispatch({
            userIds: rsvps.map((r) => r.userId),
            groupId: event.groupId,
            type,
            title: payload.title,
            body: payload.body,
            referenceType: 'event',
            referenceId: event.id,
            email: payload.email,
        });
    }
    // ── listRsvps ─────────────────────────────────────────────────────────────
    async listRsvps(eventId, page, limit, actor) {
        try {
            const event = await connection_1.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, groupId: true } });
            if (!event) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await requireGroupAdmin(event.groupId, actor.userId);
            const skip = (page - 1) * limit;
            const where = { eventId };
            const [data, total] = await Promise.all([
                connection_1.prisma.eventRsvp.findMany({
                    where,
                    select: event_types_1.rsvpSelect,
                    orderBy: { createdAt: 'asc' },
                    skip,
                    take: limit,
                }),
                connection_1.prisma.eventRsvp.count({ where }),
            ]);
            return { data, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('EventService.listRsvps error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.EventService = EventService;
exports.eventService = new EventService();
//# sourceMappingURL=event.service.js.map