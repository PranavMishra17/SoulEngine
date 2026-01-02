import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('rate-limiter');

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (entry.resetAt <= now) {
          this.store.delete(key);
        }
      }
    }, 60000);
  }

  public checkLimit(projectId: string, playerId: string, npcId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const config = getConfig();
    const limit = config.security.rateLimitPerMinute;
    const key = `${projectId}:${playerId}:${npcId}`;
    const now = Date.now();
    const windowMs = 60000;

    const entry = this.store.get(key);

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

    entry.count += 1;
    return {
      allowed: true,
      remaining: limit - entry.count,
      resetAt: entry.resetAt,
    };
  }

  public reset(projectId: string, playerId: string, npcId: string): void {
    const key = `${projectId}:${playerId}:${npcId}`;
    this.store.delete(key);
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

export const rateLimiter = new RateLimiter();

