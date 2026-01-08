import { Hono } from 'hono';
import { createLogger } from '../logger.js';
import { sessionStore } from '../session/store.js';
import { endSession, getSessionContext } from '../session/manager.js';
import { createVoicePipeline, VoicePipeline, VoicePipelineEvents } from '../voice/pipeline.js';
import { decodeClientAudio } from '../voice/audio.js';
import { canStartConversation } from '../mcp/exit-handler.js';

import type { STTProvider } from '../providers/stt/interface.js';
import type { TTSProvider } from '../providers/tts/interface.js';
import type { LLMProvider } from '../providers/llm/interface.js';
import type { VoiceConfig, ConversationMode } from '../types/voice.js';
import { CONVERSATION_MODES } from '../types/voice.js';

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

interface InterruptMessage {
  type: 'interrupt';
}

interface EndMessage {
  type: 'end';
}

type InboundMessage = InitMessage | AudioMessage | CommitMessage | TextMessage | TextInputMessage | InterruptMessage | EndMessage;

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
  | ExitConvoMessage;

/**
 * Active voice connection state
 */
interface VoiceConnection {
  sessionId: string;
  pipeline: VoicePipeline | null;
  ws: WebSocket;
}

/**
 * Map of active voice connections
 */
const activeConnections = new Map<string, VoiceConnection>();

/**
 * Provider dependencies for voice WebSocket handler
 */
export interface VoiceWebSocketDependencies {
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  llmProvider: LLMProvider;
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

  // Create connection state
  const connection: VoiceConnection = {
    sessionId,
    pipeline: null,
    ws,
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
    await cleanupConnection(connection, deps.llmProvider);
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

    case 'interrupt':
      await handleInterruptMessage(connection);
      break;

    case 'end':
      await handleEndMessage(connection, deps.llmProvider);
      break;

    default:
      logger.warn({ sessionId, messageType: (message as { type: string }).type }, 'Unknown message type');
      sendMessage(ws, { type: 'error', code: 'UNKNOWN_MESSAGE', message: 'Unknown message type' });
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

    logger.info({ sessionId }, 'handleInitMessage: creating pipeline');

    // Get mode from message or default to voice-voice for WebSocket
    const mode = msg.mode || CONVERSATION_MODES.VOICE_VOICE;
    logger.info({ sessionId, mode }, 'handleInitMessage: mode selected');

    // Create and initialize pipeline
    const pipeline = createVoicePipeline({
      sessionId,
      sttProvider: deps.sttProvider,
      ttsProvider: deps.ttsProvider,
      llmProvider: deps.llmProvider,
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
  const { pipeline, ws } = connection;

  if (!pipeline) {
    sendMessage(ws, { type: 'error', code: 'NOT_INITIALIZED', message: 'Pipeline not initialized' });
    return;
  }

  pipeline.commit();
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
 * Handle interrupt message - stop current generation
 */
async function handleInterruptMessage(connection: VoiceConnection): Promise<void> {
  const { sessionId, pipeline, ws } = connection;

  if (!pipeline) {
    sendMessage(ws, { type: 'error', code: 'NOT_INITIALIZED', message: 'Pipeline not initialized' });
    return;
  }

  try {
    await pipeline.handleInterruption();
    logger.debug({ sessionId }, 'Interruption handled via WebSocket');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId, error: errorMessage }, 'Failed to handle interruption');
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
 * Clean up a connection on close
 */
async function cleanupConnection(connection: VoiceConnection, _llmProvider: LLMProvider): Promise<void> {
  const { sessionId, pipeline } = connection;

  if (pipeline && pipeline.active) {
    try {
      await pipeline.end();
      logger.debug({ sessionId }, 'Pipeline cleaned up on connection close');
    } catch (error) {
      logger.warn({ sessionId, error: String(error) }, 'Error cleaning up pipeline');
    }
  }

  // Note: We don't automatically end the session on WebSocket close
  // The session might be reconnected, or ended via REST API
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
