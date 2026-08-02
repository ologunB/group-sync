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
const agenda_1 = require("../../agenda");
const event_types_1 = require("./event.types");
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
class EventService {
    // ── createEvent ───────────────────────────────────────────────────────────
    async createEvent(groupId, dto, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { id: true, status: true },
            });
            if (!group || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const event = await connection_1.prisma.event.create({
                data: {
                    groupId,
                    createdBy: actor.userId,
                    title: dto.title.trim(),
                    description: dto.description?.trim() ?? null,
                    locationName: dto.location_name?.trim() ?? null,
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
            // Fan-out notifications to all group members via BullMQ
            await agenda_1.AgendaManager.runNow('notify-group-members', {
                groupId,
                type: 'event_created',
                eventId: event.id,
                title: 'New event in your group',
                body: dto.title,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_CREATE, audit_logger_1.ResourceTypes.EVENT, event.id, 1, { groupId });
            return event;
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
            const [data, total] = await Promise.all([
                connection_1.prisma.event.findMany({
                    where,
                    select: event_types_1.eventSelect,
                    orderBy: { startsAt: 'asc' },
                    skip,
                    take: limit,
                }),
                connection_1.prisma.event.count({ where }),
            ]);
            return { data, pagination: { page, limit, total } };
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
                    return row;
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
            // Private events are members-only. 404 rather than 403 so a non-member can't probe
            // for the existence of a group's private events.
            if (event.visibility !== 'public' && !(await isActiveMember(event.groupId, actor.userId))) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Event'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const myRsvp = await connection_1.prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { status: true },
            });
            return { ...event, myRsvp: myRsvp?.status ?? null };
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
            const event = await connection_1.prisma.event.update({
                where: { id: eventId },
                data: {
                    ...(dto.title !== undefined && { title: dto.title.trim() }),
                    ...(dto.description !== undefined && { description: dto.description.trim() }),
                    ...(dto.location_name !== undefined && { locationName: dto.location_name.trim() }),
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
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.EVENT_UPDATE, audit_logger_1.ResourceTypes.EVENT, eventId, 1, { groupId: existing.groupId });
            return event;
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
            await connection_1.prisma.event.update({
                where: { id: eventId },
                data: { status: 'cancelled' },
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
            if (existing) {
                throw new error_middleware_1.ApiError('You have already RSVPed. Use PATCH to update your RSVP.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (dto.status === 'going' && event.rsvpLimit !== null && event.rsvpCount >= event.rsvpLimit) {
                throw new error_middleware_1.ApiError('This event has reached its RSVP limit.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const [rsvp] = await connection_1.prisma.$transaction([
                connection_1.prisma.eventRsvp.create({
                    data: { eventId, userId: actor.userId, status: dto.status },
                    select: event_types_1.rsvpSelect,
                }),
                ...(dto.status === 'going'
                    ? [connection_1.prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { increment: 1 } } })]
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