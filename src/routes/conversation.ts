import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { getSession, getSessionContext, addMessageToSession, updateSessionInstance, addTokensToSession, SessionError } from '../session/manager.js';
import { sanitize } from '../security/sanitizer.js';
import { moderate } from '../security/moderator.js';
import { rateLimiter } from '../security/rate-limiter.js';
import { assembleSlimSystemPrompt, assembleConversationHistory, augmentPromptWithMindContext, buildFollowUpPrompt } from '../core/context.js';
import { runMindAgentLoop } from '../core/mind.js';
import { isRecallTool } from '../core/tools.js';
import { blendMoods } from '../core/personality.js';
import type { LLMProvider, LLMMessage, LLMProviderType } from '../providers/llm/interface.js';
import { createLlmProvider, getDefaultModel, getDefaultLlmProviderType, isLlmProviderSupported } from '../providers/llm/factory.js';
import type { Message } from '../types/session.js';
import type { SecurityContext } from '../types/security.js';
import type { ToolCall, ToolResult } from '../types/mcp.js';
import type { MoodVector } from '../types/npc.js';
import type { MCPToolRegistry } from '../mcp/registry.js';
import { handleExitConvo, ExitConvoResult } from '../mcp/exit-handler.js';
import type { MindResult, MindActivity } from '../types/mind.js';

const logger = createLogger('routes-conversation');

/**
 * Remove stage directions and narration from NPC responses.
 * Strips lines/paragraphs starting with (action descriptions) or *action* patterns.
 */
function stripNarration(text: string): string {
  const cleaned = text
    // Strip leading parenthetical stage directions, e.g. "(Osman frowns.) Hello."
    .replace(/^\s*\(.*?\)\s*/gm, '')
    // Strip *action* at the start of a line, e.g. "*sighs* Well then."
    .replace(/^\s*\*[^*]+\*\s*/gm, '')
    // Collapse extra blank lines left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Fall back to original if stripping removed everything
  return cleaned || text;
}

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

      const { state } = stored;

      // 3. Rate limiting
      const rateLimit = rateLimiter.checkLimit(
        state.project_id,
        state.player_id,
        state.definition_id
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

      // 4. Input sanitization
      const sanitizationResult = sanitize(parsed.data.content);
      const playerInput = sanitizationResult.sanitized;

      if (sanitizationResult.violations.length > 0) {
        logger.warn({ sessionId, violations: sanitizationResult.violations }, 'Input sanitization violations');
      }

      // 5. Content moderation
      const moderationResult = await moderate(playerInput);

      // Build security context
      const securityContext: SecurityContext = {
        sanitized: sanitizationResult.violations.length === 0,
        moderated: !moderationResult.flagged,
        rateLimited: false,
        exitRequested: moderationResult.action === 'exit',
        moderationFlags: moderationResult.flagged
          ? [moderationResult.reason ?? 'Content flagged']
          : [],
        inputViolations: sanitizationResult.violations,
      };

      // 6. Load session context (definition, knowledge, API keys)
      const sessionContext = await getSessionContext(sessionId);
      const { definition, instance } = sessionContext;

      // 7. Assemble slim system prompt for Speaker (no knowledge, no tools)
      const systemPrompt = await assembleSlimSystemPrompt(
        definition,
        instance,
        securityContext,
        {},
        state.player_info
      );

      // 8. Add player message to history
      const playerMessage: Message = {
        role: 'user',
        content: playerInput,
      };
      addMessageToSession(sessionId, playerMessage);

      // 9. Assemble conversation history for LLM
      const conversationHistory = assembleConversationHistory(
        state.conversation_history,
        20
      );

      // 10. Resolve per-project LLM provider for Speaker (overrides the global default)
      const projectSettings = sessionContext.project.settings;
      const defaultProviderType = getDefaultLlmProviderType();
      const rawProviderType = projectSettings.llm_provider || defaultProviderType;
      const providerType: LLMProviderType = isLlmProviderSupported(rawProviderType)
        ? rawProviderType
        : defaultProviderType;
      const modelId = projectSettings.llm_model || getDefaultModel(providerType);
      const projectApiKey = sessionContext.apiKeys[providerType as keyof typeof sessionContext.apiKeys];

      const activeProvider = projectApiKey
        ? createLlmProvider({ provider: providerType, apiKey: projectApiKey, model: modelId })
        : llmProvider; // fall back to global if no per-project key

      if (!activeProvider) {
        return c.json({ error: 'No LLM provider configured' }, 503);
      }

      // Mind provider resolution (can use different model/provider)
      const mindProviderType = projectSettings.mind_provider
        ? (isLlmProviderSupported(projectSettings.mind_provider) ? projectSettings.mind_provider : providerType)
        : providerType;
      const mindModelId = projectSettings.mind_model || getDefaultModel(mindProviderType as LLMProviderType);
      const mindApiKey = sessionContext.apiKeys[mindProviderType as keyof typeof sessionContext.apiKeys];

      const mindProvider = mindApiKey
        ? createLlmProvider({ provider: mindProviderType as LLMProviderType, apiKey: mindApiKey, model: mindModelId })
        : activeProvider;  // fall back to same provider if no separate key

      // 11. Parallel Mind + Speaker execution
      const mindTimeoutMs = projectSettings.mind_timeout_ms ?? 15000;
      const llmMessages: LLMMessage[] = conversationHistory;
      const projectTools = toolRegistry.getProjectTools(state.project_id);

      // Augment Speaker prompt with deferred mind context from previous turn (if any)
      let speakerPrompt = systemPrompt;
      if (state.deferred_mind_context) {
        speakerPrompt = augmentPromptWithMindContext(systemPrompt, state.deferred_mind_context);
        logger.info({ sessionId, contextLength: state.deferred_mind_context.length }, 'Injected deferred mind context from previous turn');
        state.deferred_mind_context = undefined;
      }

      // Start Mind in background (does not block Speaker)
      const mindAbortController = new AbortController();
      const mindTimeout = setTimeout(() => mindAbortController.abort(), mindTimeoutMs);

      const mindPromise = runMindAgentLoop(
        definition,
        instance,
        playerInput,
        conversationHistory,
        mindProvider,
        state.project_id,
        sessionContext.knowledgeBase,
        toolRegistry,
        securityContext,
        projectTools,
        mindAbortController.signal,
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ sessionId, error: msg }, 'Mind agent loop failed');
        return null as MindResult | null;
      }).finally(() => {
        clearTimeout(mindTimeout);
      });

      // Speaker streams immediately (no waiting for Mind)
      let responseText = '';
      let providerUsage: { input_tokens: number; output_tokens: number } | undefined;

      for await (const chunk of activeProvider.streamChat({
        systemPrompt: speakerPrompt,
        messages: llmMessages,
      })) {
        if (chunk.text) responseText += chunk.text;
        if (chunk.done && chunk.usage) providerUsage = chunk.usage;
      }

      // Strip narration
      responseText = stripNarration(responseText);

      // Store primary assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: responseText,
      };
      addMessageToSession(sessionId, assistantMessage);

      // Await Mind result (likely already done)
      const mindResult = await mindPromise;

      // Process Mind results
      const toolCalls: ToolCall[] = mindResult?.raw_tool_calls ?? [];
      const toolResults: ToolResult[] = [];
      let exitConvoResult: ExitConvoResult | undefined;

      if (mindResult && mindResult.tools_called.length > 0) {
        for (const tr of mindResult.tools_called) {
          toolResults.push({
            tool_call_id: tr.tool_name,
            result: tr.status === 'success' ? tr.result_content : null,
            error: tr.status === 'error' ? tr.error : undefined,
          });
        }
      }

      if (mindResult?.exit_convo_used) {
        exitConvoResult = handleExitConvo(
          sessionId,
          { reason: mindResult.exit_convo_reason ?? 'Mind decided to end conversation' },
          securityContext
        );
      }

      // Separate recall vs MCP tool results
      if (mindResult && mindResult.tools_called.length > 0) {
        const recallResults: string[] = [];
        const mcpResults: string[] = [];

        for (const tr of mindResult.tools_called) {
          if (tr.status === 'error') continue;

          const argsStr = Object.entries(tr.arguments)
            .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(', ');

          if (isRecallTool(tr.tool_name)) {
            if (tr.result_content) {
              recallResults.push(`- Retrieved (${tr.tool_name}): ${tr.result_content}`);
            }
          } else {
            mcpResults.push(`- Action taken (${tr.tool_name}): ${tr.result_content || 'executed successfully'}. Params: ${argsStr}`);
          }
        }

        // Recall results -> defer to next turn
        if (recallResults.length > 0) {
          state.deferred_mind_context = recallResults.join('\n');
          logger.info({ sessionId, recallCount: recallResults.length }, 'Recall results deferred to next turn');
        }

        // MCP tool results -> append follow-up to response
        if (mcpResults.length > 0) {
          const mcpContext = mcpResults.join('\n');
          const followUpPrompt = buildFollowUpPrompt(systemPrompt, mcpContext);

          const updatedHistory: LLMMessage[] = [
            ...llmMessages,
            { role: 'model' as const, content: responseText },
          ];

          let followUpText = '';
          for await (const chunk of activeProvider.streamChat({
            systemPrompt: followUpPrompt,
            messages: updatedHistory,
          })) {
            if (chunk.text) followUpText += chunk.text;
          }

          followUpText = stripNarration(followUpText);

          if (followUpText.trim()) {
            responseText += '\n\n' + followUpText;
            addMessageToSession(sessionId, { role: 'assistant', content: followUpText });
          }
        }
      }

      // Track token usage
      try {
        if (providerUsage) {
          addTokensToSession(sessionId, {
            text_input_tokens: providerUsage.input_tokens,
            text_output_tokens: providerUsage.output_tokens,
          });
        } else {
          const inputText = speakerPrompt + conversationHistory.map(m => m.content).join('') + playerInput;
          addTokensToSession(sessionId, {
            text_input_tokens: Math.ceil(inputText.length / 4),
            text_output_tokens: Math.ceil(responseText.length / 4),
          });
        }
        if (mindResult?.usage) {
          addTokensToSession(sessionId, {
            text_input_tokens: mindResult.usage.input_tokens,
            text_output_tokens: mindResult.usage.output_tokens,
          });
        }
      } catch {
        // Never block the conversation for token tracking failures
      }

      // Update mood based on conversation (subtle drift)
      const instance_updated = { ...instance };
      if (moderationResult.action === 'warn') {
        const stressedMood: MoodVector = { valence: 0.3, arousal: 0.7, dominance: 0.4 };
        instance_updated.current_mood = blendMoods(instance.current_mood, stressedMood, 0.15);
      } else if (moderationResult.action === 'exit') {
        const distressedMood: MoodVector = { valence: 0.2, arousal: 0.8, dominance: 0.3 };
        instance_updated.current_mood = blendMoods(instance.current_mood, distressedMood, 0.25);
      }
      updateSessionInstance(sessionId, instance_updated);

      // Build response
      const response: ConversationResponse = {
        response: responseText,
        mood: instance_updated.current_mood,
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
        response.tool_calls = toolCalls;
        response.tool_results = toolResults;
      }

      if (exitConvoResult) {
        response.exit_convo = exitConvoResult;
      }

      const duration = Date.now() - startTime;
      logger.info(
        {
          sessionId,
          duration,
          inputLength: playerInput.length,
          responseLength: responseText.length,
          mindToolCount: mindResult?.tools_called.length ?? 0,
          mindCompleted: mindResult?.completed ?? false,
          mindDuration: mindResult?.duration_ms,
          exitConvo: !!exitConvoResult,
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
