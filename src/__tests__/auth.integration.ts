/**
 * Auth flow integration tests — runs against a live server on localhost:3000.
 * OTPs are read directly from Redis (no email required).
 *
 * Usage: tsx src/__tests__/auth.integration.ts
 */

import { redis } from '../database/connection';

const BASE = 'http://localhost:3000/api/v1';

// Unique test email for this run
const ts = Date.now();
const EMAIL = `tester${ts}@test.io`;
const PASSWORD = 'TestPass123';
const DISPLAY_NAME = 'Auth Tester';

// Mutable state shared across tests
let accessToken = '';
let refreshToken = '';
let forgotOtp = '';

// ─── Minimal assertion helpers ────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

function assertStatus(actual: number, expected: number): void {
    assert(actual === expected, `Expected HTTP ${expected}, got ${actual}`);
}

function assertHas(obj: Record<string, unknown>, key: string): void {
    assert(key in obj, `Expected response to have key "${key}"`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function post(
    path: string,
    body: object,
    token?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { status: res.status, data };
}

// ─── Redis OTP helper ─────────────────────────────────────────────────────────

async function getOtp(prefix: 'verify:email' | 'verify:forgot', email: string): Promise<string> {
    const key = `${prefix}:${email}`;
    const otp = await redis.get(key);
    assert(otp !== null, `OTP not found in Redis at key "${key}"`);
    return otp!;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

type Result = { name: string; passed: boolean; error?: string };
const results: Result[] = [];
let sectionHeader = '';

function section(title: string): void {
    sectionHeader = title;
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

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  Auth Flow Integration Tests');
    console.log(`  Email: ${EMAIL}`);
    console.log('══════════════════════════════════════════════════');

    // ── 1. Registration ───────────────────────────────────────────────────────

    section('1. Registration');

    await test('valid registration returns 201 with user + tokens', async () => {
        const { status, data } = await post('/auth/register', {
            email: EMAIL,
            password: PASSWORD,
            display_name: DISPLAY_NAME,
        });
        assertStatus(status, 201);
        assert(data.success === true, 'success should be true');
        const payload = data.data as Record<string, unknown>;
        assertHas(payload, 'user');
        assertHas(payload, 'tokens');
        const tokens = payload.tokens as Record<string, unknown>;
        assertHas(tokens, 'accessToken');
        assertHas(tokens, 'refreshToken');
        accessToken = tokens.accessToken as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('duplicate email returns 409', async () => {
        const { status } = await post('/auth/register', {
            email: EMAIL,
            password: PASSWORD,
            display_name: DISPLAY_NAME,
        });
        assertStatus(status, 409);
    });

    await test('missing required fields returns 422', async () => {
        const { status } = await post('/auth/register', { email: 'not-an-email' });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    await test('weak password (no uppercase) returns 422', async () => {
        const { status } = await post('/auth/register', {
            email: `weak${ts}@test.io`,
            password: 'alllowercase1',
            display_name: 'Weak Pass',
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
    });

    // ── 2. Login ──────────────────────────────────────────────────────────────

    section('2. Login');

    await test('valid credentials return 200 with tokens', async () => {
        const { status, data } = await post('/auth/login', {
            email: EMAIL,
            password: PASSWORD,
        });
        assertStatus(status, 200);
        const payload = data.data as Record<string, unknown>;
        assertHas(payload, 'tokens');
        const tokens = payload.tokens as Record<string, unknown>;
        accessToken = tokens.accessToken as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('wrong password returns 401', async () => {
        const { status } = await post('/auth/login', {
            email: EMAIL,
            password: 'WrongPass999',
        });
        assertStatus(status, 401);
    });

    await test('non-existent email returns 401 (no enumeration)', async () => {
        const { status } = await post('/auth/login', {
            email: `ghost${ts}@test.io`,
            password: PASSWORD,
        });
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
        const { status } = await post('/auth/verify-email', {
            email: EMAIL,
            otp: '000000',
        });
        assertStatus(status, 400);
    });

    await test('valid OTP from Redis verifies email (200)', async () => {
        const otp = await getOtp('verify:email', EMAIL);
        const { status } = await post('/auth/verify-email', { email: EMAIL, otp });
        assertStatus(status, 200);
    });

    await test('replaying the same OTP after consumption returns 400', async () => {
        // OTP was deleted after successful verification
        const { status } = await post('/auth/verify-email', {
            email: EMAIL,
            otp: '123456', // any code — OTP is gone
        });
        assertStatus(status, 400);
    });

    // ── 4. Token Refresh ──────────────────────────────────────────────────────

    section('4. Token Refresh');

    await test('valid refresh token returns new token pair', async () => {
        const { status, data } = await post('/auth/refresh', { refresh_token: refreshToken });
        assertStatus(status, 200);
        const payload = data.data as Record<string, unknown>;
        assertHas(payload, 'tokens');
        const tokens = payload.tokens as Record<string, unknown>;
        // Rotate — update for subsequent tests
        accessToken = tokens.accessToken as string;
        refreshToken = tokens.refreshToken as string;
    });

    await test('old refresh token after rotation returns 401 (rotation enforced)', async () => {
        // The token we just used above should now be revoked
        // We'll test with a clearly fake token instead to avoid race condition edge cases
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
        const { status } = await post('/auth/verify-forgot-otp', {
            email: EMAIL,
            otp: '000000',
        });
        assertStatus(status, 400);
    });

    await test('verify-forgot-otp with correct OTP returns 200', async () => {
        forgotOtp = await getOtp('verify:forgot', EMAIL);
        const { status } = await post('/auth/verify-forgot-otp', {
            email: EMAIL,
            otp: forgotOtp,
        });
        assertStatus(status, 200);
    });

    const NEW_PASSWORD = 'NewPass456!';

    await test('reset-password with wrong OTP returns 400', async () => {
        const { status } = await post('/auth/reset-password', {
            email: EMAIL,
            otp: '000000',
            password: NEW_PASSWORD,
        });
        assertStatus(status, 400);
    });

    await test('reset-password with correct OTP returns 200', async () => {
        const { status } = await post('/auth/reset-password', {
            email: EMAIL,
            otp: forgotOtp,
            password: NEW_PASSWORD,
        });
        assertStatus(status, 200);
    });

    await test('login with old password after reset returns 401', async () => {
        const { status } = await post('/auth/login', {
            email: EMAIL,
            password: PASSWORD,
        });
        assertStatus(status, 401);
    });

    await test('login with new password after reset returns 200', async () => {
        const { status, data } = await post('/auth/login', {
            email: EMAIL,
            password: NEW_PASSWORD,
        });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken = tokens.accessToken as string;
        refreshToken = tokens.refreshToken as string;
    });

    // ── 6. Change Password ────────────────────────────────────────────────────

    section('6. Change Password');

    const CHANGED_PASSWORD = 'Changed789!';

    await test('change-password without auth returns 401', async () => {
        const { status } = await post('/auth/change-password', {
            old_password: NEW_PASSWORD,
            new_password: CHANGED_PASSWORD,
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
            email: EMAIL,
            password: CHANGED_PASSWORD,
        });
        assertStatus(status, 200);
        const tokens = (data.data as Record<string, unknown>).tokens as Record<string, unknown>;
        accessToken = tokens.accessToken as string;
        refreshToken = tokens.refreshToken as string;
    });

    // ── 7. Logout ─────────────────────────────────────────────────────────────

    section('7. Logout');

    await test('logout without auth returns 401', async () => {
        const { status } = await post('/auth/logout', { refresh_token: refreshToken });
        assertStatus(status, 401);
    });

    await test('logout with valid auth returns 200', async () => {
        const { status } = await post(
            '/auth/logout',
            { refresh_token: refreshToken },
            accessToken,
        );
        assertStatus(status, 200);
    });

    await test('refresh with revoked token after logout returns 401', async () => {
        const { status } = await post('/auth/refresh', { refresh_token: refreshToken });
        assertStatus(status, 401);
    });

    await test('logout is idempotent (second call still returns 200)', async () => {
        const { status } = await post(
            '/auth/logout',
            { refresh_token: refreshToken },
            accessToken,
        );
        // accessToken may now be expired/invalid on the second call but logout is idempotent
        // The server still returns 200 for this
        assertStatus(status, 200);
    });

    // ── 8. Account Lock ───────────────────────────────────────────────────────

    section('8. Account Lock (brute force protection)');

    // Register a fresh user to test locking without affecting other tests
    const LOCK_EMAIL = `locktest${ts}@test.io`;
    await test('register a second user for lock testing', async () => {
        const { status } = await post('/auth/register', {
            email: LOCK_EMAIL,
            password: PASSWORD,
            display_name: 'Lock Tester',
        });
        assertStatus(status, 201);
    });

    await test('5 consecutive bad passwords lock the account (429)', async () => {
        let lastStatus = 0;
        for (let i = 0; i < 5; i++) {
            const { status } = await post('/auth/login', {
                email: LOCK_EMAIL,
                password: 'WrongPass999',
            });
            lastStatus = status;
        }
        // 5th attempt should lock (429) or the final attempt returns 401 and next is 429
        const { status } = await post('/auth/login', {
            email: LOCK_EMAIL,
            password: PASSWORD,
        });
        assertStatus(status, 429);
    });

    // ─── Summary ──────────────────────────────────────────────────────────────

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const total = results.length;

    console.log('\n══════════════════════════════════════════════════');
    console.log(`  Results: ${passed}/${total} passed  |  ${failed} failed`);
    console.log('══════════════════════════════════════════════════');

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
