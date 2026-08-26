/**
 * Local/dev-only sign-in.
 *
 * Lets the dashboard show a real signed-in identity (name, email, a stable
 * per-email userId for project ownership) while running locally, without
 * ever contacting Supabase. Every entry point is hard-gated on
 * `NODE_ENV !== 'production'`, re-checked at issuance AND verification, so a
 * dev token can never authenticate anything once the server actually runs in
 * production — even if it were mounted or leaked by mistake.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getConfig } from '../config.js';

const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — local convenience, not a security boundary

// Used only when ENCRYPTION_KEY isn't set locally. Inert in production: this
// entire module refuses to issue or verify anything once isDevLoginEnabled()
// is false, which is always true in a real production environment.
const DEV_FALLBACK_SECRET = 'soulengine-dev-auth-local-only';

export interface DevTokenPayload {
  userId: string;
  email: string;
  name: string;
  iat: number;
}

/** True only outside a real production environment. Re-evaluated on every call — never cached. */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function getSigningKey(): Buffer {
  const secret = getConfig().encryptionKey || DEV_FALLBACK_SECRET;
  // Namespaced hash so this key is never reused for the actual secrets-at-rest encryption key.
  return createHash('sha256').update(`${secret}|dev-auth-token`).digest();
}

/** Prefix on every dev-issued userId. Used by the storage layer to force local storage for dev users. */
export const DEV_USER_ID_PREFIX = 'dev_';

/** Stable, deterministic userId for a given email — same email always maps to the same project owner. */
export function deriveDevUserId(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return `${DEV_USER_ID_PREFIX}${hash}`;
}

/**
 * True for any userId issued by the local dev sign-in flow. The storage
 * layer uses this to force local file storage for dev users even when
 * Supabase is configured — a dev identity must never depend on Supabase
 * being reachable.
 */
export function isDevUserId(userId?: string | null): boolean {
  return !!userId && userId.startsWith(DEV_USER_ID_PREFIX);
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * Issue a signed local dev session token for the given email/name.
 * Returns null when dev login isn't enabled (i.e. in production).
 */
export function issueDevToken(email: string, name: string): string | null {
  if (!isDevLoginEnabled()) return null;

  const payload: DevTokenPayload = {
    userId: deriveDevUserId(email),
    email: email.trim().toLowerCase(),
    name: name.trim() || email.split('@')[0],
    iat: Date.now(),
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', getSigningKey()).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a local dev session token. Returns the payload on success, or null
 * if dev login is disabled, the token is malformed/tampered, or expired.
 */
export function verifyDevToken(token: string): DevTokenPayload | null {
  if (!isDevLoginEnabled()) return null;
  if (!token || typeof token !== 'string') return null;

  const separatorIndex = token.lastIndexOf('.');
  if (separatorIndex <= 0) return null;

  const payloadB64 = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  const expectedSignature = createHmac('sha256', getSigningKey()).update(payloadB64).digest('hex');

  const signatureBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  let payload: DevTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return null;
  }

  if (!payload.userId || !payload.email || typeof payload.iat !== 'number') return null;
  if (Date.now() - payload.iat > TOKEN_MAX_AGE_MS) return null;

  return payload;
}
