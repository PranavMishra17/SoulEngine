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
  assembleSlimSystemPromptParts,
  assembleConversationHistory,
  augmentPromptWithMindContext,
} from '../core/context.js';
import { selectRuntime, type CognitionInput } from '../core/runtime.js';
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
import { appendSessionLog } from '../telemetry/session-log.js';

const logger = createLogger('conversation-turn');

/** Mind budget when a project sets none; the Speaker never waits on it. */
const DEFAULT_MIND_TIMEOUT_MS = 15000;

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
  /** How this turn arrived, recorded in the session log. */
  channel?: 'http' | 'voice' | 'harness' | 'eval' | 'playground';
  /**
   * Bypass provider resolution and drive the turn with these instead.
   *
   * Only the offline evaluator sets this: it scripts the Mind and the Speaker
   * separately per turn, which project settings cannot express. Registering a
   * stub provider type in the factory would have put a test-only branch in the
   * path every real conversation takes; an override production never sets is
   * the smaller seam. See specs/5.19.md.
   */
  providers?: { speaker: LLMProvider; mind: LLMProvider };
  /**
   * Override the cognition runtime (bypasses project setting).
   * Used by the playground and tests.
   */
  runtime?: 'parallel' | 'single';
}

export interface TurnTimings {
  /** Mind agent loop, as reported by the loop itself. */
  mindMs: number | null;
  /** Speaker stream, measured here. */
  speakerMs: number;
  /** Milliseconds to first non-empty text chunk from Speaker. Null if stream yielded no text. */
  speakerTtftMs: number | null;
  /** Follow-up speech after an MCP action, when one happened. */
  followUpMs: number | null;
  /** Milliseconds to first non-empty text chunk from follow-up. Null if no follow-up or no text. */
  followUpTtftMs: number | null;
  /** Whole turn. Mind and Speaker overlap, so this is not their sum. */
  wallMs: number;
}

export interface TurnResult {
  /** Which cognition runtime produced this turn. */
  runtime: 'parallel' | 'single';
  /** Primary reply plus, when an action produced one, the follow-up utterance joined by a blank line. */
  responseText: string;
  /** The follow-up utterance alone, or null when the turn produced none. */
  followUpText: string | null;
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
  /** Token usage per leg. Speaker and followUp usage come from the provider; Mind usage from MindResult. */
  usage: {
    speaker?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
    mind?: { input_tokens: number; output_tokens: number };
    followUp?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
  };
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
  const { sessionId, content, fallbackProvider, toolRegistry, channel = 'unknown' } = options;
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
  // Split into stable (cacheable) prefix and dynamic suffix.
  const promptParts = await assembleSlimSystemPromptParts(
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

  const activeProvider = options.providers
    ? options.providers.speaker
    : projectApiKey
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

  const mindProvider = options.providers
    ? options.providers.mind
    : mindApiKey
      ? createLlmProvider({ provider: mindProviderType as LLMProviderType, apiKey: mindApiKey, model: mindModelId })
      : activeProvider;

  // Deferred recall from the previous turn goes into this turn's speaker prompt dynamic suffix.
  const deferredContextInjected = state.deferred_mind_context ?? null;
  let speakerDynamic = promptParts.dynamic;
  if (state.deferred_mind_context) {
    speakerDynamic = augmentPromptWithMindContext(promptParts.dynamic, state.deferred_mind_context);
    logger.info(
      { sessionId, contextLength: state.deferred_mind_context.length },
      'Injected deferred mind context from previous turn'
    );
    state.deferred_mind_context = undefined;
  }

  // Cache key for provider-level prompt caching
  const cacheKey = `${definition.id}:${definition.version ?? 0}`;

  const llmMessages: LLMMessage[] = conversationHistory;
  const projectTools = toolRegistry.getProjectTools(state.project_id);

  // Select and invoke the cognition runtime
  const runtimeName = options.runtime ?? (projectSettings.cognition_runtime as 'parallel' | 'single' | undefined) ?? 'parallel';
  const runtime = selectRuntime(runtimeName);

  // The Mind is abandoned, not awaited, when it overruns the project's budget.
  const mindTimeoutMs = projectSettings.mind_timeout_ms ?? DEFAULT_MIND_TIMEOUT_MS;
  const mindAbortController = new AbortController();
  const mindTimeout = setTimeout(() => mindAbortController.abort(), mindTimeoutMs);

  const cognitionInput: CognitionInput = {
    prompt: { stable: promptParts.stable, dynamic: speakerDynamic },
    history: llmMessages,
    playerInput,
    tools: projectTools,
    toolRegistry,
    providers: { speaker: activeProvider, mind: mindProvider },
    cacheKey,
    signal: mindAbortController.signal,
    context: {
      definition,
      instance,
      knowledgeBase: sessionContext.knowledgeBase,
      projectId: state.project_id,
      sessionId,
      securityContext,
      userId: state.user_id,
    },
  };

  // Consume runtime events
  let responseText = '';
  let followUpText: string | null = null;
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  let exitConvoResult: ExitConvoResult | undefined;
  let deferredContextForNextTurn: string | null = null;
  let recallResultCount = 0;
  let mcpResultCount = 0;
  let mindResult: MindResult | null = null;
  let timings = { mindMs: null as number | null, speakerMs: 0, speakerTtftMs: null as number | null, followUpMs: null as number | null, followUpTtftMs: null as number | null, wallMs: 0 };
  let usage: {
    speaker?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
    mind?: { input_tokens: number; output_tokens: number };
    followUp?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
  } = {};
  let usageEstimated = false;
  let primarySpeechAdded = false;

  try {
  for await (const event of runtime.generate(cognitionInput)) {
    if (event.type === 'text') {
      responseText += event.delta;
    } else if (event.type === 'tool_call') {
      toolCalls.push(event.call);
    } else if (event.type === 'tool_result') {
      const tr = event.result;
      toolResults.push({
        tool_call_id: tr.tool_name,
        result: tr.status === 'success' ? tr.result_content : null,
        error: tr.status === 'error' ? tr.error : undefined,
      });
      if (tr.status === 'success' && tr.result_content) {
        if (isRecallTool(tr.tool_name)) {
          recallResultCount++;
        } else {
          mcpResultCount++;
        }
      }
    } else if (event.type === 'follow_up') {
      followUpText = (followUpText ?? '') + event.delta;
    } else if (event.type === 'done') {
      const summary = event.summary;

      // Use the stripped speech from the summary
      responseText = summary.speech;
      followUpText = summary.followUp;

      // Add primary speech to session
      if (!primarySpeechAdded) {
        addMessageToSession(sessionId, { role: 'assistant', content: summary.speech });
        primarySpeechAdded = true;
      }

      // Add follow-up to session if it exists
      if (summary.followUp) {
        responseText += '\n\n' + summary.followUp;
        addMessageToSession(sessionId, { role: 'assistant', content: summary.followUp });
      }

      // Handle exit
      if (summary.exit?.requested) {
        exitConvoResult = handleExitConvo(
          sessionId,
          { reason: summary.exit.reason ?? 'Mind decided to end conversation' },
          securityContext
        );
      }

      // Deferred context
      if (summary.deferredForNextTurn) {
        deferredContextForNextTurn = summary.deferredForNextTurn;
        state.deferred_mind_context = deferredContextForNextTurn;
      }

      timings = summary.timings;
      usage = summary.usage;
      usageEstimated = summary.usageEstimated;
      mindResult = summary.mindResult;
    }
  }
  } finally {
    clearTimeout(mindTimeout);
  }

  // Reconstruct full speaker prompt for the return value
  const speakerPrompt = promptParts.stable + '\n\n' + speakerDynamic;

  // Token accounting must never break a conversation.
  try {
    if (usage.speaker) {
      addTokensToSession(sessionId, {
        text_input_tokens: usage.speaker.input_tokens,
        text_output_tokens: usage.speaker.output_tokens,
      });
    } else if (!usageEstimated) {
      const inputText = speakerPrompt + conversationHistory.map((m) => m.content).join('') + playerInput;
      addTokensToSession(sessionId, {
        text_input_tokens: Math.ceil(inputText.length / 4),
        text_output_tokens: Math.ceil(responseText.length / 4),
      });
    }
    if (usage.mind) {
      addTokensToSession(sessionId, {
        text_input_tokens: usage.mind.input_tokens,
        text_output_tokens: usage.mind.output_tokens,
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

  // Compute final wallMs
  timings.wallMs = Date.now() - wallStart;

  // Durable record of the turn. Every caller of this function is covered, which
  // is why the log lives here rather than in each entry point.
  await appendSessionLog(
    {
      sessionId,
      projectId: state.project_id,
      npcId: state.definition_id,
      playerId: state.player_id,
      channel,
    },
    'turn',
    {
      playerInput,
      reply: responseText,
      mindCompleted: mindResult?.completed ?? null,
      toolsOffered: mindResult?.tools_offered ?? [],
      toolsCalled: (mindResult?.tools_called ?? []).map((t) => ({
        name: t.tool_name,
        arguments: t.arguments,
        status: t.status,
        resultChars: t.result_content?.length ?? 0,
      })),
      recallInjected: deferredContextInjected,
      recallDeferred: deferredContextForNextTurn,
      mcpResultCount,
      exitConvo: !!exitConvoResult,
      moderationAction: moderationResult.action,
      sanitizationViolations: sanitizationResult.violations,
      stm: instance.short_term_memory?.length ?? 0,
      ltm: instance.long_term_memory?.length ?? 0,
      mood: instance_updated.current_mood,
      timings,
      usage,
      usageEstimated,
    }
  );

  return {
    runtime: runtimeName,
    responseText,
    followUpText,
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
    timings,
    usage,
    usageEstimated,
  };
}
