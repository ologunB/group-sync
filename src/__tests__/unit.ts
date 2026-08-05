/**
 * Unit suite — pure logic, no server, no database, no network.
 *
 * The integration suite in ./index.ts covers wiring; this covers the functions where a
 * subtle bug is invisible over HTTP: iCalendar escaping and line folding, the venue
 * area label, the publish rule, and the description validator's whitespace handling.
 *
 * Usage:  npm run test:unit
 */

import { buildIcs, buildGoogleCalendarUrl } from '../shared/utils/calendar';
import { buildVenueArea } from '../features/events/event.types';
import { GROUP_DESCRIPTION_MIN, GROUP_DESCRIPTION_MAX } from '../features/group/group.types';
import { NOTIFICATION_TYPES, NOTIFICATION_EMAIL_TYPES } from '../features/notifications/notification.types';
import { INTEREST_CATALOG, NIGERIA_STATES } from '../features/reference/reference.types';

// ─── Tiny assertion + runner ──────────────────────────────────────────────────

type Result = { name: string; section: string; passed: boolean; error?: string };
const results: Result[] = [];
let currentSection = 'Uncategorised';

function section(title: string): void {
    currentSection = title;
    console.log(`\n  ${title}`);
    console.log('  ' + '─'.repeat(title.length));
}

function test(name: string, fn: () => void): void {
    try {
        fn();
        results.push({ name, section: currentSection, passed: true });
        console.log(`  ✓  ${name}`);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ name, section: currentSection, passed: false, error });
        console.log(`  ✗  ${name}`);
        console.log(`       → ${error}`);
    }
}

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, context = ''): void {
    if (actual !== expected) {
        throw new Error(
            `${context ? context + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const START = new Date('2026-09-12T18:30:00.000Z');
const END = new Date('2026-09-12T21:00:00.000Z');

function baseEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'e1f2a3b4-0000-4000-8000-000000000001',
        title: 'Ibadan Runners — Sunday 10K',
        description: 'Meet at the gate.',
        location: 'Ibadan, Oyo',
        startsAt: START,
        endsAt: END,
        url: 'https://groupsync.app/events/e1f2a3b4-0000-4000-8000-000000000001',
        ...overrides,
    } as Parameters<typeof buildIcs>[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  iCalendar generation
// ═══════════════════════════════════════════════════════════════════════════════

section('1. buildIcs — structure');

test('emits a well-formed VCALENDAR/VEVENT envelope', () => {
    const ics = buildIcs(baseEvent());
    assert(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'must open with BEGIN:VCALENDAR');
    assert(ics.includes('BEGIN:VEVENT\r\n'), 'must contain BEGIN:VEVENT');
    assert(ics.includes('END:VEVENT\r\n'), 'must contain END:VEVENT');
    assert(ics.endsWith('END:VCALENDAR\r\n'), 'must close with END:VCALENDAR and a trailing CRLF');
});

test('uses CRLF line endings throughout (RFC 5545 §3.1)', () => {
    const ics = buildIcs(baseEvent());
    const bareLf = ics.replace(/\r\n/g, '');
    assert(!bareLf.includes('\n'), 'no bare LF may remain once CRLF pairs are removed');
});

test('formats timestamps as UTC basic-format', () => {
    const ics = buildIcs(baseEvent());
    assert(ics.includes('DTSTART:20260912T183000Z'), `DTSTART wrong in:\n${ics}`);
    assert(ics.includes('DTEND:20260912T210000Z'), `DTEND wrong in:\n${ics}`);
});

test('defaults a missing end time to two hours after the start', () => {
    const ics = buildIcs(baseEvent({ endsAt: null }));
    assert(ics.includes('DTEND:20260912T203000Z'), `expected +2h DTEND, got:\n${ics}`);
});

test('omits optional properties rather than emitting empty ones', () => {
    const ics = buildIcs(baseEvent({ description: null, location: null, url: null }));
    assert(!ics.includes('DESCRIPTION:'), 'DESCRIPTION should be absent when unset');
    assert(!ics.includes('LOCATION:'), 'LOCATION should be absent when unset');
    assert(!ics.includes('URL:'), 'URL should be absent when unset');
});

section('2. buildIcs — text escaping');

test('escapes commas and semicolons in TEXT values', () => {
    const ics = buildIcs(baseEvent({ location: '12 Awolowo Road, Ikoyi; Gate B', title: 'Run' }));
    assert(
        ics.includes('LOCATION:12 Awolowo Road\\, Ikoyi\\; Gate B'),
        `comma/semicolon not escaped:\n${ics}`,
    );
});

test('escapes newlines as the literal \\n sequence', () => {
    const ics = buildIcs(baseEvent({ description: 'Line one\nLine two' }));
    assert(ics.includes('DESCRIPTION:Line one\\nLine two'), `newline not escaped:\n${ics}`);
});

test('escapes backslashes before the characters they would otherwise escape', () => {
    // A naive implementation that replaces commas first then backslashes produces
    // "a\\\,b" here — double-escaping its own escape and corrupting the value.
    const ics = buildIcs(baseEvent({ description: 'a\\,b' }));
    assert(ics.includes('DESCRIPTION:a\\\\\\,b'), `backslash ordering wrong:\n${ics}`);
});

section('3. buildIcs — line folding');

test('folds content lines to 75 octets', () => {
    const ics = buildIcs(baseEvent({ title: 'A'.repeat(300) }));
    for (const line of ics.split('\r\n')) {
        assert(
            Buffer.byteLength(line, 'utf8') <= 75,
            `line exceeds 75 octets (${Buffer.byteLength(line, 'utf8')}): ${line.slice(0, 90)}`,
        );
    }
});

test('marks continuation lines with a leading space', () => {
    const ics = buildIcs(baseEvent({ title: 'B'.repeat(200) }));
    const lines = ics.split('\r\n');
    const summaryIdx = lines.findIndex((l) => l.startsWith('SUMMARY:'));
    assert(summaryIdx >= 0, 'SUMMARY line not found');
    assert(lines[summaryIdx + 1].startsWith(' '), 'continuation line must begin with a space');
});

test('leaves short lines unfolded', () => {
    const ics = buildIcs(baseEvent({ title: 'Short' }));
    assert(ics.includes('SUMMARY:Short\r\n'), 'a short SUMMARY should not be folded');
});

section('4. buildGoogleCalendarUrl');

test('builds a TEMPLATE deep link with a start/end range', () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent()));
    assertEqual(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
    assertEqual(url.searchParams.get('action'), 'TEMPLATE');
    assertEqual(url.searchParams.get('dates'), '20260912T183000Z/20260912T210000Z');
});

test('URL-encodes the title and location rather than concatenating raw', () => {
    const url = new URL(
        buildGoogleCalendarUrl(baseEvent({ title: 'Books & Chill', location: 'Ikeja, Lagos' })),
    );
    assertEqual(url.searchParams.get('text'), 'Books & Chill');
    assertEqual(url.searchParams.get('location'), 'Ikeja, Lagos');
});

test('omits details and location when the event has none', () => {
    const url = new URL(buildGoogleCalendarUrl(baseEvent({ description: null, location: null })));
    assert(!url.searchParams.has('details'), 'details should be absent');
    assert(!url.searchParams.has('location'), 'location should be absent');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Venue area label
// ═══════════════════════════════════════════════════════════════════════════════

section('5. buildVenueArea');

test('joins city and state as "City, State"', () => {
    assertEqual(buildVenueArea({ venueCity: 'Ibadan', venueState: 'Oyo' }), 'Ibadan, Oyo');
});

test('returns just the part that is present', () => {
    assertEqual(buildVenueArea({ venueCity: 'Ibadan', venueState: null }), 'Ibadan');
    assertEqual(buildVenueArea({ venueCity: null, venueState: 'Oyo' }), 'Oyo');
});

test('returns null when neither is set', () => {
    assertEqual(buildVenueArea({ venueCity: null, venueState: null }), null);
});

test('treats whitespace-only parts as absent', () => {
    assertEqual(buildVenueArea({ venueCity: '   ', venueState: 'Oyo' }), 'Oyo');
    assertEqual(buildVenueArea({ venueCity: '  ', venueState: ' ' }), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Group description rule
// ═══════════════════════════════════════════════════════════════════════════════

section('6. Group description bounds');

/** Mirrors the validator's rule so the boundaries are asserted without Express. */
function describeIsValid(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed.replace(/\s/g, '').length) return false;
    return trimmed.length >= GROUP_DESCRIPTION_MIN && trimmed.length <= GROUP_DESCRIPTION_MAX;
}

test('rejects a description below the minimum', () => {
    assertEqual(describeIsValid('A'.repeat(GROUP_DESCRIPTION_MIN - 1)), false);
});

test('accepts exactly the minimum', () => {
    assertEqual(describeIsValid('A'.repeat(GROUP_DESCRIPTION_MIN)), true);
});

test('accepts exactly the maximum', () => {
    assertEqual(describeIsValid('A'.repeat(GROUP_DESCRIPTION_MAX)), true);
});

test('rejects one character over the maximum', () => {
    assertEqual(describeIsValid('A'.repeat(GROUP_DESCRIPTION_MAX + 1)), false);
});

test('rejects a long run of whitespace that would otherwise pass on length', () => {
    // The whole reason for the separate non-whitespace check: this is 60 characters.
    assertEqual(describeIsValid(' '.repeat(60)), false);
});

test('measures length after trimming, not before', () => {
    const padded = `${' '.repeat(50)}${'A'.repeat(GROUP_DESCRIPTION_MIN - 1)}${' '.repeat(50)}`;
    assertEqual(describeIsValid(padded), false, 'padding must not count toward the minimum');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Publish rule
// ═══════════════════════════════════════════════════════════════════════════════

section('7. Explore publish rule');

/**
 * Mirrors GroupService.isPublished. The same rule is also written as SQL inside
 * listGroups; this pins the TypeScript half so the two can be diffed by eye.
 */
function published(g: {
    reviewStatus: string;
    coverImageUrl: string | null;
    isDiscoverable: boolean;
    status: string;
}): boolean {
    return (
        g.reviewStatus === 'approved' &&
        Boolean(g.coverImageUrl) &&
        g.isDiscoverable &&
        g.status === 'active'
    );
}

const publishable = {
    reviewStatus: 'approved',
    coverImageUrl: 'https://cdn.example/cover.jpg',
    isDiscoverable: true,
    status: 'active',
};

test('an approved, covered, discoverable, active group is published', () => {
    assertEqual(published(publishable), true);
});

test('a pending group is not published', () => {
    assertEqual(published({ ...publishable, reviewStatus: 'pending' }), false);
});

test('a rejected group is not published', () => {
    assertEqual(published({ ...publishable, reviewStatus: 'rejected' }), false);
});

test('a group with no cover image is not published', () => {
    assertEqual(published({ ...publishable, coverImageUrl: null }), false);
});

test('an invite-only (non-discoverable) group is not published', () => {
    assertEqual(published({ ...publishable, isDiscoverable: false }), false);
});

test('a suspended group is not published even once approved', () => {
    assertEqual(published({ ...publishable, status: 'suspended' }), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Notification type registry
// ═══════════════════════════════════════════════════════════════════════════════

section('8. Notification types');

test('every emailable type is a real notification type', () => {
    for (const type of NOTIFICATION_EMAIL_TYPES) {
        assert(
            (NOTIFICATION_TYPES as readonly string[]).includes(type),
            `"${type}" is emailable but not in NOTIFICATION_TYPES`,
        );
    }
});

test('per-message chat traffic is never emailed', () => {
    // The product rule: "we can't be seeing email per each message".
    for (const noisy of ['message', 'dm_received'] as const) {
        assert(
            !NOTIFICATION_EMAIL_TYPES.includes(noisy),
            `"${noisy}" must not be emailable — one email per chat message is the failure mode`,
        );
    }
});

test('the four requested email triggers are all emailable', () => {
    for (const wanted of ['event_created', 'event_reminder', 'message_reply', 'application_approved'] as const) {
        assert(
            NOTIFICATION_EMAIL_TYPES.includes(wanted),
            `"${wanted}" was requested as an email notification but is not emailable`,
        );
    }
});

test('type list has no duplicates', () => {
    assertEqual(new Set(NOTIFICATION_TYPES).size, NOTIFICATION_TYPES.length);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Reference catalogues
// ═══════════════════════════════════════════════════════════════════════════════

section('9. Reference catalogues');

test('interest values are unique', () => {
    const values = INTEREST_CATALOG.map((i) => i.value);
    assertEqual(new Set(values).size, values.length, 'duplicate interest value');
});

test('interest values are already normalised (lowercase, no spaces)', () => {
    // UserService.updateInterests lowercases and trims on write; if the catalogue did
    // not already match, a stored tag would never equal the option the user picked.
    for (const { value } of INTEREST_CATALOG) {
        assertEqual(value, value.toLowerCase().trim(), `"${value}" is not normalised`);
        assert(!/\s/.test(value), `"${value}" contains whitespace`);
    }
});

test('covers all 36 states plus the FCT', () => {
    assertEqual(NIGERIA_STATES.length, 37);
});

test('state names are unique and every state lists at least one city', () => {
    const names = NIGERIA_STATES.map((s) => s.state);
    assertEqual(new Set(names).size, names.length, 'duplicate state');
    for (const s of NIGERIA_STATES) {
        assert(s.cities.length > 0, `${s.state} has no cities`);
    }
});

test('includes the launch markets', () => {
    const cities = NIGERIA_STATES.flatMap((s) => s.cities);
    for (const city of ['Ibadan', 'Abuja']) {
        assert(cities.includes(city), `launch market "${city}" missing from the catalogue`);
    }
    assert(
        NIGERIA_STATES.some((s) => s.state === 'Lagos'),
        'launch market "Lagos" missing from the catalogue',
    );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;

console.log(`\n${'═'.repeat(66)}`);
console.log(`  Unit results: ${passed}/${results.length} passed  |  ${failed} failed`);
console.log('═'.repeat(66));

if (failed > 0) {
    console.log('\n  ❌  Failed');
    console.log('  ' + '─'.repeat(58));
    for (const r of results.filter((r) => !r.passed)) {
        console.log(`  ✗  [${r.section}]  ${r.name}`);
        console.log(`       → ${r.error}`);
    }
    console.log('');
}

process.exit(failed > 0 ? 1 : 0);
