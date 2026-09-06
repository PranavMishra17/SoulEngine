/**
 * One conversation turn, extracted from the HTTP handler so that every caller
 * runs the same loop.
 *
 * Before this existed there were two copies: the Hono route and
 * `src/eval/replay.ts`. They had already drifted — replay omitted the
 * `- Retrieved (tool): ` prefix, skipped the MCP follow-up speech, skipped
 * narration stripping, and had no Mind timeout. A tool that measures the turn
 * loop while running its own copy of it measures the wrong thing.
 *
 * The route keeps what is HTTP's business: request parsing, session lookup,
 * lifecycle auth, rate limiting, and response shaping. Everything from input
 * sanitization onward lives here.
 *
 * The result carries observability the HTTP response deliberately omits — the
 * assembled speaker prompt, which deferred context was injected, per-stage
 * timings — because the text harness needs to show what the mind was working
 * from, not just what it said.
 */

import { createLogger } from '../logger.js';
import {
  getSession,
  getSessionContext,
  addMessageToSession,
  updateSessionInstance,
  addTokensToSession,
} from '../session/manager.js';
import { sanitize } from '../security/sanitizer.js';
import { moderate } from '../security/moderator.js';
import {
  assembleSlimSystemPrompt,
  assembleConversationHistory,
  augmentPromptWithMindContext,
  buildFollowUpPrompt,
} from '../core/context.js';
import { runMindAgentLoop } from '../core/mind.js';
import { isRecallTool } from '../core/tools.js';
import { blendMoods } from '../core/personality.js';
import {
  createLlmProvider,
  getDefaultModel,
  getDefaultLlmProviderType,
  isLlmProviderSupported,
} from '../providers/llm/factory.js';
import { handleExitConvo, type ExitConvoResult } from '../mcp/exit-handler.js';
import type { LLMProvider, LLMMessage, LLMProviderType } from '../providers/llm/interface.js';
import type { Message } from '../types/session.js';
import type { SecurityContext } from '../types/security.js';
import type { ToolCall, ToolResult } from '../types/mcp.js';
import type { MoodVector } from '../types/npc.js';
import type { MCPToolRegistry } from '../mcp/registry.js';
import type { MindResult, MindToolResult } from '../types/mind.js';

const logger = createLogger('conversation-turn');

/** Raised when the turn cannot proceed for a reason the caller must map to a status. */
export class TurnError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_LLM_PROVIDER',
  ) {
    super(message);
    this.name = 'TurnError';
  }
}

export interface RunTurnOptions {
  sessionId: string;
  /** Raw player input, before sanitization. */
  content: string;
  /** Global provider, used when the project has no key of its own. */
  fallbackProvider: LLMProvider | null;
  toolRegistry: MCPToolRegistry;
}

export interface TurnTimings {
  /** Mind agent loop, as reported by the loop itself. */
  mindMs: number | null;
  /** Speaker stream, measured here. */
  speakerMs: number;
  /** Follow-up speech after an MCP action, when one happened. */
  followUpMs: number | null;
  /** Whole turn. Mind and Speaker overlap, so this is not their sum. */
  wallMs: number;
}

export interface TurnResult {
  responseText: string;
  mood: MoodVector;
  mindResult: MindResult | null;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  exitConvoResult?: ExitConvoResult;

  // --- observability, not part of the HTTP response ---
  /** The exact system prompt the Speaker was given, including any injected mind context. */
  speakerPrompt: string;
  /** Deferred recall context injected into THIS turn, or null. */
  deferredContextInjected: string | null;
  /** Recall context deferred to the NEXT turn, or null. */
  deferredContextForNextTurn: string | null;
  /** Number of recall results deferred forward this turn. */
  recallResultCount: number;
  /** Number of MCP action results that produced follow-up speech. */
  mcpResultCount: number;
  securityContext: SecurityContext;
  moderationAction: string;
  sanitizationViolations: string[];
  timings: TurnTimings;
  /** True when speaker token counts are estimated rather than provider-reported. */
  usageEstimated: boolean;
}

/**
 * Remove stage directions and narration from NPC responses.
 * Strips lines/paragraphs starting with (action descriptions) or *action* patterns.
 */
export function stripNarration(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let cleaned = line.replace(/\([^)]*\)/g, '');
      cleaned = cleaned.replace(/\*[^*]*\*/g, '');
      return cleaned.trim();
    })
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/**
 * Split what the Mind did into the two things that happen to results:
 * recall is deferred into the next turn's prompt, actions produce follow-up
 * speech now.
 *
 * A recall result with no content is dropped rather than deferred. It used to
 * arrive at the next turn as "- Retrieved (recall_memories): No matching
 * memories found." — telling the character it remembers nothing about whatever
 * the player just said. See ERR-022.
 */
export function partitionMindToolResults(
  toolsCalled: MindToolResult[]
): { recallLines: string[]; mcpLines: string[] } {
  const recallLines: string[] = [];
  const mcpLines: string[] = [];

  for (const tr of toolsCalled) {
    if (tr.status === 'error') continue;

    if (isRecallTool(tr.tool_name)) {
      if (tr.result_content) {
        recallLines.push(`- Retrieved (${tr.tool_name}): ${tr.result_content}`);
      }
      continue;
    }

    const argsStr = Object.entries(tr.arguments)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
    mcpLines.push(
      `- Action taken (${tr.tool_name}): ${tr.result_content || 'executed successfully'}. Params: ${argsStr}`
    );
  }

  return { recallLines, mcpLines };
}

/**
 * Run one turn against an active session.
 *
 * The caller is responsible for having authenticated and rate-limited the
 * request; this function does neither.
 */
export async function runConversationTurn(options: RunTurnOptions): Promise<TurnResult> {
  const { sessionId, content, fallbackProvider, toolRegistry } = options;
  const wallStart = Date.now();

  const stored = getSession(sessionId);
  if (!stored) {
    // Callers check first; this keeps the type honest.
    throw new TurnError('Session not found', 'NO_LLM_PROVIDER');
  }
  const { state } = stored;

  // Input sanitization
  const sanitizationResult = sanitize(content);
  const playerInput = sanitizationResult.sanitized;

  if (sanitizationResult.violations.length > 0) {
    logger.warn({ sessionId, violations: sanitizationResult.violations }, 'Input sanitization violations');
  }

  // Content moderation
  const moderationResult = await moderate(playerInput);

  const securityContext: SecurityContext = {
    sanitized: sanitizationResult.violations.length === 0,
    moderated: !moderationResult.flagged,
    rateLimited: false,
    exitRequested: moderationResult.action === 'exit',
    moderationFlags: moderationResult.flagged ? [moderationResult.reason ?? 'Content flagged'] : [],
    inputViolations: sanitizationResult.violations,
  };

  // Session context (definition, knowledge, API keys)
  const sessionContext = await getSessionContext(sessionId);
  const { definition, instance } = sessionContext;

  // Slim system prompt for the Speaker. Deliberately carries no world knowledge
  // and no tools — knowledge only reaches a model through the Mind's recall.
  const systemPrompt = await assembleSlimSystemPrompt(
    definition,
    instance,
    securityContext,
    {},
    state.player_info,
    state.user_id
  );

  const playerMessage: Message = { role: 'user', content: playerInput };
  addMessageToSession(sessionId, playerMessage);

  const conversationHistory = assembleConversationHistory(state.conversation_history, 20);

  // Per-project provider resolution, overriding the global default
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
    : fallbackProvider;

  if (!activeProvider) {
    throw new TurnError('No LLM provider configured', 'NO_LLM_PROVIDER');
  }

  const mindProviderType = projectSettings.mind_provider
    ? (isLlmProviderSupported(projectSettings.mind_provider) ? projectSettings.mind_provider : providerType)
    : providerType;
  const mindModelId = projectSettings.mind_model || getDefaultModel(mindProviderType as LLMProviderType);
  const mindApiKey = sessionContext.apiKeys[mindProviderType as keyof typeof sessionContext.apiKeys];

  const mindProvider = mindApiKey
    ? createLlmProvider({ provider: mindProviderType as LLMProviderType, apiKey: mindApiKey, model: mindModelId })
    : activeProvider;

  // Parallel Mind + Speaker
  const mindTimeoutMs = projectSettings.mind_timeout_ms ?? 15000;
  const llmMessages: LLMMessage[] = conversationHistory;
  const projectTools = toolRegistry.getProjectTools(state.project_id);

  // Deferred recall from the previous turn goes into this turn's speaker prompt.
  const deferredContextInjected = state.deferred_mind_context ?? null;
  let speakerPrompt = systemPrompt;
  if (state.deferred_mind_context) {
    speakerPrompt = augmentPromptWithMindContext(systemPrompt, state.deferred_mind_context);
    logger.info(
      { sessionId, contextLength: state.deferred_mind_context.length },
      'Injected deferred mind context from previous turn'
    );
    state.deferred_mind_context = undefined;
  }

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
    state.user_id,
  ).catch((err) => {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ sessionId, error: msg }, 'Mind agent loop failed');
    return null as MindResult | null;
  }).finally(() => {
    clearTimeout(mindTimeout);
  });

  // Speaker streams immediately; it does not wait for the Mind.
  const speakerStart = Date.now();
  let responseText = '';
  let providerUsage: { input_tokens: number; output_tokens: number } | undefined;

  for await (const chunk of activeProvider.streamChat({
    systemPrompt: speakerPrompt,
    messages: llmMessages,
  })) {
    if (chunk.text) responseText += chunk.text;
    if (chunk.done && chunk.usage) providerUsage = chunk.usage;
  }
  const speakerMs = Date.now() - speakerStart;

  responseText = stripNarration(responseText);
  addMessageToSession(sessionId, { role: 'assistant', content: responseText });

  const mindResult = await mindPromise;

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

  // Recall results defer to the next turn; MCP actions produce follow-up speech now.
  let deferredContextForNextTurn: string | null = null;
  let recallResultCount = 0;
  let mcpResultCount = 0;
  let followUpMs: number | null = null;

  if (mindResult && mindResult.tools_called.length > 0) {
    const { recallLines: recallResults, mcpLines: mcpResults } =
      partitionMindToolResults(mindResult.tools_called);

    recallResultCount = recallResults.length;
    mcpResultCount = mcpResults.length;

    if (recallResults.length > 0) {
      deferredContextForNextTurn = recallResults.join('\n');
      state.deferred_mind_context = deferredContextForNextTurn;
      logger.info({ sessionId, recallCount: recallResults.length }, 'Recall results deferred to next turn');
    }

    if (mcpResults.length > 0) {
      const mcpContext = mcpResults.join('\n');
      const followUpPrompt = buildFollowUpPrompt(systemPrompt, mcpContext, definition.name);

      const updatedHistory: LLMMessage[] = [
        ...llmMessages,
        { role: 'model' as const, content: responseText },
        { role: 'user' as const, content: '[System: You just took an action. Briefly address it.]' },
      ];

      const followUpStart = Date.now();
      let followUpText = '';
      for await (const chunk of activeProvider.streamChat({
        systemPrompt: followUpPrompt,
        messages: updatedHistory,
      })) {
        if (chunk.text) followUpText += chunk.text;
      }
      followUpMs = Date.now() - followUpStart;

      followUpText = stripNarration(followUpText);

      if (followUpText.trim()) {
        responseText += '\n\n' + followUpText;
        addMessageToSession(sessionId, { role: 'assistant', content: followUpText });
      }
    }
  }

  // Token accounting must never break a conversation.
  let usageEstimated = false;
  try {
    if (providerUsage) {
      addTokensToSession(sessionId, {
        text_input_tokens: providerUsage.input_tokens,
        text_output_tokens: providerUsage.output_tokens,
      });
    } else {
      usageEstimated = true;
      const inputText = speakerPrompt + conversationHistory.map((m) => m.content).join('') + playerInput;
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

  // Mood drifts only on moderation action; it does not move on an ordinary turn.
  const instance_updated = { ...instance };
  if (moderationResult.action === 'warn') {
    const stressedMood: MoodVector = { valence: 0.3, arousal: 0.7, dominance: 0.4 };
    instance_updated.current_mood = blendMoods(instance.current_mood, stressedMood, 0.15);
  } else if (moderationResult.action === 'exit') {
    const distressedMood: MoodVector = { valence: 0.2, arousal: 0.8, dominance: 0.3 };
    instance_updated.current_mood = blendMoods(instance.current_mood, distressedMood, 0.25);
  }
  updateSessionInstance(sessionId, instance_updated);

  return {
    responseText,
    mood: instance_updated.current_mood,
    mindResult,
    toolCalls,
    toolResults,
    exitConvoResult,
    speakerPrompt,
    deferredContextInjected,
    deferredContextForNextTurn,
    recallResultCount,
    mcpResultCount,
    securityContext,
    moderationAction: moderationResult.action,
    sanitizationViolations: sanitizationResult.violations,
    timings: {
      mindMs: mindResult?.duration_ms ?? null,
      speakerMs,
      followUpMs,
      wallMs: Date.now() - wallStart,
    },
    usageEstimated,
  };
}
