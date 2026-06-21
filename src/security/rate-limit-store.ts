/**
 * Rate limit store interface
 *
 * This abstraction allows rate limit state to be backed by different storage
 * implementations (in-memory, Redis, etc.) for horizontal scaling and persistence.
 *
 * The default implementation is in-memory (see InMemoryRateLimitStore below).
 * To use an external store (e.g., Redis):
 *
 * 1. Implement this interface with your store client
 * 2. Pass your implementation to RateLimiter constructor
 * 3. Ensure the store is shared across all server instances
 *
 * Example Redis implementation:
 *
 * ```typescript
 * class RedisRateLimitStore implements RateLimitStore {
 *   constructor(private client: Redis) {}
 *
 *   async get(key: string): Promise<RateLimitEntry | null> {
 *     const data = await this.client.get(key);
 *     return data ? JSON.parse(data) : null;
 *   }
 *
 *   async set(key: string, entry: RateLimitEntry): Promise<void> {
 *     const ttl = Math.ceil((entry.resetAt - Date.now()) / 1000);
 *     await this.client.set(key, JSON.stringify(entry), 'EX', ttl);
 *   }
 *
 *   async delete(key: string): Promise<void> {
 *     await this.client.del(key);
 *   }
 * }
 * ```
 */

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Get a rate limit entry by key
   * Returns null if not found or expired
   */
  get(key: string): Promise<RateLimitEntry | null> | RateLimitEntry | null;

  /**
   * Store or update a rate limit entry
   */
  set(key: string, entry: RateLimitEntry): Promise<void> | void;

  /**
   * Delete a rate limit entry
   */
  delete(key: string): Promise<void> | void;

  /**
   * Clean up expired entries (optional, for optimization)
   */
  cleanup?(): Promise<void> | void;

  /**
   * Clear all entries (optional, for testing)
   */
  clear?(): Promise<void> | void;
}

/**
 * Default in-memory rate limit store
 *
 * Simple Map-based implementation. State is lost on restart
 * and not shared across multiple server instances.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean up every minute
  }

  get(key: string): RateLimitEntry | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    // Return null if expired
    if (entry.resetAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}
