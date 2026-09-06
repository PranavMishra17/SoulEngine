import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { getSession, SessionError } from '../session/manager.js';
import { runConversationTurn, TurnError } from '../conversation/turn.js';
import { checkSessionLifecycleAuth } from '../middleware/auth.js';
import { rateLimiter } from '../security/rate-limiter.js';
import type { LLMProvider } from '../providers/llm/interface.js';
import type { ToolCall, ToolResult } from '../types/mcp.js';
import type { MoodVector } from '../types/npc.js';
import type { MCPToolRegistry } from '../mcp/registry.js';
import type { ExitConvoResult } from '../mcp/exit-handler.js';
import { resolveRateLimitPrincipal } from '../security/principal.js';
import type { MindActivity } from '../types/mind.js';

const logger = createLogger('routes-conversation');

/**
 * Zod schemas for request validation
 */
const SendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

/**
 * Response from sending a message
 */
export interface ConversationResponse {
  response: string;                    // Unified Speaker response (informed by Mind context)
  mind?: MindActivity;                 // Mind activity metadata
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  exit_convo?: ExitConvoResult;
  mood: MoodVector;
}

/**
 * Create conversation routes with injected dependencies
 */
export function createConversationRoutes(
  llmProvider: LLMProvider,
  toolRegistry: MCPToolRegistry
): Hono {
  const conversationRoutes = new Hono();

  /**
   * POST /api/session/:sessionId/message - Send a message to the NPC
   */
  conversationRoutes.post('/:sessionId/message', async (c) => {
    const startTime = Date.now();
    const sessionId = c.req.param('sessionId');

    try {
      // 1. Validate request
      const body = await c.req.json();
      const parsed = SendMessageSchema.safeParse(body);

      if (!parsed.success) {
        logger.warn({ sessionId, errors: parsed.error.issues }, 'Invalid message request');
        return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
      }

      // 2. Get session
      const stored = getSession(sessionId);
      if (!stored) {
        logger.warn({ sessionId }, 'Session not found');
        return c.json({ error: 'Session not found' }, 404);
      }

      // 2a. Lifecycle auth — game clients must supply x-session-token; dashboard users pass via userId
      const authError = checkSessionLifecycleAuth(
        stored.state.user_id,
        stored.sessionTokenHash,
        c.get('userId'),
        c.req.header('x-session-token')
      );
      if (authError) {
        logger.warn({ sessionId }, 'Lifecycle auth failed for message');
        return c.json({ error: authError.error }, authError.status);
      }

      const { state } = stored;

      // 3. Rate limiting — key on a trusted principal, not the client-supplied player_id
      const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      const rateLimitPrincipal = resolveRateLimitPrincipal({
        userId: state.user_id,
        gameKeyHash: undefined, // game-key is validated at session start, hash not re-available here
        ip: clientIp,
        playerId: state.player_id,
      });
      const rateLimit = rateLimiter.checkLimit(
        state.project_id,
        state.player_id,
        state.definition_id,
        rateLimitPrincipal
      );

      if (!rateLimit.allowed) {
        logger.warn({ sessionId, resetAt: rateLimit.resetAt }, 'Rate limit exceeded');
        return c.json(
          {
            error: 'Rate limit exceeded',
            retry_after: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
          },
          429
        );
      }

      // 4+. Everything from sanitization onward lives in the shared turn loop,
      // so the route, the replay harness and the text harness run the same code.
      let turn;
      try {
        turn = await runConversationTurn({
          sessionId,
          content: parsed.data.content,
          fallbackProvider: llmProvider,
          toolRegistry,
        });
      } catch (err) {
        if (err instanceof TurnError && err.code === 'NO_LLM_PROVIDER') {
          return c.json({ error: 'No LLM provider configured' }, 503);
        }
        throw err;
      }

      const { mindResult, responseText } = turn;

      const response: ConversationResponse = {
        response: responseText,
        mood: turn.mood,
      };

      if (mindResult && mindResult.tools_called.length > 0) {
        response.mind = {
          tools_called: mindResult.tools_called.map(tc => ({
            name: tc.tool_name,
            args: tc.arguments,
            status: tc.status,
          })),
          duration_ms: mindResult.duration_ms,
          completed: mindResult.completed,
        };
        response.tool_calls = turn.toolCalls;
        response.tool_results = turn.toolResults;
      }

      if (turn.exitConvoResult) {
        response.exit_convo = turn.exitConvoResult;
      }

      const duration = Date.now() - startTime;
      logger.info(
        {
          sessionId,
          duration,
          responseLength: responseText.length,
          mindToolCount: mindResult?.tools_called.length ?? 0,
          mindCompleted: mindResult?.completed ?? false,
          mindDuration: mindResult?.duration_ms,
          exitConvo: !!turn.exitConvoResult,
        },
        'Message processed'
      );

      return c.json(response);
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SessionError) {
        if (error.code === 'SESSION_NOT_FOUND') {
          logger.warn({ sessionId, duration }, 'Session not found');
          return c.json({ error: 'Session not found' }, 404);
        }
        logger.warn({ sessionId, error: error.message, code: error.code, duration }, 'Session error');
        return c.json({ error: error.message, code: error.code }, 400);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId, error: errorMessage, duration }, 'Failed to process message');
      return c.json({ error: 'Failed to process message', details: errorMessage }, 500);
    }
  });

  /**
   * GET /api/session/:sessionId/history - Get conversation history
   */
  conversationRoutes.get('/:sessionId/history', async (c) => {
    const startTime = Date.now();
    const sessionId = c.req.param('sessionId');

    try {
      const stored = getSession(sessionId);
      if (!stored) {
        logger.warn({ sessionId }, 'Session not found');
        return c.json({ error: 'Session not found' }, 404);
      }

      // Lifecycle auth — same authority as message/end
      const authError = checkSessionLifecycleAuth(
        stored.state.user_id,
        stored.sessionTokenHash,
        c.get('userId'),
        c.req.header('x-session-token')
      );
      if (authError) {
        logger.warn({ sessionId }, 'Lifecycle auth failed for history');
        return c.json({ error: authError.error }, authError.status);
      }

      const duration = Date.now() - startTime;
      logger.debug({ sessionId, messageCount: stored.state.conversation_history.length, duration }, 'Conversation history retrieved');

      return c.json({
        messages: stored.state.conversation_history,
        count: stored.state.conversation_history.length,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId, error: errorMessage, duration }, 'Failed to get conversation history');
      return c.json({ error: 'Failed to get conversation history', details: errorMessage }, 500);
    }
  });

  return conversationRoutes;
}
