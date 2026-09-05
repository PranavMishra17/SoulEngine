/**
 * Broker token mint and verify using HMAC-SHA256
 *
 * Tokens are signed with a server secret and carry: token ID, project ID, scopes, and expiry.
 * Verification is constant-time to prevent timing attacks.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('broker-token');

const DEFAULT_TTL_SECONDS = 900; // 15 minutes
const MAX_TTL_SECONDS = 3600; // 1 hour

export interface BrokerTokenPayload {
  jti: string; // Token ID
  projectId: string;
  scopes: string[];
  iat: number; // Issued at (Unix timestamp)
  exp: number; // Expires at (Unix timestamp)
}

export interface MintTokenOptions {
  projectId: string;
  scopes: string[];
  ttlSeconds?: number;
}

export interface VerifyTokenResult {
  valid: boolean;
  payload?: BrokerTokenPayload;
  error?: string;
}

/**
 * Get the HMAC signing key from config
 * Falls back to ENCRYPTION_KEY if BROKER_TOKEN_SECRET is not set
 */
function getSigningKey(): string {
  const config = getConfig();
  const key = process.env.BROKER_TOKEN_SECRET || config.encryptionKey;
  if (!key) {
    throw new Error('BROKER_TOKEN_SECRET or ENCRYPTION_KEY must be set');
  }
  return key;
}

/**
 * Mint a new broker token
 *
 * @param options Token options (project, scopes, TTL)
 * @returns Base64url-encoded signed token
 */
export function mintBrokerToken(options: MintTokenOptions): string {
  const { projectId, scopes, ttlSeconds } = options;

  // Cap TTL at max, default to 15 minutes
  const effectiveTtl = Math.min(ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);

  const now = Math.floor(Date.now() / 1000);
  const payload: BrokerTokenPayload = {
    jti: randomBytes(16).toString('hex'),
    projectId,
    scopes,
    iat: now,
    exp: now + effectiveTtl,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url');

  const signingKey = getSigningKey();
  const signature = createHmac('sha256', signingKey).update(payloadB64).digest('base64url');

  const token = `${payloadB64}.${signature}`;

  logger.debug(
    { projectId, scopes, ttl: effectiveTtl, jti: payload.jti },
    'Broker token minted'
  );

  return token;
}

/**
 * Verify a broker token
 *
 * @param token Base64url-encoded signed token
 * @param requiredScopes Optional list of required scopes
 * @returns Verification result with payload if valid
 */
export function verifyBrokerToken(
  token: string,
  requiredScopes?: string[]
): VerifyTokenResult {
  try {
    // Split token into payload and signature
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [payloadB64, signatureB64] = parts;

    // Verify signature (constant-time)
    const signingKey = getSigningKey();
    const expectedSignature = createHmac('sha256', signingKey)
      .update(payloadB64)
      .digest('base64url');

    const providedSig = Buffer.from(signatureB64, 'utf-8');
    const expectedSig = Buffer.from(expectedSignature, 'utf-8');

    if (providedSig.length !== expectedSig.length) {
      return { valid: false, error: 'Invalid signature' };
    }

    if (!timingSafeEqual(providedSig, expectedSig)) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as BrokerTokenPayload;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return { valid: false, error: 'Token expired' };
    }

    // Check required scopes
    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) => payload.scopes.includes(scope));
      if (!hasAllScopes) {
        return {
          valid: false,
          error: `Missing required scope(s): ${requiredScopes.filter((s) => !payload.scopes.includes(s)).join(', ')}`,
        };
      }
    }

    return { valid: true, payload };
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'Unknown' }, 'Token verification failed');
    return { valid: false, error: 'Token verification failed' };
  }
}
