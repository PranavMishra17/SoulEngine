/**
 * In-process session event bus.
 *
 * Routes game events (tool_call, npc_follow_up, mind_activity, mood_change)
 * from pipeline callbacks to SSE stream subscribers without coupling the
 * pipeline to the HTTP layer.
 *
 * Each session has zero or more subscriber callbacks. Subscribers are
 * automatically removed when they call the returned unsubscribe function.
 */

import type { GameEvent } from '../http/events.js';

type Subscriber = (event: GameEvent) => void;

class SessionEventBus {
  private readonly listeners = new Map<string, Set<Subscriber>>();

  /**
   * Subscribe to events for a given session.
   *
   * @param sessionId  The session to listen on
   * @param cb         Called with each event published for that session
   * @returns          An unsubscribe function — call it when the SSE stream closes
   */
  subscribe(sessionId: string, cb: Subscriber): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(cb);

    return () => {
      const set = this.listeners.get(sessionId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) {
          this.listeners.delete(sessionId);
        }
      }
    };
  }

  /**
   * Publish an event to all subscribers of a session.
   *
   * No-op if there are no subscribers.
   *
   * @param sessionId  Target session
   * @param event      The game event to broadcast
   */
  publish(sessionId: string, event: GameEvent): void {
    const set = this.listeners.get(sessionId);
    if (!set || set.size === 0) return;

    for (const cb of set) {
      try {
        cb(event);
      } catch {
        // Individual subscriber errors must not affect other subscribers
      }
    }
  }

  /**
   * Remove all subscribers for a session (called when a session ends).
   */
  removeSession(sessionId: string): void {
    this.listeners.delete(sessionId);
  }
}

/**
 * Singleton event bus instance shared by the whole process.
 */
export const sessionEventBus = new SessionEventBus();
