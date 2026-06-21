import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createLogger } from '../../logger.js';
import { getConfig } from '../../config.js';
import type { SessionState } from '../../types/session.js';
import { StorageError } from '../interface.js';

const logger = createLogger('session-storage');

/**
 * Get the path to the sessions directory
 */
function getSessionsDir(): string {
  const config = getConfig();
  return path.join(config.dataDir, 'sessions');
}

/**
 * Get the path to a specific persisted session file
 */
function getSessionPath(sessionId: string): string {
  return path.join(getSessionsDir(), `${sessionId}.yaml`);
}

/**
 * Persist session state to disk.
 * Called by endSession to allow resumption later.
 */
export async function persistSession(sessionState: SessionState): Promise<void> {
  const startTime = Date.now();
  const sessionId = sessionState.session_id;

  try {
    const sessionsDir = getSessionsDir();
    await fs.mkdir(sessionsDir, { recursive: true });

    const sessionPath = getSessionPath(sessionId);
    await fs.writeFile(sessionPath, yaml.dump(sessionState), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ sessionId, duration }, 'Session state persisted');
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage, duration }, 'Failed to persist session');
    throw new StorageError(`Failed to persist session: ${errorMessage}`);
  }
}

/**
 * Load a persisted session state from disk.
 * Returns null if the session was never persisted or the file is missing.
 */
export async function loadPersistedSession(sessionId: string): Promise<SessionState | null> {
  const startTime = Date.now();

  try {
    const sessionPath = getSessionPath(sessionId);
    const content = await fs.readFile(sessionPath, 'utf-8');
    const sessionState = yaml.load(content) as SessionState;

    const duration = Date.now() - startTime;
    logger.info({ sessionId, duration }, 'Session state loaded');

    return sessionState;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.info({ sessionId }, 'No persisted session found');
      return null;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage, duration }, 'Failed to load persisted session');
    throw new StorageError(`Failed to load persisted session: ${errorMessage}`);
  }
}

/**
 * Delete a persisted session file.
 * Used to clean up after a session is explicitly deleted or expired.
 */
export async function deletePersistedSession(sessionId: string): Promise<void> {
  try {
    const sessionPath = getSessionPath(sessionId);
    await fs.unlink(sessionPath);
    logger.info({ sessionId }, 'Persisted session deleted');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Already deleted or never existed
      return;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ sessionId, error: errorMessage }, 'Failed to delete persisted session (non-fatal)');
  }
}
