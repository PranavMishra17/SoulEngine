import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import type { SessionID, SessionState } from '../types/session.js';
import type { CoreAnchor } from '../types/npc.js';

const logger = createLogger('session-store');

/**
 * Extended session data including cached original anchor
 */
export interface StoredSession {
  state: SessionState;
  originalAnchor: CoreAnchor;
  createdAt: number;
  lastActivity: number;
}

/**
 * Session store statistics
 */
export interface SessionStoreStats {
  totalSessions: number;
  sessionsByProject: Record<string, number>;
  oldestSessionAge: number | null;
}

/**
 * In-memory session store
 */
class SessionStore {
  private sessions: Map<SessionID, StoredSession> = new Map();
  private projectSessionCounts: Map<string, number> = new Map();

  /**
   * Create a new session in the store
   */
  create(sessionId: SessionID, state: SessionState, originalAnchor: CoreAnchor): void {
    const now = Date.now();

    const stored: StoredSession = {
      state,
      originalAnchor,
      createdAt: now,
      lastActivity: now,
    };

    this.sessions.set(sessionId, stored);

    // Update project session count
    const projectId = state.project_id;
    const currentCount = this.projectSessionCounts.get(projectId) ?? 0;
    this.projectSessionCounts.set(projectId, currentCount + 1);

    logger.debug(
      {
        sessionId,
        projectId,
        instanceId: state.instance.id,
        projectSessionCount: currentCount + 1,
      },
      'Session created in store'
    );
  }

  /**
   * Get a session by ID
   */
  get(sessionId: SessionID): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session state by ID (convenience method)
   */
  getState(sessionId: SessionID): SessionState | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  /**
   * Get the original anchor for a session
   */
  getOriginalAnchor(sessionId: SessionID): CoreAnchor | undefined {
    return this.sessions.get(sessionId)?.originalAnchor;
  }

  /**
   * Update a session's state
   */
  update(sessionId: SessionID, state: SessionState): boolean {
    const stored = this.sessions.get(sessionId);
    if (!stored) {
      logger.warn({ sessionId }, 'Attempted to update non-existent session');
      return false;
    }

    stored.state = state;
    stored.lastActivity = Date.now();

    logger.debug({ sessionId }, 'Session state updated');
    return true;
  }

  /**
   * Touch a session to update its last activity time
   */
  touch(sessionId: SessionID): boolean {
    const stored = this.sessions.get(sessionId);
    if (!stored) {
      return false;
    }

    stored.lastActivity = Date.now();
    return true;
  }

  /**
   * Delete a session from the store
   */
  delete(sessionId: SessionID): boolean {
    const stored = this.sessions.get(sessionId);
    if (!stored) {
      logger.warn({ sessionId }, 'Attempted to delete non-existent session');
      return false;
    }

    const projectId = stored.state.project_id;

    // Remove from main store
    this.sessions.delete(sessionId);

    // Update project session count
    const currentCount = this.projectSessionCounts.get(projectId) ?? 0;
    if (currentCount > 1) {
      this.projectSessionCounts.set(projectId, currentCount - 1);
    } else {
      this.projectSessionCounts.delete(projectId);
    }

    logger.debug(
      {
        sessionId,
        projectId,
        projectSessionCount: Math.max(0, currentCount - 1),
      },
      'Session deleted from store'
    );

    return true;
  }

  /**
   * Check if a session exists
   */
  has(sessionId: SessionID): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get the count of active sessions for a project
   */
  getProjectSessionCount(projectId: string): number {
    return this.projectSessionCounts.get(projectId) ?? 0;
  }

  /**
   * Get total session count
   */
  getTotalSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if a project can accept new sessions (within limits)
   */
  canAcceptSession(projectId: string): boolean {
    const config = getConfig();
    const currentCount = this.getProjectSessionCount(projectId);
    return currentCount < config.limits.maxConcurrentSessions;
  }

  /**
   * Get all session IDs
   */
  getAllSessionIds(): SessionID[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get all sessions for a project
   */
  getProjectSessions(projectId: string): StoredSession[] {
    const results: StoredSession[] = [];
    for (const stored of this.sessions.values()) {
      if (stored.state.project_id === projectId) {
        results.push(stored);
      }
    }
    return results;
  }

  /**
   * Find sessions that have exceeded the timeout
   */
  findTimedOutSessions(timeoutMs?: number): SessionID[] {
    const config = getConfig();
    const timeout = timeoutMs ?? config.sessionTimeoutMs;
    const now = Date.now();
    const timedOut: SessionID[] = [];

    for (const [sessionId, stored] of this.sessions) {
      if (now - stored.lastActivity > timeout) {
        timedOut.push(sessionId);
      }
    }

    return timedOut;
  }

  /**
   * Get store statistics
   */
  getStats(): SessionStoreStats {
    const now = Date.now();
    let oldestAge: number | null = null;

    for (const stored of this.sessions.values()) {
      const age = now - stored.createdAt;
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      totalSessions: this.sessions.size,
      sessionsByProject: Object.fromEntries(this.projectSessionCounts),
      oldestSessionAge: oldestAge,
    };
  }

  /**
   * Clear all sessions (mainly for testing)
   */
  clear(): void {
    this.sessions.clear();
    this.projectSessionCounts.clear();
    logger.info('Session store cleared');
  }
}

// Singleton instance
export const sessionStore = new SessionStore();

// Export class for testing
export { SessionStore };
