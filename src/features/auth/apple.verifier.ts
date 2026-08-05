import crypto, { type JsonWebKey } from 'crypto';
import jwt, { type JwtHeader } from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { config } from '../../shared/config/app.config';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // Apple rotates signing keys infrequently.

interface AppleJwk extends JsonWebKey {
    kid: string;
    alg: string;
}

export interface AppleIdentity {
    /** Stable per-user identifier — this is what goes in user_providers.provider_id. */
    providerId: string;
    email?: string;
    emailVerified: boolean;
}

let jwksCache: { keys: AppleJwk[]; fetchedAt: number } | null = null;

async function fetchAppleKeys(force = false): Promise<AppleJwk[]> {
    const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
    if (fresh && !force) return jwksCache!.keys;

    const response = await fetch(APPLE_JWKS_URL);
    if (!response.ok) {
        throw new Error(`Apple JWKS endpoint responded ${response.status}`);
    }

    const body = (await response.json()) as { keys: AppleJwk[] };
    jwksCache = { keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
}

/**
 * Resolves the signing key for a token. A cache miss on `kid` forces one refetch —
 * that is the normal path immediately after Apple rotates its signing keys, and
 * without the retry every sign-in would fail until the 24h TTL lapsed.
 */
async function resolveSigningKey(kid: string): Promise<crypto.KeyObject> {
    let key = (await fetchAppleKeys()).find((k) => k.kid === kid);

    if (!key) {
        key = (await fetchAppleKeys(true)).find((k) => k.kid === kid);
    }

    if (!key) {
        throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
    }

    return crypto.createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
}

/**
 * Verifies an Apple `id_token` against Apple's published JWKS.
 *
 * Signature, issuer, audience and expiry are all checked — an unverified decode would
 * let anyone mint an identity by hand-writing a JWT.
 */
export async function verifyAppleIdToken(idToken: string): Promise<AppleIdentity> {
    if (config.oauth.appleClientIds.length === 0) {
        throw new ApiError(
            'Apple Sign-In is not configured on this server (APPLE_CLIENT_ID is unset).',
            StatusCodes.NOT_IMPLEMENTED,
        );
    }

    const decoded = jwt.decode(idToken, { complete: true });
    const header = decoded?.header as JwtHeader | undefined;

    if (!header?.kid) {
        throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
    }

    try {
        const publicKey = await resolveSigningKey(header.kid);

        const payload = jwt.verify(idToken, publicKey, {
            algorithms: ['RS256'],
            issuer: APPLE_ISSUER,
            // jsonwebtoken types the multi-audience form as a non-empty tuple; the guard
            // at the top of this function is what makes that assertion safe.
            audience: config.oauth.appleClientIds as [string, ...string[]],
        }) as jwt.JwtPayload;

        if (!payload.sub) {
            throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
        }

        return {
            providerId: payload.sub,
            email: typeof payload.email === 'string' ? payload.email : undefined,
            // Apple sends this as the string "true" on some surfaces and a boolean on others.
            emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        };
    } catch (error: any) {
        if (error instanceof ApiError) throw error;
        if (error.name === 'TokenExpiredError') {
            throw new ApiError('This Apple sign-in token has expired. Please try again.', StatusCodes.UNAUTHORIZED);
        }
        if (error.name === 'JsonWebTokenError') {
            throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
        }
        asLogger.error('verifyAppleIdToken:', error);
        throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
    }
}
