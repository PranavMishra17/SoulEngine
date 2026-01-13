import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import { sessionStore, StoredSession } from './store.js';
import {
  getProject,
  getDefinition,
  getOrCreateInstance,
  saveInstance,
  getKnowledgeBase,
  loadApiKeys,
  type ApiKeys,
} from '../storage/index.js';
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
  mode?: ConversationMode
): Promise<SessionStartResult> {
  const startTime = Date.now();
  logger.info({ projectId, npcId, playerId }, 'Starting session');

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
    const project = await getProject(projectId);

    // Load NPC definition
    const definition = await getDefinition(projectId, npcId);
    
    // Player info is always accepted if provided (can_know_player is always true functionally)
    // Whether it's used depends on reveal_player_identity in context assembly
    const effectivePlayerInfo = playerInfo || null;

    // Default to text-text mode if not specified
    const effectiveMode = mode || CONVERSATION_MODES.TEXT_TEXT;

    // Get or create instance for this player
    const instance = await getOrCreateInstance(projectId, npcId, playerId);

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
    };

    // Cache the original anchor for integrity checking later
    const originalAnchor: CoreAnchor = {
      backstory: definition.core_anchor.backstory,
      principles: [...definition.core_anchor.principles],
      trauma_flags: [...definition.core_anchor.trauma_flags],
    };

    // Store session
    sessionStore.create(sessionId, sessionState, originalAnchor);

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

  const { state, originalAnchor } = stored;

  try {
    // Load definition for summarization context
    const definition = await getDefinition(state.project_id, state.definition_id);

    let memorySaved = false;
    const instance = state.instance;

    // Summarize conversation and create memory (unless exit_convo was used)
    if (!exitConvoUsed && state.conversation_history.length > 0) {
      const npcPerspective: NPCPerspective = {
        name: definition.name,
        backstory: definition.core_anchor.backstory,
        principles: definition.core_anchor.principles,
        salienceThreshold: definition.salience_threshold,
      };

      const summaryResult = await summarizeConversation(
        llmProvider,
        state.conversation_history,
        npcPerspective
      );

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
    const saveResult = await saveInstance(instance);

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

  const { state } = stored;

  const [project, definition, knowledgeBase, apiKeys] = await Promise.all([
    getProject(state.project_id),
    getDefinition(state.project_id, state.definition_id),
    getKnowledgeBase(state.project_id),
    loadApiKeys(state.project_id),
  ]);

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
