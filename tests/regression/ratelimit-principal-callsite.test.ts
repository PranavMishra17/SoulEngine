import { describe, it, expect } from 'vitest';
import { resolveRateLimitPrincipal } from '../../src/security/principal.js';

describe('resolveRateLimitPrincipal', () => {
  it('returns the authenticated userId when present, ignoring weaker signals', () => {
    const principal = resolveRateLimitPrincipal({
      userId: 'user-abc-123',
      gameKeyHash: 'hash-of-game-key',
      ip: '1.2.3.4',
      playerId: 'client-supplied-player',
    });
    expect(principal).toBe('user:user-abc-123');
  });

  it('returns the userId even when gameKeyHash and ip are missing', () => {
    const principal = resolveRateLimitPrincipal({
      userId: 'user-xyz',
      gameKeyHash: undefined,
      ip: undefined,
      playerId: 'client-player',
    });
    expect(principal).toBe('user:user-xyz');
  });

  it('falls back to gameKeyHash when userId is absent', () => {
    const principal = resolveRateLimitPrincipal({
      userId: null,
      gameKeyHash: 'a1b2c3d4',
      ip: '10.0.0.1',
      playerId: 'client-player',
    });
    expect(principal).toBe('key:a1b2c3d4');
  });

  it('uses gameKeyHash over IP when both are present and userId is absent', () => {
    const principal = resolveRateLimitPrincipal({
      userId: undefined,
      gameKeyHash: 'deadbeef',
      ip: '192.168.1.1',
      playerId: 'player-x',
    });
    expect(principal).toBe('key:deadbeef');
  });

  it('falls back to IP when userId and gameKeyHash are absent', () => {
    const principal = resolveRateLimitPrincipal({
      userId: null,
      gameKeyHash: undefined,
      ip: '203.0.113.42',
      playerId: 'player-y',
    });
    expect(principal).toBe('ip:203.0.113.42');
  });

  it('never returns the bare playerId when any stronger signal exists', () => {
    // userId present — must not return playerId
    expect(
      resolveRateLimitPrincipal({ userId: 'u1', gameKeyHash: undefined, ip: undefined, playerId: 'p1' })
    ).not.toBe('p1');

    // gameKeyHash present — must not return playerId
    expect(
      resolveRateLimitPrincipal({ userId: null, gameKeyHash: 'hash', ip: undefined, playerId: 'p1' })
    ).not.toBe('p1');

    // ip present — must not return playerId
    expect(
      resolveRateLimitPrincipal({ userId: null, gameKeyHash: undefined, ip: '1.2.3.4', playerId: 'p1' })
    ).not.toBe('p1');
  });

  it('falls back to playerId only when all stronger signals are absent', () => {
    const principal = resolveRateLimitPrincipal({
      userId: null,
      gameKeyHash: undefined,
      ip: undefined,
      playerId: 'last-resort-player',
    });
    expect(principal).toBe('player:last-resort-player');
  });

  it('treats empty string userId as absent and falls through to gameKeyHash', () => {
    const principal = resolveRateLimitPrincipal({
      userId: '',
      gameKeyHash: 'key-hash',
      ip: undefined,
      playerId: 'p',
    });
    expect(principal).toBe('key:key-hash');
  });

  it('treats empty string gameKeyHash as absent and falls through to ip', () => {
    const principal = resolveRateLimitPrincipal({
      userId: null,
      gameKeyHash: '',
      ip: '5.6.7.8',
      playerId: 'p',
    });
    expect(principal).toBe('ip:5.6.7.8');
  });
});
