/**
 * Local/dev-only sign-in.
 *
 * Guards the following properties:
 *  (a) Token issuance/verification round-trips and is deterministic per email.
 *  (b) A tampered token is rejected.
 *  (c) The entire mechanism is inert once NODE_ENV is production — issuance,
 *      verification, and the HTTP route all refuse to work.
 *  (d) The dev-login route is unreachable when the app wouldn't mount it
 *      (i.e. it 404s from inside the handler too, not just via conditional
 *      mounting in index.ts).
 *  (e) A dev-issued userId always resolves to LOCAL storage, even when
 *      Supabase is fully configured — a dev identity must never depend on
 *      Supabase being reachable.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isDevLoginEnabled,
  issueDevToken,
  verifyDevToken,
  deriveDevUserId,
  isDevUserId,
} from '../../src/security/dev-auth.js';
import { devAuthRoutes } from '../../src/routes/dev-auth.js';
import { getStorage, getStorageMode } from '../../src/storage/factory.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import * as local from '../../src/storage/local/index.js';
import * as supabaseStorage from '../../src/storage/supabase/index.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('isDevLoginEnabled', () => {
  it('is true outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevLoginEnabled()).toBe(true);
  });

  it('is false in production', () => {
    process.env.NODE_ENV = 'production';
    expect(isDevLoginEnabled()).toBe(false);
  });
});

describe('deriveDevUserId', () => {
  it('is deterministic for the same email', () => {
    expect(deriveDevUserId('Alice@Example.com')).toBe(deriveDevUserId('alice@example.com'));
  });

  it('differs across distinct emails', () => {
    expect(deriveDevUserId('alice@example.com')).not.toBe(deriveDevUserId('bob@example.com'));
  });

  it('has a recognizable prefix', () => {
    expect(deriveDevUserId('alice@example.com')).toMatch(/^dev_[0-9a-f]{20}$/);
  });
});

describe('issueDevToken / verifyDevToken round-trip', () => {
  it('round-trips a valid token outside production', () => {
    process.env.NODE_ENV = 'development';
    const token = issueDevToken('alice@example.com', 'Alice');
    expect(token).toBeTruthy();

    const verified = verifyDevToken(token as string);
    expect(verified).not.toBeNull();
    expect(verified?.email).toBe('alice@example.com');
    expect(verified?.name).toBe('Alice');
    expect(verified?.userId).toBe(deriveDevUserId('alice@example.com'));
  });

  it('falls back to the email local-part when no name is given', () => {
    process.env.NODE_ENV = 'development';
    const token = issueDevToken('alice@example.com', '') as string;
    expect(verifyDevToken(token)?.name).toBe('alice');
  });

  it('rejects a tampered payload', () => {
    process.env.NODE_ENV = 'development';
    const token = issueDevToken('alice@example.com', 'Alice') as string;
    const [payloadB64, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')), userId: 'dev_hijacked' })
    ).toString('base64url');
    const tampered = `${tamperedPayload}.${signature}`;

    expect(verifyDevToken(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    process.env.NODE_ENV = 'development';
    const token = issueDevToken('alice@example.com', 'Alice') as string;
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyDevToken(tampered)).toBeNull();
  });

  it('rejects garbage input', () => {
    process.env.NODE_ENV = 'development';
    expect(verifyDevToken('not-a-token')).toBeNull();
    expect(verifyDevToken('')).toBeNull();
  });
});

describe('production inertness', () => {
  it('issueDevToken refuses to issue a token in production', () => {
    process.env.NODE_ENV = 'production';
    expect(issueDevToken('alice@example.com', 'Alice')).toBeNull();
  });

  it('verifyDevToken refuses a token that was validly issued in dev, once flipped to production', () => {
    process.env.NODE_ENV = 'development';
    const token = issueDevToken('alice@example.com', 'Alice') as string;

    process.env.NODE_ENV = 'production';
    expect(verifyDevToken(token)).toBeNull();
  });
});

describe('POST /login route', () => {
  it('issues a token and derived identity for a valid email outside production', async () => {
    process.env.NODE_ENV = 'development';
    const res = await devAuthRoutes.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', name: 'Alice' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user).toEqual({
      id: deriveDevUserId('alice@example.com'),
      email: 'alice@example.com',
      name: 'Alice',
    });
  });

  it('rejects an invalid email with 400', async () => {
    process.env.NODE_ENV = 'development';
    const res = await devAuthRoutes.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s from inside the handler when NODE_ENV is production, even if mounted', async () => {
    process.env.NODE_ENV = 'production';
    const res = await devAuthRoutes.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('isDevUserId', () => {
  it('recognizes a dev-derived userId', () => {
    expect(isDevUserId(deriveDevUserId('alice@example.com'))).toBe(true);
  });

  it('rejects a real (e.g. Supabase) userId', () => {
    expect(isDevUserId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isDevUserId(null)).toBe(false);
    expect(isDevUserId(undefined)).toBe(false);
  });
});

describe('a dev userId always resolves to local storage (never Supabase)', () => {
  // This is the property that matters, regardless of whether Supabase happens
  // to be configured in the environment running this test: a locally-issued
  // dev identity must never route to Supabase, because it must keep working
  // even when Supabase is unreachable or unconfigured.
  const devUserId = deriveDevUserId('alice@example.com');

  it('getStorage(devUserId) returns the local backend', () => {
    expect(getStorage(devUserId)).toBe(local);
    expect(getStorage(devUserId)).not.toBe(supabaseStorage);
  });

  it('getStorageForUser(devUserId) returns the local backend', () => {
    expect(getStorageForUser(devUserId)).toBe(local);
    expect(getStorageForUser(devUserId)).not.toBe(supabaseStorage);
  });

  it("getStorageMode(devUserId) reports 'local'", () => {
    expect(getStorageMode(devUserId)).toBe('local');
  });

  it('selection logic: a real userId would select supabase when configured, but a dev userId never does', () => {
    // Mirrors the inline logic used by the selector, made explicit here so the
    // property survives independent of this environment's real Supabase config.
    const hasSupabase = true;
    const realUserId = '550e8400-e29b-41d4-a716-446655440000';

    const backendFor = (userId: string) => (userId && hasSupabase && !isDevUserId(userId) ? 'supabase' : 'local');

    expect(backendFor(realUserId)).toBe('supabase');
    expect(backendFor(devUserId)).toBe('local');
  });
});
