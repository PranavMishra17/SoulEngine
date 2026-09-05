/**
 * Unit tests for broker token mint/verify
 *
 * Tests HMAC-SHA256 signing, expiry, scope validation, and TTL constraints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Broker token mint and verify', () => {
  beforeEach(() => {
    // Reset time mocking
    vi.useRealTimers();
    // Set encryption key for token signing (32+ chars)
    process.env.ENCRYPTION_KEY = 'test-encryption-key-min-32-chars-long-secret';
    process.env.BROKER_TOKEN_SECRET = 'test-broker-signing-secret-min-32-chars-long';
  });

  it('round-trips successfully (mint → verify)', async () => {
    const { mintBrokerToken, verifyBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['llm'],
      ttlSeconds: 900,
    });

    const verified = verifyBrokerToken(token, ['llm']);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.projectId).toBe('test-project');
    expect(verified.payload?.scopes).toContain('llm');
    expect(verified.payload?.jti).toBeTruthy();
  });

  it('rejects tampered signature', async () => {
    const { mintBrokerToken, verifyBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['llm'],
      ttlSeconds: 900,
    });

    // Tamper with the token (flip a character)
    const tampered = token.slice(0, -5) + 'XXXXX';

    const verified = verifyBrokerToken(tampered, ['llm']);
    expect(verified.valid).toBe(false);
    expect(verified.error).toMatch(/invalid|signature|tamper/i);
  });

  it('rejects expired token', async () => {
    const { mintBrokerToken, verifyBrokerToken } = await import('../../src/broker/token.js');

    // Use fake timers
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['llm'],
      ttlSeconds: 60, // 1 minute
    });

    // Advance time past expiry
    vi.setSystemTime(now + 61 * 1000);

    const verified = verifyBrokerToken(token, ['llm']);
    expect(verified.valid).toBe(false);
    expect(verified.error).toMatch(/expired/i);
  });

  it('rejects token missing required scope', async () => {
    const { mintBrokerToken, verifyBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['stt'], // mint with stt scope
      ttlSeconds: 900,
    });

    const verified = verifyBrokerToken(token, ['llm']); // require llm scope
    expect(verified.valid).toBe(false);
    expect(verified.error).toMatch(/scope/i);
  });

  it('accepts token with superset of scopes', async () => {
    const { mintBrokerToken, verifyBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['llm', 'stt', 'tts'],
      ttlSeconds: 900,
    });

    const verified = verifyBrokerToken(token, ['llm']);
    expect(verified.valid).toBe(true);
  });

  it('caps TTL at 1 hour', async () => {
    const { mintBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['llm'],
      ttlSeconds: 7200, // 2 hours requested
    });

    // Decode the token to check actual expiry
    const parts = token.split('.');
    expect(parts.length).toBe(2); // payload.signature
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));

    const actualTtl = payload.exp - payload.iat;
    expect(actualTtl).toBeLessThanOrEqual(3600); // max 1 hour
  });

  it('defaults to 15 minutes TTL', async () => {
    const { mintBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({
      projectId: 'test-project',
      scopes: ['llm'],
      // ttlSeconds omitted
    });

    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));

    const actualTtl = payload.exp - payload.iat;
    expect(actualTtl).toBe(900); // 15 minutes
  });

  it('verifyBrokerToken fails closed on malformed token', async () => {
    const { verifyBrokerToken } = await import('../../src/broker/token.js');

    const verified = verifyBrokerToken('not-a-valid-token', ['llm']);
    expect(verified.valid).toBe(false);
    expect(verified.error).toBeTruthy();
  });

  it('verifyBrokerToken is constant-time (no early return on length mismatch)', async () => {
    const { verifyBrokerToken } = await import('../../src/broker/token.js');

    // This is a smoke test - proper timing analysis requires instrumentation
    // Just verify that short and long invalid tokens both fail without throwing
    const short = verifyBrokerToken('x', ['llm']);
    const long = verifyBrokerToken('x'.repeat(1000), ['llm']);

    expect(short.valid).toBe(false);
    expect(long.valid).toBe(false);
  });
});
