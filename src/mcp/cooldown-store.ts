/**
 * Cooldown store interface
 *
 * This abstraction allows cooldown state (from exit_convo moderation triggers)
 * to be backed by different storage implementations for horizontal scaling.
 *
 * The default implementation is in-memory (see InMemoryCooldownStore below).
 * To use an external store (e.g., Redis):
 *
 * 1. Implement this interface with your store client
 * 2. Pass your implementation to CooldownTracker constructor
 * 3. Ensure the store is shared across all server instances
 *
 * Example Redis implementation:
 *
 * ```typescript
 * class RedisCooldownStore implements CooldownStore {
 *   constructor(private client: Redis) {}
 *
 *   async get(key: string): Promise<number | null> {
 *     const expiresAt = await this.client.get(key);
 *     return expiresAt ? parseInt(expiresAt, 10) : null;
 *   }
 *
 *   async set(key: string, expiresAt: number): Promise<void> {
 *     const ttl = Math.ceil((expiresAt - Date.now()) / 1000);
 *     await this.client.set(key, expiresAt.toString(), 'EX', ttl);
 *   }
 *
 *   async delete(key: string): Promise<void> {
 *     await this.client.del(key);
 *   }
 * }
 * ```
 */

export interface CooldownStore {
  /**
   * Get the expiration timestamp for a cooldown
   * Returns null if no cooldown exists or it has expired
   */
  get(key: string): Promise<number | null> | number | null;

  /**
   * Store a cooldown with expiration timestamp
   */
  set(key: string, expiresAt: number): Promise<void> | void;

  /**
   * Delete a cooldown
   */
  delete(key: string): Promise<void> | void;

  /**
   * Clean up expired cooldowns (optional, for optimization)
   */
  cleanup?(): Promise<void> | void;

  /**
   * Clear all cooldowns (optional, for testing)
   */
  clear?(): Promise<void> | void;
}

/**
 * Default in-memory cooldown store
 *
 * Simple Map-based implementation. State is lost on restart
 * and not shared across multiple server instances.
 */
export class InMemoryCooldownStore implements CooldownStore {
  private store: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean up every minute
  }

  get(key: string): number | null {
    const expiresAt = this.store.get(key);
    if (!expiresAt) {
      return null;
    }

    // Return null if expired
    if (expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return expiresAt;
  }

  set(key: string, expiresAt: number): void {
    this.store.set(key, expiresAt);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.store.entries()) {
      if (expiresAt <= now) {
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
