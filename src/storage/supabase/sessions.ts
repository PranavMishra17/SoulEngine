import { createLogger } from '../../logger.js';
import type { SessionState } from '../../types/session.js';

const logger = createLogger('session-storage-supabase');

/**
 * Persist session state to Supabase.
 * TODO: Implement session persistence in Supabase (add sessions table).
 */
export async function persistSession(sessionState: SessionState): Promise<void> {
  logger.warn({ sessionId: sessionState.session_id }, 'Supabase session persistence not yet implemented (session will not be resumable)');
  // Placeholder: In a full implementation, insert into a `sessions` table with session_id as PK
}

/**
 * Load a persisted session state from Supabase.
 * TODO: Implement session loading from Supabase.
 */
export async function loadPersistedSession(sessionId: string): Promise<SessionState | null> {
  logger.warn({ sessionId }, 'Supabase session loading not yet implemented');
  return null; // Return null to indicate no persisted session
}

/**
 * Delete a persisted session from Supabase.
 * TODO: Implement session deletion.
 */
export async function deletePersistedSession(sessionId: string): Promise<void> {
  logger.debug({ sessionId }, 'Supabase session deletion not yet implemented');
}
