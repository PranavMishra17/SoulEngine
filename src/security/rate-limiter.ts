import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';
import type { RateLimitStore, RateLimitEntry } from './rate-limit-store.js';
import { InMemoryRateLimitStore } from './rate-limit-store.js';

const logger = createLogger('rate-limiter');

/**
 * Rate limiter with principal-based keying
 *
 * Keys rate limits on a trusted principal (authenticated user ID, API key, IP address)
 * rather than client-supplied player_id, preventing bypass via player_id rotation.
 *
 * The principal parameter is optional for backward compatibility. When not provided,
 * falls back to keying on playerId (less secure, but maintains existing behavior).
 *
 * State is stored via RateLimitStore interface, allowing external/shared storage
 * (e.g., Redis) to be plugged in for horizontal scaling.
 */
class RateLimiter {
  private store: RateLimitStore;

  constructor(store?: RateLimitStore) {
    this.store = store || new InMemoryRateLimitStore();
  }

  /**
   * Check if a request is allowed under rate limits
   *
   * Note: This is synchronous and assumes a synchronous store.
   * The store interface allows Promise returns for flexibility, but
   * this implementation requires a synchronous store (like InMemoryRateLimitStore).
   * For async stores (e.g., Redis), wrap this class or use an async version.
   *
   * @param projectId - The project making the request
   * @param playerId - Client-supplied player ID (untrusted)
   * @param npcId - The NPC being conversed with
   * @param principal - OPTIONAL: Trusted principal (user ID, API key, IP). If provided,
   *                    rate limit is keyed on this instead of playerId, preventing bypass.
   *                    If omitted, falls back to playerId for backward compatibility.
   * @returns Rate limit status
   */
  public checkLimit(
    projectId: string,
    playerId: string,
    npcId: string,
    principal?: string
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const config = getConfig();
    const limit = config.security.rateLimitPerMinute;
    const key = this.makeKey(projectId, playerId, npcId, principal);
    const now = Date.now();
    const windowMs = 60000;

    const entry = this.store.get(key) as RateLimitEntry | null;

    if (!entry || entry.resetAt <= now) {
      this.store.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: now + windowMs,
      };
    }

    if (entry.count >= limit) {
      logger.warn({ key, count: entry.count, limit }, 'Rate limit exceeded');
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    // Increment and persist the updated count
    const updatedEntry = {
      count: entry.count + 1,
      resetAt: entry.resetAt,
    };
    this.store.set(key, updatedEntry);

    return {
      allowed: true,
      remaining: limit - updatedEntry.count,
      resetAt: updatedEntry.resetAt,
    };
  }

  /**
   * Reset rate limit for a specific principal
   *
   * @param projectId - The project
   * @param playerId - Client-supplied player ID
   * @param npcId - The NPC
   * @param principal - OPTIONAL: The principal to reset. Should match what was passed to checkLimit.
   */
  public reset(projectId: string, playerId: string, npcId: string, principal?: string): void {
    const key = this.makeKey(projectId, playerId, npcId, principal);
    this.store.delete(key);
  }

  /**
   * Generate rate limit key
   *
   * If principal is provided, key on it (secure).
   * If not, fall back to playerId (backward compat, less secure).
   */
  private makeKey(projectId: string, playerId: string, npcId: string, principal?: string): string {
    const keyPart = principal || playerId;
    return `${projectId}:${keyPart}:${npcId}`;
  }

  public destroy(): void {
    if (this.store instanceof InMemoryRateLimitStore) {
      this.store.destroy();
      // Reinitialize with a fresh store after destroy
      this.store = new InMemoryRateLimitStore();
    } else if (this.store.clear) {
      this.store.clear();
    }
  }
}

export const rateLimiter = new RateLimiter();

