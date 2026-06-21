/**
 * Trusted principal resolution for rate limiting and cooldown keying.
 *
 * Rate limits and cooldowns must key on a signal that the caller cannot rotate.
 * Client-supplied player_id is untrusted: an adversary can bypass per-minute
 * limits simply by sending a new player_id on each request.
 *
 * Resolution priority (highest trust first):
 *   1. Authenticated user ID  — set by JWT middleware; cannot be spoofed
 *   2. Hashed game-client API key — validated at session start; stable per client
 *   3. Request IP address     — from x-forwarded-for or direct connection
 *   4. player_id (last resort) — returned only when no stronger signal is present
 */

/**
 * Input signals used to determine the rate-limit principal.
 *
 * All fields are optional; pass every signal you have and the helper
 * picks the most trustworthy non-empty one.
 */
export interface PrincipalInput {
  /** Authenticated user ID from JWT (null/undefined/empty = not authenticated). */
  userId?: string | null;
  /**
   * SHA-256 hex hash of the game-client API key (validated at session start).
   * Pass undefined/empty if no game-client key was presented.
   */
  gameKeyHash?: string;
  /**
   * Client IP address (e.g. from x-forwarded-for or the TCP connection).
   * Pass undefined if unavailable.
   */
  ip?: string;
  /**
   * Client-supplied player ID.
   * Used ONLY as a last resort when no other signal is present.
   */
  playerId: string;
}

/**
 * Resolve the most-trusted principal for rate limiting.
 *
 * Returns a prefixed string to avoid key collisions across tiers:
 *   "user:<id>"    for authenticated users
 *   "key:<hash>"   for game-client API key holders
 *   "ip:<address>" for anonymous callers with a known IP
 *   "player:<id>"  when no stronger signal is available (least preferred)
 *
 * The function never returns the raw player_id when a stronger signal exists.
 */
export function resolveRateLimitPrincipal(input: PrincipalInput): string {
  const { userId, gameKeyHash, ip, playerId } = input;

  // Tier 1: authenticated user (highest trust)
  if (userId && userId.length > 0) {
    return `user:${userId}`;
  }

  // Tier 2: hashed game-client API key (validated at session start)
  if (gameKeyHash && gameKeyHash.length > 0) {
    return `key:${gameKeyHash}`;
  }

  // Tier 3: request IP address
  if (ip && ip.length > 0) {
    return `ip:${ip}`;
  }

  // Tier 4: client-supplied player ID (last resort, lowest trust)
  return `player:${playerId}`;
}
