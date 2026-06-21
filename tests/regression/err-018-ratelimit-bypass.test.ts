import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rateLimiter } from '../../src/security/rate-limiter.js';

describe('ERR-018: rate limit bypass via player_id rotation', () => {
  beforeEach(() => {
    // Clear the rate limiter state before each test
    rateLimiter.destroy();
  });

  afterEach(() => {
    // Also clean up after each test
    rateLimiter.destroy();
  });

  it('prevents bypass by rotating player_id when principal is the same', () => {
    const projectId = 'proj-123';
    const npcId = 'npc-456';
    const principal = 'authenticated-user-789'; // The trusted principal (e.g., user ID, API key, IP)

    // Default config limit is 10 per minute
    const expectedLimit = 10;

    // Make requests with the same principal but different player_ids
    const result1 = rateLimiter.checkLimit(projectId, 'player-A', npcId, principal);
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(expectedLimit - 1);

    const result2 = rateLimiter.checkLimit(projectId, 'player-B', npcId, principal);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(expectedLimit - 2);

    const result3 = rateLimiter.checkLimit(projectId, 'player-C', npcId, principal);
    expect(result3.allowed).toBe(true);
    expect(result3.remaining).toBe(expectedLimit - 3);

    // Exhaust the remaining limit
    for (let i = 4; i <= expectedLimit; i++) {
      rateLimiter.checkLimit(projectId, `player-${i}`, npcId, principal);
    }

    // Next request with yet another player_id should be blocked
    // because the principal is the same and limit is exhausted
    const resultExceeded = rateLimiter.checkLimit(projectId, 'player-overflow', npcId, principal);
    expect(resultExceeded.allowed).toBe(false);
    expect(resultExceeded.remaining).toBe(0);
  });

  it('allows different principals to have separate rate limit buckets', () => {
    const projectId = 'proj-123';
    const npcId = 'npc-456';
    const principal1 = 'user-AAA';
    const principal2 = 'user-BBB';
    const expectedLimit = 10;

    // Each principal should get their own bucket
    const result1a = rateLimiter.checkLimit(projectId, 'player-1', npcId, principal1);
    expect(result1a.allowed).toBe(true);

    const result2a = rateLimiter.checkLimit(projectId, 'player-2', npcId, principal2);
    expect(result2a.allowed).toBe(true);

    // Fill up principal1's bucket completely
    for (let i = 2; i <= expectedLimit; i++) {
      rateLimiter.checkLimit(projectId, `player-${i}`, npcId, principal1);
    }

    // Next request for principal1 should be blocked
    const result1b = rateLimiter.checkLimit(projectId, 'player-overflow', npcId, principal1);
    expect(result1b.allowed).toBe(false);

    // principal2 should still be allowed (separate bucket)
    const result2b = rateLimiter.checkLimit(projectId, 'player-2', npcId, principal2);
    expect(result2b.allowed).toBe(true);
  });

  it('maintains backward compatibility when no principal is provided', () => {
    const projectId = 'proj-123';
    const playerId = 'player-456';
    const npcId = 'npc-789';

    // When no principal is provided, should fall back to old behavior
    // (keying on playerId for backward compat)
    const result1 = rateLimiter.checkLimit(projectId, playerId, npcId);
    expect(result1.allowed).toBe(true);

    const result2 = rateLimiter.checkLimit(projectId, playerId, npcId);
    expect(result2.allowed).toBe(true);
  });

  it('reset() clears the bucket for a given principal', () => {
    const projectId = 'proj-123';
    const playerId = 'player-456';
    const npcId = 'npc-789';
    const principal = 'user-AAA';
    const expectedLimit = 10;

    // Fill up the bucket completely
    for (let i = 1; i <= expectedLimit; i++) {
      rateLimiter.checkLimit(projectId, playerId, npcId, principal);
    }

    // Next request should be blocked
    const beforeReset = rateLimiter.checkLimit(projectId, playerId, npcId, principal);
    expect(beforeReset.allowed).toBe(false);

    // Reset should accept principal parameter
    rateLimiter.reset(projectId, playerId, npcId, principal);

    // After reset, should be allowed again
    const afterReset = rateLimiter.checkLimit(projectId, playerId, npcId, principal);
    expect(afterReset.allowed).toBe(true);
  });
});
