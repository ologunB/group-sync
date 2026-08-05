/**
 * Full integration test suite — Auth · Users · Groups · Memberships
 *
 * Requires a running server on localhost:3000.
 *
 * Usage:
 *   1. Start the server:  npm run dev   (or: npx tsx src/server.ts)
 *   2. Run tests:         npx tsx src/__tests__/index.ts
 */

import { EncryptionUtil } from '../shared/utils/encryption';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { SocketEvents } from '../shared/socket/socket.events';

const BASE = Boolean(true) ? 'https://group-sync-ovzh.onrender.com/api/v1' : 'http://localhost:3000/api/v1';
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

type Result = { name: string; section: string; passed: boolean; durationMs: number; error?: string };
const results: Result[] = [];
let _currentSection = 'Uncategorised';
let _lastSection    = 'Uncategorised';

function section(title: string): void {
    _lastSection    = title;
    _currentSection = title;
    console.log(`\n  ${title}`);
    console.log('  ' + '─'.repeat(title.length));
}

function subsection(title: string): void {
    _currentSection = `${_lastSection} — ${title}`;
    console.log(`\n    · ${title}`);
}

function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    try {
        await fn();
        const durationMs = Date.now() - t0;
        results.push({ name, section: _currentSection, passed: true, durationMs });
        console.log(`  ✓  ${name}  ${fmtMs(durationMs)}`);
    } catch (err: unknown) {
        const durationMs = Date.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name, section: _currentSection, passed: false, durationMs, error: msg });
        console.log(`  ✗  ${name}  ${fmtMs(durationMs)}`);
        console.log(`       → ${msg}`);
    }
}

// ─── OTP helper — reads from server via test endpoint ────────────────────────

async function getOtp(prefix: 'verify:email' | 'verify:forgot', email: string): Promise<string> {
    const type = prefix === 'verify:forgot' ? 'forgot_password' : 'verify_email';
    const { status, data } = await get(`/test/otp?email=${encodeURIComponent(email)}&type=${type}`);
    assert(status === 200, `OTP fetch failed (${status}): ${JSON.stringify(data)}`);
    const otp = (data.data as Record<string, unknown>).otp as string;
    assert(typeof otp === 'string' && otp.length > 0, `OTP not found for ${email}`);
    return otp;
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
    const regPayload = reg.data.data as Record<string, unknown>;
    const user = regPayload.user as Record<string, unknown>;

    // Verify email — this is now what issues the tokens
    const otp = await getOtp('verify:email', email);
    const verify = await post('/auth/verify-email', { email, otp });
    if (verify.status !== 200) {
        throw new Error(`Email verification failed for ${email}: ${JSON.stringify(verify.data)}`);
    }
    const verifyPayload = verify.data.data as Record<string, unknown>;
    const tokens = verifyPayload.tokens as Record<string, unknown>;
    return { token: tokens.accessToken as string, userId: user.id as string };
}

async function setVerified(userId: string): Promise<void> {
    const { status } = await patch(`/test/verify-user/${userId}`, {});
    assert(status === 200, `setVerified failed for ${userId}: HTTP ${status}`);
}

/**
 * Tier 1 of the verification ladder — joining a group, applying, accepting an invite
 * and RSVPing all require a verified phone. Shortcuts the SMS round-trip.
 */
async function setPhoneVerified(userId: string): Promise<void> {
    const { status } = await patch(`/test/verify-phone/${userId}`, {});
    assert(status === 200, `setPhoneVerified failed for ${userId}: HTTP ${status}`);
}

/**
 * Tier 2 — creating a group additionally requires a bio on the organiser's profile.
 */
async function setOrganiserBio(token: string): Promise<void> {
    const { status } = await patch('/users/me', { bio: 'Integration test organiser.' }, token);
    assert(status === 200, `setOrganiserBio failed: HTTP ${status}`);
}

/**
 * Back-dates a user's groups so the 3-per-7-days creation quota starts fresh.
 * The suite deliberately creates more groups than a real account is allowed to.
 */
async function resetGroupQuota(userId: string): Promise<void> {
    const { status } = await post(`/test/reset-group-quota/${userId}`, {});
    assert(status === 200, `resetGroupQuota failed for ${userId}: HTTP ${status}`);
}

/** Moves a group through the review queue so it shows up in Explore. */
async function approveGroup(groupId: string): Promise<void> {
    const { status } = await patch(`/test/approve-group/${groupId}`, {});
    assert(status === 200, `approveGroup failed for ${groupId}: HTTP ${status}`);
}

// Group descriptions must be 40–500 characters, so every fixture shares one that clears
// the floor rather than each call site inventing its own.
const VALID_DESCRIPTION =
    'A group created by the integration suite to exercise the API end to end.';

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

    await test('valid registration returns 201 with user (no tokens)', async () => {
        const { status, data } = await post('/auth/register', {
            email: EMAIL, password: PASSWORD, display_name: 'Auth Tester',
        });
        assertStatus(status, 201);
        assert(data.success === true, 'success should be true');
        const payload = data.data as Record<string, unknown>;
        assertHas(payload, 'user');
        assert(!('tokens' in payload), 'register should not return tokens');
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
            display_name: 'Phone User', phone: `+2348${String(ts).slice(-9)}`,
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

    await test('unverified user login returns 403', async () => {
        const { status } = await post('/auth/login', { email: EMAIL, password: PASSWORD });
        assertStatus(status, 403);
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

    await test('valid OTP from Redis verifies email and returns user + tokens (200)', async () => {
        const otp = await getOtp('verify:email', EMAIL);
        const { status, data } = await post('/auth/verify-email', { email: EMAIL, otp });
        assertStatus(status, 200);
        const payload = data.data as Record<string, unknown>;
        assertHas(payload, 'user');
        assertHas(payload, 'tokens');
        const tokens = payload.tokens as Record<string, unknown>;
        assertHas(tokens, 'accessToken');
        assertHas(tokens, 'refreshToken');
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('verified user can now log in and receives tokens (200)', async () => {
        const { status, data } = await post('/auth/login', { email: EMAIL, password: PASSWORD });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken  = tokens.accessToken  as string;
        refreshToken = tokens.refreshToken as string;
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

    await test('satisfy the verification ladder for all actors', async () => {
        // Tier 1 for everyone (join / apply / RSVP), tier 2 for the creator (bio).
        await setPhoneVerified(creatorId);
        await setPhoneVerified(memberId);
        await setPhoneVerified(outsiderId);
        await setOrganiserBio(creatorToken);
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

    // Tier 2 replaced the (still-disabled) ID gate: an account with no verified phone
    // and no bio cannot create a group, whatever its idVerificationStatus says.
    await test('POST /groups without a verified phone returns 403', async () => {
        const { token } = await registerAndLogin(`unverf${ts}@test.io`, 'Unverf123!', 'Unverified');
        const { status } = await post(
            '/groups',
            { name: `Unverf Group ${ts}`, category: 'Tech', description: VALID_DESCRIPTION },
            token,
        );
        assertStatus(status, 403);
    });

    await test('POST /groups with a verified phone but no bio returns 403', async () => {
        const u = await registerAndLogin(`nobio${ts}@test.io`, 'NoBio123!', 'No Bio');
        await setPhoneVerified(u.userId);
        const { status, data } = await post(
            '/groups',
            { name: `NoBio Group ${ts}`, category: 'Tech', description: VALID_DESCRIPTION },
            u.token,
        );
        assertStatus(status, 403);
        assert(
            String(data.message).toLowerCase().includes('bio'),
            `error should name the missing bio, got: ${data.message}`,
        );
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
        await resetGroupQuota(creatorId);
        const { status, data } = await post(
            '/groups',
            { name: `OpenGroup ${ts}`, category: 'Technology', description: VALID_DESCRIPTION, membership_type: 'open', cover_image_url: 'https://cdn.example.com/cover.jpg' },
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
        assert(group.memberCount === 1, `creator should count as first member, got ${group.memberCount}`);
    });

    await test('POST /groups creates application group (201)', async () => {
        await resetGroupQuota(creatorId);
        const { status, data } = await post(
            '/groups',
            { name: `AppGroup ${ts}`, category: 'Lifestyle', description: VALID_DESCRIPTION, membership_type: 'application', cover_image_url: 'https://cdn.example.com/cover.jpg' },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        appGroupId   = group.id   as string;
        appGroupSlug = group.slug as string;
        assert(appGroupId.length > 0, 'appGroupId empty');
    });

    await test('POST /groups with all optional fields creates group (201)', async () => {
        await resetGroupQuota(creatorId);
        const { status, data } = await post(
            '/groups',
            {
                name: `FullGroup ${ts}`,
                category: 'Technology',
                subcategory: 'Web Development',
                description: VALID_DESCRIPTION,
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
        await resetGroupQuota(creatorId);
        const { status, data } = await post(
            '/groups',
            { name: `InviteGroup ${ts}`, category: 'Sports', description: VALID_DESCRIPTION, membership_type: 'invite_only' },
            creatorToken,
        );
        assertStatus(status, 201);
        const group = data.data as Record<string, unknown>;
        assert(group.isDiscoverable === false, `invite_only group should not be discoverable: ${group.isDiscoverable}`);
        inviteGroupId   = group.id   as string;
        inviteGroupSlug = group.slug as string;
    });

    await test('approve the fixture groups so they reach Explore', async () => {
        // Groups are created 'pending' and stay out of Explore until reviewed. The
        // discovery assertions below are about filtering, not about the review queue.
        await approveGroup(openGroupId);
        await approveGroup(appGroupId);
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

    await test('GET /groups/:slug memberCount increments after join (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        const group = result.group as Record<string, unknown>;
        assert(group.memberCount === 2, `expected memberCount=2 after join, got ${group.memberCount}`);
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

    await test('GET /groups/:slug memberCount decrements after leave (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        const group = result.group as Record<string, unknown>;
        assert(group.memberCount === 1, `expected memberCount=1 after leave, got ${group.memberCount}`);
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

    await test('GET /groups/:slug memberCount decrements after suspension (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        const group = result.group as Record<string, unknown>;
        assert(group.memberCount === 1, `expected memberCount=1 after suspension, got ${group.memberCount}`);
    });

    await test('PATCH /groups/:id/members/:userId restores member to active (200)', async () => {
        const { status } = await patch(
            `/groups/${openGroupId}/members/${memberId}`,
            { status: 'active' },
            creatorToken,
        );
        assertStatus(status, 200);
    });

    await test('GET /groups/:slug memberCount increments after restore (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const result = data.data as Record<string, unknown>;
        const group = result.group as Record<string, unknown>;
        assert(group.memberCount === 2, `expected memberCount=2 after restore, got ${group.memberCount}`);
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
        formData.append(fieldName, new Blob([new Uint8Array(buffer)], { type: mimeType }), 'test.' + mimeType.split('/')[1]);

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

    async function uploadFileWithFields(
        path: string,
        fieldName: string,
        buffer: Buffer,
        mimeType: string,
        fields: Record<string, string>,
        token?: string,
    ): Promise<ApiResponse> {
        const formData = new FormData();
        for (const [key, value] of Object.entries(fields)) {
            formData.append(key, value);
        }
        formData.append(fieldName, new Blob([new Uint8Array(buffer)], { type: mimeType }), 'test.' + mimeType.split('/')[1]);

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

    // POST is an idempotent upsert now, not a create. The client updates the RSVP
    // optimistically and disables the button on tap, so a retry has to land on the same
    // state instead of a 409 that would force the UI to un-press an already-correct button.
    await test('POST /events/:id/rsvp again is idempotent, not 409', async () => {
        const { status, data } = await post(`/events/${eventId}/rsvp`, { status: 'going' }, memberToken);
        assert(status === 200 || status === 201, `a repeated RSVP must not error, got ${status}`);
        const d = data.data as Record<string, unknown>;
        assert(d.status === 'going', `status should be unchanged, got ${d.status}`);
    });

    await test('re-sending the same RSVP does not double the headcount', async () => {
        const { data } = await get(`/events/${eventId}`, memberToken);
        const d = data.data as Record<string, unknown>;
        assert(d.rsvpCount === 1, `rsvpCount drifted to ${d.rsvpCount}`);
    });

    await test('POST /events/:id/rsvp transitions an existing RSVP instead of rejecting it', async () => {
        const { status, data } = await post(`/events/${eventId}/rsvp`, { status: 'not_going' }, memberToken);
        assert(status === 200 || status === 201, `expected success, got ${status}`);
        const d = data.data as Record<string, unknown>;
        assert(d.status === 'not_going', `expected "not_going" (the Unavailable option), got ${d.status}`);
    });

    await test('switching away from "going" releases the headcount', async () => {
        const { data } = await get(`/events/${eventId}`, memberToken);
        const d = data.data as Record<string, unknown>;
        assert(d.rsvpCount === 0, `expected 0 after switching to not_going, got ${d.rsvpCount}`);
    });

    await test('RSVPing requires a verified phone (tier 1)', async () => {
        const u = await registerAndLogin(`norsvp${ts}@test.io`, 'NoRsvp123!', 'No Phone');
        const { status } = await post(`/events/${eventId}/rsvp`, { status: 'going' }, u.token);
        assertStatus(status, 403);
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

    // ── Venue & calendar ──────────────────────────────────────────────────

    let venueEventId = '';

    await test('POST /groups/:id/events accepts venue_city/venue_state and returns venueArea', async () => {
        const { status, data } = await post(
            `/groups/${openGroupId}/events`,
            {
                title: `Venue Event ${ts}`,
                description: 'Meet at the gate.',
                venue_city: 'Ibadan',
                venue_state: 'Oyo',
                starts_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
                visibility: 'public',
            },
            creatorToken,
        );
        assertStatus(status, 201);
        const d = data.data as Record<string, unknown>;
        venueEventId = d.id as string;
        assert(d.venueArea === 'Ibadan, Oyo', `venueArea was "${d.venueArea}"`);
    });

    await test('event payload carries .ics and Google Calendar links', async () => {
        const { data } = await get(`/events/${venueEventId}`, memberToken);
        const cal = (data.data as Record<string, any>).calendar;
        assert(Boolean(cal), 'calendar block missing from the event payload');
        assert(String(cal.ics).endsWith('/calendar.ics'), `ics link looks wrong: ${cal.ics}`);
        assert(
            String(cal.google).startsWith('https://calendar.google.com/'),
            `google link looks wrong: ${cal.google}`,
        );
    });

    await test('setting an exact venue_address requires a verified ID (tier 3)', async () => {
        // The creator is ID-verified from setup, so use an organiser who is not.
        const organiser = await registerAndLogin(`tier3${ts}@test.io`, 'Tier3Pass1!', 'Tier Three');
        await setPhoneVerified(organiser.userId);
        await setOrganiserBio(organiser.token);
        await resetGroupQuota(organiser.userId);

        const groupRes = await post(
            '/groups',
            {
                name: `Tier3 Group ${ts}`,
                category: 'Community',
                description: VALID_DESCRIPTION,
                cover_image_url: 'https://cdn.example.com/cover.jpg',
            },
            organiser.token,
        );
        assertStatus(groupRes.status, 201);
        const gid = (groupRes.data.data as Record<string, unknown>).id as string;

        const { status } = await post(
            `/groups/${gid}/events`,
            {
                title: `Address Event ${ts}`,
                venue_city: 'Ibadan',
                venue_state: 'Oyo',
                venue_address: '12 Awolowo Road, Bodija',
                starts_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
            },
            organiser.token,
        );
        assertStatus(status, 403);
    });

    let addressEventId = '';

    await test('an ID-verified organiser may publish an exact address', async () => {
        const { status, data } = await post(
            `/groups/${openGroupId}/events`,
            {
                title: `Address Event ${ts}`,
                venue_city: 'Ibadan',
                venue_state: 'Oyo',
                venue_address: '12 Awolowo Road, Bodija',
                starts_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
                visibility: 'public',
            },
            creatorToken,
        );
        assertStatus(status, 201);
        const d = data.data as Record<string, unknown>;
        addressEventId = d.id as string;
        assert(d.venueAddress === '12 Awolowo Road, Bodija', 'the organiser should see the address');
        assert(d.canSeeExactAddress === true, 'canSeeExactAddress should be true for the organiser');
    });

    await test('a member sees the exact address', async () => {
        const { status, data } = await get(`/events/${addressEventId}`, memberToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(d.venueAddress === '12 Awolowo Road, Bodija', 'members should see the address');
    });

    await test('a non-member sees the area label but not the exact address', async () => {
        const { status, data } = await get(`/events/${addressEventId}`, outsiderToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(d.venueArea === 'Ibadan, Oyo', 'the public area label should still be present');
        assert(
            !('venueAddress' in d),
            'venueAddress must be omitted entirely, not nulled — a null tells a stranger it exists',
        );
        assert(d.canSeeExactAddress === false, 'canSeeExactAddress should be false');
    });

    await test('GET /events/:id/calendar.ics returns a text/calendar attachment', async () => {
        const res = await fetch(`${BASE}/events/${venueEventId}/calendar.ics`, {
            headers: { Authorization: `Bearer ${memberToken}` },
        });
        assertStatus(res.status, 200);
        assert(
            (res.headers.get('content-type') ?? '').includes('text/calendar'),
            `content-type was ${res.headers.get('content-type')}`,
        );
        assert(
            (res.headers.get('content-disposition') ?? '').includes('attachment'),
            'the .ics should be served as an attachment',
        );
        const body = await res.text();
        assert(body.startsWith('BEGIN:VCALENDAR'), 'body is not an iCalendar document');
        assert(body.includes('SUMMARY:'), 'SUMMARY line missing');
    });

    await test('the .ics of a private event 404s for a non-member', async () => {
        const priv = await post(
            `/groups/${openGroupId}/events`,
            {
                title: `Private Event ${ts}`,
                starts_at: new Date(Date.now() + 96 * 3_600_000).toISOString(),
                visibility: 'private',
            },
            creatorToken,
        );
        assertStatus(priv.status, 201);
        const pid = (priv.data.data as Record<string, unknown>).id as string;

        const res = await fetch(`${BASE}/events/${pid}/calendar.ics`, {
            headers: { Authorization: `Bearer ${outsiderToken}` },
        });
        assertStatus(res.status, 404);
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
        const { status, data } = await post('/test/seed-notification', {
            userId: creatorId,
            type: 'system',
            title: 'Test notification',
            body: 'This is a test.',
        });
        assertStatus(status, 201);
        notificationId = (data.data as Record<string, unknown>).id as string;
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

    await test('GET /notifications/unread-count returns a number (200)', async () => {
        const { status, data } = await get('/notifications/unread-count', memberToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(typeof d.unread_count === 'number', 'Expected unread_count to be a number');
    });

    // Before this batch the fan-out job only logged its payload — no notification row
    // was ever written, which is why the counter and the notifications page were always
    // empty. These two tests are the regression guard for that.
    await test('creating an event actually notifies group members', async () => {
        const before = await get('/notifications/unread-count', memberToken);
        const beforeCount = ((before.data.data as Record<string, unknown>).unread_count as number);

        const created = await post(
            `/groups/${openGroupId}/events`,
            {
                title: `Notified Event ${ts}`,
                venue_city: 'Ibadan',
                venue_state: 'Oyo',
                starts_at: new Date(Date.now() + 120 * 3_600_000).toISOString(),
                visibility: 'public',
            },
            creatorToken,
        );
        assertStatus(created.status, 201);

        // The fan-out is awaited inside the request, but the write and this read are
        // separate round-trips — give it a beat.
        await new Promise((r) => setTimeout(r, 800));

        const after = await get('/notifications/unread-count', memberToken);
        const afterCount = ((after.data.data as Record<string, unknown>).unread_count as number);
        assert(
            afterCount > beforeCount,
            `unread count did not rise (${beforeCount} → ${afterCount}) — the fan-out wrote nothing`,
        );
    });

    await test('the event notification lands in the list with a usable reference', async () => {
        const { status, data } = await get('/notifications?limit=50', memberToken);
        assertStatus(status, 200);
        const list = (data.data as Record<string, any>).data as Record<string, unknown>[];
        const created = list.find((n) => n.type === 'event_created');
        assert(Boolean(created), 'no event_created notification found');
        assert(created!.referenceType === 'event', `referenceType was ${created!.referenceType}`);
        assert(Boolean(created!.referenceId), 'referenceId should point at the event');
    });

    await test('the organiser is not notified about their own event', async () => {
        const { data } = await get('/notifications?limit=50', creatorToken);
        const list = (data.data as Record<string, any>).data as Record<string, unknown>[];
        const own = list.filter(
            (n) => n.type === 'event_created' && String(n.title).includes(`Notified Event`),
        );
        assert(own.length === 0, 'the actor must be excluded from their own fan-out');
    });

    await test('an approved application notifies the applicant in-app', async () => {
        // The approval email already worked; the in-app notification did not exist.
        const applicant = await registerAndLogin(`applicant${ts}@test.io`, 'Applies123!', 'Applicant');
        await setPhoneVerified(applicant.userId);

        const applied = await post(`/groups/${appGroupId}/apply`, { form_responses: {} }, applicant.token);
        assertStatus(applied.status, 201);

        const list = await get(`/groups/${appGroupId}/applications?status=pending`, creatorToken);
        assertStatus(list.status, 200);
        const pending = extractList(list.data.data).find(
            (a) => (a as Record<string, unknown>).userId === applicant.userId,
        ) as Record<string, unknown>;
        assert(Boolean(pending), 'the application was not found');

        const review = await patch(`/applications/${pending.id}`, { action: 'approve' }, creatorToken);
        assertStatus(review.status, 200);

        await new Promise((r) => setTimeout(r, 800));

        const notes = await get('/notifications?limit=50', applicant.token);
        const noteList = (notes.data.data as Record<string, any>).data as Record<string, unknown>[];
        assert(
            noteList.some((n) => n.type === 'application_approved'),
            'the applicant received no in-app approval notification',
        );
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

    await test('a partial channel update leaves the other channels alone', async () => {
        // Muting email must not silently re-enable in-app just because the client
        // did not restate it.
        const { status, data } = await patch(
            '/notifications/preferences',
            { preferences: [{ pref_type: 'event_created', email_enabled: false }] },
            creatorToken,
        );
        assertStatus(status, 200);
        const pref = (data.data as Record<string, unknown>[]).find(
            (p) => p.prefType === 'event_created' && p.groupId === null,
        );
        assert(Boolean(pref), 'preference row missing');
        assert(pref!.emailEnabled === false, 'email should now be off');
        assert(pref!.pushEnabled === false, 'push should have kept its previous value');
        assert(pref!.inAppEnabled === true, 'in-app should have kept its previous value');
    });

    await test('an unknown pref_type is rejected', async () => {
        const { status } = await patch(
            '/notifications/preferences',
            { preferences: [{ pref_type: 'not_a_real_type', email_enabled: false }] },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
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
    // super_admin has all admin perms + platform.manage_roles
    const superAdminToken = EncryptionUtil.generateJWT(
        {
            userId: creatorId,
            role: 'super_admin',
            sessionId: 'test-super-session',
            permissions: [
                'platform.admin',
                'platform.view_users',
                'platform.manage_users',
                'platform.view_reports',
                'platform.manage_reports',
                'platform.manage_groups',
                'platform.view_audit_logs',
                'platform.manage_roles',
            ],
        },
        900,
    );

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

    await test('GET /admin/stats returns platform stats (200)', async () => {
        const { status, data } = await get('/admin/stats', adminToken);
        assertStatus(status, 200);
        const stats = data.data as Record<string, unknown>;
        assertHas(stats, 'users');
        assertHas(stats, 'groups');
        assertHas(stats, 'content');
        assertHas(stats, 'moderation');
        const users = stats.users as Record<string, unknown>;
        assertHas(users, 'total');
        assertHas(users, 'active');
    });

    await test('PATCH /admin/users/:id/role without platform.manage_roles returns 403', async () => {
        // adminToken only has platform.admin, not platform.manage_roles
        const { status } = await patch(`/admin/users/${memberId}/role`, { role: 'admin' }, adminToken);
        assertStatus(status, 403);
    });

    await test('PATCH /admin/users/:id/role with super_admin changes role (200)', async () => {
        const { status, data } = await patch(`/admin/users/${memberId}/role`, { role: 'admin' }, superAdminToken);
        assertStatus(status, 200);
        const user = data.data as Record<string, unknown>;
        assert(user.role === 'admin', `Expected role=admin, got: ${user.role}`);
    });

    await test('PATCH /admin/users/:id/role self-change returns 403', async () => {
        // creatorId === superAdminToken.userId — cannot change own role
        const { status } = await patch(`/admin/users/${creatorId}/role`, { role: 'user' }, superAdminToken);
        assertStatus(status, 403);
    });

    await test('PATCH /admin/users/:id/role restores member role (200)', async () => {
        const { status } = await patch(`/admin/users/${memberId}/role`, { role: 'user' }, superAdminToken);
        assertStatus(status, 200);
    });

    // ── 13. Messages (Group Chat) ─────────────────────────────────────────────

    section('13. Messages (Group Chat)');

    // Re-login before messages section — sections 1-12 can exceed the 15-min JWT TTL
    await test('refresh tokens before message tests', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL, password: CREATOR_PASS });
        const { data: md } = await post('/auth/login', { email: MEMBER_EMAIL,  password: MEMBER_PASS  });
        const freshCreator = ((cd.data as any)?.tokens as any)?.accessToken as string;
        const freshMember  = ((md.data as any)?.tokens as any)?.accessToken as string;
        assert(freshCreator?.length > 0, `Creator re-login failed: ${JSON.stringify(cd)}`);
        assert(freshMember?.length  > 0, `Member re-login failed: ${JSON.stringify(md)}`);
        creatorToken = freshCreator;
        memberToken  = freshMember;
    });

    let messageId = '';
    let pinnedMessageId = '';

    await test('POST /groups/:id/messages without auth returns 401', async () => {
        const { status } = await post(`/groups/${openGroupId}/messages`, { content: 'Hi' });
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/messages as non-member returns 403', async () => {
        // Register a fresh user who is not a member
        const { token: stranger } = await registerAndLogin(`stranger${ts}@test.io`, 'Stranger1!', 'Stranger');
        const { status } = await post(`/groups/${openGroupId}/messages`, { content: 'Sneaky' }, stranger);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/messages as member sends message (201)', async () => {
        const { status, data } = await post(`/groups/${openGroupId}/messages`, { content: 'Hello group!' }, memberToken);
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        assertHas(msg, 'id');
        messageId = msg.id as string;
        assert(msg.content === 'Hello group!', `content mismatch: ${msg.content}`);
    });

    await test('POST /groups/:id/messages with media upload sends image message (201)', async () => {
        const { status, data } = await uploadFileWithFields(
            `/groups/${openGroupId}/messages`,
            'media',
            TINY_PNG,
            'image/png',
            { content: 'Image hello' },
            memberToken,
        );
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        assert(msg.messageType === 'image', `messageType mismatch: ${msg.messageType}`);
        assert(typeof msg.mediaUrl === 'string' && (msg.mediaUrl as string).startsWith('https://'), 'expected mediaUrl HTTPS string');
    });

    await test('POST /groups/:id/messages with message_type text sends text message (201)', async () => {
        const { status, data } = await post(`/groups/${openGroupId}/messages`, {
            content: 'Plain text message',
            message_type: 'text',
        }, memberToken);
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        assert(msg.messageType === 'text', `expected messageType=text, got ${msg.messageType}`);
        assert(msg.content === 'Plain text message', 'content mismatch');
    });

    await test('POST /groups/:id/messages with media_url sends image by URL (201)', async () => {
        const { status, data } = await post(`/groups/${openGroupId}/messages`, {
            message_type: 'image',
            media_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        }, memberToken);
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        assert(msg.messageType === 'image', `expected messageType=image, got ${msg.messageType}`);
        assert(typeof msg.mediaUrl === 'string', 'expected mediaUrl string');
    });

    await test('POST /groups/:id/messages with invalid message_type returns 422', async () => {
        const { status } = await post(`/groups/${openGroupId}/messages`, {
            content: 'hi',
            message_type: 'voice_note',
        }, memberToken);
        assertStatus(status, 422);
    });

    await test('POST /groups/:id/messages with reply_to_id sends threaded reply (201)', async () => {
        const { status, data } = await post(
            `/groups/${openGroupId}/messages`,
            { content: 'Reply!', reply_to_id: messageId },
            creatorToken,
        );
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        assert(msg.replyToId === messageId, `replyToId mismatch: ${msg.replyToId}`);
        pinnedMessageId = msg.id as string;
    });

    await test('GET /groups/:id/messages as member returns list (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/messages`, memberToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'expected array of messages');
        assert((data.data as any[]).length >= 1, 'expected at least one message');
    });

    await test('GET /groups/:id/messages without auth returns 401', async () => {
        const { status } = await get(`/groups/${openGroupId}/messages`);
        assertStatus(status, 401);
    });

    await test('POST /messages/:id/react adds reaction (201)', async () => {
        const { status } = await post(`/messages/${messageId}/react`, { emoji: '👍' }, memberToken);
        assertStatus(status, 201);
    });

    await test('POST /messages/:id/react duplicate returns 409', async () => {
        const { status } = await post(`/messages/${messageId}/react`, { emoji: '👍' }, memberToken);
        assertStatus(status, 409);
    });

    await test('DELETE /messages/:id/react removes reaction (200)', async () => {
        const { status } = await del(`/messages/${messageId}/react`, memberToken, { emoji: '👍' });
        assertStatus(status, 200);
    });

    await test('PATCH /messages/:id/pin as admin pins message (200)', async () => {
        const { status, data } = await patch(`/messages/${pinnedMessageId}/pin`, {}, creatorToken);
        assertStatus(status, 200);
        const msg = data.data as Record<string, unknown>;
        assert(msg.isPinned === true, `expected isPinned=true: ${msg.isPinned}`);
    });

    await test('PATCH /messages/:id/pin as non-admin returns 403', async () => {
        const { status } = await patch(`/messages/${pinnedMessageId}/pin`, {}, memberToken);
        assertStatus(status, 403);
    });

    await test('GET /groups/:id/messages/pinned returns pinned list (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/messages/pinned`, memberToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'expected array');
        assert((data.data as any[]).some((m: any) => m.id === pinnedMessageId), 'pinned message not in list');
    });

    await test('PATCH /groups/:id/chat as non-admin returns 403', async () => {
        const { status } = await patch(`/groups/${openGroupId}/chat`, { locked: true }, memberToken);
        assertStatus(status, 403);
    });

    await test('PATCH /groups/:id/chat as admin locks chat (200)', async () => {
        const { status, data } = await patch(`/groups/${openGroupId}/chat`, { locked: true }, creatorToken);
        assertStatus(status, 200);
        assert((data.data as any).is_chat_locked === true, 'expected chat to be locked');
    });

    await test('POST /groups/:id/messages while chat locked as member returns 403', async () => {
        const { status } = await post(`/groups/${openGroupId}/messages`, { content: 'Blocked' }, memberToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/messages while chat locked as admin succeeds (201)', async () => {
        const { status } = await post(`/groups/${openGroupId}/messages`, { content: 'Admin msg' }, creatorToken);
        assertStatus(status, 201);
    });

    await test('PATCH /groups/:id/chat unlocks chat (200)', async () => {
        const { status, data } = await patch(`/groups/${openGroupId}/chat`, { locked: false }, creatorToken);
        assertStatus(status, 200);
        assert((data.data as any).is_chat_locked === false, 'expected chat to be unlocked');
    });

    await test('DELETE /messages/:id as sender soft-deletes message (200)', async () => {
        const { status } = await del(`/messages/${messageId}`, memberToken);
        assertStatus(status, 200);
    });

    await test('DELETE /messages/:id already deleted returns 404', async () => {
        const { status } = await del(`/messages/${messageId}`, memberToken);
        assertStatus(status, 404);
    });

    // ── Polls ─────────────────────────────────────────────────────────────────

    let pollMessageId = '';
    let pollOptionId  = '';

    await test('POST /groups/:id/messages with message_type poll creates poll (201)', async () => {
        const { status, data } = await post(`/groups/${openGroupId}/messages`, {
            message_type: 'poll',
            poll: {
                question:    'What is your favourite colour?',
                options:     ['Red', 'Green', 'Blue'],
                is_multiple: false,
            },
        }, creatorToken);
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        assert(msg.messageType === 'poll', `expected messageType=poll, got ${msg.messageType}`);
        assertHas(msg, 'poll');
        const poll = msg.poll as Record<string, unknown>;
        assert(poll.question === 'What is your favourite colour?', 'question mismatch');
        const options = poll.options as any[];
        assert(options.length === 3, `expected 3 options, got ${options.length}`);
        pollMessageId = msg.id as string;
        pollOptionId  = options[0].id as string;
    });

    await test('POST /groups/:id/messages with poll but < 2 options returns 422', async () => {
        const { status } = await post(`/groups/${openGroupId}/messages`, {
            message_type: 'poll',
            poll: { question: 'Solo?', options: ['Only one'] },
        }, creatorToken);
        assertStatus(status, 422);
    });

    await test('POST /groups/:id/messages with poll but no question returns 422', async () => {
        const { status } = await post(`/groups/${openGroupId}/messages`, {
            message_type: 'poll',
            poll: { options: ['A', 'B'] },
        }, creatorToken);
        assertStatus(status, 422);
    });

    await test('POST /messages/:id/poll/vote without auth returns 401', async () => {
        const { status } = await post(`/messages/${pollMessageId}/poll/vote`, { option_id: pollOptionId });
        assertStatus(status, 401);
    });

    await test('POST /messages/:id/poll/vote records vote (201)', async () => {
        const { status, data } = await post(`/messages/${pollMessageId}/poll/vote`, { option_id: pollOptionId }, memberToken);
        assertStatus(status, 201);
        const msg = data.data as Record<string, unknown>;
        const poll = msg.poll as Record<string, unknown>;
        const options = poll.options as any[];
        const voted = options.find((o: any) => o.id === pollOptionId);
        assert(voted._count.votes === 1, `expected 1 vote, got ${voted._count.votes}`);
        assert(voted.votes.some((v: any) => v.userId === memberId), 'memberToken vote not reflected');
    });

    await test('POST /messages/:id/poll/vote duplicate returns 409', async () => {
        const { status } = await post(`/messages/${pollMessageId}/poll/vote`, { option_id: pollOptionId }, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /messages/:id/poll/vote on second option (single-choice) returns 409', async () => {
        // member already voted for pollOptionId; single-choice poll prevents voting on another option
        const pollData = (await get(`/groups/${openGroupId}/messages`, memberToken)).data.data as any[];
        const ourPoll  = pollData.find((m: any) => m.id === pollMessageId);
        const secondOption = (ourPoll.poll.options as any[]).find((o: any) => o.id !== pollOptionId);
        const { status } = await post(`/messages/${pollMessageId}/poll/vote`, { option_id: secondOption.id }, memberToken);
        assertStatus(status, 409);
    });

    await test('DELETE /messages/:id/poll/vote removes vote (200)', async () => {
        const { status, data } = await del(`/messages/${pollMessageId}/poll/vote`, memberToken, { option_id: pollOptionId });
        assertStatus(status, 200);
        const poll = ((data.data as Record<string, unknown>).poll as Record<string, unknown>);
        const options = poll.options as any[];
        const unvoted = options.find((o: any) => o.id === pollOptionId);
        assert(unvoted._count.votes === 0, `expected 0 votes after unvote, got ${unvoted._count.votes}`);
    });

    await test('DELETE /messages/:id/poll/vote non-existent vote returns 404', async () => {
        const { status } = await del(`/messages/${pollMessageId}/poll/vote`, memberToken, { option_id: pollOptionId });
        assertStatus(status, 404);
    });

    await test('POST /messages/:id/poll/vote with invalid option_id returns 422', async () => {
        const { status } = await post(`/messages/${pollMessageId}/poll/vote`, { option_id: 'not-a-uuid' }, memberToken);
        assertStatus(status, 422);
    });

    await test('POST /messages/:id/poll/vote with option from wrong poll returns 404', async () => {
        // Create a second poll and try to vote its option on the first poll's message
        const p2 = await post(`/groups/${openGroupId}/messages`, {
            message_type: 'poll',
            poll: { question: 'Other poll', options: ['X', 'Y'] },
        }, creatorToken);
        assertStatus(p2.status, 201);
        const otherOption = ((p2.data.data as any).poll.options as any[])[0].id as string;
        // Vote that option against the ORIGINAL poll message — should be 404 (option not in this poll)
        const { status } = await post(`/messages/${pollMessageId}/poll/vote`, { option_id: otherOption }, memberToken);
        assertStatus(status, 404);
    });

    // ── 14. Direct Messages ───────────────────────────────────────────────────

    section('14. Direct Messages');

    // Re-login before DM section — sections 1-13 can exceed the 15-min JWT TTL
    await test('refresh tokens before DM tests', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL, password: CREATOR_PASS });
        const { data: md } = await post('/auth/login', { email: MEMBER_EMAIL,  password: MEMBER_PASS  });
        const freshCreator = ((cd.data as any)?.tokens as any)?.accessToken as string;
        const freshMember  = ((md.data as any)?.tokens as any)?.accessToken as string;
        assert(freshCreator?.length > 0, `Creator re-login failed: ${JSON.stringify(cd)}`);
        assert(freshMember?.length  > 0, `Member re-login failed: ${JSON.stringify(md)}`);
        creatorToken = freshCreator;
        memberToken  = freshMember;
    });

    let dmId = '';

    await test('GET /conversations without auth returns 401', async () => {
        const { status } = await get('/conversations');
        assertStatus(status, 401);
    });

    await test('GET /conversations returns unified list (200)', async () => {
        const { status, data } = await get('/conversations', creatorToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'expected array');
    });

    await test('GET /conversations with invalid type returns 422', async () => {
        const { status } = await get('/conversations?type=private', creatorToken);
        assertStatus(status, 422);
    });

    await test('GET /conversations?type=group returns only groups (200)', async () => {
        const { status, data } = await get('/conversations?type=group', creatorToken);
        assertStatus(status, 200);
        const items = data.data as any[];
        assert(Array.isArray(items), 'expected array');
        assert(items.length >= 1, 'expected at least one group conversation');
        assert(items.every((i) => i.type === 'group'), 'expected only group conversations');
    });

    await test('POST /dm/:userId without auth returns 401', async () => {
        const { status } = await post(`/dm/${memberId}`, { content: 'Hey' });
        assertStatus(status, 401);
    });

    await test('POST /dm/:userId to self returns 422', async () => {
        const { status } = await post(`/dm/${creatorId}`, { content: 'Hello me' }, creatorToken);
        assertStatus(status, 422);
    });

    await test('POST /dm/:userId to user in same group sends DM (201)', async () => {
        // creator and member both belong to openGroup
        const { status, data } = await post(`/dm/${memberId}`, { content: 'Hey member!' }, creatorToken);
        assertStatus(status, 201);
        const dm = data.data as Record<string, unknown>;
        assertHas(dm, 'id');
        dmId = dm.id as string;
        assert(dm.content === 'Hey member!', `content mismatch: ${dm.content}`);
    });

    await test('POST /dm/:userId with media upload sends DM media (201)', async () => {
        const { status, data } = await uploadFileWithFields(
            `/dm/${memberId}`,
            'media',
            TINY_PNG,
            'image/png',
            { content: 'DM image hello' },
            creatorToken,
        );
        assertStatus(status, 201);
        const dm = data.data as Record<string, unknown>;
        assert(typeof dm.mediaUrl === 'string' && (dm.mediaUrl as string).startsWith('https://'), 'expected mediaUrl HTTPS string');
    });

    await test('POST /dm/:userId to user in no shared group returns 403', async () => {
        // Register a completely new user with no group membership
        const { userId: lonerId } = await registerAndLogin(`loner${ts}@test.io`, 'Loner1234!', 'Loner');
        const { status } = await post(`/dm/${lonerId}`, { content: 'Hi stranger' }, creatorToken);
        assertStatus(status, 403);
    });

    await test('GET /dm/:userId returns thread (200)', async () => {
        const { status, data } = await get(`/dm/${memberId}`, creatorToken);
        assertStatus(status, 200);
        assert(Array.isArray(data.data), 'expected array');
        assert((data.data as any[]).some((m: any) => m.id === dmId), 'sent DM not in thread');
    });

    await test('PATCH /dm/:userId/read marks thread as read (200)', async () => {
        // memberToken reads the thread from creator
        const { status, data } = await patch(`/dm/${creatorId}/read`, {}, memberToken);
        assertStatus(status, 200);
        assert(typeof (data.data as any).count === 'number', 'expected count field');
    });

    await test('GET /conversations after DM shows DM entry (200)', async () => {
        const { status, data } = await get('/conversations', creatorToken);
        assertStatus(status, 200);
        const items = data.data as any[];
        const hasDm = items.some((i) => i.type === 'dm' && i.id === memberId);
        assert(hasDm, 'DM conversation not found in unified list');
    });

    await test('GET /conversations?type=dm returns only DMs (200)', async () => {
        const { status, data } = await get('/conversations?type=dm', creatorToken);
        assertStatus(status, 200);
        const items = data.data as any[];
        assert(items.length >= 1, 'expected at least one DM conversation');
        assert(items.every((i) => i.type === 'dm'), 'expected only DM conversations');
        assert(items.some((i) => i.id === memberId), 'expected member DM conversation');
    });

    await test('DELETE /dm/:dmId soft-deletes DM (200)', async () => {
        const { status } = await del(`/dm/${dmId}`, creatorToken);
        assertStatus(status, 200);
    });

    // ── DM reply_to ───────────────────────────────────────────────────────────

    let replyDmId = '';

    await test('POST /dm/:userId with reply_to_id sends threaded reply (201)', async () => {
        // Send a fresh DM first so we have a parent in-thread message
        const parent = await post(`/dm/${memberId}`, { content: 'Parent message' }, creatorToken);
        assertStatus(parent.status, 201);
        const parentDm = parent.data.data as Record<string, unknown>;
        const parentId = parentDm.id as string;

        const { status, data } = await post(`/dm/${memberId}`, {
            content: 'Reply to parent',
            reply_to_id: parentId,
        }, creatorToken);
        assertStatus(status, 201);
        const dm = data.data as Record<string, unknown>;
        assertHas(dm, 'replyToId');
        assert(dm.replyToId === parentId, `replyToId mismatch: ${dm.replyToId}`);
        assertHas(dm, 'replyTo');
        replyDmId = dm.id as string;
    });

    await test('POST /dm/:userId with out-of-thread reply_to_id returns 422', async () => {
        // Use a completely different (non-existent) UUID as reply_to_id
        const { status } = await post(`/dm/${memberId}`, {
            content: 'Invalid reply',
            reply_to_id: '00000000-0000-0000-0000-000000000000',
        }, creatorToken);
        assertStatus(status, 422);
    });

    // ── DM reactions ──────────────────────────────────────────────────────────

    await test('POST /dm/:dmId/react without auth returns 401', async () => {
        const { status } = await post(`/dm/${replyDmId}/react`, { emoji: '👍' });
        assertStatus(status, 401);
    });

    await test('POST /dm/:dmId/react adds reaction (201)', async () => {
        const { status } = await post(`/dm/${replyDmId}/react`, { emoji: '👍' }, memberToken);
        assertStatus(status, 201);
    });

    await test('POST /dm/:dmId/react duplicate reaction returns 409', async () => {
        const { status } = await post(`/dm/${replyDmId}/react`, { emoji: '👍' }, memberToken);
        assertStatus(status, 409);
    });

    await test('POST /dm/:dmId/react missing emoji returns 422', async () => {
        const { status } = await post(`/dm/${replyDmId}/react`, {}, memberToken);
        assertStatus(status, 422);
    });

    await test('POST /dm/:dmId/react by non-participant returns 403', async () => {
        // Register a fresh user who shares no DM thread with creator
        const { token: outsiderToken } = await registerAndLogin(`dmreact${ts}@test.io`, 'Outsider1!', 'DmReactOut');
        const { status } = await post(`/dm/${replyDmId}/react`, { emoji: '❤️' }, outsiderToken);
        assertStatus(status, 403);
    });

    await test('DELETE /dm/:dmId/react removes reaction (200)', async () => {
        const { status } = await del(`/dm/${replyDmId}/react`, memberToken, { emoji: '👍' });
        assertStatus(status, 200);
    });

    await test('DELETE /dm/:dmId/react non-existent reaction returns 404', async () => {
        const { status } = await del(`/dm/${replyDmId}/react`, memberToken, { emoji: '👍' });
        assertStatus(status, 404);
    });

    await test('GET /dm/:userId thread includes replyTo and reactions fields', async () => {
        // Re-add a reaction so we can inspect the shape
        await post(`/dm/${replyDmId}/react`, { emoji: '🔥' }, creatorToken);
        const { status, data } = await get(`/dm/${memberId}`, creatorToken);
        assertStatus(status, 200);
        const messages = data.data as any[];
        const reply = messages.find((m: any) => m.id === replyDmId);
        assert(reply !== undefined, 'reply DM not found in thread');
        assertHas(reply, 'replyToId');
        assertHas(reply, 'replyTo');
        assertHas(reply, 'reactions');
        assert(Array.isArray(reply.reactions), 'reactions should be an array');
        assert(reply.reactions.length >= 1, 'expected at least one reaction');
    });

    // ── 15. Socket.io ────────────────────────────────────────────────────────

    section('15. Socket.io');

    // Re-login to get fresh tokens — sections 12-14 may take >15 min when DB is slow,
    // causing the original JWT (15-min TTL) to expire before socket tests run.
    await test('refresh tokens before socket tests', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL, password: CREATOR_PASS });
        const { data: md } = await post('/auth/login', { email: MEMBER_EMAIL,  password: MEMBER_PASS  });
        const freshCreator = ((cd.data as any)?.tokens as any)?.accessToken as string;
        const freshMember  = ((md.data as any)?.tokens as any)?.accessToken as string;
        assert(freshCreator?.length > 0, `Creator re-login failed: ${JSON.stringify(cd)}`);
        assert(freshMember?.length  > 0, `Member re-login failed: ${JSON.stringify(md)}`);
        creatorToken = freshCreator;
        memberToken  = freshMember;
    });

    const SOCKET_URL = BASE.replace('/api/v1', '') + '/chat';

    function connectSocket(token: string): Promise<ClientSocket> {
        return new Promise((resolve, reject) => {
            const s = ioClient(SOCKET_URL, {
                auth: { token },
                transports: ['websocket'],
                timeout: 5000,
                reconnection: false,
            });
            s.once('connect', () => resolve(s));
            s.once('connect_error', (err) => { s.disconnect(); reject(err); });
        });
    }

    function waitForEvent(s: ClientSocket | null, event: string, timeoutMs = 3000): Promise<unknown> {
        if (!s) return Promise.reject(new Error('Socket is not connected'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Timeout (${timeoutMs}ms) waiting for "${event}"`)),
                timeoutMs,
            );
            s.once(event, (data) => { clearTimeout(timer); resolve(data); });
        });
    }

    let creatorSocket: ClientSocket | null = null;
    let memberSocket: ClientSocket | null = null;

    await test('connect without token returns connect_error', async () => {
        await new Promise<void>((resolve, reject) => {
            const s = ioClient(SOCKET_URL, { transports: ['websocket'], reconnection: false, timeout: 4000 });
            s.once('connect_error', () => { s.disconnect(); resolve(); });
            s.once('connect', () => { s.disconnect(); reject(new Error('Should not connect without token')); });
        });
    });

    await test('connect with invalid token returns connect_error', async () => {
        await new Promise<void>((resolve, reject) => {
            const s = ioClient(SOCKET_URL, {
                auth: { token: 'not.a.valid.jwt' },
                transports: ['websocket'],
                reconnection: false,
                timeout: 4000,
            });
            s.once('connect_error', () => { s.disconnect(); resolve(); });
            s.once('connect', () => { s.disconnect(); reject(new Error('Should not connect with invalid token')); });
        });
    });

    await test('connect with valid token connects successfully', async () => {
        creatorSocket = await connectSocket(creatorToken);
        memberSocket  = await connectSocket(memberToken);
        assert(creatorSocket.connected, 'creator socket should be connected');
        assert(memberSocket.connected,  'member socket should be connected');
    });

    await test('join_group as active member receives no error', async () => {
        // Wait for GROUP_JOINED confirmation on both sockets — guarantees socket.join()
        // completed before subsequent tests rely on room membership.
        const creatorJoined = waitForEvent(creatorSocket!, SocketEvents.GROUP_JOINED, 5000);
        const memberJoined  = waitForEvent(memberSocket!,  SocketEvents.GROUP_JOINED, 5000);
        creatorSocket!.emit(SocketEvents.JOIN_GROUP, { group_id: openGroupId });
        memberSocket!.emit(SocketEvents.JOIN_GROUP, { group_id: openGroupId });
        await Promise.all([creatorJoined, memberJoined]);
    });

    await test('join_group for unknown group emits error event', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const errPromise = waitForEvent(creatorSocket!, SocketEvents.ERROR);
        creatorSocket!.emit(SocketEvents.JOIN_GROUP, { group_id: fakeId });
        const data = await errPromise as Record<string, string>;
        assert(typeof data.message === 'string', 'error payload should have message');
    });

    await test('send_message via socket broadcasts new_message to room members', async () => {
        // Member listens for the new_message that creator will send
        const newMsgPromise = waitForEvent(memberSocket!, SocketEvents.NEW_MESSAGE);
        creatorSocket!.emit(SocketEvents.SEND_MESSAGE, {
            group_id: openGroupId,
            content: 'Socket test message',
        });
        const data = await newMsgPromise as { message: Record<string, unknown> };
        assert(data?.message?.content === 'Socket test message', `content mismatch: ${data?.message?.content}`);
    });

    await test('send_message to locked group as non-admin emits error', async () => {
        // Lock the chat via REST first
        await patch(`/groups/${openGroupId}/chat`, { locked: true }, creatorToken);
        const errPromise = waitForEvent(memberSocket!, SocketEvents.ERROR);
        memberSocket!.emit(SocketEvents.SEND_MESSAGE, {
            group_id: openGroupId,
            content: 'Should be blocked',
        });
        const data = await errPromise as Record<string, string>;
        assert(data.message?.toLowerCase().includes('locked'), `Expected lock error, got: ${data.message}`);
        // Unlock for subsequent tests
        await patch(`/groups/${openGroupId}/chat`, { locked: false }, creatorToken);
    });

    await test('user_typing emits typing event to group room', async () => {
        const typingPromise = waitForEvent(memberSocket!, SocketEvents.TYPING);
        creatorSocket!.emit(SocketEvents.USER_TYPING, { group_id: openGroupId });
        const data = await typingPromise as Record<string, string>;
        assert(data.user_id === creatorId,    `user_id mismatch: ${data.user_id}`);
        assert(data.group_id === openGroupId, `group_id mismatch: ${data.group_id}`);
    });

    await test('heartbeat sets presence key in Redis', async () => {
        creatorSocket!.emit(SocketEvents.HEARTBEAT, {});
        // Retry up to 3 times in case of transient Redis blip
        let present = false;
        for (let i = 0; i < 3; i++) {
            await new Promise((r) => setTimeout(r, 400));
            const { data } = await get(`/test/presence/${creatorId}`);
            present = (data.data as Record<string, unknown>).present as boolean;
            if (present) break;
        }
        assert(present, `Expected presence key to be set after heartbeat`);
    });

    await test('dm_send via socket delivers dm_received to receiver', async () => {
        const dmPromise = waitForEvent(memberSocket!, SocketEvents.DM_RECEIVED);
        creatorSocket!.emit(SocketEvents.DM_SEND, {
            receiver_id: memberId,
            content: 'Socket DM hello',
        });
        const data = await dmPromise as { message: Record<string, unknown> };
        assert(data?.message?.content === 'Socket DM hello', `DM content mismatch: ${data?.message?.content}`);
    });

    await test('dm_send to user with no shared group emits error', async () => {
        // Register a lone user (no shared group) — use random suffix to avoid collisions across runs
        const { userId: loneSocketId } = await registerAndLogin(
            `lone_socket${ts}_${Math.random().toString(36).slice(2, 8)}@test.io`, 'Lone1234!', 'LoneSocket',
        );
        const errPromise = waitForEvent(creatorSocket!, SocketEvents.ERROR);
        creatorSocket!.emit(SocketEvents.DM_SEND, {
            receiver_id: loneSocketId,
            content: 'Should be rejected',
        });
        const data = await errPromise as Record<string, string>;
        assert(data.message?.toLowerCase().includes('group'), `Expected shared-group error, got: ${data.message}`);
    });

    await test('disconnect clears presence key from Redis', async () => {
        // Set presence for creator first
        creatorSocket!.emit(SocketEvents.HEARTBEAT, {});
        await new Promise((r) => setTimeout(r, 300));
        creatorSocket!.disconnect();
        memberSocket!.disconnect();
        await new Promise((r) => setTimeout(r, 500));
        const { data } = await get(`/test/presence/${creatorId}`);
        const present = (data.data as Record<string, unknown>).present as boolean;
        assert(!present, `Presence should be cleared after disconnect`);
    });

    // ── 16. Feed (Group Timeline) ─────────────────────────────────────────────

    section('16. Feed (Group Timeline)');

    // Re-login before feed tests — prior sections can push us past the 15-min JWT TTL
    await test('refresh tokens before feed tests', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL, password: CREATOR_PASS });
        const { data: md } = await post('/auth/login', { email: MEMBER_EMAIL,  password: MEMBER_PASS  });
        const { data: od } = await post('/auth/login', { email: OUTSIDER_EMAIL, password: OUTSIDER_PASS });
        const fc = ((cd.data as any)?.tokens as any)?.accessToken as string;
        const fm = ((md.data as any)?.tokens as any)?.accessToken as string;
        const fo = ((od.data as any)?.tokens as any)?.accessToken as string;
        assert(fc?.length > 0, 'Creator re-login failed');
        assert(fm?.length > 0, 'Member re-login failed');
        assert(fo?.length > 0, 'Outsider re-login failed');
        creatorToken  = fc;
        memberToken   = fm;
        outsiderToken = fo;
    });

    let feedPostId      = '';
    let publicPostId    = '';
    let feedCommentId   = '';
    let feedReplyId     = '';

    subsection('Post CRUD');

    await test('POST /test/seed-feed seeds 100 diverse posts', async () => {
        const { status, data } = await post('/test/seed-feed', { groupId: openGroupId, authorId: creatorId });
        assertStatus(status, 201);
        const d = data.data as Record<string, unknown>;
        assert(typeof d.count === 'number' && d.count > 0, `Expected count > 0, got ${d.count}`);
    });

    await test('POST /groups/:id/feed without auth returns 401', async () => {
        const { status } = await post(`/groups/${openGroupId}/feed`, { content: 'Hello world' });
        assertStatus(status, 401);
    });

    await test('POST /groups/:id/feed as non-member returns 403', async () => {
        const { status } = await post(`/groups/${openGroupId}/feed`, { content: 'Hello world' }, outsiderToken);
        assertStatus(status, 403);
    });

    await test('POST /groups/:id/feed with no content, link, or media returns 422', async () => {
        const { status } = await post(`/groups/${openGroupId}/feed`, {}, creatorToken);
        // Service throws UNPROCESSABLE_ENTITY (422)
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('POST /groups/:id/feed creates a text post (201)', async () => {
        const { status, data } = await post(
            `/groups/${openGroupId}/feed`,
            { content: 'My first feed post — integration test' },
            creatorToken,
        );
        assertStatus(status, 201);
        const post_ = data.data as Record<string, unknown>;
        assertHas(post_, 'id');
        assertHas(post_, 'content');
        assertHas(post_, 'author');
        assertHas(post_, 'reactions');
        assertHas(post_, '_count');
        assert(post_.isPublic === false, 'New post should default to private');
        assert(post_.isPinned === false, 'New post should default to unpinned');
        feedPostId = post_.id as string;
    });

    await test('POST /groups/:id/feed creates a link post (201)', async () => {
        const { status, data } = await post(
            `/groups/${openGroupId}/feed`,
            { content: 'Check out this resource', link_url: 'https://example.com' },
            memberToken,
        );
        assertStatus(status, 201);
        const post_ = data.data as Record<string, unknown>;
        assert(post_.linkUrl === 'https://example.com', `Expected linkUrl, got ${post_.linkUrl}`);
    });

    await test('POST /groups/:id/feed with HTTP link_url returns 422', async () => {
        const { status } = await post(
            `/groups/${openGroupId}/feed`,
            { content: 'Bad link', link_url: 'http://example.com' },
            creatorToken,
        );
        assertStatus(status, 422);
    });

    await test('GET /groups/:id/feed as member returns all posts including private (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/feed`, creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assertHas(d, 'pinned');
        assertHas(d, 'data');
        assertHas(d, 'has_more');
        const posts = d.data as unknown[];
        assert(posts.length > 0, 'Expected posts in feed');
    });

    await test('GET /groups/:id/feed without auth returns only public posts (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/feed`);
        assertStatus(status, 200);
        const d  = data.data as Record<string, unknown>;
        const all = [...(d.pinned as any[]), ...(d.data as any[])];
        assert(all.every((p: any) => p.isPublic === true), 'Non-member should only see public posts');
    });

    await test('GET /groups/:id/feed?limit=5 paginates correctly (200)', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/feed?limit=5`, creatorToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        const posts = d.data as unknown[];
        assert(posts.length <= 5, `Expected ≤5 posts, got ${posts.length}`);
        assert(d.has_more === true, 'Expected has_more=true with 100 seeded posts');
        assert(typeof d.next_cursor === 'string', 'Expected next_cursor string');
    });

    await test('GET /groups/:id/feed with cursor returns next page (200)', async () => {
        const first = await get(`/groups/${openGroupId}/feed?limit=5`, creatorToken);
        assertStatus(first.status, 200);
        const cursor = (first.data.data as any)?.next_cursor as string;
        assert(typeof cursor === 'string' && cursor.length > 0, 'Expected next_cursor on first page');
        const { status, data } = await get(`/groups/${openGroupId}/feed?limit=5&cursor=${cursor}`, creatorToken);
        assertStatus(status, 200);
        const secondPage = (data.data as any).data as any[];
        assert(secondPage.length > 0, 'Expected posts on second page');
    });

    await test('GET /feed/posts/:postId returns the post (200)', async () => {
        const { status, data } = await get(`/feed/posts/${feedPostId}`, creatorToken);
        assertStatus(status, 200);
        const p = data.data as Record<string, unknown>;
        assert(p.id === feedPostId, 'ID mismatch');
    });

    await test('GET /feed/posts/:postId without auth on private post returns 403', async () => {
        const { status } = await get(`/feed/posts/${feedPostId}`);
        assertStatus(status, 403);
    });

    await test('PATCH /feed/posts/:postId updates content (200)', async () => {
        const { status, data } = await patch(
            `/feed/posts/${feedPostId}`,
            { content: 'Updated feed post content' },
            creatorToken,
        );
        assertStatus(status, 200);
        const p = data.data as Record<string, unknown>;
        assert(p.content === 'Updated feed post content', `Content mismatch: ${p.content}`);
    });

    await test('PATCH /feed/posts/:postId by non-author returns 403', async () => {
        const { status } = await patch(
            `/feed/posts/${feedPostId}`,
            { content: 'Trying to hijack' },
            memberToken,
        );
        assertStatus(status, 403);
    });

    subsection('Visibility & Pin');

    await test('PATCH /feed/posts/:postId/visibility as non-admin returns 403', async () => {
        const { status } = await patch(`/feed/posts/${feedPostId}/visibility`, {}, memberToken);
        assertStatus(status, 403);
    });

    await test('PATCH /feed/posts/:postId/visibility as admin toggles to public (200)', async () => {
        const { status, data } = await patch(`/feed/posts/${feedPostId}/visibility`, {}, creatorToken);
        assertStatus(status, 200);
        const p = data.data as Record<string, unknown>;
        assert(p.isPublic === true, `Expected isPublic=true, got ${p.isPublic}`);
        publicPostId = p.id as string;
    });

    await test('GET /feed/posts/:postId on now-public post works without auth (200)', async () => {
        const { status } = await get(`/feed/posts/${publicPostId}`);
        assertStatus(status, 200);
    });

    await test('PATCH /feed/posts/:postId/pin as non-admin returns 403', async () => {
        const { status } = await patch(`/feed/posts/${feedPostId}/pin`, {}, memberToken);
        assertStatus(status, 403);
    });

    await test('PATCH /feed/posts/:postId/pin as admin pins post (200)', async () => {
        const { status, data } = await patch(`/feed/posts/${feedPostId}/pin`, {}, creatorToken);
        assertStatus(status, 200);
        const p = data.data as Record<string, unknown>;
        assert(p.isPinned === true, `Expected isPinned=true, got ${p.isPinned}`);
    });

    await test('GET /groups/:id/feed pinned array includes pinned post', async () => {
        const { status, data } = await get(`/groups/${openGroupId}/feed`, creatorToken);
        assertStatus(status, 200);
        const pinned = (data.data as any).pinned as any[];
        assert(pinned.some((p: any) => p.id === feedPostId), 'Pinned post missing from pinned array');
    });

    await test('PATCH /feed/posts/:postId/pin again unpins (toggle, 200)', async () => {
        const { status, data } = await patch(`/feed/posts/${feedPostId}/pin`, {}, creatorToken);
        assertStatus(status, 200);
        const p = data.data as Record<string, unknown>;
        assert(p.isPinned === false, `Expected isPinned=false after toggle, got ${p.isPinned}`);
    });

    subsection('Reactions');

    await test('POST /feed/posts/:postId/react without auth returns 401', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/react`, { emoji: '👍' });
        assertStatus(status, 401);
    });

    await test('POST /feed/posts/:postId/react as non-member returns 403', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/react`, { emoji: '👍' }, outsiderToken);
        assertStatus(status, 403);
    });

    await test('POST /feed/posts/:postId/react adds reaction (201)', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/react`, { emoji: '👍' }, creatorToken);
        assertStatus(status, 201);
    });

    await test('POST /feed/posts/:postId/react duplicate returns 409', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/react`, { emoji: '👍' }, creatorToken);
        assertStatus(status, 409);
    });

    await test('DELETE /feed/posts/:postId/react removes reaction (200)', async () => {
        const { status } = await del(`/feed/posts/${feedPostId}/react`, creatorToken, { emoji: '👍' });
        assertStatus(status, 200);
    });

    await test('DELETE /feed/posts/:postId/react non-existent returns 404', async () => {
        const { status } = await del(`/feed/posts/${feedPostId}/react`, creatorToken, { emoji: '🔥' });
        assertStatus(status, 404);
    });

    subsection('Comments');

    await test('POST /feed/posts/:postId/comments without auth returns 401', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/comments`, { content: 'Hi' });
        assertStatus(status, 401);
    });

    await test('POST /feed/posts/:postId/comments as non-member returns 403', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/comments`, { content: 'Hi' }, outsiderToken);
        assertStatus(status, 403);
    });

    await test('POST /feed/posts/:postId/comments adds comment (201)', async () => {
        const { status, data } = await post(
            `/feed/posts/${feedPostId}/comments`,
            { content: 'Great post! Really enjoyed reading this.' },
            memberToken,
        );
        assertStatus(status, 201);
        const c = data.data as Record<string, unknown>;
        assertHas(c, 'id');
        assertHas(c, 'content');
        assertHas(c, 'author');
        assert(c.parentId === null, `Expected top-level comment, got parentId=${c.parentId}`);
        feedCommentId = c.id as string;
    });

    await test('POST /feed/posts/:postId/comments with empty content returns 422', async () => {
        const { status } = await post(`/feed/posts/${feedPostId}/comments`, { content: '' }, memberToken);
        assertStatus(status, 422);
    });

    await test('POST /feed/posts/:postId/comments as a threaded reply (201)', async () => {
        const { status, data } = await post(
            `/feed/posts/${feedPostId}/comments`,
            { content: 'Replying to your comment!', parent_id: feedCommentId },
            creatorToken,
        );
        assertStatus(status, 201);
        const c = data.data as Record<string, unknown>;
        assert(c.parentId === feedCommentId, `Expected parentId=${feedCommentId}, got ${c.parentId}`);
        feedReplyId = c.id as string;
    });

    await test('POST /feed/posts/:postId/comments with wrong-post parent_id returns 404', async () => {
        const { status } = await post(
            `/feed/posts/${feedPostId}/comments`,
            { content: 'Bad reply', parent_id: '00000000-0000-0000-0000-000000000000' },
            creatorToken,
        );
        assertStatus(status, 404);
    });

    await test('GET /feed/posts/:postId/comments returns top-level comments only (200)', async () => {
        const { status, data } = await get(`/feed/posts/${feedPostId}/comments`, memberToken);
        assertStatus(status, 200);
        const comments = data.data as any[];
        assert(comments.length > 0, 'Expected at least one comment');
        assert(comments.every((c: any) => c.parentId === null), 'Expected top-level only');
        const c = comments.find((c: any) => c.id === feedCommentId);
        assert(c !== undefined, 'Top-level comment not found');
        assert(c._count.replies >= 1, 'Expected at least one reply counted');
    });

    await test('GET /feed/comments/:commentId/replies returns replies (200)', async () => {
        const { status, data } = await get(`/feed/comments/${feedCommentId}/replies`, memberToken);
        assertStatus(status, 200);
        const replies = data.data as any[];
        assert(replies.some((r: any) => r.id === feedReplyId), 'Reply not found in list');
    });

    await test('PATCH /feed/comments/:commentId updates content (200)', async () => {
        const { status, data } = await patch(
            `/feed/comments/${feedCommentId}`,
            { content: 'Edited comment text' },
            memberToken,
        );
        assertStatus(status, 200);
        const c = data.data as Record<string, unknown>;
        assert(c.content === 'Edited comment text', `Content mismatch: ${c.content}`);
    });

    await test('PATCH /feed/comments/:commentId by non-author returns 403', async () => {
        const { status } = await patch(`/feed/comments/${feedCommentId}`, { content: 'Hijack' }, creatorToken);
        assertStatus(status, 403);
    });

    await test('POST /feed/comments/:commentId/react adds reaction to comment (201)', async () => {
        const { status } = await post(`/feed/comments/${feedCommentId}/react`, { emoji: '❤️' }, creatorToken);
        assertStatus(status, 201);
    });

    await test('POST /feed/comments/:commentId/react duplicate returns 409', async () => {
        const { status } = await post(`/feed/comments/${feedCommentId}/react`, { emoji: '❤️' }, creatorToken);
        assertStatus(status, 409);
    });

    await test('DELETE /feed/comments/:commentId/react removes reaction (200)', async () => {
        const { status } = await del(`/feed/comments/${feedCommentId}/react`, creatorToken, { emoji: '❤️' });
        assertStatus(status, 200);
    });

    await test('DELETE /feed/comments/:commentId as non-author non-admin returns 403', async () => {
        const { status } = await del(`/feed/comments/${feedReplyId}`, outsiderToken);
        assertStatus(status, 403);
    });

    await test('DELETE /feed/comments/:commentId as admin soft-deletes (200)', async () => {
        const { status } = await del(`/feed/comments/${feedReplyId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('DELETE /feed/posts/:postId as non-author non-admin returns 403', async () => {
        const { status } = await del(`/feed/posts/${feedPostId}`, outsiderToken);
        assertStatus(status, 403);
    });

    await test('DELETE /feed/posts/:postId as admin soft-deletes (200)', async () => {
        // Create a fresh post from member, then admin deletes it
        const { data: pd } = await post(
            `/groups/${openGroupId}/feed`,
            { content: 'Admin will delete this' },
            memberToken,
        );
        const tempId = (pd.data as any).id as string;
        const { status } = await del(`/feed/posts/${tempId}`, creatorToken);
        assertStatus(status, 200);
    });

    await test('GET /feed/posts/:postId after deletion returns 404', async () => {
        // Create and immediately delete
        const { data: pd } = await post(
            `/groups/${openGroupId}/feed`,
            { content: 'Will be deleted' },
            creatorToken,
        );
        const tmpId = (pd.data as any).id as string;
        await del(`/feed/posts/${tmpId}`, creatorToken);
        const { status } = await get(`/feed/posts/${tmpId}`, creatorToken);
        assertStatus(status, 404);
    });

    // ── 17. Reference catalogues & onboarding ─────────────────────────────────

    section('17. Reference catalogues & onboarding');

    await test('GET /reference/onboarding works without a token', async () => {
        // These populate the signup form, which runs before the user has one.
        const { status, data } = await get('/reference/onboarding');
        assertStatus(status, 200);
        const d = data.data as Record<string, any>;
        assert(Array.isArray(d.interests), 'interests must be an array');
        assert(Array.isArray(d.states), 'states must be an array');
        assert(d.states.length === 37, `expected 36 states + FCT, got ${d.states.length}`);
    });

    await test('GET /reference/interests returns grouped multi-select options', async () => {
        const { status, data } = await get('/reference/interests');
        assertStatus(status, 200);
        const d = data.data as Record<string, any>;
        assert(d.interests.length > 0, 'catalogue should not be empty');
        assert(d.groups.length > 0, 'groups should not be empty');
        const first = d.interests[0];
        assert('value' in first && 'label' in first && 'group' in first, 'option shape is wrong');
    });

    await test('GET /reference/states lists cities per state', async () => {
        const { status, data } = await get('/reference/states');
        assertStatus(status, 200);
        const oyo = (data.data as Record<string, any>[]).find((st) => st.state === 'Oyo');
        assert(Boolean(oyo), 'Oyo missing from the catalogue');
        assert(oyo!.cities.includes('Ibadan'), 'Ibadan missing from Oyo');
    });

    let onboardEmail = `onboard${ts}@test.io`;
    let onboardToken = '';

    await test('POST /auth/register accepts city, state and interests', async () => {
        const { status } = await post('/auth/register', {
            email: onboardEmail,
            password: 'Onboard123!',
            display_name: 'Onboarded User',
            city: 'Ibadan',
            state: 'Oyo',
            interests: ['Running', 'BOOKS', 'running'],
        });
        assertStatus(status, 201);

        const otp = await getOtp('verify:email', onboardEmail);
        const verify = await post('/auth/verify-email', { email: onboardEmail, otp });
        assertStatus(verify.status, 200);
        onboardToken = ((verify.data.data as any).tokens as any).accessToken;
    });

    await test('the onboarding fields come back on GET /users/me', async () => {
        const { status, data } = await get('/users/me', onboardToken);
        assertStatus(status, 200);
        const d = data.data as Record<string, unknown>;
        assert(d.city === 'Ibadan', `city was ${d.city}`);
        assert(d.state === 'Oyo', `state was ${d.state}`);
    });

    await test('interests are lowercased and deduplicated on write', async () => {
        const { data } = await get('/users/me', onboardToken);
        const interests = (data.data as Record<string, any>).interests as string[];
        assert(interests.includes('running'), `expected "running" in ${JSON.stringify(interests)}`);
        assert(interests.includes('books'), `expected "books" in ${JSON.stringify(interests)}`);
        assert(
            interests.filter((i) => i === 'running').length === 1,
            '"Running" and "running" should collapse to a single tag',
        );
    });

    await test('phoneVerifiedAt is exposed to self so the client knows to prompt', async () => {
        const { data } = await get('/users/me', onboardToken);
        const d = data.data as Record<string, unknown>;
        assert('phoneVerifiedAt' in d, 'phoneVerifiedAt missing from /users/me');
        assert(d.phoneVerifiedAt === null, 'a fresh account must not be phone-verified');
    });

    // ── 18. Phone verification (tier 1) ───────────────────────────────────────

    section('18. Phone verification');

    let phoneUserId = '';
    let phoneToken  = '';

    await test('POST /auth/phone/send-otp with no number on file returns 400', async () => {
        const u = await registerAndLogin(`phoneotp${ts}@test.io`, 'PhoneOtp123!', 'Phone Tester');
        phoneUserId = u.userId;
        phoneToken  = u.token;
        const { status } = await post('/auth/phone/send-otp', {}, phoneToken);
        assertStatus(status, 400);
    });

    await test('POST /auth/phone/send-otp with a number stores it and sends a code', async () => {
        const { status } = await post(
            '/auth/phone/send-otp',
            { phone: `+23480${String(ts).slice(-8)}` },
            phoneToken,
        );
        assertStatus(status, 200);
    });

    await test('a second send inside the 60s cooldown returns 429', async () => {
        const { status } = await post('/auth/phone/send-otp', {}, phoneToken);
        assertStatus(status, 429);
    });

    await test('a wrong OTP is rejected with 400', async () => {
        const { status } = await post('/auth/phone/verify', { otp: '000000' }, phoneToken);
        assertStatus(status, 400);
    });

    await test('the correct OTP verifies the phone (200)', async () => {
        const otpRes = await get(`/test/phone-otp/${phoneUserId}`);
        assertStatus(otpRes.status, 200, 'the phone OTP should be in Redis');
        const otp = (otpRes.data.data as Record<string, unknown>).otp as string;

        const { status, data } = await post('/auth/phone/verify', { otp }, phoneToken);
        assertStatus(status, 200);
        assert((data.data as Record<string, unknown>).phoneVerified === true, 'phoneVerified should be true');
    });

    await test('/users/me now reports a phone verification timestamp', async () => {
        const { data } = await get('/users/me', phoneToken);
        assert((data.data as Record<string, unknown>).phoneVerifiedAt !== null, 'phoneVerifiedAt should be set');
    });

    await test('joining a group without a verified phone returns 403 (tier 1)', async () => {
        const u = await registerAndLogin(`nojoin${ts}@test.io`, 'NoJoin123!', 'No Phone Join');
        const { status } = await post(`/groups/${openGroupId}/join`, {}, u.token);
        assertStatus(status, 403);
    });

    // ── 19. Group description rules ───────────────────────────────────────────

    section('19. Group description rules');

    await test('a description under 40 characters is rejected', async () => {
        const { status } = await post(
            '/groups',
            { name: `Short ${ts}`, category: 'Community', description: 'Too short.' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('a description over 500 characters is rejected', async () => {
        const { status } = await post(
            '/groups',
            { name: `Long ${ts}`, category: 'Community', description: 'A'.repeat(501) },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('a whitespace-only description is rejected despite clearing the length floor', async () => {
        const { status } = await post(
            '/groups',
            { name: `Blank ${ts}`, category: 'Community', description: ' '.repeat(60) },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('a missing description is rejected on create', async () => {
        const { status } = await post(
            '/groups',
            { name: `NoDesc ${ts}`, category: 'Community' },
            creatorToken,
        );
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 20. Review queue & Explore visibility ─────────────────────────────────

    section('20. Review queue');

    let pendingGroupId   = '';
    let pendingGroupSlug = '';
    let pendingGroupName = '';
    let platformAdminToken = '';

    await test('a new group starts in review and is not published', async () => {
        await resetGroupQuota(creatorId);
        pendingGroupName = `Pending Club ${ts}`;
        const { status, data } = await post(
            '/groups',
            {
                name: pendingGroupName,
                category: 'Community',
                description: VALID_DESCRIPTION,
                cover_image_url: 'https://cdn.example.com/cover.jpg',
            },
            creatorToken,
        );
        assertStatus(status, 201);
        const g = data.data as Record<string, unknown>;
        pendingGroupId   = g.id   as string;
        pendingGroupSlug = g.slug as string;
        assert(g.reviewStatus === 'pending', `expected "pending", got "${g.reviewStatus}"`);
        assert(g.isPublished === false, 'a group awaiting review must not be published');
    });

    await test('the organiser is shown an "under review" publishing checklist', async () => {
        const { status, data } = await get(`/groups/${pendingGroupSlug}`, creatorToken);
        assertStatus(status, 200);
        const checklist = (data.data as Record<string, any>).publishingChecklist;
        assert(Boolean(checklist), 'publishingChecklist missing for the organiser');
        assert(checklist.reviewStatus === 'pending', 'checklist should report pending');
        assert(
            String(checklist.reviewMessage).includes('24 hours'),
            `expected the "usually within 24 hours" copy, got: ${checklist.reviewMessage}`,
        );
    });

    await test('a non-member does not receive the checklist', async () => {
        const { status, data } = await get(`/groups/${pendingGroupSlug}`, outsiderToken);
        assertStatus(status, 200);
        assert(
            (data.data as Record<string, unknown>).publishingChecklist === null,
            'the checklist is admin-only',
        );
    });

    await test('a pending group is hidden from Explore', async () => {
        const { status, data } = await get(`/groups?q=${encodeURIComponent(pendingGroupName)}`);
        assertStatus(status, 200);
        const found = (data.data as Record<string, unknown>[]).some((g) => g.id === pendingGroupId);
        assert(!found, 'a group awaiting review must not appear in Explore');
    });

    await test('its own members still find it in the list', async () => {
        const { status, data } = await get(
            `/groups?q=${encodeURIComponent(pendingGroupName)}`,
            creatorToken,
        );
        assertStatus(status, 200);
        const found = (data.data as Record<string, unknown>[]).some((g) => g.id === pendingGroupId);
        assert(found, 'the organiser should still see their own pending group');
    });

    await test('an approved group with no cover image stays out of Explore', async () => {
        await resetGroupQuota(creatorId);
        const name = `NoCover Club ${ts}`;
        const created = await post(
            '/groups',
            { name, category: 'Community', description: VALID_DESCRIPTION },
            creatorToken,
        );
        assertStatus(created.status, 201);
        const gid = (created.data.data as Record<string, unknown>).id as string;
        await approveGroup(gid);

        const { status, data } = await get(`/groups?q=${encodeURIComponent(name)}`);
        assertStatus(status, 200);
        const found = (data.data as Record<string, unknown>[]).some((g) => g.id === gid);
        assert(!found, 'no cover image means no Explore listing');
    });

    await test('GET /admin/groups/pending lists the queue with the creator\'s verification state', async () => {
        platformAdminToken = makeAdminToken(creatorId);
        const { status, data } = await get('/admin/groups/pending?limit=100', platformAdminToken);
        assertStatus(status, 200);
        const row = (data.data as Record<string, any>[]).find((g) => g.id === pendingGroupId);
        assert(Boolean(row), 'the pending group is not in the queue');
        assert('name' in row! && 'description' in row!, 'name/description missing');
        assert(Boolean(row!.creator), 'creator block missing');
        assert(row!.creator.phoneVerified === true, 'creator phone-verified flag should be true');
        assert(typeof row!.creator.groupsCreated === 'number', 'groupsCreated missing');
    });

    await test('rejecting without notes is refused — the organiser is shown them verbatim', async () => {
        const { status } = await patch(
            `/admin/groups/${pendingGroupId}/review`,
            { decision: 'reject' },
            platformAdminToken,
        );
        assertStatus(status, 400);
    });

    await test('approving a group with no cover is refused with 422', async () => {
        await resetGroupQuota(creatorId);
        const created = await post(
            '/groups',
            { name: `NoCover2 Club ${ts}`, category: 'Community', description: VALID_DESCRIPTION },
            creatorToken,
        );
        assertStatus(created.status, 201);
        const gid = (created.data.data as Record<string, unknown>).id as string;

        const { status } = await patch(
            `/admin/groups/${gid}/review`,
            { decision: 'approve' },
            platformAdminToken,
        );
        assertStatus(status, 422);
    });

    await test('approving records the reviewer and publishes the group', async () => {
        const { status, data } = await patch(
            `/admin/groups/${pendingGroupId}/review`,
            { decision: 'approve' },
            platformAdminToken,
        );
        assertStatus(status, 200);
        const g = data.data as Record<string, unknown>;
        assert(g.reviewStatus === 'approved', `got ${g.reviewStatus}`);
        assert(Boolean(g.reviewedAt), 'reviewedAt should be set');
    });

    await test('the approved group now appears in Explore', async () => {
        const { status, data } = await get(`/groups?q=${encodeURIComponent(pendingGroupName)}`);
        assertStatus(status, 200);
        const row = (data.data as Record<string, any>[]).find((g) => g.id === pendingGroupId);
        assert(Boolean(row), 'an approved group with a cover should be discoverable');
        assert(row!.isPublished === true, 'isPublished should be true');
    });

    // ── 21. Group creation quota ──────────────────────────────────────────────

    section('21. Group creation quota');

    await test('the 4th group inside the 7-day window is rejected with 429', async () => {
        const quotaUser = await registerAndLogin(`quota${ts}@test.io`, 'Quota123!', 'Quota User');
        await setPhoneVerified(quotaUser.userId);
        await setOrganiserBio(quotaUser.token);

        for (let i = 1; i <= 3; i++) {
            const res = await post(
                '/groups',
                {
                    name: `Quota ${i} ${ts}`,
                    category: 'Community',
                    description: VALID_DESCRIPTION,
                    cover_image_url: 'https://cdn.example.com/cover.jpg',
                },
                quotaUser.token,
            );
            assertStatus(res.status, 201, `group ${i} of 3 should be allowed`);
        }

        const fourth = await post(
            '/groups',
            {
                name: `Quota 4 ${ts}`,
                category: 'Community',
                description: VALID_DESCRIPTION,
                cover_image_url: 'https://cdn.example.com/cover.jpg',
            },
            quotaUser.token,
        );
        assertStatus(fourth.status, 429);
        assert(
            String(fourth.data.message).includes('3'),
            `the error should state the limit, got: ${fourth.data.message}`,
        );
    });

    await test('back-dating the earlier groups restores the allowance', async () => {
        // Proves the window is a rolling one rather than a lifetime cap.
        const quotaUser2 = await registerAndLogin(`quota2${ts}@test.io`, 'Quota123!', 'Quota User 2');
        await setPhoneVerified(quotaUser2.userId);
        await setOrganiserBio(quotaUser2.token);

        for (let i = 1; i <= 3; i++) {
            await post(
                '/groups',
                {
                    name: `Roll ${i} ${ts}`,
                    category: 'Community',
                    description: VALID_DESCRIPTION,
                    cover_image_url: 'https://cdn.example.com/cover.jpg',
                },
                quotaUser2.token,
            );
        }

        await resetGroupQuota(quotaUser2.userId);

        const next = await post(
            '/groups',
            {
                name: `Roll 4 ${ts}`,
                category: 'Community',
                description: VALID_DESCRIPTION,
                cover_image_url: 'https://cdn.example.com/cover.jpg',
            },
            quotaUser2.token,
        );
        assertStatus(next.status, 201);
    });

    // ── 22. "Active this month" ───────────────────────────────────────────────

    section('22. "Active this month"');

    await test('a group with an upcoming event is flagged active', async () => {
        // openGroupId has had several events created against it above.
        const { status, data } = await get(`/groups/${openGroupSlug}`);
        assertStatus(status, 200);
        const g = (data.data as Record<string, any>).group;
        assert(g.isActiveThisMonth === true, 'a group with a scheduled event should be active this month');
    });

    await test('a group with no events is not flagged active', async () => {
        await resetGroupQuota(creatorId);
        const created = await post(
            '/groups',
            {
                name: `Quiet Club ${ts}`,
                category: 'Community',
                description: VALID_DESCRIPTION,
                cover_image_url: 'https://cdn.example.com/cover.jpg',
            },
            creatorToken,
        );
        assertStatus(created.status, 201);
        const slug = (created.data.data as Record<string, unknown>).slug as string;

        const { status, data } = await get(`/groups/${slug}`);
        assertStatus(status, 200);
        const g = (data.data as Record<string, any>).group;
        assert(g.isActiveThisMonth === false, 'a group with no events must not be flagged active');
    });

    await test('the Explore listing computes the flag too', async () => {
        const { status, data } = await get(`/groups?q=${encodeURIComponent(`OpenGroup ${ts}`)}`);
        assertStatus(status, 200);
        const row = (data.data as Record<string, any>[]).find((g) => g.id === openGroupId);
        assert(Boolean(row), 'the open group was not found in Explore');
        assert(row!.isActiveThisMonth === true, 'the badge must be computed in the list query as well');
    });

    // ── 23. Group Deletion ────────────────────────────────────────────────────

    section('23. Group Deletion');

    // Re-login to get fresh tokens — the suite can exceed the 15-min JWT TTL
    await test('refresh tokens before deletion tests', async () => {
        const { data: cd } = await post('/auth/login', { email: CREATOR_EMAIL,  password: CREATOR_PASS  });
        const { data: od } = await post('/auth/login', { email: OUTSIDER_EMAIL, password: OUTSIDER_PASS });
        const freshCreator  = ((cd.data as any)?.tokens as any)?.accessToken as string;
        const freshOutsider = ((od.data as any)?.tokens as any)?.accessToken as string;
        assert(freshCreator?.length  > 0, `Creator re-login failed: ${JSON.stringify(cd)}`);
        assert(freshOutsider?.length > 0, `Outsider re-login failed: ${JSON.stringify(od)}`);
        creatorToken  = freshCreator;
        outsiderToken = freshOutsider;
    });

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

    // ── 24. Account Deletion ───────────────────────────────────────────────────

    section('24. Account Deletion');

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

function fmtDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min      = Math.floor(totalSec / 60);
    const sec      = totalSec % 60;
    const ms_      = ms % 1000;
    if (min > 0) return `${min}m ${sec}s`;
    if (sec > 0) return `${sec}.${String(ms_).padStart(3, '0').slice(0, 2)}s`;
    return `${ms}ms`;
}

async function run(): Promise<void> {
    const suiteStart = Date.now();

    await runAuthSuite();
    await runFeaturesSuite();

    const totalMs = Date.now() - suiteStart;
    const passed  = results.filter((r) => r.passed).length;
    const failed  = results.filter((r) => !r.passed).length;
    const total   = results.length;
    const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
    const avgMs   = Math.round(totalDuration / total);
    const rps     = (total / (totalMs / 1000)).toFixed(1);

    const W = 66;
    const bar = '═'.repeat(W);

    console.log(`\n${bar}`);
    console.log(`  Results: ${passed}/${total} passed  |  ${failed} failed`);
    console.log(bar);

    // ── Timing overview ──────────────────────────────────────────────────────
    console.log('\n  ⏱  Timing');
    console.log('  ' + '─'.repeat(30));
    console.log(`  Total wall time   ${fmtDuration(totalMs)}`);
    console.log(`  Total test time   ${fmtDuration(totalDuration)}`);
    console.log(`  Average per test  ${fmtDuration(avgMs)}`);
    console.log(`  Throughput        ${rps} tests/sec`);

    // ── Per-section breakdown ────────────────────────────────────────────────
    const sectionMap = new Map<string, { pass: number; fail: number; ms: number }>();
    for (const r of results) {
        const s = sectionMap.get(r.section) ?? { pass: 0, fail: 0, ms: 0 };
        s.pass += r.passed ? 1 : 0;
        s.fail += r.passed ? 0 : 1;
        s.ms   += r.durationMs;
        sectionMap.set(r.section, s);
    }

    console.log('\n  📋  Section breakdown');
    console.log('  ' + '─'.repeat(58));
    const colW = 38;
    for (const [name, s] of sectionMap) {
        const label   = name.length > colW ? name.slice(0, colW - 1) + '…' : name.padEnd(colW);
        const counts  = `${s.pass + s.fail}`.padStart(3);
        const pct     = `${Math.round((s.pass / (s.pass + s.fail)) * 100)}%`.padStart(4);
        const time    = fmtDuration(s.ms).padStart(8);
        const badge   = s.fail > 0 ? `✗ ${s.fail} failed` : '✓';
        console.log(`  ${label}  ${counts} tests  ${pct}  ${time}  ${badge}`);
    }

    // ── Slowest 5 tests ──────────────────────────────────────────────────────
    const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
    console.log('\n  🐢  Slowest tests');
    console.log('  ' + '─'.repeat(58));
    slowest.forEach((r, i) => {
        const label = r.name.length > colW ? r.name.slice(0, colW - 1) + '…' : r.name.padEnd(colW);
        console.log(`  ${i + 1}. ${label}  ${fmtDuration(r.durationMs)}`);
    });

    // ── Fastest 5 tests ──────────────────────────────────────────────────────
    const fastest = [...results].sort((a, b) => a.durationMs - b.durationMs).slice(0, 5);
    console.log('\n  ⚡  Fastest tests');
    console.log('  ' + '─'.repeat(58));
    fastest.forEach((r, i) => {
        const label = r.name.length > colW ? r.name.slice(0, colW - 1) + '…' : r.name.padEnd(colW);
        console.log(`  ${i + 1}. ${label}  ${fmtDuration(r.durationMs)}`);
    });

    // ── Failed tests ──────────────────────────────────────────────────────────
    if (failed > 0) {
        console.log('\n  ❌  Failed tests');
        console.log('  ' + '─'.repeat(58));
        results
            .filter((r) => !r.passed)
            .forEach((r) => {
                console.log(`  ✗  [${r.section}]  ${r.name}`);
                console.log(`       → ${r.error}`);
            });
    }

    console.log(`\n${bar}\n`);
}

run()
    .catch((err) => {
        console.error('\nFatal test runner error:', err);
        process.exitCode = 1;
    })
    .finally(() => {
        process.exit(results.some((r) => !r.passed) ? 1 : 0);
    });
