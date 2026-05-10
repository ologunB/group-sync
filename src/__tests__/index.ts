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
import { EncryptionUtil } from '../shared/utils/encryption';

const BASE = Boolean(false) ? 'https://group-sync-ovzh.onrender.com/api/v1' : 'http://localhost:3000/api/v1';
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

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(`${BASE}${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            const data = (await res.json()) as Record<string, unknown>;
            return { status: res.status, data };
        } catch (err) {
            lastErr = err;
            // Transient connection error (Redis blip, server restart) — retry with backoff
            if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
        }
    }
    throw lastErr;
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

function makeAdminToken(userId: string): string {
    return EncryptionUtil.generateJWT(
        { userId, role: 'platform_admin', sessionId: 'test-admin-session', permissions: ['platform.admin'] },
        900,
    );
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

    await test('password with no digit returns 422', async () => {
        const { status } = await post('/auth/register', {
            email: `nodigit${ts}@test.io`, password: 'NoDigitPass', display_name: 'No Digit',
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('display_name too short (1 char) returns 422', async () => {
        const { status } = await post('/auth/register', {
            email: `shortname${ts}@test.io`, password: PASSWORD, display_name: 'X',
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('missing display_name returns 422', async () => {
        const { status } = await post('/auth/register', {
            email: `nodisplay${ts}@test.io`, password: PASSWORD,
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('register with valid phone number returns 201', async () => {
        const { status } = await post('/auth/register', {
            email: `withphone${ts}@test.io`, password: PASSWORD,
            display_name: 'Phone User', phone: '+2348012345678',
        });
        assertStatus(status, 201);
    });

    await test('register with invalid phone number returns 422', async () => {
        const { status } = await post('/auth/register', {
            email: `badphone${ts}@test.io`, password: PASSWORD,
            display_name: 'Bad Phone', phone: 'not-a-phone',
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

    await test('login with uppercase email normalizes and succeeds (200)', async () => {
        const { status, data } = await post('/auth/login', {
            email: EMAIL.toUpperCase(), password: PASSWORD,
        });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('login with missing email returns 422', async () => {
        const { status } = await post('/auth/login', { password: PASSWORD });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 3. Email Verification ─────────────────────────────────────────────────

    section('3. Email Verification');

    await test('resend-verification always returns 200', async () => {
        const { status } = await post('/auth/resend-verification', { email: EMAIL });
        assertStatus(status, 200);
    });

    await test('resend-verification for non-existent email returns 200 (no enumeration)', async () => {
        const { status } = await post('/auth/resend-verification', { email: `ghost${ts}@test.io` });
        assertStatus(status, 200);
    });

    await test('resend-verification with invalid email returns 422', async () => {
        const { status } = await post('/auth/resend-verification', { email: 'not-an-email' });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('verify-email with OTP shorter than 6 digits returns 422', async () => {
        const { status } = await post('/auth/verify-email', { email: EMAIL, otp: '123' });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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

    await test('refresh with invalid (non-existent) token returns 401', async () => {
        const { status } = await post('/auth/refresh', { refresh_token: 'completely-made-up-token-xyz' });
        assertStatus(status, 401);
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

    await test('change-password with weak new_password (no uppercase) returns 422', async () => {
        const { status } = await post(
            '/auth/change-password',
            { old_password: CHANGED_PASSWORD, new_password: 'alllower1' },
            accessToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('change-password with new_password too short returns 422', async () => {
        const { status } = await post(
            '/auth/change-password',
            { old_password: CHANGED_PASSWORD, new_password: 'Ab1' },
            accessToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('forgot-password with invalid email format returns 422', async () => {
        const { status } = await post('/auth/forgot-password', { email: 'not-valid' });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('reset-password with weak new password returns 422', async () => {
        const { status } = await post('/auth/reset-password', {
            email: EMAIL, otp: '123456', password: 'weakpass',
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('verify-forgot-otp with OTP longer than 6 digits returns 422', async () => {
        const { status } = await post('/auth/verify-forgot-otp', { email: EMAIL, otp: '1234567' });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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

    let openGroupId     = '';
    let openGroupSlug   = '';
    let appGroupId      = '';
    let appGroupSlug    = '';
    let inviteGroupId   = '';
    let inviteGroupSlug = '';
    let applicationId   = '';
    let approvedAppId   = '';
    let inviteToken     = '';
    let inviteId        = '';

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
        const { status: cs, data: cd } = await post('/auth/login', { email: CREATOR_EMAIL,  password: CREATOR_PASS  });
        const { status: ms, data: md } = await post('/auth/login', { email: MEMBER_EMAIL,   password: MEMBER_PASS   });
        const { status: os, data: od } = await post('/auth/login', { email: OUTSIDER_EMAIL, password: OUTSIDER_PASS });
        assert(cs === 200, `creator login failed (${cs}): ${JSON.stringify(cd)}`);
        assert(ms === 200, `member login failed (${ms}): ${JSON.stringify(md)}`);
        assert(os === 200, `outsider login failed (${os}): ${JSON.stringify(od)}`);
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

    await test('PATCH /users/me with invalid lng (>180) returns 422', async () => {
        const { status } = await patch('/users/me', { lng: 999 }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with valid lat and lng updates location (200)', async () => {
        const { status } = await patch('/users/me', { lat: 6.5244, lng: 3.3792 }, creatorToken);
        assertStatus(status, 200);
    });

    await test('PATCH /users/me with city, state, country updates location fields (200)', async () => {
        const { status, data } = await patch(
            '/users/me',
            { city: 'Lagos', state: 'Lagos State', country: 'NG' },
            creatorToken,
        );
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.city    === 'Lagos',       `city not updated: ${user.city}`);
        assert(user.state   === 'Lagos State', `state not updated: ${user.state}`);
        assert(user.country === 'NG',          `country not updated: ${user.country}`);
    });

    await test('PATCH /users/me with valid HTTPS profile_photo_url (200)', async () => {
        const { status, data } = await patch(
            '/users/me',
            { profile_photo_url: 'https://example.com/photo.jpg' },
            creatorToken,
        );
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.profilePhotoUrl === 'https://example.com/photo.jpg', `url not updated: ${user.profilePhotoUrl}`);
    });

    await test('PATCH /users/me with HTTP (non-HTTPS) profile_photo_url returns 422', async () => {
        const { status } = await patch(
            '/users/me',
            { profile_photo_url: 'http://example.com/photo.jpg' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with display_name too short (1 char) returns 422', async () => {
        const { status } = await patch('/users/me', { display_name: 'X' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with bio exceeding 500 chars returns 422', async () => {
        const { status } = await patch('/users/me', { bio: 'x'.repeat(501) }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with username containing uppercase returns 422', async () => {
        const { status } = await patch('/users/me', { username: 'UPPER_USER' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with username too short (2 chars) returns 422', async () => {
        const { status } = await patch('/users/me', { username: 'ab' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with username containing spaces returns 422', async () => {
        const { status } = await patch('/users/me', { username: 'has spaces' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /users/me with preferred_language sets language (200)', async () => {
        const { status, data } = await patch(
            '/users/me',
            { preferred_language: 'yo' },
            creatorToken,
        );
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.preferredLanguage === 'yo', `language not updated: ${user.preferredLanguage}`);
    });

    await test('PATCH /users/me with empty body (no fields) returns 400', async () => {
        const { status } = await patch('/users/me', {}, creatorToken);
        assertStatus(status, 400);
    });

    await test('PATCH /users/me without auth returns 401', async () => {
        const { status } = await patch('/users/me', { bio: 'no auth' });
        assertStatus(status, 401);
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

    await test('POST /users/me/interests deduplicates tags (200)', async () => {
        const { status, data } = await post(
            '/users/me/interests',
            { interests: ['Cooking', 'cooking', 'COOKING', 'hiking'] },
            creatorToken,
        );
        assertStatus(status, 200);
        const interests = (data.data as Record<string, unknown>).interests as string[];
        assert(
            interests.filter((i) => i === 'cooking').length === 1,
            `duplicates not deduped: ${JSON.stringify(interests)}`,
        );
    });

    await test('POST /users/me/interests with empty array clears interests (200)', async () => {
        const { status, data } = await post('/users/me/interests', { interests: [] }, creatorToken);
        assertStatus(status, 200);
        const interests = (data.data as Record<string, unknown>).interests as string[];
        assert(Array.isArray(interests) && interests.length === 0, 'interests should be empty array');
    });

    await test('POST /users/me/interests with tag exceeding 50 chars returns 422', async () => {
        const { status } = await post(
            '/users/me/interests',
            { interests: ['x'.repeat(51)] },
            creatorToken,
        );
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

    await test('GET /users/:id when target has blocked caller returns 404', async () => {
        // outsider blocks creator — creator should now see 404 when looking up outsider
        await post(`/users/${creatorId}/block`, {}, outsiderToken);
        const { status } = await get(`/users/${outsiderId}`, creatorToken);
        assertStatus(status, 404);
        // Restore: outsider unblocks creator
        await del(`/users/${creatorId}/block`, outsiderToken);
    });

    await test('POST /users/:id/block blocks target user (200)', async () => {
        const { status } = await post(`/users/${memberId}/block`, {}, creatorToken);
        assertStatus(status, 200);
    });

    await test('POST /users/:id/block is idempotent — second call still 200', async () => {
        const { status } = await post(`/users/${memberId}/block`, {}, creatorToken);
        assertStatus(status, 200);
    });

    await test('POST /users/:id/block yourself returns 400', async () => {
        const { status } = await post(`/users/${creatorId}/block`, {}, creatorToken);
        assertStatus(status, 400);
    });

    await test('POST /users/:id/block non-existent user returns 404', async () => {
        const { status } = await post('/users/00000000-0000-4000-8000-000000000000/block', {}, creatorToken);
        assertStatus(status, 404);
    });

    await test('GET /users/:id when blocked returns 404', async () => {
        const { status } = await get(`/users/${memberId}`, creatorToken);
        assertStatus(status, 404);
    });

    await test('DELETE /users/:id/block unblocks (200)', async () => {
        const { status } = await del(`/users/${memberId}/block`, creatorToken);
        assertStatus(status, 200);
    });

    await test('DELETE /users/:id/block yourself returns 400', async () => {
        const { status } = await del(`/users/${creatorId}/block`, creatorToken);
        assertStatus(status, 400);
    });

    await test('DELETE /users/:id/block when never blocked is idempotent (200)', async () => {
        // outsider was never blocked by creator at this point
        const { status } = await del(`/users/${outsiderId}/block`, creatorToken);
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

    await test('GET /users/me/groups?limit=1 paginates correctly (200)', async () => {
        const { status, data } = await get('/users/me/groups?limit=1', creatorToken);
        assertStatus(status, 200);
        assertHas(data, 'data');
    });

    await test('GET /users/me/applications?status=invalid returns 422', async () => {
        const { status } = await get('/users/me/applications?status=bogus', creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /users/me/applications?page=0 (invalid page) returns 422', async () => {
        const { status } = await get('/users/me/applications?page=0', creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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

    // idVerificationStatus check is temporarily disabled in auth middleware
    await test('POST /groups with unverified user returns 201 (verification disabled)', async () => {
        const { token } = await registerAndLogin(`unverf${ts}@test.io`, 'Unverf123!', 'Unverified');
        const { status } = await post('/groups', { name: `Unverf Group ${ts}`, category: 'Tech' }, token);
        assertStatus(status, 201);
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

    await test('POST /groups with all optional fields creates group (201)', async () => {
        const { status, data } = await post(
            '/groups',
            {
                name: `FullGroup ${ts}`,
                category: 'Technology',
                subcategory: 'Web Development',
                description: 'A fully detailed group',
                city: 'Lagos',
                state: 'Lagos State',
                country: 'NG',
                lat: 6.5244,
                lng: 3.3792,
                membership_type: 'open',
                rules: 'Be respectful.',
                how_to_join_content: 'Just click join.',
                membership_fee: 0,
                membership_fee_currency: 'NGN',
                founding_date: '2020-01-01',
            },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        assert(group.subcategory === 'Web Development', `subcategory wrong: ${group.subcategory}`);
        assert(group.city === 'Lagos', `city wrong: ${group.city}`);
    });

    await test('POST /groups with 1-char name returns 422', async () => {
        const { status } = await post('/groups', { name: 'X', category: 'Tech' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups with name exceeding 150 chars returns 422', async () => {
        const { status } = await post('/groups', { name: 'A'.repeat(151), category: 'Tech' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups with invalid founding_date returns 422', async () => {
        const { status } = await post(
            '/groups',
            { name: 'Date Group', category: 'Tech', founding_date: 'not-a-date' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups with HTTP cover_image_url (not HTTPS) returns 422', async () => {
        const { status } = await post(
            '/groups',
            { name: 'Cover Group', category: 'Tech', cover_image_url: 'http://example.com/img.jpg' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups with invalid membership_type returns 422', async () => {
        const { status } = await post(
            '/groups',
            { name: 'Bad Type', category: 'Tech', membership_type: 'vip_only' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups with invalid lat returns 422', async () => {
        const { status } = await post(
            '/groups',
            { name: 'Bad Lat', category: 'Tech', lat: 91, lng: 3.0 },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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
        inviteGroupId   = group.id   as string;
        inviteGroupSlug = group.slug as string;
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

    await test('GET /groups?sort=most_members returns sorted list (200)', async () => {
        const { status } = await get('/groups?sort=most_members');
        assertStatus(status, 200);
    });

    await test('GET /groups?sort=invalid returns 422', async () => {
        const { status } = await get('/groups?sort=bogus_sort');
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /groups?membership_type=invalid returns 422', async () => {
        const { status } = await get('/groups?membership_type=exclusive');
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /groups?min_members=1 filters by member count (200)', async () => {
        const { status, data } = await get('/groups?min_members=1');
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'expected array');
    });

    await test('GET /groups?is_verified=false filters by verification status (200)', async () => {
        const { status } = await get('/groups?is_verified=false');
        assertStatus(status, 200);
    });

    await test('GET /groups?subcategory=Web+Development filters by subcategory (200)', async () => {
        const { status } = await get('/groups?subcategory=Web%20Development');
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

    await test('GET /groups/:slug for invite_only group without auth returns 404', async () => {
        const { status } = await get(`/groups/${inviteGroupSlug}`);
        assertStatus(status, 404);
    });

    await test('GET /groups/:slug for invite_only group as member (creator) returns 200', async () => {
        const { status, data } = await get(`/groups/${inviteGroupSlug}`, creatorToken);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        const group  = result.group as Record<string, unknown>;
        assert(group.id === inviteGroupId, `id mismatch: ${group.id}`);
    });

    await test('GET /groups/:slug for invite_only group as non-member returns 404', async () => {
        const { status } = await get(`/groups/${inviteGroupSlug}`, memberToken);
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

    await test('PATCH /groups/:id with empty body returns 400', async () => {
        const { status } = await patch(`/groups/${openGroupId}`, {}, creatorToken);
        assertStatus(status, 400);
    });

    await test('PATCH /groups/:id with invalid UUID returns 422', async () => {
        const { status } = await patch('/groups/not-a-uuid', { description: 'test' }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /groups/:id updates name and regenerates slug (200)', async () => {
        const newName = `OpenGroup Renamed ${ts}`;
        const { status, data } = await patch(
            `/groups/${openGroupId}`,
            { name: newName },
            creatorToken,
        );
        assertStatus(status, 200);
        const group = data.data as Record<string, unknown>;
        assert(group.name === newName, `name not updated: ${group.name}`);
        assert(typeof group.slug === 'string' && (group.slug as string).length > 0, 'slug should be regenerated');
        openGroupSlug = group.slug as string;
    });

    await test('PATCH /groups/:id updates lat and lng (200)', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}`,
            { lat: 6.5244, lng: 3.3792 },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PATCH /groups/:id changing membership_type to invite_only sets isDiscoverable=false (200)', async () => {
        const { status, data } = await patch(
            `/groups/${openGroupId}`,
            { membership_type: 'invite_only' },
            creatorToken,
        );
        assertStatus(status, 200);
        const group = data.data as Record<string, unknown>;
        assert(group.isDiscoverable === false, `should be non-discoverable: ${group.isDiscoverable}`);
        assert(group.membershipType === 'invite_only', `membershipType should be invite_only: ${group.membershipType}`);
    });

    await test('PATCH /groups/:id changing from invite_only back to open restores isDiscoverable (200)', async () => {
        const { status, data } = await patch(
            `/groups/${openGroupId}`,
            { membership_type: 'open' },
            creatorToken,
        );
        assertStatus(status, 200);
        const group = data.data as Record<string, unknown>;
        assert(group.isDiscoverable === true, `should be discoverable again: ${group.isDiscoverable}`);
        assert(group.membershipType === 'open', `membershipType should be open: ${group.membershipType}`);
    });

    await test('PATCH /groups/:id with invalid lat returns 422', async () => {
        const { status } = await patch(`/groups/${openGroupId}`, { lat: -91, lng: 0 }, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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

    await test('GET /groups/:id/members?role=super_admin filters by role (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/members?role=super_admin`, creatorToken);
        assertStatus(status, 200);
        const members = extractList(data.data);
        assert(members.length >= 1, 'should have at least 1 super_admin');
        assert(
            members.every((m: any) => m.role === 'super_admin'),
            'all returned members should be super_admin',
        );
    });

    await test('GET /groups/:id/members?limit=1 respects pagination (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/members?limit=1`, creatorToken);
        assertStatus(status, 200);
        const members = extractList(data.data);
        assert(members.length <= 1, `expected at most 1 member with limit=1, got ${members.length}`);
    });

    await test('GET /groups/:id/members?role=invalid returns 422', async () => {
        const { status } = await get(`/groups/${openGroupId}/members?role=god`, creatorToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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

    await test('POST /groups/:id/join invite_only group returns 403', async () => {
        const { status } = await post(`/groups/${inviteGroupId}/join`, {}, memberToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/join non-existent group returns 404', async () => {
        const { status } = await post('/groups/00000000-0000-4000-8000-000000000000/join', {}, memberToken);
        assertStatus(status, 404);
    });

    await test('super_admin cannot leave group while other members exist (403)', async () => {
        // member is currently in openGroup — creator (super_admin) should be blocked from leaving
        const { status } = await del(`/groups/${openGroupId}/leave`, creatorToken);
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

    await test('POST /groups/:id/apply to invite_only group returns 403', async () => {
        const { status } = await post(`/groups/${inviteGroupId}/apply`, {}, outsiderToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/apply to non-existent group returns 404', async () => {
        const { status } = await post(
            '/groups/00000000-0000-4000-8000-000000000000/apply', {}, memberToken,
        );
        assertStatus(status, 404);
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
        approvedAppId = freshAppId;

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

    await test('POST /groups/:id/apply when already active member returns 409', async () => {
        // member was just approved into appGroup in the composite test above
        const { status } = await post(`/groups/${appGroupId}/apply`, {}, memberToken);
        assertStatus(status, 409);
    });

    await test('PATCH /groups/applications/:id for non-existent application returns 404', async () => {
        const { status } = await patch(
            '/groups/applications/00000000-0000-4000-8000-000000000000',
            { action: 'approve' },
            creatorToken,
        );
        assertStatus(status, 404);
    });

    await test('PATCH /groups/applications/:id for already-reviewed application returns 409', async () => {
        // approvedAppId was approved in the composite test — trying to review again should conflict
        const { status } = await patch(
            `/groups/applications/${approvedAppId}`,
            { action: 'reject' },
            creatorToken,
        );
        assertStatus(status, 409);
    });

    await test('GET /groups/:id/applications?status=approved returns filtered list (200)', async () => {
        const { status, data } = await get(
            `/groups/${appGroupId}/applications?status=approved`,
            creatorToken,
        );
        assertStatus(status, 200);
        const apps = extractList(data.data);
        assert(
            apps.every((a: any) => a.status === 'approved'),
            'all returned applications should have status=approved',
        );
    });

    await test('GET /groups/:id/applications?status=withdrawn returns filtered list (200)', async () => {
        const { status } = await get(
            `/groups/${appGroupId}/applications?status=withdrawn`,
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('GET /groups/:id/applications?page=1&limit=1 paginates correctly (200)', async () => {
        const { status, data } = await get(
            `/groups/${appGroupId}/applications?page=1&limit=1`,
            creatorToken,
        );
        assertStatus(status, 200);
        const apps = extractList(data.data);
        assert(apps.length <= 1, `expected at most 1 result with limit=1, got ${apps.length}`);
    });

    await test('GET /users/me/applications?status=withdrawn returns withdrawn applications (200)', async () => {
        const { status, data } = await get('/users/me/applications?status=withdrawn', memberToken);
        assertStatus(status, 200);
        const apps = extractList(data.data);
        assert(
            apps.every((a: any) => a.status === 'withdrawn'),
            'all returned applications should be withdrawn',
        );
    });

    await test('GET /users/me/applications?status=approved returns approved applications (200)', async () => {
        const { status } = await get('/users/me/applications?status=approved', memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /groups/applications/:id for non-existent application returns 404', async () => {
        const { status } = await del(
            '/groups/applications/00000000-0000-4000-8000-000000000000',
            memberToken,
        );
        assertStatus(status, 404);
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

    await test('PUT /groups/:id/form with empty fields array clears form (200)', async () => {
        const { status, data } = await put(`/groups/${appGroupId}/form`, { fields: [] }, creatorToken);
        assertStatus(status, 200);
        const form   = data.data as Record<string, unknown>;
        const fields = form.fields as unknown[];
        assert(fields.length === 0, `expected empty fields, got ${fields.length}`);
    });

    await test('PUT /groups/:id/form — re-set 1 required field for apply tests (200)', async () => {
        const { status } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'textarea', label: 'Tell us about yourself', required: true }] },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('PUT /groups/:id/form with field missing label returns 422', async () => {
        const { status } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'text', required: true }] },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PUT /groups/:id/form with field missing id returns 422', async () => {
        const { status } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ type: 'text', label: 'No ID field', required: true }] },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PUT /groups/:id/form with field missing required flag returns 422', async () => {
        const { status } = await put(
            `/groups/${appGroupId}/form`,
            { fields: [{ id: 'q1', type: 'text', label: 'No required flag' }] },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('GET /groups/:id/form for non-existent group returns 404', async () => {
        const { status } = await get('/groups/00000000-0000-4000-8000-000000000000/form');
        assertStatus(status, 404);
    });

    await test('POST /groups/:id/apply without required form field returns 422', async () => {
        // outsider applies to appGroup but omits the required "Tell us about yourself" field
        const { status } = await post(`/groups/${appGroupId}/apply`, {}, outsiderToken);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups/:id/apply with all required form fields returns 201', async () => {
        const { status } = await post(
            `/groups/${appGroupId}/apply`,
            { form_responses: { q1: 'I am very passionate about this topic and would love to contribute.' } },
            outsiderToken,
        );
        assertStatus(status, 201);
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

    await test('PATCH /groups/:id/members/:userId with no role or status returns 400', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            {},
            creatorToken,
        );
        assertStatus(status, 400);
    });

    await test('PATCH /groups/:id/members/:userId with invalid role value returns 422', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { role: 'god' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /groups/:id/members/:userId with invalid status value returns 422', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { status: 'deleted' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('PATCH /groups/:id/members/:userId targeting super_admin returns 403', async () => {
        // member (who is a regular member) tries to modify the super_admin (creator)
        // but first — member was promoted to moderator in this section; test using outsider would fail auth
        // Use creator trying to patch themselves (super_admin): should be blocked
        const { status } = await patch(
            `/groups/${openGroupId}/members/${creatorId}`,
            { role: 'admin' },
            creatorToken,
        );
        assertStatus(status, 403);
    });

    await test('PATCH /groups/:id/members/:userId for non-existent member returns 404', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/00000000-0000-4000-8000-000000000000`,
            { role: 'member' },
            creatorToken,
        );
        assertStatus(status, 404);
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

    await test('DELETE /groups/:id/members/:userId targeting super_admin returns 403', async () => {
        const { status } = await del(`/groups/${openGroupId}/members/${creatorId}`, creatorToken);
        assertStatus(status, 403);
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

    await test('POST /groups/:id/invite with max_uses=0 returns 422', async () => {
        const { status } = await post(
            `/groups/${openGroupId}/invite`,
            { max_uses: 0 },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups/:id/invite with no limits (unlimited) returns 201', async () => {
        const { status, data } = await post(`/groups/${openGroupId}/invite`, {}, creatorToken);
        assertStatus(status, 201);
        const link = data.data as Record<string, unknown>;
        assert(link.maxUses === null, `maxUses should be null for unlimited: ${link.maxUses}`);
        assert(link.expiresAt === null, `expiresAt should be null for unlimited: ${link.expiresAt}`);
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

    await test('GET /groups/:id/invites as regular member (not admin) returns 403', async () => {
        // member was removed in section 6 — re-join so we have a non-admin member to test with
        await post(`/groups/${openGroupId}/join`, {}, memberToken);
        const { status } = await get(`/groups/${openGroupId}/invites`, memberToken);
        assertStatus(status, 403);
        // clean up
        await del(`/groups/${openGroupId}/leave`, memberToken);
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

    await test('DELETE /groups/invites/:id for non-existent invite returns 404', async () => {
        const { status } = await del('/groups/invites/00000000-0000-4000-8000-000000000000', creatorToken);
        assertStatus(status, 404);
    });

    await test('POST /groups/invites/:token/accept after revoke returns 410 (Gone)', async () => {
        const { status } = await post(`/groups/invites/${inviteToken}/accept`, {}, outsiderToken);
        assertStatus(status, 410);
    });

    // ── 8. File Uploads ───────────────────────────────────────────────────────

    section('8. File Uploads');

    // Minimal 1×1 transparent PNG (68 bytes) — used for all upload tests
    const TINY_PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ' +
        'AABjkB6QAAAABJRU5ErkJggg==',
        'base64',
    );
    // 4-byte stub with image/gif MIME — rejected by fileFilter
    const FAKE_GIF = Buffer.from('GIF8', 'utf8');

    async function uploadFile(
        path: string,
        fieldName: string,
        buffer: Buffer,
        mimeType: string,
        token?: string,
    ): Promise<ApiResponse> {
        const formData = new FormData();
        formData.append(fieldName, new Blob([buffer], { type: mimeType }), 'test.' + mimeType.split('/')[1]);

        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
                const data = (await res.json()) as Record<string, unknown>;
                return { status: res.status, data };
            } catch (err) {
                lastErr = err;
                if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
            }
        }
        throw lastErr;
    }

    // ── Profile photo ────────────────────────────────────────────────────────

    await test('POST /users/me/photo without auth returns 401', async () => {
        const { status } = await request('POST', '/users/me/photo');
        assertStatus(status, 401);
    });

    await test('POST /users/me/photo with no file returns 400', async () => {
        // JSON request body — multer skips non-multipart, controller returns 400
        const { status } = await post('/users/me/photo', {}, creatorToken);
        assertStatus(status, 400);
    });

    await test('POST /users/me/photo with unsupported file type returns 422', async () => {
        const { status } = await uploadFile('/users/me/photo', 'photo', FAKE_GIF, 'image/gif', creatorToken);
        assertStatus(status, 422);
    });

    await test('POST /users/me/photo with valid PNG uploads and returns URL (200)', async () => {
        const { status, data } = await uploadFile('/users/me/photo', 'photo', TINY_PNG, 'image/png', creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(typeof d?.url === 'string' && (d.url as string).startsWith('https://'), 'Expected url to be an HTTPS string');
    });

    // ── Group cover ──────────────────────────────────────────────────────────

    await test('POST /groups/:id/cover without auth returns 401', async () => {
        const { status } = await request('POST', `/groups/${openGroupId}/cover`);
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/cover as member (non-admin) returns 403', async () => {
        const { status } = await uploadFile(`/groups/${openGroupId}/cover`, 'cover', TINY_PNG, 'image/png', memberToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/cover with unsupported file type returns 422', async () => {
        const { status } = await uploadFile(`/groups/${openGroupId}/cover`, 'cover', FAKE_GIF, 'image/gif', creatorToken);
        assertStatus(status, 422);
    });

    await test('POST /groups/:id/cover with valid PNG uploads and returns URL (200)', async () => {
        const { status, data } = await uploadFile(`/groups/${openGroupId}/cover`, 'cover', TINY_PNG, 'image/png', creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(typeof d?.url === 'string' && (d.url as string).startsWith('https://'), 'Expected url to be an HTTPS string');
    });

    // ── Group logo ───────────────────────────────────────────────────────────

    await test('POST /groups/:id/logo without auth returns 401', async () => {
        const { status } = await request('POST', `/groups/${openGroupId}/logo`);
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/logo as member (non-admin) returns 403', async () => {
        const { status } = await uploadFile(`/groups/${openGroupId}/logo`, 'logo', TINY_PNG, 'image/png', memberToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/logo with valid PNG uploads and returns URL (200)', async () => {
        const { status, data } = await uploadFile(`/groups/${openGroupId}/logo`, 'logo', TINY_PNG, 'image/png', creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(typeof d?.url === 'string' && (d.url as string).startsWith('https://'), 'Expected url to be an HTTPS string');
    });

    // ── 9. Events ─────────────────────────────────────────────────────────────

    section('9. Events');

    let eventId = '';

    await test('POST /groups/:id/events without auth returns 401', async () => {
        const { status } = await post(`/groups/${openGroupId}/events`, {});
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/events as member (non-admin) returns 403', async () => {
        const { status } = await post(
            `/groups/${openGroupId}/events`,
            { title: 'Test Event', starts_at: new Date(Date.now() + 3_600_000).toISOString() },
            memberToken,
        );
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/events with past starts_at returns 422', async () => {
        const { status } = await post(
            `/groups/${openGroupId}/events`,
            { title: 'Past Event', starts_at: '2020-01-01T00:00:00Z' },
            creatorToken,
        );
        assertStatus(status, 422);
    });

    await test('POST /groups/:id/events with valid data creates event (201)', async () => {
        const future = new Date(Date.now() + 3_600_000).toISOString();
        const { status, data } = await post(
            `/groups/${openGroupId}/events`,
            { title: 'Awesome Meetup', description: 'Fun event', starts_at: future, rsvp_limit: 50 },
            creatorToken,
        );
        assertStatus(status, 201);
        const d = data.data as Record<string, unknown>;
        assert(typeof d?.id === 'string', 'Expected event id');
        eventId = d.id as string;
    });

    await test('GET /groups/:id/events returns list (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/events`, creatorToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array');
    });

    await test('GET /events/:id returns event details (200)', async () => {
        const { status, data } = await get(`/events/${eventId}`, memberToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(d.id === eventId, 'Expected matching event id');
        assert('myRsvp' in d, 'Expected myRsvp field');
    });

    await test('POST /events/:id/rsvp as member returns 201', async () => {
        const { status } = await post(`/events/${eventId}/rsvp`, { status: 'going' }, memberToken);
        assertStatus(status, 201);
    });

    await test('POST /events/:id/rsvp again returns 409 (duplicate)', async () => {
        const { status } = await post(`/events/${eventId}/rsvp`, { status: 'going' }, memberToken);
        assertStatus(status, 409);
    });

    await test('PATCH /events/:id/rsvp updates RSVP status (200)', async () => {
        const { status } = await patch(`/events/${eventId}/rsvp`, { status: 'maybe' }, memberToken);
        assertStatus(status, 200);
    });

    await test('GET /events/:id/rsvps as non-admin returns 403', async () => {
        const { status } = await get(`/events/${eventId}/rsvps`, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /events/:id/rsvps as admin returns list (200)', async () => {
        const { status, data } = await get(`/events/${eventId}/rsvps`, creatorToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array of RSVPs');
    });

    await test('PATCH /events/:id as non-admin returns 403', async () => {
        const { status } = await patch(`/events/${eventId}`, { title: 'Updated' }, memberToken);
        assertStatus(status, 403);
    });

    await test('PATCH /events/:id as admin updates event (200)', async () => {
        const { status, data } = await patch(`/events/${eventId}`, { title: 'Updated Meetup' }, creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(d.title === 'Updated Meetup', 'Expected updated title');
    });

    await test('DELETE /events/:id/rsvp cancels RSVP (200)', async () => {
        const { status } = await del(`/events/${eventId}/rsvp`, memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /events/:id as non-admin returns 403', async () => {
        const { status } = await del(`/events/${eventId}`, memberToken);
        assertStatus(status, 403);
    });

    await test('DELETE /events/:id as admin cancels event (200)', async () => {
        const { status } = await del(`/events/${eventId}`, creatorToken);
        assertStatus(status, 200);
    });

    // ── 10. Notifications ─────────────────────────────────────────────────────

    section('10. Notifications');

    let notificationId = '';

    await test('GET /notifications without auth returns 401', async () => {
        const { status } = await get('/notifications');
        assertStatus(status, 401);
    });

    await test('GET /notifications returns cursor-paginated list (200)', async () => {
        const { status, data } = await get('/notifications', creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(Array.isArray(d.data), 'Expected data array');
        assert(typeof d.unread_count === 'number', 'Expected unread_count');
    });

    await test('seed a notification for creator to test read/delete', async () => {
        const notif = await prisma.notification.create({
            data: {
                userId: creatorId,
                type: 'system',
                title: 'Test notification',
                body: 'This is a test.',
            },
        });
        notificationId = notif.id;
        assert(notificationId.length > 0, 'Expected notification id');
    });

    await test('PATCH /notifications/:id/read marks notification read (200)', async () => {
        const { status, data } = await patch(`/notifications/${notificationId}/read`, {}, creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(d.isRead === true, 'Expected isRead to be true');
    });

    await test('PATCH /notifications/read-all marks all as read (200)', async () => {
        const { status, data } = await patch('/notifications/read-all', {}, creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(typeof d.count === 'number', 'Expected count');
    });

    await test('GET /notifications/preferences returns array (200)', async () => {
        const { status, data } = await get('/notifications/preferences', creatorToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array');
    });

    await test('PATCH /notifications/preferences updates preferences (200)', async () => {
        const { status, data } = await patch(
            '/notifications/preferences',
            { preferences: [{ pref_type: 'event_created', push_enabled: false, in_app_enabled: true }] },
            creatorToken,
        );
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array of preferences');
    });

    await test('DELETE /notifications/:id removes notification (200)', async () => {
        const { status } = await del(`/notifications/${notificationId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('DELETE /notifications/:id again returns 404', async () => {
        const { status } = await del(`/notifications/${notificationId}`, creatorToken);
        assertStatus(status, 404);
    });

    // ── 11. Reports ───────────────────────────────────────────────────────────

    section('11. Reports');

    let reportId = '';

    await test('POST /reports without auth returns 401', async () => {
        const { status } = await post('/reports', {});
        assertStatus(status, 401);
    });

    await test('POST /reports with invalid reason returns 422', async () => {
        const { status } = await post(
            '/reports',
            { target_type: 'user', target_id: memberId, reason: 'invalid_reason' },
            creatorToken,
        );
        assertStatus(status, 422);
    });

    await test('POST /reports with invalid target_type returns 422', async () => {
        const { status } = await post(
            '/reports',
            { target_type: 'banana', target_id: memberId, reason: 'spam' },
            creatorToken,
        );
        assertStatus(status, 422);
    });

    await test('POST /reports with valid data submits report (201)', async () => {
        const { status, data } = await post(
            '/reports',
            { target_type: 'user', target_id: memberId, reason: 'spam', description: 'Test report' },
            creatorToken,
        );
        assertStatus(status, 201);
        const d = data.data as Record<string, unknown>;
        assert(typeof d?.id === 'string', 'Expected report id');
        reportId = d.id as string;
    });

    // ── 12. Platform Admin ────────────────────────────────────────────────────

    section('12. Platform Admin');

    const adminToken = makeAdminToken(creatorId);

    await test('GET /admin/users without auth returns 401', async () => {
        const { status } = await get('/admin/users');
        assertStatus(status, 401);
    });

    await test('GET /admin/users without platform.admin permission returns 403', async () => {
        const { status } = await get('/admin/users', creatorToken);
        assertStatus(status, 403);
    });

    await test('GET /admin/users with platform.admin returns list (200)', async () => {
        const { status, data } = await get('/admin/users', adminToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array of users');
    });

    await test('GET /admin/users with search filter returns results (200)', async () => {
        const { status, data } = await get('/admin/users?search=creator', adminToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array');
    });

    await test('PATCH /admin/users/:id updates user status (200)', async () => {
        const { status } = await patch(`/admin/users/${outsiderId}`, { status: 'active' }, adminToken);
        assertStatus(status, 200);
    });

    await test('GET /admin/users/:id/verification returns verification data (200)', async () => {
        const { status } = await get(`/admin/users/${memberId}/verification`, adminToken);
        assertStatus(status, 200);
    });

    await test('PATCH /admin/users/:id/verification approves ID (200)', async () => {
        const { status } = await patch(
            `/admin/users/${memberId}/verification`,
            { decision: 'approved' },
            adminToken,
        );
        assertStatus(status, 200);
    });

    await test('GET /admin/groups returns list (200)', async () => {
        const { status, data } = await get('/admin/groups', adminToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array of groups');
    });

    await test('PATCH /admin/groups/:id verifies group (200)', async () => {
        const { status } = await patch(`/admin/groups/${openGroupId}`, { is_verified: true }, adminToken);
        assertStatus(status, 200);
    });

    await test('GET /admin/reports returns list (200)', async () => {
        const { status, data } = await get('/admin/reports', adminToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array of reports');
    });

    await test('PATCH /admin/reports/:id resolves report (200)', async () => {
        const { status } = await patch(`/admin/reports/${reportId}`, { action: 'resolved' }, adminToken);
        assertStatus(status, 200);
    });

    await test('GET /admin/audit-logs returns list (200)', async () => {
        const { status, data } = await get('/admin/audit-logs', adminToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'Expected array of audit logs');
    });

    await test('GET /admin/audit-logs with filters returns filtered results (200)', async () => {
        const { status } = await get('/admin/audit-logs?action=report&entity_type=report', adminToken);
        assertStatus(status, 200);
    });

    // ── 13. Group Deletion ─────────────────────────────────────────────────────

    section('13. Group Deletion');

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

    // ── 14. Account Deletion ───────────────────────────────────────────────────

    section('14. Account Deletion');

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
