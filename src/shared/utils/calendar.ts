import { config } from '../config/app.config';

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string | null;
    /** Human-readable venue. Pass the exact address for members, the area label otherwise. */
    location?: string | null;
    startsAt: Date;
    endsAt?: Date | null;
    url?: string | null;
}

/** RFC 5545 UTC timestamp: 20260805T183000Z */
function toIcsStamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escapes a value for an iCalendar TEXT field. Backslash must be replaced first,
 * otherwise the escapes introduced by the later rules get double-escaped.
 */
function escapeIcsText(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a content line to the 75-octet limit in RFC 5545 §3.1. Outlook and some
 * Android calendar clients reject or truncate over-long lines outright.
 */
function foldLine(line: string): string {
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;

    const out: string[] = [];
    let current = '';
    for (const char of line) {
        // Continuation lines carry a leading space, so they only fit 74 octets of payload.
        const limit = out.length === 0 ? 75 : 74;
        if (Buffer.byteLength(current + char, 'utf8') > limit) {
            out.push(current);
            current = char;
        } else {
            current += char;
        }
    }
    out.push(current);

    return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n');
}

/** Events without an explicit end are treated as two hours long. */
function resolveEnd(event: CalendarEvent): Date {
    return event.endsAt ?? new Date(event.startsAt.getTime() + 2 * 60 * 60 * 1000);
}

export function buildIcs(event: CalendarEvent): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GroupSync//Events//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${event.id}@groupsync`,
        `DTSTAMP:${toIcsStamp(new Date())}`,
        `DTSTART:${toIcsStamp(event.startsAt)}`,
        `DTEND:${toIcsStamp(resolveEnd(event))}`,
        `SUMMARY:${escapeIcsText(event.title)}`,
        ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
        ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
        ...(event.url ? [`URL:${escapeIcsText(event.url)}`] : []),
        'END:VEVENT',
        'END:VCALENDAR',
    ];

    // iCalendar requires CRLF line endings and a trailing newline.
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** Deep link that opens Google Calendar's "add event" form pre-filled. */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: event.title,
        dates: `${toIcsStamp(event.startsAt)}/${toIcsStamp(resolveEnd(event))}`,
    });

    if (event.description) params.set('details', event.description);
    if (event.location) params.set('location', event.location);

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildEventUrl(eventId: string): string {
    return `${config.server.clientUrl}/events/${eventId}`;
}
