import { StatusCodes } from 'http-status-codes';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload } from '../../shared/types/common.types';
import { AgendaManager } from '../../agenda';
import {
    CreateEventDTO,
    UpdateEventDTO,
    RsvpDTO,
    EventPublic,
    EventVisibility,
    NearbyEvent,
    NearbyEventsQuery,
    PaginatedResult,
    RsvpPublic,
    eventSelect,
    rsvpSelect,
} from './event.types';

async function requireGroupAdmin(groupId: string, userId: string): Promise<void> {
    const membership = await prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
    if (!membership || membership.status !== 'active' || !['super_admin', 'admin'].includes(membership.role)) {
        throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
    }
}

// Non-members get the public preview: public events only. Reads used to apply no membership
// check at all, so any authenticated user could read every event of any group.
async function isActiveMember(groupId: string, userId: string): Promise<boolean> {
    const membership = await prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { status: true },
    });
    return membership?.status === 'active';
}

export class EventService {
    // ── createEvent ───────────────────────────────────────────────────────────

    async createEvent(groupId: string, dto: CreateEventDTO, actor: TokenPayload): Promise<EventPublic> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { id: true, status: true },
            });

            if (!group || group.status === 'deleted') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            const event = await prisma.event.create({
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
                select: eventSelect,
            });

            // Set PostGIS location if provided
            if (dto.lat !== undefined && dto.lng !== undefined) {
                await prisma.$executeRaw`
                    UPDATE events
                    SET location_point = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
                    WHERE id = ${event.id}::uuid
                `;
            }

            // Fan-out notifications to all group members via BullMQ
            await AgendaManager.runNow('notify-group-members', {
                groupId,
                type: 'event_created',
                eventId: event.id,
                title: 'New event in your group',
                body: dto.title,
            });

            await AuditLogger.log(actor, LogActions.EVENT_CREATE, ResourceTypes.EVENT, event.id, 1, { groupId });

            return event;
        } catch (error) {
            await AuditLogger.log(actor, LogActions.EVENT_CREATE, ResourceTypes.EVENT, null, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.createEvent error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── listEvents ────────────────────────────────────────────────────────────

    async listEvents(
        groupId: string,
        page: number,
        limit: number,
        actor: TokenPayload,
        visibility?: EventVisibility,
    ): Promise<{ data: EventPublic[]; pagination: { page: number; limit: number; total: number } }> {
        try {
            const skip = (page - 1) * limit;
            const isMember = await isActiveMember(groupId, actor.userId);

            // Intersect what was asked for with what the caller may see, rather than overriding
            // it. Overriding meant a non-member asking ?visibility=private got the *public*
            // events back — not a leak, but it answered a different question than it was asked.
            // An empty intersection yields `in: []`, which correctly matches nothing.
            const allowed: EventVisibility[] = isMember ? ['public', 'private'] : ['public'];
            const effective = visibility ? allowed.filter((v) => v === visibility) : allowed;

            const where = {
                groupId,
                status: { not: 'cancelled' },
                visibility: { in: effective },
            };

            const [data, total] = await Promise.all([
                prisma.event.findMany({
                    where,
                    select: eventSelect,
                    orderBy: { startsAt: 'asc' },
                    skip,
                    take: limit,
                }),
                prisma.event.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.listEvents error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── listNearbyEvents ──────────────────────────────────────────────────────
    // Cross-group discovery. Deliberately NOT scoped to the caller's memberships:
    // every other event read is group-scoped, so a new account with no groups had
    // nothing to show. Only public events from discoverable groups surface here.

    async listNearbyEvents(
        query: NearbyEventsQuery,
        actorId: string,
    ): Promise<PaginatedResult<NearbyEvent>> {
        try {
            const page = Math.max(1, query.page ?? 1);
            const limit = Math.min(50, Math.max(1, query.limit ?? 20));
            const skip = (page - 1) * limit;
            const radiusMeters = (query.radius_km ?? 50) * 1000;
            const sort = query.sort ?? 'distance';

            const conditions: Prisma.Sql[] = [
                // Only events the caller is allowed to discover without membership.
                Prisma.sql`e.visibility = 'public'`,
                Prisma.sql`e.status <> 'cancelled'`,
                // Discovery is forward-looking; past events are not "near you" any more.
                Prisma.sql`e.starts_at >= NOW()`,
                Prisma.sql`e.location_point IS NOT NULL`,
                // The group must itself be discoverable, or this would leak the existence
                // of invite-only groups through their events. Members still see their own
                // groups' public events here, matching GroupService.listGroups.
                Prisma.sql`g.status = 'active'`,
                Prisma.sql`g.deleted_at IS NULL`,
                Prisma.sql`
                    (g.is_discoverable = TRUE OR EXISTS (
                        SELECT 1 FROM memberships m
                        WHERE m.group_id = g.id
                          AND m.user_id = ${actorId}::uuid
                          AND m.status = 'active'
                    ))
                `,
                Prisma.sql`
                    ST_DWithin(
                        e.location_point::geography,
                        ST_MakePoint(${query.lng}, ${query.lat})::geography,
                        ${radiusMeters}
                    )
                `,
            ];

            if (query.category) {
                conditions.push(Prisma.sql`g.category ILIKE ${query.category}`);
            }

            const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
            const orderClause =
                sort === 'soonest'
                    ? Prisma.sql`ORDER BY e.starts_at ASC`
                    : Prisma.sql`ORDER BY distance_m ASC, e.starts_at ASC`;

            const [data, countResult] = await Promise.all([
                prisma.$queryRaw<NearbyEvent[]>`
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
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(*) as count
                    FROM events e
                    JOIN groups g ON g.id = e.group_id
                    ${whereClause}
                `,
            ]);

            return {
                data: data.map(({ ...row }) => {
                    delete (row as Record<string, unknown>).distance_m;
                    return row;
                }),
                pagination: { page, limit, total: Number(countResult[0]?.count ?? 0) },
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.listNearbyEvents error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── getEvent ──────────────────────────────────────────────────────────────

    async getEvent(eventId: string, actor: TokenPayload): Promise<EventPublic & { myRsvp: string | null }> {
        try {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                select: eventSelect,
            });

            if (!event) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            // Private events are members-only. 404 rather than 403 so a non-member can't probe
            // for the existence of a group's private events.
            if (event.visibility !== 'public' && !(await isActiveMember(event.groupId, actor.userId))) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            const myRsvp = await prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { status: true },
            });

            return { ...event, myRsvp: myRsvp?.status ?? null };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.getEvent error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── updateEvent ───────────────────────────────────────────────────────────

    async updateEvent(eventId: string, dto: UpdateEventDTO, actor: TokenPayload): Promise<EventPublic> {
        try {
            const existing = await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, groupId: true },
            });

            if (!existing) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            await requireGroupAdmin(existing.groupId, actor.userId);

            const event = await prisma.event.update({
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
                select: eventSelect,
            });

            if (dto.lat !== undefined && dto.lng !== undefined) {
                await prisma.$executeRaw`
                    UPDATE events
                    SET location_point = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
                    WHERE id = ${event.id}::uuid
                `;
            }

            await AuditLogger.log(actor, LogActions.EVENT_UPDATE, ResourceTypes.EVENT, eventId, 1, { groupId: existing.groupId });

            return event;
        } catch (error) {
            await AuditLogger.log(actor, LogActions.EVENT_UPDATE, ResourceTypes.EVENT, eventId, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.updateEvent error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── deleteEvent ───────────────────────────────────────────────────────────

    async deleteEvent(eventId: string, actor: TokenPayload): Promise<void> {
        try {
            const existing = await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, groupId: true },
            });

            if (!existing) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            await requireGroupAdmin(existing.groupId, actor.userId);

            await prisma.event.update({
                where: { id: eventId },
                data: { status: 'cancelled' },
            });

            await AuditLogger.log(actor, LogActions.EVENT_DELETE, ResourceTypes.EVENT, eventId, 1, { groupId: existing.groupId });
        } catch (error) {
            await AuditLogger.log(actor, LogActions.EVENT_DELETE, ResourceTypes.EVENT, eventId, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.deleteEvent error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── rsvp ─────────────────────────────────────────────────────────────────

    async rsvp(eventId: string, dto: RsvpDTO, actor: TokenPayload): Promise<RsvpPublic> {
        try {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, status: true, rsvpLimit: true, rsvpCount: true },
            });

            if (!event) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            if (event.status === 'cancelled') {
                throw new ApiError('Cannot RSVP to a cancelled event.', StatusCodes.UNPROCESSABLE_ENTITY);
            }

            const existing = await prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { id: true, status: true },
            });

            if (existing) {
                throw new ApiError('You have already RSVPed. Use PATCH to update your RSVP.', StatusCodes.CONFLICT);
            }

            if (dto.status === 'going' && event.rsvpLimit !== null && event.rsvpCount >= event.rsvpLimit) {
                throw new ApiError('This event has reached its RSVP limit.', StatusCodes.UNPROCESSABLE_ENTITY);
            }

            const [rsvp] = await prisma.$transaction([
                prisma.eventRsvp.create({
                    data: { eventId, userId: actor.userId, status: dto.status },
                    select: rsvpSelect,
                }),
                ...(dto.status === 'going'
                    ? [prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { increment: 1 } } })]
                    : []),
            ]);

            await AuditLogger.log(actor, LogActions.EVENT_RSVP, ResourceTypes.EVENT, eventId, 1, { status: dto.status });

            return rsvp;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.rsvp error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── updateRsvp ────────────────────────────────────────────────────────────

    async updateRsvp(eventId: string, dto: RsvpDTO, actor: TokenPayload): Promise<RsvpPublic> {
        try {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, status: true, rsvpLimit: true, rsvpCount: true },
            });

            if (!event) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            if (event.status === 'cancelled') {
                throw new ApiError('Cannot update RSVP for a cancelled event.', StatusCodes.UNPROCESSABLE_ENTITY);
            }

            const existing = await prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { id: true, status: true },
            });

            if (!existing) {
                throw new ApiError('No RSVP found. Use POST to create an RSVP first.', StatusCodes.NOT_FOUND);
            }

            // Adjust rsvpCount based on going/not-going transitions
            const wasGoing = existing.status === 'going';
            const willBeGoing = dto.status === 'going';

            if (willBeGoing && !wasGoing && event.rsvpLimit !== null && event.rsvpCount >= event.rsvpLimit) {
                throw new ApiError('This event has reached its RSVP limit.', StatusCodes.UNPROCESSABLE_ENTITY);
            }

            const countDelta = (willBeGoing ? 1 : 0) - (wasGoing ? 1 : 0);

            const [rsvp] = await prisma.$transaction([
                prisma.eventRsvp.update({
                    where: { eventId_userId: { eventId, userId: actor.userId } },
                    data: { status: dto.status },
                    select: rsvpSelect,
                }),
                ...(countDelta !== 0
                    ? [prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { increment: countDelta } } })]
                    : []),
            ]);

            await AuditLogger.log(actor, LogActions.EVENT_RSVP_UPDATE, ResourceTypes.EVENT, eventId, 1, { status: dto.status });

            return rsvp;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.updateRsvp error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── cancelRsvp ────────────────────────────────────────────────────────────

    async cancelRsvp(eventId: string, actor: TokenPayload): Promise<void> {
        try {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true },
            });

            if (!event) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            const existing = await prisma.eventRsvp.findUnique({
                where: { eventId_userId: { eventId, userId: actor.userId } },
                select: { id: true, status: true },
            });

            if (!existing) {
                throw new ApiError('No RSVP found to cancel.', StatusCodes.NOT_FOUND);
            }

            const wasGoing = existing.status === 'going';

            await prisma.$transaction([
                prisma.eventRsvp.delete({ where: { eventId_userId: { eventId, userId: actor.userId } } }),
                ...(wasGoing
                    ? [prisma.event.update({ where: { id: eventId }, data: { rsvpCount: { decrement: 1 } } })]
                    : []),
            ]);

            await AuditLogger.log(actor, LogActions.EVENT_RSVP_CANCEL, ResourceTypes.EVENT, eventId, 1);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.cancelRsvp error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── listRsvps ─────────────────────────────────────────────────────────────

    async listRsvps(
        eventId: string,
        page: number,
        limit: number,
        actor: TokenPayload,
    ): Promise<{ data: RsvpPublic[]; pagination: { page: number; limit: number; total: number } }> {
        try {
            const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, groupId: true } });
            if (!event) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }

            await requireGroupAdmin(event.groupId, actor.userId);

            const skip = (page - 1) * limit;
            const where = { eventId };

            const [data, total] = await Promise.all([
                prisma.eventRsvp.findMany({
                    where,
                    select: rsvpSelect,
                    orderBy: { createdAt: 'asc' },
                    skip,
                    take: limit,
                }),
                prisma.eventRsvp.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('EventService.listRsvps error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}

export const eventService = new EventService();
