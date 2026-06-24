/**
 * Server-to-client game event envelope.
 *
 * This is the single source of truth for all named events emitted from the
 * server to game clients — both over the voice WebSocket and over SSE for text
 * clients.
 *
 * Event envelope shape:
 *   {
 *     type: GameEventTypeLiteral,
 *     ts:   string,   // ISO-8601 UTC timestamp
 *     payload: object // per-type payload, see GameEventPayloads
 *   }
 *
 * The enum and builder are kept pure (no I/O) so they can be used in unit tests
 * without a live server.
 */

/**
 * Stable set of event type literals emitted by the server.
 * Do NOT rename or remove existing values — they are part of the public API.
 * Add new values at the bottom.
 */
export const GameEventType = {
  /** A game-event tool was invoked by the NPC (e.g. lock_door, grant_item). */
  TOOL_CALL: 'tool_call',
  /** The NPC emitted a follow-up speech turn after an MCP tool action. */
  NPC_FOLLOW_UP: 'npc_follow_up',
  /** The Mind agent completed — reports tools called this turn. */
  MIND_ACTIVITY: 'mind_activity',
  /** The NPC's mood changed during a turn. */
  MOOD_CHANGE: 'mood_change',
} as const;

export type GameEventTypeLiteral = (typeof GameEventType)[keyof typeof GameEventType];

// ---------------------------------------------------------------------------
// Per-type payload shapes
// ---------------------------------------------------------------------------

export interface ToolCallPayload {
  name: string;
  args: Record<string, unknown>;
}

export interface NpcFollowUpPayload {
  text: string;
}

export interface MindActivityPayload {
  tools_called: Array<{
    name: string;
    args: Record<string, unknown>;
    status: 'success' | 'error';
  }>;
  duration_ms: number;
  completed: boolean;
}

export interface MoodChangePayload {
  valence: number;
  arousal: number;
  dominance: number;
}

/**
 * Map from event type literal to payload type.
 * Extending this map automatically propagates through buildGameEvent.
 */
export interface GameEventPayloads {
  tool_call: ToolCallPayload;
  npc_follow_up: NpcFollowUpPayload;
  mind_activity: MindActivityPayload;
  mood_change: MoodChangePayload;
}

/**
 * The versioned game event envelope.
 */
export interface GameEvent<T extends GameEventTypeLiteral = GameEventTypeLiteral> {
  /** Stable event type identifier. */
  type: T;
  /** ISO-8601 UTC timestamp of when the event was built. */
  ts: string;
  /** Event-specific payload. */
  payload: GameEventPayloads[T];
}

/**
 * Build a well-formed game event envelope.
 *
 * This is a pure function — safe to call anywhere without side effects.
 *
 * @param type    One of the GameEventType literals
 * @param payload Event-specific payload object
 * @returns       A GameEvent envelope ready for serialization and transmission
 */
export function buildGameEvent<T extends GameEventTypeLiteral>(
  type: T,
  payload: GameEventPayloads[T]
): GameEvent<T> {
  return {
    type,
    ts: new Date().toISOString(),
    payload,
  };
}
