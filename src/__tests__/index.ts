/**
 * Full integration test suite — Auth · Users · Groups · Memberships
 *
 * Requires a running server on localhost:3000.
 *
 * Usage:
 *   1. Start the server:  npm run dev   (or: npx tsx src/server.ts)
 *   2. Run tests:         npx tsx src/__tests__/index.ts
 */

import { redis, prisma } from '../database/connection';

const BASE = 'http://localhost:3000/api/v1';
const ts = Date.now();

// ─── Shared assertion helpers ─────────────────────────────────────────────────

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

// ─── Shared HTTP helpers ──────────────────────────────────────────────────────

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

const get  = (path: string, token?: string)                  => request('GET',    path, undefined, token);
const post = (path: string, body: object,  token?: string)   => request('POST',   path, body,      token);
const patch= (path: string, body: object,  token?: string)   => request('PATCH',  path, body,      token);
const put  = (path: string, body: object,  token?: string)   => request('PUT',    path, body,      token);
const del  = (path: string, token?: string, body?: object)   => request('DELETE', path, body,      token);

// ─── Shared test runner ───────────────────────────────────────────────────────

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

// ─── Redis OTP helper (auth suite) ───────────────────────────────────────────

async function getOtp(prefix: 'verify:email' | 'verify:forgot', email: string): Promise<string> {
    const key = `${prefix}:${email}`;
    const otp = await redis.get(key);
    assert(otp !== null, `OTP not found in Redis at key "${key}"`);
    return otp!;
}

// ─── Setup helpers (features suite) ──────────────────────────────────────────

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
    const tokens  = payload.tokens as Record<string, unknown>;
    const user    = payload.user   as Record<string, unknown>;
    return { token: tokens.accessToken as string, userId: user.id as string };
}

async function setVerified(userId: string): Promise<void> {
    await prisma.user.update({
        where: { id: userId },
        data:  { idVerificationStatus: 'verified' },
    });
}

function extractList(data: unknown): unknown[] {
    if (!data || typeof data !== 'object') return [];
    const d = data as Record<string, unknown>;
    for (const key of ['members', 'applications', 'invites', 'groups', 'items', 'data']) {
        if (Array.isArray(d[key])) return d[key] as unknown[];
    }
    if (Array.isArray(d)) return d as unknown[];
    return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH SUITE
// ═══════════════════════════════════════════════════════════════════════════════

async function runAuthSuite(): Promise<void> {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  Suite 1 — Auth Flow');
    console.log('══════════════════════════════════════════════════');

    const EMAIL    = `tester${ts}@test.io`;
    const PASSWORD = 'TestPass123';

    let accessToken  = '';
    let refreshToken = '';
    let forgotOtp    = '';

    // ── 1. Registration ───────────────────────────────────────────────────────

    section('1. Registration');

    await test('valid registration returns 201 with user + tokens', async () => {
        const { status, data } = await post('/auth/register', {
            email: EMAIL, password: PASSWORD, display_name: 'Auth Tester',
        });
        assertStatus(status, 201);
        assert(data.success === true, 'success should be true');
        const payload = data.data as Record<string, unknown>;
        assertHas(payload, 'user');
        assertHas(payload, 'tokens');
        const tokens = payload.tokens as Record<string, unknown>;
        assertHas(tokens, 'accessToken');
        assertHas(tokens, 'refreshToken');
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('duplicate email returns 409', async () => {
        const { status } = await post('/auth/register', {
            email: EMAIL, password: PASSWORD, display_name: 'Auth Tester',
        });
        assertStatus(status, 409);
    });

    await test('missing required fields returns 422', async () => {
        const { status } = await post('/auth/register', { email: 'not-an-email' });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('weak password (no uppercase) returns 422', async () => {
        const { status } = await post('/auth/register', {
            email: `weak${ts}@test.io`, password: 'alllowercase1', display_name: 'Weak Pass',
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 2. Login ──────────────────────────────────────────────────────────────

    section('2. Login');

    await test('valid credentials return 200 with tokens', async () => {
        const { status, data } = await post('/auth/login', { email: EMAIL, password: PASSWORD });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('wrong password returns 401', async () => {
        const { status } = await post('/auth/login', { email: EMAIL, password: 'WrongPass999' });
        assertStatus(status, 401);
    });

    await test('non-existent email returns 401 (no enumeration)', async () => {
        const { status } = await post('/auth/login', { email: `ghost${ts}@test.io`, password: PASSWORD });
        assertStatus(status, 401);
    });

    await test('missing password returns 422', async () => {
        const { status } = await post('/auth/login', { email: EMAIL });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 3. Email Verification ─────────────────────────────────────────────────

    section('3. Email Verification');

    await test('resend-verification always returns 200', async () => {
        const { status } = await post('/auth/resend-verification', { email: EMAIL });
        assertStatus(status, 200);
    });

    await test('invalid OTP returns 400', async () => {
        const { status } = await post('/auth/verify-email', { email: EMAIL, otp: '000000' });
        assertStatus(status, 400);
    });

    await test('valid OTP from Redis verifies email (200)', async () => {
        const otp = await getOtp('verify:email', EMAIL);
        const { status } = await post('/auth/verify-email', { email: EMAIL, otp });
        assertStatus(status, 200);
    });

    await test('replaying the same OTP after consumption returns 400', async () => {
        const { status } = await post('/auth/verify-email', { email: EMAIL, otp: '123456' });
        assertStatus(status, 400);
    });

    // ── 4. Token Refresh ──────────────────────────────────────────────────────

    section('4. Token Refresh');

    await test('valid refresh token returns new token pair', async () => {
        const { status, data } = await post('/auth/refresh', { refresh_token: refreshToken });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('old refresh token after rotation returns 401 (rotation enforced)', async () => {
        const { status } = await post('/auth/refresh', { refresh_token: 'definitely-fake-token' });
        assertStatus(status, 401);
    });

    await test('missing refresh_token field returns 422', async () => {
        const { status } = await post('/auth/refresh', {});
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 5. Forgot / Reset Password ────────────────────────────────────────────

    section('5. Forgot / Reset Password');

    await test('forgot-password always returns 200 (no email enumeration)', async () => {
        const { status } = await post('/auth/forgot-password', { email: EMAIL });
        assertStatus(status, 200);
    });

    await test('forgot-password for non-existent email also returns 200', async () => {
        const { status } = await post('/auth/forgot-password', { email: `ghost${ts}@test.io` });
        assertStatus(status, 200);
    });

    await test('verify-forgot-otp with wrong OTP returns 400', async () => {
        const { status } = await post('/auth/verify-forgot-otp', { email: EMAIL, otp: '000000' });
        assertStatus(status, 400);
    });

    await test('verify-forgot-otp with correct OTP returns 200', async () => {
        forgotOtp = await getOtp('verify:forgot', EMAIL);
        const { status } = await post('/auth/verify-forgot-otp', { email: EMAIL, otp: forgotOtp });
        assertStatus(status, 200);
    });

    const NEW_PASSWORD = 'NewPass456!';

    await test('reset-password with wrong OTP returns 400', async () => {
        const { status } = await post('/auth/reset-password', {
            email: EMAIL, otp: '000000', password: NEW_PASSWORD,
        });
        assertStatus(status, 400);
    });

    await test('reset-password with correct OTP returns 200', async () => {
        const { status } = await post('/auth/reset-password', {
            email: EMAIL, otp: forgotOtp, password: NEW_PASSWORD,
        });
        assertStatus(status, 200);
    });

    await test('login with old password after reset returns 401', async () => {
        const { status } = await post('/auth/login', { email: EMAIL, password: PASSWORD });
        assertStatus(status, 401);
    });

    await test('login with new password after reset returns 200', async () => {
        const { status, data } = await post('/auth/login', { email: EMAIL, password: NEW_PASSWORD });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    // ── 6. Change Password ────────────────────────────────────────────────────

    section('6. Change Password');

    const CHANGED_PASSWORD = 'Changed789!';

    await test('change-password without auth returns 401', async () => {
        const { status } = await post('/auth/change-password', {
            old_password: NEW_PASSWORD, new_password: CHANGED_PASSWORD,
        });
        assertStatus(status, 401);
    });

    await test('change-password with wrong old password returns 400', async () => {
        const { status } = await post(
            '/auth/change-password',
            { old_password: 'WrongOld123', new_password: CHANGED_PASSWORD },
            accessToken,
        );
        assertStatus(status, 400);
    });

    await test('change-password with correct credentials returns 200', async () => {
        const { status } = await post(
            '/auth/change-password',
            { old_password: NEW_PASSWORD, new_password: CHANGED_PASSWORD },
            accessToken,
        );
        assertStatus(status, 200);
    });

    await test('login with changed password returns 200', async () => {
        const { status, data } = await post('/auth/login', {
            email: EMAIL, password: CHANGED_PASSWORD,
        });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    // ── 7. Logout ─────────────────────────────────────────────────────────────

    section('7. Logout');

    await test('logout without auth returns 401', async () => {
        const { status } = await post('/auth/logout', { refresh_token: refreshToken });
        assertStatus(status, 401);
    });

    await test('logout with valid auth returns 200', async () => {
        const { status } = await post('/auth/logout', { refresh_token: refreshToken }, accessToken);
        assertStatus(status, 200);
    });

    await test('refresh with revoked token after logout returns 401', async () => {
        const { status } = await post('/auth/refresh', { refresh_token: refreshToken });
        assertStatus(status, 401);
    });

    await test('logout is idempotent (second call still returns 200)', async () => {
        const { status } = await post('/auth/logout', { refresh_token: refreshToken }, accessToken);
        assertStatus(status, 200);
    });

    // ── 8. Account Lock ───────────────────────────────────────────────────────

    section('8. Account Lock (brute force protection)');

    const LOCK_EMAIL = `locktest${ts}@test.io`;

    await test('register a second user for lock testing', async () => {
        const { status } = await post('/auth/register', {
            email: LOCK_EMAIL, password: PASSWORD, display_name: 'Lock Tester',
        });
        assertStatus(status, 201);
    });

    await test('5 consecutive bad passwords lock the account (429)', async () => {
        for (let i = 0; i < 5; i++) {
            await post('/auth/login', { email: LOCK_EMAIL, password: 'WrongPass999' });
        }
        const { status } = await post('/auth/login', { email: LOCK_EMAIL, password: PASSWORD });
        assertStatus(status, 429);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURES SUITE
// ═══════════════════════════════════════════════════════════════════════════════

async function runFeaturesSuite(): Promise<void> {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  Suite 2 — Users · Groups · Memberships');
    console.log('══════════════════════════════════════════════════════════════');

    const CREATOR_EMAIL  = `creator${ts}@test.io`;
    const CREATOR_PASS   = 'Creator123!';
    const MEMBER_EMAIL   = `member${ts}@test.io`;
    const MEMBER_PASS    = 'Member123!';
    const OUTSIDER_EMAIL = `outsider${ts}@test.io`;
    const OUTSIDER_PASS  = 'Outsider123!';

    let creatorToken  = '';
    let memberToken   = '';
    let outsiderToken = '';
    let creatorId     = '';
    let memberId      = '';
    let outsiderId    = '';

    let openGroupId   = '';
    let openGroupSlug = '';
    let appGroupId    = '';
    let appGroupSlug  = '';
    let applicationId = '';
    let inviteToken   = '';
    let inviteId      = '';

    // ── 0. Setup ──────────────────────────────────────────────────────────────

    section('0. Setup');

    await test('register creator, member, outsider', async () => {
        const c = await registerAndLogin(CREATOR_EMAIL,  CREATOR_PASS,  'Group Creator');
        const m = await registerAndLogin(MEMBER_EMAIL,   MEMBER_PASS,   'Test Member');
        const o = await registerAndLogin(OUTSIDER_EMAIL, OUTSIDER_PASS, 'Outsider');
        creatorToken  = c.token; creatorId  = c.userId;
        memberToken   = m.token; memberId   = m.userId;
        outsiderToken = o.token; outsiderId = o.userId;
    });

    await test('set id_verification_status = verified for all actors', async () => {
        await setVerified(creatorId);
        await setVerified(memberId);
        await setVerified(outsiderId);
    });

    await test('re-login all actors to get fresh tokens reflecting DB change', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL,  password: CREATOR_PASS  });
        const { data: md } = await post('/auth/login', { email: MEMBER_EMAIL,   password: MEMBER_PASS   });
        const { data: od } = await post('/auth/login', { email: OUTSIDER_EMAIL, password: OUTSIDER_PASS });
        creatorToken  = ((cd.data as any).tokens as any).accessToken;
        memberToken   = ((md.data as any).tokens as any).accessToken;
        outsiderToken = ((od.data as any).tokens as any).accessToken;
        assert(creatorToken.length  > 0, 'creatorToken empty');
        assert(memberToken.length   > 0, 'memberToken empty');
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
        const { status } = await patch('/users/me', { username: `creator_${ts}` }, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /users/me/interests sets interests array (200)', async () => {
        const { status, data } = await post(
            '/users/me/interests',
            { interests: ['cooking', 'hiking', 'technology'] },
            creatorToken,
        );
        assertStatus(status, 200);
        const interests = (data.data as Record<string, unknown>).interests as string[];
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
        const { token } = await registerAndLogin(`unverf${ts}@test.io`, 'Unverf123!', 'Unverified');
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
            { name: `OpenGroup ${ts}`, category: 'Technology', description: 'An open group for integration testing', membership_type: 'open' },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        assertHas(group, 'id');
        assertHas(group, 'slug');
        openGroupId   = group.id   as string;
        openGroupSlug = group.slug as string;
        assert(openGroupId.length > 0,   'openGroupId empty');
        assert(openGroupSlug.length > 0, 'openGroupSlug empty');
    });

    await test('POST /groups creates application group (201)', async () => {
        const { status, data } = await post(
            '/groups',
            { name: `AppGroup ${ts}`, category: 'Lifestyle', description: 'Application-based group for testing', membership_type: 'application' },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        appGroupId   = group.id   as string;
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
        assert(group.isDiscoverable === false, `invite_only group should not be discoverable: ${group.isDiscoverable}`);
    });

    await test('GET /groups returns paginated list (200)', async () => {
        const { status, data } = await get('/groups');
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'data.data should be an array');
    });

    await test('GET /groups?q= full-text search returns results (200)', async () => {
        const { status } = await get('/groups?q=OpenGroup');
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
        const group  = result.group as Record<string, unknown>;
        assert(group.id   === openGroupId,   `id mismatch: ${group.id}`);
        assert(group.slug === openGroupSlug, `slug mismatch: ${group.slug}`);
    });

    await test('GET /groups/:slug includes callerMembershipStatus when authed (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`, creatorToken);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        assertHas(result, 'callerMembershipStatus');
        const cms = result.callerMembershipStatus as Record<string, unknown>;
        assert(cms.isMember === true,          'creator should be a member of their own group');
        assert(cms.role     === 'super_admin', `creator should be super_admin, got ${cms.role}`);
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
        assert(group.description === 'Updated via integration test', `description not updated: ${group.description}`);
    });

    await test('PATCH /groups/:id without auth returns 401', async () => {
        const { status } = await patch(`/groups/${openGroupId}`, { description: 'no auth' });
        assertStatus(status, 401);
    });

    await test('PATCH /groups/:id as non-member returns 403', async () => {
        const { status } = await patch(`/groups/${openGroupId}`, { description: 'unauthorized' }, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/members returns list with creator (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/members`, creatorToken);
        assertStatus(status, 200);
        const members = extractList(data.data);
        assert(Array.isArray(members) && members.length >= 1, 'creator should be in the member list');
        const found = members.some((m: any) => m.userId === creatorId || m.user_id === creatorId);
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

    await test('POST /groups/:id/join without auth returns 401', async () => {
        const { status } = await post(`/groups/${openGroupId}/join`, {});
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/join open group (201)', async () => {
        const { status } = await post(`/groups/${openGroupId}/join`, {}, memberToken);
        assertStatus(status, 201);
    });

    await test('POST /groups/:id/join again returns 409 (already member)', async () => {
        const { status } = await post(`/groups/${openGroupId}/join`, {}, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /groups/:id/join application group returns 403 (wrong type)', async () => {
        const { status } = await post(`/groups/${appGroupId}/join`, {}, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/members after join shows new member (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/members`, creatorToken);
        assertStatus(status, 200);
        const members = extractList(data.data);
        const found = members.some((m: any) => m.userId === memberId || m.user_id === memberId);
        assert(found, 'member should appear in member list after joining');
    });

    await test('GET /users/me/groups shows joined group (200)', async () => {
        const { status, data } = await get('/users/me/groups', memberToken);
        assertStatus(status, 200);
        const groups = extractList(data.data);
        const found  = groups.some(
            (g: any) => g.groupId === openGroupId || g.group_id === openGroupId || g.group?.id === openGroupId || g.id === openGroupId,
        );
        assert(found, 'joined group should appear in /me/groups');
    });

    await test('DELETE /groups/:id/leave leaves group (200)', async () => {
        const { status } = await del(`/groups/${openGroupId}/leave`, memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /groups/:id/leave when not a member returns 403', async () => {
        const { status } = await del(`/groups/${openGroupId}/leave`, memberToken);
        assertStatus(status, 403);
    });

    await test('DELETE /groups/:id/leave without auth returns 401', async () => {
        const { status } = await del(`/groups/${openGroupId}/leave`);
        assertStatus(status, 401);
    });

    // ── 4. Memberships — Applications ─────────────────────────────────────────

    section('4. Memberships — Applications');

    await test('POST /groups/:id/apply to application group (201)', async () => {
        const { status, data } = await post(`/groups/${appGroupId}/apply`, {}, memberToken);
        assertStatus(status, 201);
        const app = data.data as Record<string, unknown>;
        applicationId = app.applicationId as string;
        assert(applicationId?.length > 0, `applicationId empty: ${JSON.stringify(app)}`);
    });

    await test('POST /groups/:id/apply again returns 409 (pending exists)', async () => {
        const { status } = await post(`/groups/${appGroupId}/apply`, {}, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /groups/:id/apply to open group returns 403 (wrong type)', async () => {
        const { status } = await post(`/groups/${openGroupId}/apply`, {}, outsiderToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/applications as admin returns list (200)', async () => {
        const { status, data } = await get(`/groups/${appGroupId}/applications`, creatorToken);
        assertStatus(status, 200);
        const apps = extractList(data.data);
        assert(apps.length >= 1, `expected at least 1 application, got ${apps.length}`);
    });

    await test('GET /groups/:id/applications as non-admin returns 403', async () => {
        const { status } = await get(`/groups/${appGroupId}/applications`, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/applications without auth returns 401', async () => {
        const { status } = await get(`/groups/${appGroupId}/applications`);
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

    await test('PATCH /groups/applications/:id rejects application (200)', async () => {
        const { status } = await patch(
            `/groups/applications/${applicationId}`,
            { action: 'reject', rejection_reason: 'Not a good fit for now.' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /groups/applications/:id as non-admin returns 403', async () => {
        const { status } = await patch(
            `/groups/applications/${applicationId}`,
            { action: 'approve' },
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('PATCH /groups/applications/:id invalid action returns 422', async () => {
        const { status } = await patch(
            `/groups/applications/${applicationId}`,
            { action: 'vanish' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST apply after rejection allows re-application (201)', async () => {
        const { status, data } = await post(`/groups/${appGroupId}/apply`, {}, memberToken);
        assertStatus(status, 201);
        applicationId = (data.data as any).applicationId as string;
        assert(applicationId?.length > 0, 'new applicationId should be set');
    });

    await test('DELETE /groups/applications/:id withdraws own pending application (200)', async () => {
        const { status } = await del(`/groups/applications/${applicationId}`, memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /groups/applications/:id again returns 409 (already withdrawn)', async () => {
        const { status } = await del(`/groups/applications/${applicationId}`, memberToken);
        assertStatus(status, 409);
    });

    await test('DELETE /groups/applications/:id by non-owner returns 403', async () => {
        const { status } = await del(`/groups/applications/${applicationId}`, outsiderToken);
        assertStatus(status, 403);
    });

    await test('POST apply + PATCH approve → member becomes active (201 + 200)', async () => {
        const { status: s1, data: d1 } = await post(`/groups/${appGroupId}/apply`, {}, memberToken);
        assertStatus(s1, 201);
        const freshAppId = (d1.data as any).applicationId as string;
        assert(freshAppId?.length > 0, 'freshAppId should be set');

        const { status: s2 } = await patch(
            `/groups/applications/${freshAppId}`,
            { action: 'approve' },
            creatorToken,
        );
        assertStatus(s2, 200);

        const { status: s3, data: d3 } = await get(`/groups/${appGroupId}/members`, creatorToken);
        assertStatus(s3, 200);
        const members = extractList(d3.data);
        const found   = members.some((m: any) => m.userId === memberId || m.user_id === memberId);
        assert(found, 'member should appear in appGroup after approval');
    });

    // ── 5. Memberships — Group Form ───────────────────────────────────────────

    section('5. Memberships — Group Form');

    await test('GET /groups/:id/form with no form returns 200', async () => {
        const { status } = await get(`/groups/${appGroupId}/form`);
        assertStatus(status, 200);
    });

    await test('PUT /groups/:id/form without auth returns 401', async () => {
        const { status } = await put(`/groups/${appGroupId}/form`, {
            fields: [{ id: 'q1', type: 'text', label: 'Why join?', required: true }],
        });
        assertStatus(status, 401);
    });

    await test('PUT /groups/:id/form as non-admin returns 403', async () => {
        const { status } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'text', label: 'Why?', required: true }] },
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('PUT /groups/:id/form creates form with 2 fields (200)', async () => {
        const { status, data } = await put(
            `/groups/${appGroupId}/form`,
            {
                fields: [
                    { id: 'q1', type: 'text',   label: 'Why do you want to join?',   required: true  },
                    { id: 'q2', type: 'select',  label: 'How did you hear about us?', required: false, options: ['Social media', 'Friend', 'Other'] },
                ],
            },
            creatorToken,
        );
        assertStatus(status, 200);
        const form   = data.data as Record<string, unknown>;
        assertHas(form, 'fields');
        const fields = form.fields as unknown[];
        assert(fields.length === 2, `expected 2 fields, got ${fields.length}`);
    });

    await test('GET /groups/:id/form returns saved form with fields (200)', async () => {
        const { status, data } = await get(`/groups/${appGroupId}/form`);
        assertStatus(status, 200);
        const form = data.data as Record<string, unknown> | null;
        if (form) {
            const fields = form.fields as unknown[];
            assert(fields.length === 2, `expected 2 fields, got ${fields.length}`);
        }
    });

    await test('PUT /groups/:id/form replaces form (1 field) (200)', async () => {
        const { status, data } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'textarea', label: 'Tell us about yourself', required: true }] },
            creatorToken,
        );
        assertStatus(status, 200);
        const fields = (data.data as Record<string, unknown>).fields as unknown[];
        assert(fields.length === 1, `expected 1 field after replace, got ${fields.length}`);
    });

    await test('PUT /groups/:id/form with invalid field type returns 422', async () => {
        const { status } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'invalid_type', label: 'Bad', required: true }] },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PUT /groups/:id/form with 21 fields returns 422', async () => {
        const tooMany = Array.from({ length: 21 }, (_, i) => ({ id: `q${i}`, type: 'text', label: `Field ${i}`, required: false }));
        const { status } = await put(`/groups/${appGroupId}/form`, { fields: tooMany }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 6. Memberships — Member Management ───────────────────────────────────

    section('6. Memberships — Member Management');

    await test('member re-joins openGroup for role management tests (201)', async () => {
        const { status } = await post(`/groups/${openGroupId}/join`, {}, memberToken);
        assertStatus(status, 201);
    });

    await test('PATCH /groups/:id/members/:userId promotes to moderator (200)', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { role: 'moderator' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /groups/:id/members/:userId without auth returns 401', async () => {
        const { status } = await patch(`/groups/${openGroupId}/members/${memberId}`, { role: 'member' });
        assertStatus(status, 401);
    });

    await test('PATCH /groups/:id/members/:userId as non-admin returns 403', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { role: 'member' },
            outsiderToken,
        );
        assertStatus(status, 403);
    });

    await test('PATCH /groups/:id/members/:userId suspends member (200)', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { status: 'suspended' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /groups/:id/members/:userId restores member to active (200)', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { status: 'active' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('DELETE /groups/:id/members/:userId removes member (200)', async () => {
        const { status } = await del(`/groups/${openGroupId}/members/${memberId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('DELETE /groups/:id/members/:userId twice returns 404 (not found)', async () => {
        const { status } = await del(`/groups/${openGroupId}/members/${memberId}`, creatorToken);
        assertStatus(status, 404);
    });

    await test('DELETE /groups/:id/members/:userId without auth returns 401', async () => {
        const { status } = await del(`/groups/${openGroupId}/members/${outsiderId}`);
        assertStatus(status, 401);
    });

    // ── 7. Memberships — Invite Links ─────────────────────────────────────────

    section('7. Memberships — Invite Links');

    await test('POST /groups/:id/invite without auth returns 401', async () => {
        const { status } = await post(`/groups/${openGroupId}/invite`, {});
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/invite as non-admin returns 403', async () => {
        const { status } = await post(`/groups/${openGroupId}/invite`, {}, outsiderToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/invite generates link (201)', async () => {
        const { status, data } = await post(
            `/groups/${openGroupId}/invite`,
            { max_uses: 10, expires_in_hours: 48 },
            creatorToken,
        );
        assertStatus(status, 201);
        const link = data.data as Record<string, unknown>;
        assertHas(link, 'token');
        assertHas(link, 'id');
        inviteToken = link.token as string;
        inviteId    = link.id    as string;
        assert(inviteToken.length > 0, 'inviteToken empty');
        assert(inviteId.length    > 0, 'inviteId empty');
    });

    await test('POST /groups/:id/invite with expires_in_hours > 8760 returns 422', async () => {
        const { status } = await post(
            `/groups/${openGroupId}/invite`,
            { expires_in_hours: 99999 },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /groups/:id/invites lists active links (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/invites`, creatorToken);
        assertStatus(status, 200);
        const links = extractList(data.data);
        assert(links.length >= 1, `expected at least 1 invite, got ${links.length}`);
    });

    await test('GET /groups/:id/invites without auth returns 401', async () => {
        const { status } = await get(`/groups/${openGroupId}/invites`);
        assertStatus(status, 401);
    });

    await test('POST /groups/invites/:token/accept joins group (201)', async () => {
        const { status } = await post(`/groups/invites/${inviteToken}/accept`, {}, memberToken);
        assertStatus(status, 201);
    });

    await test('POST /groups/invites/:token/accept again returns 409 (already member)', async () => {
        const { status } = await post(`/groups/invites/${inviteToken}/accept`, {}, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /groups/invites/invalid-token/accept returns 404', async () => {
        const { status } = await post('/groups/invites/definitely-not-a-real-token-xyz/accept', {}, outsiderToken);
        assertStatus(status, 404);
    });

    await test('POST /groups/invites/:token/accept without auth returns 401', async () => {
        const { status } = await post(`/groups/invites/${inviteToken}/accept`, {});
        assertStatus(status, 401);
    });

    await test('DELETE /groups/invites/:id revokes invite (200)', async () => {
        const { status } = await del(`/groups/invites/${inviteId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('DELETE /groups/invites/:id again returns 409 (already revoked)', async () => {
        const { status } = await del(`/groups/invites/${inviteId}`, creatorToken);
        assertStatus(status, 409);
    });

    await test('POST /groups/invites/:token/accept after revoke returns 410 (Gone)', async () => {
        const { status } = await post(`/groups/invites/${inviteToken}/accept`, {}, outsiderToken);
        assertStatus(status, 410);
    });

    // ── 8. Group Deletion ─────────────────────────────────────────────────────

    section('8. Group Deletion');

    await test('DELETE /groups/:id without auth returns 401', async () => {
        const { status } = await del(`/groups/${appGroupId}`);
        assertStatus(status, 401);
    });

    await test('DELETE /groups/:id as non-super_admin returns 403', async () => {
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
        const { status } = await del('/users/me', outsiderToken);
        assertStatus(status, 200);
    });

    await test('POST /groups after account deletion returns 404 (authenticateVerified: user.deletedAt set)', async () => {
        const { status } = await post('/groups', { name: 'Ghost Group', category: 'Tech' }, outsiderToken);
        assertStatus(status, 404);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function run(): Promise<void> {
    await runAuthSuite();
    await runFeaturesSuite();

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const total  = results.length;

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
        await prisma.$disconnect();
        process.exit(results.some((r) => !r.passed) ? 1 : 0);
    });
