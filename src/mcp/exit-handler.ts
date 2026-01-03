import { createLogger } from '../logger.js';
import type { SecurityContext } from '../types/security.js';
import type { SessionID } from '../types/session.js';

const logger = createLogger('mcp-exit-handler');

/**
 * Result of handling an exit_convo tool call
 */
export interface ExitConvoResult {
  /** Whether the exit was triggered */
  triggered: boolean;
  /** Reason provided by the NPC */
  reason: string;
  /** Whether this was forced by moderation */
  forcedByModeration: boolean;
  /** Session ID for the ended conversation */
  sessionId: SessionID;
  /** Whether a cooldown should be applied */
  applyCooldown: boolean;
  /** Cooldown duration in seconds (if applicable) */
  cooldownSeconds?: number;
}

/**
 * Exit convo tool arguments
 */
export interface ExitConvoArgs {
  reason: string;
}

/**
 * Default cooldown duration when exit is triggered by moderation
 */
const MODERATION_COOLDOWN_SECONDS = 300; // 5 minutes

/**
 * Handle the exit_convo tool call.
 *
 * This is the special security escape hatch that allows NPCs to end
 * conversations when the player crosses boundaries. The exit can be:
 * - Voluntarily triggered by the NPC (via LLM decision)
 * - Forced by the moderation system (exitRequested in security context)
 *
 * When triggered by moderation, a cooldown is applied to prevent
 * immediate reconnection.
 *
 * @param sessionId - The session ID being exited
 * @param args - Arguments from the tool call
 * @param securityContext - Current security context
 * @returns Exit result with details
 */
export function handleExitConvo(
  sessionId: SessionID,
  args: ExitConvoArgs,
  securityContext: SecurityContext
): ExitConvoResult {
  const reason = args.reason || 'Conversation ended';
  const forcedByModeration = securityContext.exitRequested;

  // Log the exit
  if (forcedByModeration) {
    logger.warn(
      {
        sessionId,
        reason,
        moderationFlags: securityContext.moderationFlags,
      },
      'Exit conversation triggered by moderation'
    );
  } else {
    logger.info({ sessionId, reason }, 'Exit conversation triggered by NPC');
  }

  const result: ExitConvoResult = {
    triggered: true,
    reason,
    forcedByModeration,
    sessionId,
    applyCooldown: forcedByModeration,
    cooldownSeconds: forcedByModeration ? MODERATION_COOLDOWN_SECONDS : undefined,
  };

  return result;
}

/**
 * Check if an exit_convo result indicates the session should end
 */
export function shouldEndSession(exitResult: ExitConvoResult): boolean {
  return exitResult.triggered;
}

/**
 * Format exit result for client response
 */
export function formatExitForClient(exitResult: ExitConvoResult): {
  conversation_ended: boolean;
  reason: string;
  cooldown_seconds?: number;
} {
  return {
    conversation_ended: exitResult.triggered,
    reason: exitResult.reason,
    cooldown_seconds: exitResult.cooldownSeconds,
  };
}

/**
 * In-memory cooldown tracker
 */
class CooldownTracker {
  private cooldowns: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired cooldowns every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this.cooldowns) {
        if (expiresAt <= now) {
          this.cooldowns.delete(key);
        }
      }
    }, 60000);
  }

  /**
   * Apply a cooldown for a player/NPC combination
   */
  applyCooldown(projectId: string, playerId: string, npcId: string, seconds: number): void {
    const key = this.makeKey(projectId, playerId, npcId);
    const expiresAt = Date.now() + seconds * 1000;
    this.cooldowns.set(key, expiresAt);
    logger.debug({ key, expiresAt, seconds }, 'Cooldown applied');
  }

  /**
   * Check if a cooldown is active
   */
  isOnCooldown(projectId: string, playerId: string, npcId: string): boolean {
    const key = this.makeKey(projectId, playerId, npcId);
    const expiresAt = this.cooldowns.get(key);

    if (!expiresAt) {
      return false;
    }

    if (expiresAt <= Date.now()) {
      this.cooldowns.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get remaining cooldown time in seconds
   */
  getRemainingCooldown(projectId: string, playerId: string, npcId: string): number {
    const key = this.makeKey(projectId, playerId, npcId);
    const expiresAt = this.cooldowns.get(key);

    if (!expiresAt) {
      return 0;
    }

    const remaining = Math.max(0, expiresAt - Date.now());
    return Math.ceil(remaining / 1000);
  }

  /**
   * Clear a cooldown early (e.g., after apology)
   */
  clearCooldown(projectId: string, playerId: string, npcId: string): boolean {
    const key = this.makeKey(projectId, playerId, npcId);
    return this.cooldowns.delete(key);
  }

  /**
   * Generate a unique key for the cooldown
   */
  private makeKey(projectId: string, playerId: string, npcId: string): string {
    return `${projectId}:${playerId}:${npcId}`;
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cooldowns.clear();
  }
}

// Singleton instance
export const cooldownTracker = new CooldownTracker();

/**
 * Process an exit_convo result and apply any necessary cooldowns
 */
export function processExitResult(
  exitResult: ExitConvoResult,
  projectId: string,
  playerId: string,
  npcId: string
): void {
  if (exitResult.applyCooldown && exitResult.cooldownSeconds) {
    cooldownTracker.applyCooldown(
      projectId,
      playerId,
      npcId,
      exitResult.cooldownSeconds
    );
  }
}

/**
 * Check if a conversation can be started (not on cooldown)
 */
export function canStartConversation(
  projectId: string,
  playerId: string,
  npcId: string
): { allowed: boolean; remainingSeconds?: number } {
  if (cooldownTracker.isOnCooldown(projectId, playerId, npcId)) {
    const remaining = cooldownTracker.getRemainingCooldown(projectId, playerId, npcId);
    return { allowed: false, remainingSeconds: remaining };
  }
  return { allowed: true };
}
