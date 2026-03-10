import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import { sessionStore, StoredSession } from './store.js';
import {
  type ApiKeys,
} from '../storage/index.js';
import { getStorageForUser } from '../storage/hybrid.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import type { Tool } from '../types/mcp.js';
import { validateAnchorIntegrity } from '../security/anchor-guard.js';
import { resolveKnowledge } from '../core/knowledge.js';
import { summarizeConversation, NPCPerspective } from '../core/summarizer.js';
import { createMemory, calculateSalience, pruneSTM } from '../core/memory.js';
import { blendMoods } from '../core/personality.js';
import type { SessionID, SessionState, Message, PlayerInfo } from '../types/session.js';
import type { NPCDefinition, NPCInstance, MoodVector, CoreAnchor } from '../types/npc.js';
import { CONVERSATION_MODES, type ConversationMode } from '../types/voice.js';
import type { KnowledgeBase } from '../types/knowledge.js';
import type { Project } from '../types/project.js';
import type { LLMProvider } from '../providers/llm/interface.js';
import { resolveProjectLlmProvider } from '../providers/llm/factory.js';
import { emptyTokenUsage } from '../types/usage.js';
import type { SessionTokenUsage, ConversationTranscript } from '../types/usage.js';

const logger = createLogger('session-manager');

/**
 * Result of starting a session
 */
export interface SessionStartResult {
  session_id: SessionID;
  npc_name: string;
  npc_description: string;
  mood: MoodVector;
  project_name: string;
}

/**
 * Result of ending a session
 */
export interface SessionEndResult {
  success: boolean;
  version: string;
  memorySaved: boolean;
  exitConvoUsed: boolean;
}

/**
 * Session context loaded at start
 */
export interface SessionContext {
  project: Project;
  definition: NPCDefinition;
  instance: NPCInstance;
  knowledgeBase: KnowledgeBase;
  resolvedKnowledge: string;
  apiKeys: ApiKeys;
}

/**
 * Error thrown for session-related failures
 */
export class SessionError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): SessionID {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Start a new session for an NPC conversation.
 *
 * This function:
 * 1. Validates the project exists and can accept sessions
 * 2. Loads the NPC definition
 * 3. Loads or creates the instance for this player
 * 4. Loads the knowledge base and resolves NPC's knowledge access
 * 5. Loads API keys
 * 6. Creates the session in the store with cached original anchor
 */
export async function startSession(
  projectId: string,
  npcId: string,
  playerId: string,
  playerInfo?: PlayerInfo,
  mode?: ConversationMode,
  userId?: string | null
): Promise<SessionStartResult> {
  const startTime = Date.now();
  logger.info({ projectId, npcId, playerId }, 'Starting session');

  const storage = getStorageForUser(userId);

  try {
    // Check if project can accept more sessions
    if (!sessionStore.canAcceptSession(projectId)) {
      const config = getConfig();
      throw new SessionError(
        `Project has reached maximum concurrent sessions (${config.limits.maxConcurrentSessions})`,
        'SESSION_LIMIT_REACHED'
      );
    }

    // Load project
    const project = await storage.getProject(projectId);

    // Load NPC definition
    const definition = await storage.getDefinition(projectId, npcId);

    // Player info is always accepted if provided (can_know_player is always true functionally)
    // Whether it's used depends on reveal_player_identity in context assembly
    const effectivePlayerInfo = playerInfo || null;

    // Default to text-text mode if not specified
    const effectiveMode = mode || CONVERSATION_MODES.TEXT_TEXT;

    // Get or create instance for this player
    const instance = await storage.getOrCreateInstance(projectId, npcId, playerId);

    // Note: Knowledge base and API keys are loaded on-demand via getSessionContext()
    // during conversation processing, not cached at session start

    // Generate session ID
    const sessionId = generateSessionId();

    // Create session state
    const now = new Date().toISOString();
    const sessionState: SessionState = {
      session_id: sessionId,
      project_id: projectId,
      definition_id: npcId,
      instance,
      conversation_history: [],
      created_at: now,
      last_activity: now,
      player_id: playerId,
      player_info: effectivePlayerInfo,
      mode: effectiveMode,
      token_usage: emptyTokenUsage(),
    };

    // Cache the original anchor for integrity checking later
    const originalAnchor: CoreAnchor = {
      backstory: definition.core_anchor.backstory,
      principles: [...definition.core_anchor.principles],
      trauma_flags: [...definition.core_anchor.trauma_flags],
    };

    // Store session with userId so endSession and getSessionContext can pick the right backend
    sessionStore.create(sessionId, sessionState, originalAnchor, userId);

    const duration = Date.now() - startTime;
    logger.info(
      {
        sessionId,
        projectId,
        npcId,
        playerId,
        instanceId: instance.id,
        duration,
      },
      'Session started'
    );

    return {
      session_id: sessionId,
      npc_name: definition.name,
      npc_description: definition.description,
      mood: instance.current_mood,
      project_name: project.name,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof SessionError) {
      logger.warn({ projectId, npcId, playerId, error: error.message, code: error.code, duration }, 'Session start failed');
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, playerId, error: errorMessage, duration }, 'Session start failed');
    throw new SessionError(`Failed to start session: ${errorMessage}`, 'SESSION_START_FAILED');
  }
}

/**
 * End a session and persist state.
 *
 * This function:
 * 1. Summarizes the conversation (unless exit_convo was used)
 * 2. Creates a memory from the summary
 * 3. Updates the NPC's mood
 * 4. Validates anchor integrity
 * 5. Saves the instance state (with history)
 * 6. Removes the session from the store
 */
export async function endSession(
  sessionId: SessionID,
  llmProvider: LLMProvider,
  exitConvoUsed: boolean = false
): Promise<SessionEndResult> {
  const startTime = Date.now();
  logger.info({ sessionId, exitConvoUsed }, 'Ending session');

  const stored = sessionStore.get(sessionId);
  if (!stored) {
    throw new SessionError(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
  }

  const { state, originalAnchor, userId } = stored;
  const storage = getStorageForUser(userId);

  try {
    // Load project, definition, and API keys for per-project LLM resolution
    const [project, definition, apiKeys] = await Promise.all([
      storage.getProject(state.project_id),
      storage.getDefinition(state.project_id, state.definition_id),
      storage.loadApiKeys(state.project_id),
    ]);

    // Resolve per-project LLM provider (BYOK), falling back to global default
    const activeProvider = resolveProjectLlmProvider(project.settings, apiKeys as Partial<Record<string, string>>, llmProvider);

    let memorySaved = false;
    const instance = state.instance;

    // Summarize conversation and create memory (unless exit_convo was used)
    if (!exitConvoUsed && state.conversation_history.length > 0) {
      try {
        const npcPerspective: NPCPerspective = {
          name: definition.name,
          backstory: definition.core_anchor.backstory,
          principles: definition.core_anchor.principles,
          salienceThreshold: definition.salience_threshold,
        };

        const summaryResult = activeProvider
          ? await summarizeConversation(activeProvider, state.conversation_history, npcPerspective)
          : { success: false, summary: null };

        if (summaryResult.success && summaryResult.summary) {
          // Calculate salience based on conversation
          const salience = calculateSalience({
            emotionalIntensity: estimateEmotionalIntensity(state.conversation_history),
            playerInvolvement: 0.8,
            novelty: 0.5,
            actionTaken: 0,
            currentMood: instance.current_mood,
          });

          // Create memory
          const memory = createMemory(summaryResult.summary, 'short_term', salience);
          instance.short_term_memory.push(memory);

          // Prune STM if over limit
          const pruneResult = pruneSTM(instance.short_term_memory);
          instance.short_term_memory = pruneResult.kept;

          memorySaved = true;
          logger.debug({ sessionId, memorySalience: salience }, 'Conversation memory created');
        }
      } catch (summaryErr) {
        // Summarization failure must not block instance save or session cleanup
        logger.warn(
          { sessionId, error: summaryErr instanceof Error ? summaryErr.message : 'Unknown' },
          'Summarization failed (non-fatal) — session will end without memory update'
        );
      }
    }

    // Update mood slightly based on conversation (gentle drift toward neutral)
    const neutralMood: MoodVector = { valence: 0.5, arousal: 0.5, dominance: 0.5 };
    instance.current_mood = blendMoods(instance.current_mood, neutralMood, 0.1);

    // Validate anchor integrity
    const anchorValid = validateAnchorIntegrity(originalAnchor, definition.core_anchor);
    if (!anchorValid) {
      logger.warn({ sessionId }, 'Anchor integrity violation detected at session end');
      // The anchor guard already logs the violation - we continue with save
    }

    // Save instance state
    const saveResult = await storage.saveInstance(instance);

    // Save usage and transcript — wrapped in try/catch, must never throw
    try {
      const endedAt = new Date().toISOString();
      const transcriptId = `tr_${sessionId}_${Date.now()}`;
      const modeStr = `${state.mode?.input ?? 'text'}-${state.mode?.output ?? 'text'}`;

      const transcript: ConversationTranscript = {
        id: transcriptId,
        project_id: state.project_id,
        npc_id: state.definition_id,
        player_id: state.player_id,
        session_id: sessionId,
        started_at: state.created_at,
        ended_at: endedAt,
        mode: modeStr,
        messages: state.conversation_history
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content })),
        token_usage: state.token_usage,
      };

      await Promise.all([
        storage.appendProjectUsage(state.project_id, state.token_usage),
        storage.saveConversationTranscript(transcript),
      ]);

      logger.debug({ sessionId, tokenUsage: state.token_usage }, 'Usage and transcript saved');
    } catch (usageErr) {
      // Non-fatal: usage tracking failure must not prevent session cleanup
      logger.warn(
        { sessionId, error: usageErr instanceof Error ? usageErr.message : 'Unknown' },
        'Failed to save usage/transcript (non-fatal)'
      );
    }

    // Remove session from store
    sessionStore.delete(sessionId);

    const duration = Date.now() - startTime;
    logger.info(
      {
        sessionId,
        version: saveResult.version,
        memorySaved,
        exitConvoUsed,
        duration,
      },
      'Session ended'
    );

    return {
      success: true,
      version: saveResult.version,
      memorySaved,
      exitConvoUsed,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage, duration }, 'Session end failed');

    // Still try to remove from store to prevent memory leak
    sessionStore.delete(sessionId);

    throw new SessionError(`Failed to end session: ${errorMessage}`, 'SESSION_END_FAILED');
  }
}

/**
 * Get a session's current state
 */
export function getSession(sessionId: SessionID): StoredSession | undefined {
  return sessionStore.get(sessionId);
}

/**
 * Get session context (useful for conversation processing)
 */
export async function getSessionContext(sessionId: SessionID): Promise<SessionContext> {
  const stored = sessionStore.get(sessionId);
  if (!stored) {
    throw new SessionError(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
  }

  const { state, userId } = stored;
  const storage = getStorageForUser(userId);

  const [project, definition, knowledgeBase, apiKeys] = await Promise.all([
    storage.getProject(state.project_id),
    storage.getDefinition(state.project_id, state.definition_id),
    storage.getKnowledgeBase(state.project_id),
    storage.loadApiKeys(state.project_id),
  ]);

  // Load MCP tools from storage and register in the singleton registry.
  // This is idempotent — re-registering the same tools overwrites safely.
  if (!mcpToolRegistry.hasProject(state.project_id)) {
    try {
      const mcpTools = await storage.getMCPTools(state.project_id);
      const allTools: Tool[] = [
        ...mcpTools.conversation_tools.map(t => ({
          name: t.id,
          description: t.description,
          parameters: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
        })),
        ...mcpTools.game_event_tools.map(t => ({
          name: t.id,
          description: t.description,
          parameters: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
        })),
      ];
      if (allTools.length > 0) {
        mcpToolRegistry.registerTools(state.project_id, allTools);
        logger.info({ projectId: state.project_id, toolCount: allTools.length }, 'MCP tools registered from storage');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.warn({ projectId: state.project_id, error: msg }, 'Failed to load MCP tools — Mind will run without conversation tools');
    }
  }

  const resolvedKnowledge = resolveKnowledge(knowledgeBase, definition.knowledge_access);

  return {
    project,
    definition,
    instance: state.instance,
    knowledgeBase,
    resolvedKnowledge,
    apiKeys,
  };
}

/**
 * Add a message to the session's conversation history
 */
export function addMessageToSession(sessionId: SessionID, message: Message): boolean {
  const stored = sessionStore.get(sessionId);
  if (!stored) {
    logger.warn({ sessionId }, 'Cannot add message to non-existent session');
    return false;
  }

  stored.state.conversation_history.push(message);
  stored.state.last_activity = new Date().toISOString();
  stored.lastActivity = Date.now();

  return true;
}

/**
 * Accumulate token/character usage for an active session.
 * Wrapped in try/catch — a failure must never break the conversation flow.
 */
export function addTokensToSession(
  sessionId: SessionID,
  usage: Partial<SessionTokenUsage>
): void {
  try {
    const stored = sessionStore.get(sessionId);
    if (!stored) return;

    const tu = stored.state.token_usage;
    if (usage.text_input_tokens) tu.text_input_tokens += usage.text_input_tokens;
    if (usage.text_output_tokens) tu.text_output_tokens += usage.text_output_tokens;
    if (usage.voice_input_chars) tu.voice_input_chars += usage.voice_input_chars;
    if (usage.voice_output_chars) tu.voice_output_chars += usage.voice_output_chars;

    stored.state.last_activity = new Date().toISOString();
  } catch {
    // Never let token tracking break the conversation
  }
}

/**
 * Update the instance state within a session
 */
export function updateSessionInstance(sessionId: SessionID, instance: NPCInstance): boolean {

  const stored = sessionStore.get(sessionId);
  if (!stored) {
    logger.warn({ sessionId }, 'Cannot update instance in non-existent session');
    return false;
  }

  stored.state.instance = instance;
  stored.state.last_activity = new Date().toISOString();
  stored.lastActivity = Date.now();

  return true;
}

/**
 * Clean up timed-out sessions
 */
export async function cleanupTimedOutSessions(llmProvider: LLMProvider): Promise<number> {
  const timedOutIds = sessionStore.findTimedOutSessions();

  if (timedOutIds.length === 0) {
    return 0;
  }

  logger.info({ count: timedOutIds.length }, 'Cleaning up timed-out sessions');

  let cleaned = 0;
  for (const sessionId of timedOutIds) {
    try {
      // End session gracefully (will summarize and save)
      await endSession(sessionId, llmProvider, false);
      cleaned++;
    } catch (error) {
      // Log but continue with other sessions
      logger.error({ sessionId, error }, 'Failed to cleanup timed-out session');
    }
  }

  logger.info({ cleaned, total: timedOutIds.length }, 'Timed-out session cleanup complete');
  return cleaned;
}

/**
 * Start periodic timeout cleanup
 */
export function startTimeoutCleanup(
  llmProvider: LLMProvider,
  intervalMs: number = 60000
): NodeJS.Timeout {
  logger.info({ intervalMs }, 'Starting session timeout cleanup');

  return setInterval(async () => {
    try {
      await cleanupTimedOutSessions(llmProvider);
    } catch (error) {
      logger.error({ error }, 'Error during timeout cleanup');
    }
  }, intervalMs);
}

/**
 * Stop periodic timeout cleanup
 */
export function stopTimeoutCleanup(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('Stopped session timeout cleanup');
}

/**
 * Estimate emotional intensity from conversation history.
 * Simple heuristic based on message count and length.
 */
function estimateEmotionalIntensity(history: Message[]): number {
  if (history.length === 0) return 0;

  // More messages = more engagement
  const messageCountFactor = Math.min(history.length / 10, 1);

  // Longer messages = more investment
  const totalLength = history.reduce((sum, m) => sum + m.content.length, 0);
  const avgLength = totalLength / history.length;
  const lengthFactor = Math.min(avgLength / 200, 1);

  return (messageCountFactor * 0.6 + lengthFactor * 0.4);
}

/**
 * Get session store statistics
 */
export function getSessionStats() {
  return sessionStore.getStats();
}
