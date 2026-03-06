import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { getSession, getSessionContext, addMessageToSession, updateSessionInstance, addTokensToSession, SessionError } from '../session/manager.js';
import { sanitize } from '../security/sanitizer.js';
import { moderate } from '../security/moderator.js';
import { rateLimiter } from '../security/rate-limiter.js';
import { assembleSystemPrompt, assembleConversationHistory } from '../core/context.js';
import { getAvailableTools, isExitConvoTool, validateToolArguments } from '../core/tools.js';
import { blendMoods } from '../core/personality.js';
import type { LLMProvider, LLMMessage, LLMProviderType } from '../providers/llm/interface.js';
import { createLlmProvider, getDefaultModel, getDefaultLlmProviderType, isLlmProviderSupported } from '../providers/llm/factory.js';
import type { Message } from '../types/session.js';
import type { SecurityContext } from '../types/security.js';
import type { ToolCall, ToolResult } from '../types/mcp.js';
import type { MoodVector } from '../types/npc.js';
import type { MCPToolRegistry } from '../mcp/registry.js';
import { handleExitConvo, ExitConvoResult } from '../mcp/exit-handler.js';

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
  response: string;
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
      const { definition, instance, resolvedKnowledge } = sessionContext;

      // 7. Get available tools from project registry
      const projectTools = toolRegistry.getProjectTools(state.project_id);
      const availableTools = getAvailableTools(definition, securityContext, projectTools);

      // 8. Assemble system prompt (with player info from session state)
      const systemPrompt = await assembleSystemPrompt(
        definition,
        instance,
        resolvedKnowledge,
        securityContext,
        {},
        state.player_info
      );

      // 9. Add player message to history
      const playerMessage: Message = {
        role: 'user',
        content: playerInput,
      };
      addMessageToSession(sessionId, playerMessage);

      // 10. Assemble conversation history for LLM
      const conversationHistory = assembleConversationHistory(
        state.conversation_history,
        20
      );

      // 11. Resolve per-project LLM provider (overrides the global default)
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

      // 12. Call LLM
      let responseText = '';
      const toolCalls: ToolCall[] = [];

      const llmMessages: LLMMessage[] = conversationHistory;

      for await (const chunk of activeProvider.streamChat({
        systemPrompt,
        messages: llmMessages,
        tools: availableTools.length > 0 ? availableTools : undefined,
      })) {
        if (chunk.text) {
          responseText += chunk.text;
        }
        if (chunk.toolCalls.length > 0) {
          toolCalls.push(...chunk.toolCalls);
        }
      }

      // Gracefully estimate token usage from this LLM turn.
      // We approximate 1 token ≈ 4 characters (standard heuristic for English text).
      // If we ever get real token counts from providers, they'd override this.
      try {
        const inputText = systemPrompt + conversationHistory.map(m => m.content).join('') + playerInput;
        const estimatedInput = Math.ceil(inputText.length / 4);
        const estimatedOutput = Math.ceil(responseText.length / 4);
        addTokensToSession(sessionId, {
          text_input_tokens: estimatedInput,
          text_output_tokens: estimatedOutput,
        });
      } catch {
        // Never block the conversation for token estimation failures
      }

      // 13. Handle tool calls
      const toolResults: ToolResult[] = [];
      let exitConvoResult: ExitConvoResult | undefined;

      for (const toolCall of toolCalls) {
        // Check for exit_convo
        if (isExitConvoTool(toolCall.name)) {
          exitConvoResult = handleExitConvo(
            sessionId,
            toolCall.arguments as { reason: string },
            securityContext
          );
          toolResults.push({
            tool_call_id: toolCall.id ?? toolCall.name,
            result: exitConvoResult,
          });
          continue;
        }

        // Validate tool arguments
        const tool = projectTools[toolCall.name];
        if (!tool) {
          logger.warn({ sessionId, toolName: toolCall.name }, 'Tool not found in registry');
          toolResults.push({
            tool_call_id: toolCall.id ?? toolCall.name,
            result: null,
            error: `Tool not found: ${toolCall.name}`,
          });
          continue;
        }

        const validation = validateToolArguments(tool, toolCall.arguments);
        if (!validation.valid) {
          logger.warn({ sessionId, toolName: toolCall.name, errors: validation.errors }, 'Tool argument validation failed');
          toolResults.push({
            tool_call_id: toolCall.id ?? toolCall.name,
            result: null,
            error: `Invalid arguments: ${validation.errors.join(', ')}`,
          });
          continue;
        }

        // Execute tool via registry (or log for later game handling)
        try {
          const result = await toolRegistry.executeTool(
            state.project_id,
            toolCall.name,
            toolCall.arguments
          );
          toolResults.push({
            tool_call_id: toolCall.id ?? toolCall.name,
            result,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ sessionId, toolName: toolCall.name, error: errorMessage }, 'Tool execution failed');
          toolResults.push({
            tool_call_id: toolCall.id ?? toolCall.name,
            result: null,
            error: errorMessage,
          });
        }
      }

      // 14. Strip stage directions / narration from response before storing
      responseText = stripNarration(responseText);

      const assistantMessage: Message = {
        role: 'assistant',
        content: responseText,
      };
      addMessageToSession(sessionId, assistantMessage);

      // 15. Update mood based on conversation (subtle drift)
      const instance_updated = { ...instance };
      if (moderationResult.action === 'warn') {
        // Negative mood shift if moderation warned
        const stressedMood: MoodVector = { valence: 0.3, arousal: 0.7, dominance: 0.4 };
        instance_updated.current_mood = blendMoods(instance.current_mood, stressedMood, 0.15);
      } else if (moderationResult.action === 'exit') {
        // Strong negative mood shift if exit
        const distressedMood: MoodVector = { valence: 0.2, arousal: 0.8, dominance: 0.3 };
        instance_updated.current_mood = blendMoods(instance.current_mood, distressedMood, 0.25);
      }
      updateSessionInstance(sessionId, instance_updated);

      // 16. Build response
      const response: ConversationResponse = {
        response: responseText,
        mood: instance_updated.current_mood,
      };

      if (toolCalls.length > 0) {
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
          toolCallCount: toolCalls.length,
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
