/**
 * Features integration tests — users, groups, memberships.
 * Runs against a live server on localhost:3000.
 *
 * Usage: tsx src/__tests__/features.integration.ts
 */

import { redis, prisma } from '../database/connection';

const BASE = 'http://localhost:3000/api/v1';
const ts = Date.now();

// ─── Test actors ──────────────────────────────────────────────────────────────

const CREATOR_EMAIL = `creator${ts}@test.io`;
const CREATOR_PASS = 'Creator123!';

const MEMBER_EMAIL = `member${ts}@test.io`;
const MEMBER_PASS = 'Member123!';

const OUTSIDER_EMAIL = `outsider${ts}@test.io`;
const OUTSIDER_PASS = 'Outsider123!';

// Mutable shared state
let creatorToken = '';
let memberToken = '';
let outsiderToken = '';
let creatorId = '';
let memberId = '';
let outsiderId = '';

let openGroupId = '';
let openGroupSlug = '';
let appGroupId = '';
let appGroupSlug = '';
let applicationId = '';
let inviteToken = '';
let inviteId = '';

// ─── Assertion helpers ────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

function assertStatus(actual: number, expected: number, context = ''): void {
    assert(
        actual === expected,
        `Expected HTTP ${expected}, got ${actual}${context ? ` (${context})` : ''}`,
    );
}

function assertHas(obj: Record<string, unknown>, key: string): void {
    assert(key in obj, `Expected response to have key "${key}"`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

type ApiResponse = { status: number; data: Record<string, unknown> };

async function request(
    method: string,
    path: string,
    body?: object,
    token?: string,
): Promise<ApiResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { status: res.status, data };
}

const get = (path: string, token?: string) =>
    request('GET', path, undefined, token);
const post = (path: string, body: object, token?: string) =>
    request('POST', path, body, token);
const patch = (path: string, body: object, token?: string) =>
    request('PATCH', path, body, token);
const put = (path: string, body: object, token?: string) =>
    request('PUT', path, body, token);
const del = (path: string, token?: string, body?: object) =>
    request('DELETE', path, body, token);

// ─── Test runner ──────────────────────────────────────────────────────────────

type Result = { name: string; passed: boolean; error?: string };
const results: Result[] = [];

function section(title: string): void {
    console.log(`\n  ${title}`);
    console.log('  ' + '─'.repeat(title.length));
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        results.push({ name, passed: true });
        console.log(`  ✓  ${name}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name, passed: false, error: msg });
        console.log(`  ✗  ${name}`);
        console.log(`       → ${msg}`);
    }
}

// ─── Setup helpers ─────────────────────────────────────────────────────────────

async function registerAndLogin(
    email: string,
    password: string,
    name: string,
): Promise<{ token: string; userId: string }> {
    const reg = await post('/auth/register', { email, password, display_name: name });
    if (reg.status !== 201) {
        throw new Error(`Registration failed for ${email}: ${JSON.stringify(reg.data)}`);
    }
    const payload = reg.data.data as Record<string, unknown>;
    const tokens = payload.tokens as Record<string, unknown>;
    const user = payload.user as Record<string, unknown>;
    return { token: tokens.accessToken as string, userId: user.id as string };
}

async function setVerified(userId: string): Promise<void> {
    await prisma.user.update({
        where: { id: userId },
        data: { idVerificationStatus: 'verified' },
    });
}

// Safely extract a paginated list from various response shapes
function extractList(data: unknown): unknown[] {
    if (!data || typeof data !== 'object') return [];
    const d = data as Record<string, unknown>;
    for (const key of ['members', 'applications', 'invites', 'groups', 'items', 'data']) {
        if (Array.isArray(d[key])) return d[key] as unknown[];
    }
    if (Array.isArray(d)) return d as unknown[];
    return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  Features Integration Tests — Users · Groups · Memberships');
    console.log('══════════════════════════════════════════════════════════════');

    // ── 0. Setup ──────────────────────────────────────────────────────────────

    section('0. Setup');

    await test('register creator, member, outsider', async () => {
        const c = await registerAndLogin(CREATOR_EMAIL, CREATOR_PASS, 'Group Creator');
        const m = await registerAndLogin(MEMBER_EMAIL, MEMBER_PASS, 'Test Member');
        const o = await registerAndLogin(OUTSIDER_EMAIL, OUTSIDER_PASS, 'Outsider');
        creatorToken = c.token;
        creatorId = c.userId;
        memberToken = m.token;
        memberId = m.userId;
        outsiderToken = o.token;
        outsiderId = o.userId;
    });

    await test('set id_verification_status = verified for all actors', async () => {
        await setVerified(creatorId);
        await setVerified(memberId);
        await setVerified(outsiderId);
    });

    await test('re-login all actors to get fresh tokens reflecting DB change', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL, password: CREATOR_PASS });
        const { data: md } = await post('/auth/login', { email: MEMBER_EMAIL, password: MEMBER_PASS });
        const { data: od } = await post('/auth/login', { email: OUTSIDER_EMAIL, password: OUTSIDER_PASS });
        creatorToken = ((cd.data as any).tokens as any).accessToken;
        memberToken = ((md.data as any).tokens as any).accessToken;
        outsiderToken = ((od.data as any).tokens as any).accessToken;
        assert(creatorToken.length > 0, 'creatorToken empty');
        assert(memberToken.length > 0, 'memberToken empty');
        assert(outsiderToken.length > 0, 'outsiderToken empty');
    });

    // ── 1. User Profile ───────────────────────────────────────────────────────

    section('1. User Profile');

    await test('GET /users/me returns own profile with email (200)', async () => {
        const { status, data } = await get('/users/me', creatorToken);
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assertHas(user, 'id');
        assertHas(user, 'email');
        assertHas(user, 'displayName');
        assert(user.email === CREATOR_EMAIL, `email mismatch: ${user.email}`);
    });

    await test('GET /users/me without auth returns 401', async () => {
        const { status } = await get('/users/me');
        assertStatus(status, 401);
    });

    await test('PATCH /users/me updates displayName and bio (200)', async () => {
        const { status, data } = await patch(
            '/users/me',
            { display_name: 'Creator Updated', bio: 'Integration test bio' },
            creatorToken,
        );
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.displayName === 'Creator Updated', `displayName not updated: ${user.displayName}`);
        assert(user.bio === 'Integration test bio', `bio not updated: ${user.bio}`);
    });

    await test('PATCH /users/me with invalid lat (>90) returns 422', async () => {
        const { status } = await patch('/users/me', { lat: 999 }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me sets username (200)', async () => {
        const username = `creator_${ts}`;
        const { status, data } = await patch('/users/me', { username }, creatorToken);
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.username === username, `username not set: ${user.username}`);
    });

    await test('PATCH /users/me with duplicate username returns 409', async () => {
        const username = `creator_${ts}`;
        const { status } = await patch('/users/me', { username }, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /users/me/interests sets interests array (200)', async () => {
        const { status, data } = await post(
            '/users/me/interests',
            { interests: ['cooking', 'hiking', 'technology'] },
            creatorToken,
        );
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        const interests = user.interests as string[];
        assert(Array.isArray(interests) && interests.includes('cooking'), 'interests not set');
    });

    await test('POST /users/me/interests with 31 tags returns 422', async () => {
        const tooMany = Array.from({ length: 31 }, (_, i) => `tag${i}`);
        const { status } = await post('/users/me/interests', { interests: tooMany }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /users/me/interests with non-array returns 422', async () => {
        const { status } = await post('/users/me/interests', { interests: 'not-an-array' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /users/:id returns public profile (no email field) (200)', async () => {
        const { status, data } = await get(`/users/${memberId}`, creatorToken);
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.id === memberId, `id mismatch: ${user.id}`);
        assert(!('email' in user), 'public profile must not expose email');
        assertHas(user, 'displayName');
    });

    await test('GET /users/:id with invalid UUID returns 422', async () => {
        const { status } = await get('/users/not-a-uuid', creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /users/:id for non-existent user returns 404', async () => {
        const { status } = await get('/users/00000000-0000-4000-8000-000000000000', creatorToken);
        assertStatus(status, 404);
    });

    await test('POST /users/:id/block blocks target user (200)', async () => {
        const { status } = await post(`/users/${memberId}/block`, {}, creatorToken);
        assertStatus(status, 200);
    });

    await test('POST /users/:id/block is idempotent — second call still 200', async () => {
        const { status } = await post(`/users/${memberId}/block`, {}, creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /users/:id when blocked returns 404', async () => {
        const { status } = await get(`/users/${memberId}`, creatorToken);
        assertStatus(status, 404);
    });

    await test('DELETE /users/:id/block unblocks (200)', async () => {
        const { status } = await del(`/users/${memberId}/block`, creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /users/:id after unblock returns profile (200)', async () => {
        const { status } = await get(`/users/${memberId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /users/me/groups returns empty list initially (200)', async () => {
        const { status, data } = await get('/users/me/groups', creatorToken);
        assertStatus(status, 200);
        assert(typeof data.data === 'object', 'expected object data');
    });

    await test('GET /users/me/applications returns empty list initially (200)', async () => {
        const { status } = await get('/users/me/applications', creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /users/me/groups without auth returns 401', async () => {
        const { status } = await get('/users/me/groups');
        assertStatus(status, 401);
    });

    // ── 2. Groups ─────────────────────────────────────────────────────────────

    section('2. Groups');

    await test('POST /groups without auth returns 401', async () => {
        const { status } = await post('/groups', { name: 'Ghost Group', category: 'Technology' });
        assertStatus(status, 401);
    });

    await test('POST /groups with unverified user returns 403', async () => {
        const { token } = await registerAndLogin(
            `unverf${ts}@test.io`,
            'Unverf123!',
            'Unverified',
        );
        const { status } = await post('/groups', { name: 'Test', category: 'Tech' }, token);
        assertStatus(status, 403);
    });

    await test('POST /groups missing name returns 422', async () => {
        const { status } = await post('/groups', { category: 'Technology' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups missing category returns 422', async () => {
        const { status } = await post('/groups', { name: 'No Category' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups creates open group (201)', async () => {
        const { status, data } = await post(
            '/groups',
            {
                name: `OpenGroup ${ts}`,
                category: 'Technology',
                description: 'An open group for integration testing',
                membership_type: 'open',
            },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        assertHas(group, 'id');
        assertHas(group, 'slug');
        openGroupId = group.id as string;
        openGroupSlug = group.slug as string;
        assert(openGroupId.length > 0, 'openGroupId empty');
        assert(openGroupSlug.length > 0, 'openGroupSlug empty');
    });

    await test('POST /groups creates application group (201)', async () => {
        const { status, data } = await post(
            '/groups',
            {
                name: `AppGroup ${ts}`,
                category: 'Lifestyle',
                description: 'Application-based group for testing',
                membership_type: 'application',
            },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        appGroupId = group.id as string;
        appGroupSlug = group.slug as string;
        assert(appGroupId.length > 0, 'appGroupId empty');
    });

    await test('POST /groups creates invite_only group and disables discoverability (201)', async () => {
        const { status, data } = await post(
            '/groups',
            { name: `InviteGroup ${ts}`, category: 'Sports', membership_type: 'invite_only' },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        assert(
            group.isDiscoverable === false,
            `invite_only group should not be discoverable: ${group.isDiscoverable}`,
        );
    });

    await test('GET /groups returns paginated list (200)', async () => {
        const { status, data } = await get('/groups');
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'data.data should be an array');
    });

    await test('GET /groups?q= full-text search returns results (200)', async () => {
        const { status } = await get(`/groups?q=OpenGroup`);
        assertStatus(status, 200);
    });

    await test('GET /groups?category=Technology filters by category (200)', async () => {
        const { status } = await get('/groups?category=Technology');
        assertStatus(status, 200);
    });

    await test('GET /groups?membership_type=open filters by type (200)', async () => {
        const { status } = await get('/groups?membership_type=open');
        assertStatus(status, 200);
    });

    await test('GET /groups?sort=newest returns groups sorted by newest (200)', async () => {
        const { status } = await get('/groups?sort=newest');
        assertStatus(status, 200);
    });

    await test('GET /groups?page=1&limit=5 paginates correctly (200)', async () => {
        const { status } = await get('/groups?page=1&limit=5');
        assertStatus(status, 200);
    });

    await test('GET /groups?limit=200 rejected by validator (422, max is 50)', async () => {
        const { status } = await get('/groups?limit=200');
        assertStatus(status, 422);
    });

    await test('GET /groups/:slug returns correct group (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        const group = result.group as Record<string, unknown>;
        assert(group.id === openGroupId, `id mismatch: ${group.id}`);
        assert(group.slug === openGroupSlug, `slug mismatch: ${group.slug}`);
    });

    await test('GET /groups/:slug includes callerMembershipStatus when authed (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`, creatorToken);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        assertHas(result, 'callerMembershipStatus');
        const cms = result.callerMembershipStatus as Record<string, unknown>;
        assert(cms.isMember === true, 'creator should be a member of their own group');
        assert(cms.role === 'super_admin', `creator should be super_admin, got ${cms.role}`);
    });

    await test('GET /groups/:slug without auth returns null callerMembershipStatus (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        assert(result.callerMembershipStatus === null, 'unauthenticated caller should have null membership status');
    });

    await test('GET /groups/non-existent-slug-xyz999 returns 404', async () => {
        const { status } = await get('/groups/non-existent-slug-xyz999');
        assertStatus(status, 404);
    });

    await test('PATCH /groups/:id updates description only (200, creator = super_admin)', async () => {
        const { status, data } = await patch(
            `/groups/${openGroupId}`,
            { description: 'Updated via integration test' },
            creatorToken,
        );
        assertStatus(status, 200);
        const group = data.data as Record<string, unknown>;
        assert(
            group.description === 'Updated via integration test',
            `description not updated: ${group.description}`,
        );
    });

    await test('PATCH /groups/:id without auth returns 401', async () => {
        const { status } = await patch(`/groups/${openGroupId}`, { description: 'no auth' });
        assertStatus(status, 401);
    });

    await test('PATCH /groups/:id as non-member returns 403', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}`,
            { description: 'unauthorized' },
            memberToken,
        );
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/members returns list with creator (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/members`, creatorToken);
        assertStatus(status, 200);
        const members = extractList(data.data);
        assert(Array.isArray(members) && members.length >= 1, 'creator should be in the member list');
        const found = members.some(
            (m: any) => m.userId === creatorId || m.user_id === creatorId,
        );
        assert(found, 'creator should appear as super_admin member');
    });

    await test('GET /groups/:id/members without auth returns 401', async () => {
        const { status } = await get(`/groups/${openGroupId}/members`);
        assertStatus(status, 401);
    });

    await test('GET /groups/:id/members as non-member returns 403', async () => {
        const { status } = await get(`/groups/${openGroupId}/members`, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/members?search= filters by name (200)', async () => {
        const { status } = await get(`/groups/${openGroupId}/members?search=Creator`, creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /groups/:id/stats returns stats object (200, admin only)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/stats`, creatorToken);
        assertStatus(status, 200);
        const stats = data.data as Record<string, unknown>;
        assertHas(stats, 'memberCount');
        assertHas(stats, 'pendingApplications');
        assertHas(stats, 'totalApplications');
    });

    await test('GET /groups/:id/stats as non-admin returns 403', async () => {
        const { status } = await get(`/groups/${openGroupId}/stats`, memberToken);
        assertStatus(status, 403);
    });

    // ── 3. Memberships — Join / Leave ─────────────────────────────────────────

    section('3. Memberships — Join / Leave');

    await test('POST /memberships/groups/:id/join without auth returns 401', async () => {
        const { status } = await post(`/memberships/groups/${openGroupId}/join`, {});
        assertStatus(status, 401);
    });

    await test('POST /memberships/groups/:id/join open group (201)', async () => {
        const { status } = await post(`/memberships/groups/${openGroupId}/join`, {}, memberToken);
        assertStatus(status, 201);
    });

    await test('POST /memberships/groups/:id/join again returns 409 (already member)', async () => {
        const { status } = await post(`/memberships/groups/${openGroupId}/join`, {}, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /memberships/groups/:id/join application group returns 403 (wrong type)', async () => {
        // application groups require POST /apply — join returns 403
        const { status } = await post(`/memberships/groups/${appGroupId}/join`, {}, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/members after join shows new member (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/members`, creatorToken);
        assertStatus(status, 200);
        const members = extractList(data.data);
        const found = members.some(
            (m: any) => m.userId === memberId || m.user_id === memberId,
        );
        assert(found, 'member should appear in member list after joining');
    });

    await test('GET /users/me/groups shows joined group (200)', async () => {
        const { status, data } = await get('/users/me/groups', memberToken);
        assertStatus(status, 200);
        const groups = extractList(data.data);
        const found = groups.some(
            (g: any) =>
                g.groupId === openGroupId ||
                g.group_id === openGroupId ||
                g.group?.id === openGroupId ||
                g.id === openGroupId,
        );
        assert(found, 'joined group should appear in /me/groups');
    });

    await test('DELETE /memberships/groups/:id/leave leaves group (200)', async () => {
        const { status } = await del(`/memberships/groups/${openGroupId}/leave`, memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /memberships/groups/:id/leave when not a member returns 403', async () => {
        // Service throws FORBIDDEN when user is not an active member
        const { status } = await del(`/memberships/groups/${openGroupId}/leave`, memberToken);
        assertStatus(status, 403);
    });

    await test('DELETE /memberships/groups/:id/leave without auth returns 401', async () => {
        const { status } = await del(`/memberships/groups/${openGroupId}/leave`);
        assertStatus(status, 401);
    });

    // ── 4. Memberships — Applications ─────────────────────────────────────────

    section('4. Memberships — Applications');

    await test('POST /memberships/groups/:id/apply to application group (201)', async () => {
        const { status, data } = await post(
            `/memberships/groups/${appGroupId}/apply`,
            {},
            memberToken,
        );
        assertStatus(status, 201);
        const app = data.data as Record<string, unknown>;
        applicationId = app.applicationId as string;
        assert(applicationId?.length > 0, `applicationId empty: ${JSON.stringify(app)}`);
    });

    await test('POST /memberships/groups/:id/apply again returns 409 (pending exists)', async () => {
        const { status } = await post(
            `/memberships/groups/${appGroupId}/apply`,
            {},
            memberToken,
        );
        assertStatus(status, 409);
    });

    await test('POST /memberships/groups/:id/apply to open group returns 403 (wrong type)', async () => {
        // open groups require POST /join — apply returns 403
        const { status } = await post(
            `/memberships/groups/${openGroupId}/apply`,
            {},
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('GET /memberships/groups/:id/applications as admin returns list (200)', async () => {
        const { status, data } = await get(
            `/memberships/groups/${appGroupId}/applications`,
            creatorToken,
        );
        assertStatus(status, 200);
        const apps = extractList(data.data);
        assert(apps.length >= 1, `expected at least 1 application, got ${apps.length}`);
    });

    await test('GET /memberships/groups/:id/applications as non-admin returns 403', async () => {
        const { status } = await get(
            `/memberships/groups/${appGroupId}/applications`,
            memberToken,
        );
        assertStatus(status, 403);
    });

    await test('GET /memberships/groups/:id/applications without auth returns 401', async () => {
        const { status } = await get(`/memberships/groups/${appGroupId}/applications`);
        assertStatus(status, 401);
    });

    await test('GET /users/me/applications returns own application list (200)', async () => {
        const { status } = await get('/users/me/applications', memberToken);
        assertStatus(status, 200);
    });

    await test('GET /users/me/applications?status=pending filters by status (200)', async () => {
        const { status } = await get('/users/me/applications?status=pending', memberToken);
        assertStatus(status, 200);
    });

    await test('PATCH /memberships/applications/:id rejects application (200)', async () => {
        const { status } = await patch(
            `/memberships/applications/${applicationId}`,
            { action: 'reject', rejection_reason: 'Not a good fit for now.' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /memberships/applications/:id as non-admin returns 403', async () => {
        // outsider not in group → middleware blocks with 403
        const { status } = await patch(
            `/memberships/applications/${applicationId}`,
            { action: 'approve' },
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('PATCH /memberships/applications/:id invalid action returns 422', async () => {
        const { status } = await patch(
            `/memberships/applications/${applicationId}`,
            { action: 'vanish' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST apply after rejection allows re-application (201)', async () => {
        // Old rejected application is deleted, fresh one is created
        const { status, data } = await post(
            `/memberships/groups/${appGroupId}/apply`,
            {},
            memberToken,
        );
        assertStatus(status, 201);
        applicationId = (data.data as any).applicationId as string;
        assert(applicationId?.length > 0, 'new applicationId should be set');
    });

    await test('DELETE /memberships/applications/:id withdraws own pending application (200)', async () => {
        const { status } = await del(`/memberships/applications/${applicationId}`, memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /memberships/applications/:id again returns 409 (already withdrawn)', async () => {
        // Service throws CONFLICT when application is not pending
        const { status } = await del(`/memberships/applications/${applicationId}`, memberToken);
        assertStatus(status, 409);
    });

    await test('DELETE /memberships/applications/:id by non-owner returns 403', async () => {
        const { status } = await del(`/memberships/applications/${applicationId}`, outsiderToken);
        assertStatus(status, 403);
    });

    // Apply fresh + approve to grant membership for member-management tests
    await test('POST apply + PATCH approve → member becomes active (201 + 200)', async () => {
        // Withdrawn application is deleted, fresh one is created
        const { status: s1, data: d1 } = await post(
            `/memberships/groups/${appGroupId}/apply`,
            {},
            memberToken,
        );
        assertStatus(s1, 201);
        const freshAppId = (d1.data as any).applicationId as string;
        assert(freshAppId?.length > 0, 'freshAppId should be set');

        const { status: s2 } = await patch(
            `/memberships/applications/${freshAppId}`,
            { action: 'approve' },
            creatorToken,
        );
        assertStatus(s2, 200);

        // Verify member is now in appGroup
        const { status: s3, data: d3 } = await get(`/groups/${appGroupId}/members`, creatorToken);
        assertStatus(s3, 200);
        const members = extractList(d3.data);
        const found = members.some(
            (m: any) => m.userId === memberId || m.user_id === memberId,
        );
        assert(found, 'member should appear in appGroup after approval');
    });

    // ── 5. Memberships — Group Form ───────────────────────────────────────────

    section('5. Memberships — Group Form');

    await test('GET /memberships/groups/:id/form with no form returns 200', async () => {
        const { status } = await get(`/memberships/groups/${appGroupId}/form`);
        assertStatus(status, 200);
    });

    await test('PUT /memberships/groups/:id/form without auth returns 401', async () => {
        const { status } = await put(`/memberships/groups/${appGroupId}/form`, {
            fields: [{ id: 'q1', type: 'text', label: 'Why join?', required: true }],
        });
        assertStatus(status, 401);
    });

    await test('PUT /memberships/groups/:id/form as non-admin returns 403', async () => {
        const { status } = await put(
            `/memberships/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'text', label: 'Why?', required: true }] },
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('PUT /memberships/groups/:id/form creates form with 2 fields (200)', async () => {
        const { status, data } = await put(
            `/memberships/groups/${appGroupId}/form`,
            {
                fields: [
                    { id: 'q1', type: 'text', label: 'Why do you want to join?', required: true },
                    {
                        id: 'q2',
                        type: 'select',
                        label: 'How did you hear about us?',
                        required: false,
                        options: ['Social media', 'Friend', 'Other'],
                    },
                ],
            },
            creatorToken,
        );
        assertStatus(status, 200);
        const form = data.data as Record<string, unknown>;
        assertHas(form, 'fields');
        const fields = form.fields as unknown[];
        assert(fields.length === 2, `expected 2 fields, got ${fields.length}`);
    });

    await test('GET /memberships/groups/:id/form returns saved form with fields (200)', async () => {
        const { status, data } = await get(`/memberships/groups/${appGroupId}/form`);
        assertStatus(status, 200);
        const form = data.data as Record<string, unknown> | null;
        if (form) {
            assertHas(form, 'fields');
            const fields = form.fields as unknown[];
            assert(fields.length === 2, `expected 2 fields, got ${fields.length}`);
        }
    });

    await test('PUT /memberships/groups/:id/form replaces form (1 field) (200)', async () => {
        const { status, data } = await put(
            `/memberships/groups/${appGroupId}/form`,
            {
                fields: [
                    { id: 'q1', type: 'textarea', label: 'Tell us about yourself', required: true },
                ],
            },
            creatorToken,
        );
        assertStatus(status, 200);
        const form = data.data as Record<string, unknown>;
        const fields = form.fields as unknown[];
        assert(fields.length === 1, `expected 1 field after replace, got ${fields.length}`);
    });

    await test('PUT /memberships/groups/:id/form with invalid field type returns 422', async () => {
        const { status } = await put(
            `/memberships/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'invalid_type', label: 'Bad', required: true }] },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PUT /memberships/groups/:id/form with 21 fields returns 422', async () => {
        const tooMany = Array.from({ length: 21 }, (_, i) => ({
            id: `q${i}`,
            type: 'text',
            label: `Field ${i}`,
            required: false,
        }));
        const { status } = await put(
            `/memberships/groups/${appGroupId}/form`,
            { fields: tooMany },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 6. Memberships — Member Management ───────────────────────────────────

    section('6. Memberships — Member Management');

    await test('member re-joins openGroup for role management tests (201)', async () => {
        const { status } = await post(`/memberships/groups/${openGroupId}/join`, {}, memberToken);
        assertStatus(status, 201);
    });

    await test('PATCH /memberships/groups/:id/members/:userId promotes to moderator (200)', async () => {
        const { status } = await patch(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            { role: 'moderator' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /memberships/groups/:id/members/:userId without auth returns 401', async () => {
        const { status } = await patch(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            { role: 'member' },
        );
        assertStatus(status, 401);
    });

    await test('PATCH /memberships/groups/:id/members/:userId as non-admin returns 403', async () => {
        // outsider not in openGroup → 403
        const { status } = await patch(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            { role: 'member' },
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('PATCH /memberships/groups/:id/members/:userId suspends member (200)', async () => {
        const { status } = await patch(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            { status: 'suspended' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /memberships/groups/:id/members/:userId restores member to active (200)', async () => {
        const { status } = await patch(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            { status: 'active' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('DELETE /memberships/groups/:id/members/:userId removes member (200)', async () => {
        const { status } = await del(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('DELETE /memberships/groups/:id/members/:userId twice returns 404 (not found)', async () => {
        const { status } = await del(
            `/memberships/groups/${openGroupId}/members/${memberId}`,
            creatorToken,
        );
        assertStatus(status, 404);
    });

    await test('DELETE /memberships/groups/:id/members/:userId without auth returns 401', async () => {
        const { status } = await del(`/memberships/groups/${openGroupId}/members/${outsiderId}`);
        assertStatus(status, 401);
    });

    // ── 7. Memberships — Invite Links ─────────────────────────────────────────

    section('7. Memberships — Invite Links');

    await test('POST /memberships/groups/:id/invite without auth returns 401', async () => {
        const { status } = await post(`/memberships/groups/${openGroupId}/invite`, {});
        assertStatus(status, 401);
    });

    await test('POST /memberships/groups/:id/invite as non-admin returns 403', async () => {
        // outsider not in group → 403
        const { status } = await post(
            `/memberships/groups/${openGroupId}/invite`,
            {},
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('POST /memberships/groups/:id/invite generates link (201)', async () => {
        const { status, data } = await post(
            `/memberships/groups/${openGroupId}/invite`,
            { max_uses: 10, expires_in_hours: 48 },
            creatorToken,
        );
        assertStatus(status, 201);
        const link = data.data as Record<string, unknown>;
        assertHas(link, 'token');
        assertHas(link, 'id');
        inviteToken = link.token as string;
        inviteId = link.id as string;
        assert(inviteToken.length > 0, 'inviteToken empty');
        assert(inviteId.length > 0, 'inviteId empty');
    });

    await test('POST /memberships/groups/:id/invite with expires_in_hours > 8760 returns 422', async () => {
        const { status } = await post(
            `/memberships/groups/${openGroupId}/invite`,
            { expires_in_hours: 99999 },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /memberships/groups/:id/invites lists active links (200)', async () => {
        const { status, data } = await get(
            `/memberships/groups/${openGroupId}/invites`,
            creatorToken,
        );
        assertStatus(status, 200);
        const links = extractList(data.data);
        assert(links.length >= 1, `expected at least 1 invite, got ${links.length}`);
    });

    await test('GET /memberships/groups/:id/invites without auth returns 401', async () => {
        const { status } = await get(`/memberships/groups/${openGroupId}/invites`);
        assertStatus(status, 401);
    });

    await test('POST /memberships/invites/:token/accept joins group (201)', async () => {
        // member was removed in section 6 — not in openGroup
        const { status } = await post(
            `/memberships/invites/${inviteToken}/accept`,
            {},
            memberToken,
        );
        assertStatus(status, 201);
    });

    await test('POST /memberships/invites/:token/accept again returns 409 (already member)', async () => {
        const { status } = await post(
            `/memberships/invites/${inviteToken}/accept`,
            {},
            memberToken,
        );
        assertStatus(status, 409);
    });

    await test('POST /memberships/invites/invalid-token/accept returns 404', async () => {
        const { status } = await post(
            '/memberships/invites/definitely-not-a-real-token-xyz/accept',
            {},
            outsiderToken,
        );
        assertStatus(status, 404);
    });

    await test('POST /memberships/invites/:token/accept without auth returns 401', async () => {
        const { status } = await post(`/memberships/invites/${inviteToken}/accept`, {});
        assertStatus(status, 401);
    });

    await test('DELETE /memberships/invites/:id revokes invite (200)', async () => {
        const { status } = await del(`/memberships/invites/${inviteId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('DELETE /memberships/invites/:id again returns 409 (already revoked)', async () => {
        const { status } = await del(`/memberships/invites/${inviteId}`, creatorToken);
        assertStatus(status, 409);
    });

    await test('POST /memberships/invites/:token/accept after revoke returns 410 (Gone)', async () => {
        const { status } = await post(
            `/memberships/invites/${inviteToken}/accept`,
            {},
            outsiderToken,
        );
        assertStatus(status, 410);
    });

    // ── 8. Group Deletion ─────────────────────────────────────────────────────

    section('8. Group Deletion');

    await test('DELETE /groups/:id without auth returns 401', async () => {
        const { status } = await del(`/groups/${appGroupId}`);
        assertStatus(status, 401);
    });

    await test('DELETE /groups/:id as non-super_admin returns 403', async () => {
        // outsider not in group → 403
        const { status } = await del(`/groups/${appGroupId}`, outsiderToken);
        assertStatus(status, 403);
    });

    await test('DELETE /groups/:id as super_admin soft-deletes group (200)', async () => {
        const { status } = await del(`/groups/${appGroupId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /groups/:slug after deletion returns 404', async () => {
        const { status } = await get(`/groups/${appGroupSlug}`);
        assertStatus(status, 404);
    });

    await test('DELETE /groups/:id again returns 404 (already deleted)', async () => {
        const { status } = await del(`/groups/${appGroupId}`, creatorToken);
        assertStatus(status, 404);
    });

    // ── 9. Account Deletion ───────────────────────────────────────────────────

    section('9. Account Deletion');

    await test('DELETE /users/me without auth returns 401', async () => {
        const { status } = await del('/users/me');
        assertStatus(status, 401);
    });

    await test('DELETE /users/me soft-deletes account (200)', async () => {
        // Use outsider — they have no shared state that would break other tests
        const { status } = await del('/users/me', outsiderToken);
        assertStatus(status, 200);
    });

    await test('POST /groups after account deletion returns 404 (authenticateVerified: user.deletedAt set)', async () => {
        // authenticateVerified checks user.deletedAt and returns 404 NOT_FOUND for deleted accounts
        const { status } = await post(
            '/groups',
            { name: 'Ghost Group', category: 'Tech' },
            outsiderToken,
        );
        assertStatus(status, 404);
    });

    // ─── Summary ──────────────────────────────────────────────────────────────

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const total = results.length;

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed}/${total} passed  |  ${failed} failed`);
    console.log('══════════════════════════════════════════════════════════════');

    if (failed > 0) {
        console.log('\n  Failed tests:');
        results
            .filter((r) => !r.passed)
            .forEach((r) => console.log(`    ✗  ${r.name}\n       ${r.error}`));
    }

    console.log('');
}

run()
    .catch((err) => {
        console.error('\nFatal test runner error:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await redis.quit();
        process.exit(results.some((r) => !r.passed) ? 1 : 0);
    });
