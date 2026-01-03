import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  startSession,
  endSession,
  getSession,
  getSessionStats,
  SessionError,
} from '../session/manager.js';
import type { LLMProvider } from '../providers/llm/interface.js';

const logger = createLogger('routes-session');

/**
 * Zod schemas for request validation
 */
const StartSessionSchema = z.object({
  project_id: z.string().min(1),
  npc_id: z.string().min(1),
  player_id: z.string().min(1),
});

const EndSessionSchema = z.object({
  exit_convo_used: z.boolean().default(false),
});

/**
 * Create session routes with injected LLM provider
 */
export function createSessionRoutes(llmProvider: LLMProvider): Hono {
  const sessionRoutes = new Hono();

  /**
   * POST /api/session/start - Start a new session
   */
  sessionRoutes.post('/start', async (c) => {
    const startTime = Date.now();

    try {
      const body = await c.req.json();
      const parsed = StartSessionSchema.safeParse(body);

      if (!parsed.success) {
        logger.warn({ errors: parsed.error.issues }, 'Invalid start session request');
        return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
      }

      const { project_id, npc_id, player_id } = parsed.data;

      const result = await startSession(project_id, npc_id, player_id);

      const duration = Date.now() - startTime;
      logger.info({ sessionId: result.session_id, projectId: project_id, npcId: npc_id, playerId: player_id, duration }, 'Session started via API');

      return c.json(result, 201);
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SessionError) {
        const status = error.code === 'SESSION_LIMIT_REACHED' ? 429 : 400;
        logger.warn({ error: error.message, code: error.code, duration }, 'Session start failed');
        return c.json({ error: error.message, code: error.code }, status);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, duration }, 'Failed to start session');
      return c.json({ error: 'Failed to start session', details: errorMessage }, 500);
    }
  });

  /**
   * POST /api/session/:sessionId/end - End a session
   */
  sessionRoutes.post('/:sessionId/end', async (c) => {
    const startTime = Date.now();
    const sessionId = c.req.param('sessionId');

    try {
      let exitConvoUsed = false;

      // Body is optional
      try {
        const body = await c.req.json();
        const parsed = EndSessionSchema.safeParse(body);
        if (parsed.success) {
          exitConvoUsed = parsed.data.exit_convo_used;
        }
      } catch {
        // Empty body is fine
      }

      const result = await endSession(sessionId, llmProvider, exitConvoUsed);

      const duration = Date.now() - startTime;
      logger.info({ sessionId, memorySaved: result.memorySaved, exitConvoUsed: result.exitConvoUsed, duration }, 'Session ended via API');

      return c.json(result);
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SessionError) {
        if (error.code === 'SESSION_NOT_FOUND') {
          logger.warn({ sessionId, duration }, 'Session not found');
          return c.json({ error: 'Session not found' }, 404);
        }
        logger.warn({ sessionId, error: error.message, code: error.code, duration }, 'Session end failed');
        return c.json({ error: error.message, code: error.code }, 400);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId, error: errorMessage, duration }, 'Failed to end session');
      return c.json({ error: 'Failed to end session', details: errorMessage }, 500);
    }
  });

  /**
   * GET /api/session/:sessionId - Get session state (debug)
   */
  sessionRoutes.get('/:sessionId', async (c) => {
    const startTime = Date.now();
    const sessionId = c.req.param('sessionId');

    try {
      const stored = getSession(sessionId);

      if (!stored) {
        const duration = Date.now() - startTime;
        logger.warn({ sessionId, duration }, 'Session not found');
        return c.json({ error: 'Session not found' }, 404);
      }

      const duration = Date.now() - startTime;
      logger.debug({ sessionId, duration }, 'Session retrieved via API');

      // Return session state (for debugging)
      return c.json({
        session_id: stored.state.session_id,
        project_id: stored.state.project_id,
        definition_id: stored.state.definition_id,
        player_id: stored.state.player_id,
        created_at: stored.state.created_at,
        last_activity: stored.state.last_activity,
        conversation_length: stored.state.conversation_history.length,
        instance_id: stored.state.instance.id,
        current_mood: stored.state.instance.current_mood,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId, error: errorMessage, duration }, 'Failed to get session');
      return c.json({ error: 'Failed to get session', details: errorMessage }, 500);
    }
  });

  /**
   * GET /api/session/stats - Get session store statistics
   */
  sessionRoutes.get('/stats', async (c) => {
    const startTime = Date.now();

    try {
      const stats = getSessionStats();

      const duration = Date.now() - startTime;
      logger.debug({ duration }, 'Session stats retrieved via API');

      return c.json(stats);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, duration }, 'Failed to get session stats');
      return c.json({ error: 'Failed to get session stats', details: errorMessage }, 500);
    }
  });

  return sessionRoutes;
}
