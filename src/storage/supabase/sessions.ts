import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import type { SessionState } from '../../types/session.js';
import { StorageError } from '../interface.js';

const logger = createLogger('session-storage-supabase');

/**
 * Persist session state to Supabase.
 * Uses upsert so repeated calls safely overwrite stale data.
 */
export async function persistSession(sessionState: SessionState): Promise<void> {
  const startTime = Date.now();
  const sessionId = sessionState.session_id;

  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('sessions')
      .upsert(
        {
          session_id: sessionId,
          project_id: sessionState.project_id,
          state: sessionState,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      );

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ sessionId, duration }, 'Session state persisted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage, duration }, 'Failed to persist session');
    throw new StorageError(`Failed to persist session: ${errorMessage}`);
  }
}

/**
 * Load a persisted session state from Supabase.
 * Returns null if the session was never persisted or has been deleted.
 * Consistent with the local backend contract.
 */
export async function loadPersistedSession(sessionId: string): Promise<SessionState | null> {
  const startTime = Date.now();

  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('sessions')
      .select('state')
      .eq('session_id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        logger.info({ sessionId }, 'No persisted session found');
        return null;
      }
      throw new StorageError(`Database error: ${error.message}`);
    }

    const sessionState = data.state as SessionState;

    const duration = Date.now() - startTime;
    logger.info({ sessionId, duration }, 'Session state loaded');

    return sessionState;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage, duration }, 'Failed to load persisted session');
    throw new StorageError(`Failed to load persisted session: ${errorMessage}`);
  }
}

/**
 * Delete a persisted session from Supabase.
 * Silently succeeds if the session does not exist (idempotent, matches local contract).
 */
export async function deletePersistedSession(sessionId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      // Log but do not throw — deletion failure is non-fatal (matches local backend)
      logger.warn({ sessionId, error: error.message }, 'Failed to delete persisted session (non-fatal)');
      return;
    }

    logger.info({ sessionId }, 'Persisted session deleted');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ sessionId, error: errorMessage }, 'Failed to delete persisted session (non-fatal)');
  }
}
