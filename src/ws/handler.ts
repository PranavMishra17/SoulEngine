import { Hono } from 'hono';
import { createLogger } from '../logger.js';
import { sessionStore } from '../session/store.js';
import { endSession, getSessionContext } from '../session/manager.js';
import { createVoicePipeline, VoicePipeline, VoicePipelineEvents } from '../voice/pipeline.js';
import { decodeClientAudio } from '../voice/audio.js';
import { canStartConversation } from '../mcp/exit-handler.js';
import { DeepgramSttProvider } from '../providers/stt/deepgram.js';
import { createTtsProvider } from '../providers/tts/factory.js';
import type { TTSProviderType } from '../providers/tts/interface.js';
import { createLlmProvider, getDefaultModel, getDefaultLlmProviderType, isLlmProviderSupported } from '../providers/llm/factory.js';
import type { LLMProviderType, LLMProvider } from '../providers/llm/interface.js';
import { getConfig } from '../config.js';
import type { VoiceConfig, ConversationMode } from '../types/voice.js';
import { CONVERSATION_MODES } from '../types/voice.js';
import type { MindActivity } from '../types/mind.js';

const logger = createLogger('ws-handler');

/**
 * Inbound WebSocket message types
 */
interface InitMessage {
  type: 'init';
  session_id: string;
  mode?: ConversationMode;
}

interface AudioMessage {
  type: 'audio';
  data: string; // base64 encoded
}

interface CommitMessage {
  type: 'commit';
}

interface TextMessage {
  type: 'text';
  content: string;
}

interface TextInputMessage {
  type: 'text_input';
  text: string;
}

interface EndMessage {
  type: 'end';
}

type InboundMessage = InitMessage | AudioMessage | CommitMessage | TextMessage | TextInputMessage | EndMessage;

/**
 * Outbound WebSocket message types
 */
interface ReadyMessage {
  type: 'ready';
  session_id: string;
  npc_name: string;
  voice_config: VoiceConfig;
  mode: ConversationMode;
}

interface TranscriptMessage {
  type: 'transcript';
  text: string;
  is_final: boolean;
}

interface TextChunkMessage {
  type: 'text_chunk';
  text: string;
}

interface AudioChunkMessage {
  type: 'audio_chunk';
  data: string; // base64 encoded
}

interface ToolCallMessage {
  type: 'tool_call';
  name: string;
  args: Record<string, unknown>;
}

interface GenerationEndMessage {
  type: 'generation_end';
}

interface MindActivityMessage {
  type: 'mind_activity';
  tools_called: Array<{
    name: string;
    args: Record<string, unknown>;
    status: 'success' | 'error';
  }>;
  duration_ms: number;
  completed: boolean;
}

interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

interface SyncMessage {
  type: 'sync';
  success: boolean;
  version?: string;
}

interface ExitConvoMessage {
  type: 'exit_convo';
  reason: string;
  cooldown_seconds?: number;
}

type OutboundMessage =
  | ReadyMessage
  | TranscriptMessage
  | TextChunkMessage
  | AudioChunkMessage
  | ToolCallMessage
  | GenerationEndMessage
  | ErrorMessage
  | SyncMessage
  | ExitConvoMessage
  | MindActivityMessage;

/**
 * Active voice connection state
 */
interface VoiceConnection {
  sessionId: string;
  pipeline: VoicePipeline | null;
  ws: WebSocket;
  llmProvider: LLMProvider;
}

/**
 * Map of active voice connections
 */
const activeConnections = new Map<string, VoiceConnection>();

/**
 * Provider API key config for voice WebSocket handler.
 * Providers are created lazily in handleInitMessage after loading the NPC definition.
 */
export interface VoiceWebSocketDependencies {
  deepgramApiKey: string;
  cartesiaApiKey: string;
  elevenLabsApiKey?: string;
  llmProviderType: LLMProviderType;
  llmApiKey: string;
  defaultLlmModel: string;
}

/**
 * Create voice WebSocket routes
 */
export function createVoiceWebSocketHandler(_deps: VoiceWebSocketDependencies): Hono {
  const routes = new Hono();

  /**
   * GET /ws/voice - WebSocket voice endpoint
   *
   * Query params:
   * - session_id: Required session ID to attach to
   *
   * Note: The actual WebSocket upgrade is handled by the runtime (Bun/Node).
   * This route sets up the WebSocket handlers.
   */
  routes.get('/voice', async (c) => {
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = c.req.header('upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return c.json({ error: 'WebSocket upgrade required' }, 426);
    }

    // Get session ID from query
    const sessionId = c.req.query('session_id');
    if (!sessionId) {
      return c.json({ error: 'session_id query parameter required' }, 400);
    }

    // Verify session exists
    const stored = sessionStore.get(sessionId);
    if (!stored) {
      return c.json({ error: 'Session not found' }, 404);
    }

    // Check cooldown
    const { state } = stored;
    const cooldownCheck = canStartConversation(state.project_id, state.player_id, state.definition_id);
    if (!cooldownCheck.allowed) {
      return c.json(
        { error: 'On cooldown', remaining_seconds: cooldownCheck.remainingSeconds },
        429
      );
    }

    logger.info({ sessionId }, 'WebSocket voice connection requested');

    // The actual WebSocket upgrade and handling is done below via Bun/Node adapter
    // Return a response that the runtime will intercept for upgrade
    return new Response(null, {
      status: 101,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      },
    });
  });

  return routes;
}

/**
 * Handle a WebSocket connection for voice
 * This function is called by the runtime's WebSocket server
 */
export async function handleVoiceWebSocket(
  ws: WebSocket,
  sessionId: string,
  deps: VoiceWebSocketDependencies
): Promise<void> {
  const connectionId = `voice_${sessionId}_${Date.now()}`;
  logger.info({ sessionId, connectionId }, 'Voice WebSocket connected');

  // Create the LLM provider synchronously (needed for session cleanup on close/end)
  const llmProvider: LLMProvider = createLlmProvider({
    provider: deps.llmProviderType,
    apiKey: deps.llmApiKey,
    model: deps.defaultLlmModel,
  });

  // Create connection state
  const connection: VoiceConnection = {
    sessionId,
    pipeline: null,
    ws,
    llmProvider,
  };
  activeConnections.set(connectionId, connection);

  // Set up message handler
  ws.onmessage = async (event) => {
    try {
      const message = parseInboundMessage(event.data);
      if (!message) {
        sendMessage(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid message format' });
        return;
      }

      await handleInboundMessage(connection, message, deps);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId, connectionId, error: errorMessage }, 'Error handling WebSocket message');
      sendMessage(ws, { type: 'error', code: 'MESSAGE_ERROR', message: errorMessage });
    }
  };

  // Set up close handler
  ws.onclose = async () => {
    logger.info({ sessionId, connectionId }, 'Voice WebSocket closed');
    await cleanupConnection(connection, connection.llmProvider);
    activeConnections.delete(connectionId);
  };

  // Set up error handler
  ws.onerror = (error) => {
    logger.error({ sessionId, connectionId, error: String(error) }, 'Voice WebSocket error');
  };
}

/**
 * Parse and validate an inbound message
 */
function parseInboundMessage(data: string | Buffer | ArrayBuffer): InboundMessage | null {
  try {
    const text = typeof data === 'string' ? data : data.toString();
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }

    return parsed as InboundMessage;
  } catch {
    return null;
  }
}

/**
 * Handle an inbound message
 */
async function handleInboundMessage(
  connection: VoiceConnection,
  message: InboundMessage,
  deps: VoiceWebSocketDependencies
): Promise<void> {
  const { sessionId, ws } = connection;

  switch (message.type) {
    case 'init':
      await handleInitMessage(connection, message, deps);
      break;

    case 'audio':
      handleAudioMessage(connection, message);
      break;

    case 'commit':
      handleCommitMessage(connection);
      break;

    case 'text':
      await handleTextMessage(connection, message);
      break;

    case 'end':
      await handleEndMessage(connection, connection.llmProvider);
      break;

    default: {
      const msgType = (message as { type: string }).type;
      if (msgType === 'interrupt') {
        // Barge-in removed — interrupt is a no-op
        logger.debug({ sessionId: connection.sessionId }, 'Interrupt message received (no-op)');
      } else {
        logger.warn({ sessionId, messageType: msgType }, 'Unknown message type');
        sendMessage(ws, { type: 'error', code: 'UNKNOWN_MESSAGE', message: 'Unknown message type' });
      }
    }
  }
}

/**
 * Handle init message - initialize the voice pipeline
 */
async function handleInitMessage(
  connection: VoiceConnection,
  msg: InitMessage,
  deps: VoiceWebSocketDependencies
): Promise<void> {
  const { sessionId, ws } = connection;

  logger.info({ sessionId, messageSessionId: msg.session_id }, 'handleInitMessage: start');

  // Validate session ID matches
  if (msg.session_id !== sessionId) {
    logger.error({ sessionId, messageSessionId: msg.session_id }, 'handleInitMessage: session mismatch');
    sendMessage(ws, { type: 'error', code: 'SESSION_MISMATCH', message: 'Session ID does not match' });
    return;
  }

  // Check if already initialized
  if (connection.pipeline) {
    logger.warn({ sessionId }, 'handleInitMessage: already initialized');
    sendMessage(ws, { type: 'error', code: 'ALREADY_INITIALIZED', message: 'Pipeline already initialized' });
    return;
  }

  try {
    logger.info({ sessionId }, 'handleInitMessage: getting session context');

    // Get session context to get voice config
    const context = await getSessionContext(sessionId);
    const voiceConfig = context.definition.voice;

    logger.info({
      sessionId,
      voiceProvider: voiceConfig.provider,
      voiceId: voiceConfig.voice_id,
      speed: voiceConfig.speed
    }, 'handleInitMessage: voice config loaded');

    // Create pipeline events
    const events: VoicePipelineEvents = {
      onTranscript: (text, isFinal) => {
        logger.debug({ sessionId, text: text.slice(0, 50), isFinal }, 'Pipeline event: transcript');
        sendMessage(ws, { type: 'transcript', text, is_final: isFinal });
      },
      onTextChunk: (text) => {
        logger.debug({ sessionId, chunkLength: text.length }, 'Pipeline event: text_chunk');
        sendMessage(ws, { type: 'text_chunk', text });
      },
      onAudioChunk: (audioBase64) => {
        logger.debug({ sessionId, audioLength: audioBase64.length }, 'Pipeline event: audio_chunk');
        sendMessage(ws, { type: 'audio_chunk', data: audioBase64 });
      },
      onToolCall: (name, args) => {
        logger.info({ sessionId, toolName: name }, 'Pipeline event: tool_call');
        sendMessage(ws, { type: 'tool_call', name, args });
      },
      onGenerationEnd: () => {
        logger.info({ sessionId }, 'Pipeline event: generation_end');
        sendMessage(ws, { type: 'generation_end' });
      },
      onMindActivity: (activity: MindActivity) => {
        logger.info({ sessionId, toolCount: activity.tools_called.length }, 'Pipeline event: mind_activity');
        sendMessage(ws, {
          type: 'mind_activity',
          tools_called: activity.tools_called,
          duration_ms: activity.duration_ms,
          completed: activity.completed,
        });
      },
      onError: (code, message) => {
        logger.error({ sessionId, code, message }, 'Pipeline event: error');
        sendMessage(ws, { type: 'error', code, message });
      },
      onExitConvo: (reason, cooldownSeconds) => {
        logger.info({ sessionId, reason, cooldownSeconds }, 'Pipeline event: exit_convo');
        sendMessage(ws, { type: 'exit_convo', reason, cooldown_seconds: cooldownSeconds });
        // Close WebSocket after exit_convo - session was already ended by pipeline
        logger.info({ sessionId }, 'Closing WebSocket after exit_convo');
        ws.close(1000, 'Session ended by NPC');
      },
    };

    logger.info({ sessionId }, 'handleInitMessage: creating providers');

    // Create providers from API key config + voice config loaded above
    const ttsProviderType = (voiceConfig.provider || 'cartesia') as TTSProviderType;
    const ttsApiKey = ttsProviderType === 'elevenlabs' ? deps.elevenLabsApiKey : deps.cartesiaApiKey;
    if (!ttsApiKey) {
      logger.error({ sessionId, ttsProviderType }, 'handleInitMessage: TTS API key not configured');
      sendMessage(ws, { type: 'error', code: 'TTS_KEY_MISSING', message: `${ttsProviderType} API key not configured` });
      return;
    }

    // Resolve per-project LLM provider (same logic as conversation.ts)
    const projectSettings = context.project.settings;
    const defaultProviderType = getDefaultLlmProviderType();
    const rawProviderType = projectSettings.llm_provider || deps.llmProviderType;
    const resolvedProviderType: LLMProviderType = isLlmProviderSupported(rawProviderType)
      ? rawProviderType
      : defaultProviderType;
    const resolvedModelId = projectSettings.llm_model || getDefaultModel(resolvedProviderType);

    // API key priority: project-specific key → server env key for that provider
    const projectApiKey = context.apiKeys[resolvedProviderType as keyof typeof context.apiKeys];
    const serverConfig = getConfig();
    const serverApiKeyForProvider = (() => {
      switch (resolvedProviderType) {
        case 'gemini': return serverConfig.providers.geminiApiKey;
        case 'openai': return serverConfig.providers.openaiApiKey;
        case 'anthropic': return serverConfig.providers.anthropicApiKey;
        case 'grok': return serverConfig.providers.grokApiKey;
        default: return undefined;
      }
    })();
    const resolvedLlmApiKey = projectApiKey || serverApiKeyForProvider;

    if (!resolvedLlmApiKey) {
      logger.error({ sessionId, resolvedProviderType }, 'handleInitMessage: LLM API key not configured for project');
      sendMessage(ws, { type: 'error', code: 'LLM_KEY_MISSING', message: `LLM API key not configured for provider: ${resolvedProviderType}` });
      return;
    }

    const sttProvider = new DeepgramSttProvider({ apiKey: deps.deepgramApiKey });
    const ttsProvider = createTtsProvider({ provider: ttsProviderType, apiKey: ttsApiKey });
    const llmProvider: LLMProvider = createLlmProvider({
      provider: resolvedProviderType,
      apiKey: resolvedLlmApiKey,
      model: resolvedModelId,
    });

    logger.info({ sessionId, ttsProviderType, voiceId: voiceConfig.voice_id, llmProvider: resolvedProviderType, llmModel: resolvedModelId }, 'handleInitMessage: providers created');

    // Mind provider resolution (can use different model/provider per project settings)
    const mindRawProviderType = projectSettings.mind_provider || resolvedProviderType;
    const mindProviderType: LLMProviderType = isLlmProviderSupported(mindRawProviderType)
      ? mindRawProviderType
      : resolvedProviderType;
    const mindModelId = projectSettings.mind_model || getDefaultModel(mindProviderType);
    const mindApiKeyForProvider = context.apiKeys[mindProviderType as keyof typeof context.apiKeys]
      || (() => {
        switch (mindProviderType) {
          case 'gemini': return serverConfig.providers.geminiApiKey;
          case 'openai': return serverConfig.providers.openaiApiKey;
          case 'anthropic': return serverConfig.providers.anthropicApiKey;
          case 'grok': return serverConfig.providers.grokApiKey;
          default: return undefined;
        }
      })();

    const mindLlmProvider: LLMProvider = mindApiKeyForProvider
      ? createLlmProvider({ provider: mindProviderType, apiKey: mindApiKeyForProvider, model: mindModelId })
      : llmProvider;  // fall back to same provider

    logger.info({ sessionId, mindProvider: mindProviderType, mindModel: mindModelId }, 'handleInitMessage: Mind provider created');

    // Get mode from message or default to voice-voice for WebSocket
    const mode = msg.mode || CONVERSATION_MODES.VOICE_VOICE;
    logger.info({ sessionId, mode }, 'handleInitMessage: mode selected');

    // Create and initialize pipeline
    const pipeline = createVoicePipeline({
      sessionId,
      sttProvider,
      ttsProvider,
      llmProvider,
      mindProvider: mindLlmProvider,
      voiceConfig,
      events,
      mode,
    });

    logger.info({ sessionId }, 'handleInitMessage: initializing pipeline');

    await pipeline.initialize();
    connection.pipeline = pipeline;

    logger.info({ sessionId }, 'handleInitMessage: sending ready message');

    // Send ready message with mode
    sendMessage(ws, {
      type: 'ready',
      session_id: sessionId,
      npc_name: context.definition.name,
      voice_config: voiceConfig,
      mode,
    });

    logger.info({ sessionId, npcName: context.definition.name }, 'handleInitMessage: complete');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
      sessionId,
      error: errorMessage,
      stack: errorStack
    }, 'handleInitMessage: failed');

    sendMessage(ws, { type: 'error', code: 'INIT_FAILED', message: errorMessage });
  }
}

/**
 * Handle audio message - push audio to STT
 */
function handleAudioMessage(connection: VoiceConnection, message: AudioMessage): void {
  const { sessionId, pipeline, ws } = connection;

  if (!pipeline) {
    sendMessage(ws, { type: 'error', code: 'NOT_INITIALIZED', message: 'Pipeline not initialized' });
    return;
  }

  try {
    const audioBuffer = decodeClientAudio(message.data);
    pipeline.pushAudio(audioBuffer);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage }, 'Failed to process audio');
    sendMessage(ws, { type: 'error', code: 'AUDIO_ERROR', message: errorMessage });
  }
}

/**
 * Handle commit message - signal end of user turn
 */
function handleCommitMessage(connection: VoiceConnection): void {
  const { pipeline, ws, sessionId } = connection;

  if (!pipeline) {
    sendMessage(ws, { type: 'error', code: 'NOT_INITIALIZED', message: 'Pipeline not initialized' });
    return;
  }

  try {
    pipeline.commit();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage }, 'Failed to commit audio');
    sendMessage(ws, { type: 'error', code: 'COMMIT_ERROR', message: errorMessage });
  }
}

/**
 * Handle text message - process text input
 */
async function handleTextMessage(connection: VoiceConnection, message: TextMessage): Promise<void> {
  const { sessionId, pipeline, ws } = connection;

  if (!pipeline) {
    sendMessage(ws, { type: 'error', code: 'NOT_INITIALIZED', message: 'Pipeline not initialized' });
    return;
  }

  try {
    await pipeline.handleTextInput(message.content);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage }, 'Failed to process text input');
    sendMessage(ws, { type: 'error', code: 'TEXT_ERROR', message: errorMessage });
  }
}

/**
 * Handle end message - end the voice session
 */
async function handleEndMessage(connection: VoiceConnection, llmProvider: LLMProvider): Promise<void> {
  const { sessionId, pipeline, ws } = connection;

  try {
    // End pipeline if active
    if (pipeline) {
      await pipeline.end();
    }

    // End session
    const exitConvoUsed = pipeline?.wasExitConvoUsed() ?? false;
    const result = await endSession(sessionId, llmProvider, exitConvoUsed);

    // Send sync message
    sendMessage(ws, {
      type: 'sync',
      success: result.success,
      version: result.version,
    });

    logger.info({ sessionId, version: result.version }, 'Voice session ended via WebSocket');

    // Close WebSocket
    ws.close(1000, 'Session ended');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage }, 'Failed to end voice session');
    sendMessage(ws, { type: 'error', code: 'END_FAILED', message: errorMessage });
  }
}

/**
 * Clean up a connection on close.
 * Ends the pipeline and the session so transcripts/usage are always saved,
 * even when the browser tab is closed abruptly.
 */
async function cleanupConnection(connection: VoiceConnection, llmProvider: LLMProvider): Promise<void> {
  const { sessionId, pipeline } = connection;

  try {
    // End the voice pipeline first
    if (pipeline && pipeline.active) {
      await pipeline.end();
      logger.debug({ sessionId }, 'Pipeline cleaned up on connection close');
    }

    // Auto-end session if it's still alive (saves transcript + usage).
    // This runs when the WS closes for any reason (tab close, network drop, explicit 'end').
    // endSession is idempotent — if already ended it throws SESSION_NOT_FOUND which we catch.
    const sessionStillActive = sessionStore.get(sessionId);
    if (sessionStillActive) {
      const exitConvoUsed = pipeline?.wasExitConvoUsed() ?? false;
      await endSession(sessionId, llmProvider, exitConvoUsed);
      logger.info({ sessionId }, 'Session auto-ended on WebSocket close');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // SESSION_NOT_FOUND is expected if the session was already ended via the 'end' message
    if (!msg.includes('SESSION_NOT_FOUND') && !msg.includes('not found')) {
      logger.warn({ sessionId, error: msg }, 'Error during connection cleanup (non-fatal)');
    }
  }
}


/**
 * Send a message to the WebSocket client
 */
function sendMessage(ws: WebSocket, message: OutboundMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Get count of active voice connections
 */
export function getActiveVoiceConnectionCount(): number {
  return activeConnections.size;
}

/**
 * Get all active connection session IDs
 */
export function getActiveVoiceSessionIds(): string[] {
  return Array.from(activeConnections.values()).map((c) => c.sessionId);
}
