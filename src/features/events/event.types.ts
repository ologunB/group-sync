import { Prisma } from '@prisma/client';

export const EVENT_STATUSES = ['scheduled', 'cancelled', 'completed'] as const;
export const RSVP_STATUSES = ['going', 'maybe', 'not_going'] as const;
export const EVENT_VISIBILITIES = ['public', 'private'] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export interface CreateEventDTO {
    title: string;
    description?: string;
    location_name?: string;
    lat?: number;
    lng?: number;
    starts_at: string;
    ends_at?: string;
    rsvp_limit?: number;
    visibility?: EventVisibility;
}

export interface UpdateEventDTO {
    title?: string;
    description?: string;
    location_name?: string;
    lat?: number;
    lng?: number;
    starts_at?: string;
    ends_at?: string;
    rsvp_limit?: number;
    status?: EventStatus;
    visibility?: EventVisibility;
}

export interface RsvpDTO {
    status: RsvpStatus;
}

export const eventSelect = {
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
} as const satisfies Prisma.EventSelect;

export const rsvpSelect = {
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
} as const satisfies Prisma.EventRsvpSelect;

export type EventPublic = Prisma.EventGetPayload<{ select: typeof eventSelect }>;
export type RsvpPublic = Prisma.EventRsvpGetPayload<{ select: typeof rsvpSelect }>;
