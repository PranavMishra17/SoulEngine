import { createLogger } from '../logger.js';
import { sanitize } from '../security/sanitizer.js';
import { moderate } from '../security/moderator.js';
import { rateLimiter } from '../security/rate-limiter.js';
import {
  getSessionContext,
  addMessageToSession,
  updateSessionInstance,
  addTokensToSession,
  endSession,
  SessionContext,
  SessionError,
} from '../session/manager.js';
import { sessionStore } from '../session/store.js';
import { assembleSlimSystemPrompt, assembleConversationHistory } from '../core/context.js';
import { runMindAgentLoop } from '../core/mind.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { handleExitConvo, processExitResult } from '../mcp/exit-handler.js';
import { SentenceDetector } from './sentence-detector.js';
import { encodeTtsAudio } from './audio.js';

import type { SessionID, Message } from '../types/session.js';
import type { SecurityContext } from '../types/security.js';
import type { TranscriptEvent, TTSChunk, VoiceConfig, ConversationMode } from '../types/voice.js';
import type { MindResult, MindActivity } from '../types/mind.js';
import type { STTProvider, STTSession, STTSessionConfig, STTSessionEvents } from '../providers/stt/interface.js';
import type { TTSProvider, TTSSession, TTSSessionConfig, TTSSessionEvents } from '../providers/tts/interface.js';
import type { LLMProvider } from '../providers/llm/interface.js';

const logger = createLogger('voice-pipeline');

/**
 * Events emitted by the voice pipeline to the WebSocket handler
 */
export interface VoicePipelineEvents {
  /** Called when STT produces a transcript */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Called when LLM produces text (for UI display) */
  onTextChunk: (text: string) => void;
  /** Called when TTS produces audio */
  onAudioChunk: (audioBase64: string) => void;
  /** Called when LLM triggers a tool call (kept for backward compat; Mind reports via onMindActivity) */
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  /** Called when the NPC's turn is complete. Optional phase param indicates speaker vs followup. */
  onGenerationEnd: (phase?: 'speaker' | 'followup') => void;
  /** Called on error */
  onError: (code: string, message: string) => void;
  /** Called when exit_convo is triggered */
  onExitConvo: (reason: string, cooldownSeconds?: number) => void;
  /** Called when Mind completes with tool activity */
  onMindActivity: (activity: MindActivity) => void;
  /** Called when Mind follow-up speech begins */
  onFollowupStart: () => void;
}

/**
 * Configuration for creating a voice pipeline
 */
export interface VoicePipelineConfig {
  sessionId: SessionID;
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  llmProvider: LLMProvider;
  mindProvider: LLMProvider;
  voiceConfig: VoiceConfig;
  events: VoicePipelineEvents;
  /** Conversation mode - determines which providers to initialize */
  mode: ConversationMode;
}

/**
 * Internal state for tracking a turn
 */
interface TurnState {
  abortController: AbortController;
  isProcessing: boolean;
  exitConvoUsed: boolean;
}

/**
 * VoicePipeline orchestrates the full voice conversation flow:
 * Client audio -> STT -> Security -> Context -> LLM -> TTS -> Client audio
 *
 * It manages:
 * - STT streaming session for audio input
 * - TTS streaming session for audio output
 * - LLM streaming for text generation
 * - Security pipeline integration
 * - Tool calling and exit_convo handling
 * - Interruption handling
 */
export class VoicePipeline {
  private readonly sessionId: SessionID;
  private readonly sttProvider: STTProvider;
  private readonly ttsProvider: TTSProvider;
  private readonly llmProvider: LLMProvider;
  private readonly mindProvider: LLMProvider;
  private readonly voiceConfig: VoiceConfig;
  private readonly events: VoicePipelineEvents;
  private readonly mode: ConversationMode;

  private sttSession: STTSession | null = null;
  private ttsSession: TTSSession | null = null;
  private sentenceDetector: SentenceDetector;
  private turnState: TurnState | null = null;

  private accumulatedTranscript: string = '';
  private isActive: boolean = false;

  // Deduplication: prevent processing same transcript twice
  private lastProcessedTimestamp: number = 0;
  private lastProcessedHash: string = '';
  private static readonly DEDUP_WINDOW_MS = 1000; // Ignore duplicate transcripts within 1 second

  // Processing lock: prevent concurrent transcript processing
  private isProcessingTranscript: boolean = false;
  private pendingTranscript: TranscriptEvent | null = null;

  // Transcript aggregation: combine fragmented speech into complete utterances
  private transcriptAggregator: {
    text: string;
    timer: NodeJS.Timeout | null;
    lastTimestamp: number;
  } = { text: '', timer: null, lastTimestamp: 0 };
  private static readonly AGGREGATION_WINDOW_MS = 1500; // Wait 1.5s after last speech_final

  // Suppress the next STT final transcript when commit() already processed the interim.
  // Without this, commit() processes interim → NPC responds, then STT final arrives
  // 1.5s later via the aggregation timer → NPC responds a second time for the same utterance.
  private pendingSTTFinal: boolean = false;

  constructor(config: VoicePipelineConfig) {
    this.sessionId = config.sessionId;
    this.sttProvider = config.sttProvider;
    this.ttsProvider = config.ttsProvider;
    this.llmProvider = config.llmProvider;
    this.mindProvider = config.mindProvider;
    this.voiceConfig = config.voiceConfig;
    this.events = config.events;
    this.mode = config.mode;
    this.sentenceDetector = new SentenceDetector();

    logger.info({ sessionId: this.sessionId, mode: this.mode }, 'VoicePipeline created');
  }

  /**
   * Initialize the pipeline - connect STT and TTS sessions
   */
  /**
   * Initialize the pipeline based on conversation mode
   */
  async initialize(): Promise<void> {
    logger.info({ sessionId: this.sessionId, mode: this.mode }, 'VoicePipeline.initialize: start');

    try {
      // Only initialize STT if input mode is voice
      if (this.mode.input === 'voice') {
        await this.initializeSTT();
      } else {
        logger.info({ sessionId: this.sessionId }, 'Skipping STT init (text input mode)');
      }

      // Only initialize TTS if output mode is voice
      if (this.mode.output === 'voice') {
        await this.initializeTTS();
      } else {
        logger.info({ sessionId: this.sessionId }, 'Skipping TTS init (text output mode)');
      }

      this.isActive = true;
      logger.info({ sessionId: this.sessionId }, 'VoicePipeline.initialize: complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId: this.sessionId, error: message }, 'VoicePipeline.initialize: failed');
      throw error;
    }
  }

  /**
   * Initialize STT session
   */
  private async initializeSTT(): Promise<void> {
    const sttConfig: STTSessionConfig = {
      sampleRate: 16000,
      encoding: 'linear16',
      punctuate: true,
      interimResults: true,
    };

    logger.info({ sessionId: this.sessionId, sttConfig }, 'Creating STT session');

    const sttEvents: STTSessionEvents = {
      onTranscript: (event) => {
        logger.debug({ sessionId: this.sessionId, text: event.text.slice(0, 30), isFinal: event.isFinal }, 'STT transcript');
        this.handleSTTTranscript(event);
      },
      onError: (error) => {
        logger.error({ sessionId: this.sessionId, error: error.message }, 'STT error');
        this.handleSTTError(error);
      },
      onClose: () => {
        logger.info({ sessionId: this.sessionId }, 'STT session closed');
        this.handleSTTClose();
      },
      onOpen: () => {
        logger.info({ sessionId: this.sessionId }, 'STT session opened');
      },
    };

    try {
      this.sttSession = await this.sttProvider.createSession(sttConfig, sttEvents);
      logger.info({ sessionId: this.sessionId }, 'STT session created');
    } catch (sttError) {
      const errorMessage = sttError instanceof Error ? sttError.message : String(sttError);
      logger.error({ sessionId: this.sessionId, error: errorMessage }, 'STT session creation failed');
      throw new Error(`STT initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Initialize TTS session
   */
  private async initializeTTS(): Promise<void> {
    const ttsConfig: TTSSessionConfig = {
      voiceId: this.voiceConfig.voice_id,
      speed: this.voiceConfig.speed,
      outputFormat: 'pcm_s16le',
    };

    logger.info({ sessionId: this.sessionId, ttsConfig }, 'Creating TTS session');

    const ttsEvents: TTSSessionEvents = {
      onAudioChunk: (chunk) => {
        logger.debug({ sessionId: this.sessionId, audioBytes: chunk.audio.length }, 'TTS audio chunk');
        this.handleTTSAudioChunk(chunk);
      },
      onComplete: () => {
        logger.debug({ sessionId: this.sessionId }, 'TTS synthesis complete');
      },
      onError: (error) => {
        logger.error({ sessionId: this.sessionId, error: error.message }, 'TTS error');
        this.handleTTSError(error);
      },
    };

    try {
      this.ttsSession = await this.ttsProvider.createSession(ttsConfig, ttsEvents);
      logger.info({ sessionId: this.sessionId }, 'TTS session created');
    } catch (ttsError) {
      const errorMessage = ttsError instanceof Error ? ttsError.message : String(ttsError);
      logger.error({ sessionId: this.sessionId, error: errorMessage }, 'TTS session creation failed');

      // Clean up STT session if TTS fails (if it was initialized)
      if (this.sttSession) {
        try {
          this.sttSession.close();
        } catch (cleanupError) {
          logger.warn({ sessionId: this.sessionId }, 'Failed to cleanup STT session after TTS failure');
        }
      }

      throw new Error(`TTS initialization failed: ${errorMessage}`);
    }
  }

  // Track audio chunks for periodic logging
  private audioChunkCount: number = 0;

  /**
   * Push audio data from client to STT
   */
  pushAudio(audioBuffer: Buffer): void {
    if (this.mode.input !== 'voice') {
      logger.warn({ sessionId: this.sessionId }, 'Audio received but input mode is text');
      this.events.onError('MODE_MISMATCH', 'Voice input not enabled for this session');
      return;
    }

    if (!this.isActive || !this.sttSession) {
      logger.warn({ sessionId: this.sessionId }, 'pushAudio: inactive or no STT session');
      return;
    }

    if (!this.sttSession.isConnected) {
      logger.warn({ sessionId: this.sessionId }, 'pushAudio: STT not connected');
      return;
    }

    this.audioChunkCount++;

    // Periodic logging (every 50 chunks)
    if (this.audioChunkCount % 50 === 0) {
      logger.debug({
        sessionId: this.sessionId,
        chunkCount: this.audioChunkCount,
        bufferSize: audioBuffer.length
      }, 'pushAudio: sending to STT');
    }

    this.sttSession.sendAudio(audioBuffer);
  }

  /**
   * Handle pure text input (alternative to audio)
   */
  async handleTextInput(text: string): Promise<void> {
    logger.info({ sessionId: this.sessionId, inputLength: text.length }, 'Processing text input');

    // Create a synthetic "final" transcript event
    const event: TranscriptEvent = {
      text,
      isFinal: true,
      timestamp: Date.now(),
    };

    await this.processTranscript(event);
  }

  /**
   * Signal that the user has committed their current input
   * (e.g., finished speaking for this turn)
   */
  commit(): void {
    if (this.sttSession?.isConnected) {
      this.sttSession.finalize();
    }

    // If we have accumulated interim transcript, add it to aggregator for proper handling
    // This prevents double-processing when STT's speech_final comes in after VAD commit
    if (this.accumulatedTranscript.trim()) {
      const text = this.accumulatedTranscript.trim();
      this.accumulatedTranscript = '';

      // Add to aggregator if not already there (prevents duplicates)
      if (!this.transcriptAggregator.text.includes(text)) {
        if (this.transcriptAggregator.text) {
          this.transcriptAggregator.text += ' ' + text;
        } else {
          this.transcriptAggregator.text = text;
        }
        logger.debug({
          sessionId: this.sessionId,
          addedLength: text.length,
          totalLength: this.transcriptAggregator.text.length
        }, 'Commit: added interim to aggregator');
      }
    }

    // Restart debounce timer — do NOT flush immediately.
    // VAD fires multiple speech-end events for natural mid-sentence pauses; debouncing
    // combines all rapid segments into a single LLM turn instead of one per segment.
    if (this.transcriptAggregator.text.trim()) {
      if (this.transcriptAggregator.timer) {
        clearTimeout(this.transcriptAggregator.timer);
      }
      this.transcriptAggregator.timer = setTimeout(() => {
        this.processAggregatedTranscript();
      }, VoicePipeline.AGGREGATION_WINDOW_MS);

      // Suppress the STT final for this VAD segment (interim text already captured above).
      // If a new speech segment starts before the STT final arrives, pendingSTTFinal gets
      // reset to false — that's fine, aggregateTranscript() will deduplicate the text.
      this.pendingSTTFinal = true;
      logger.debug({
        sessionId: this.sessionId,
        textLength: this.transcriptAggregator.text.length
      }, 'Commit: debounce timer (re)started');
    } else {
      logger.debug({ sessionId: this.sessionId }, 'Commit: nothing to process, STT finalize sent');
    }
  }

  /**
   * Handle interruption - stop current generation
   */
  async handleInterruption(): Promise<void> {
    logger.info({ sessionId: this.sessionId }, 'Handling interruption');

    // Clear transcript aggregator to prevent processing partial speech
    if (this.transcriptAggregator.timer) {
      clearTimeout(this.transcriptAggregator.timer);
    }
    this.transcriptAggregator.text = '';
    this.transcriptAggregator.timer = null;

    if (this.turnState?.isProcessing) {
      // Abort LLM generation
      this.turnState.abortController.abort();

      // Abort TTS
      if (this.ttsSession) {
        this.ttsSession.abort();
      }

      // Clear sentence detector buffer
      this.sentenceDetector.clear();

      logger.debug({ sessionId: this.sessionId }, 'Interruption handled');
    }
  }

  /**
   * End the pipeline - close all connections
   */
  async end(): Promise<void> {
    logger.info({ sessionId: this.sessionId }, 'Ending voice pipeline');

    this.isActive = false;

    // Clear aggregator timer
    if (this.transcriptAggregator.timer) {
      clearTimeout(this.transcriptAggregator.timer);
      this.transcriptAggregator.timer = null;
    }
    this.transcriptAggregator.text = '';

    // Abort any ongoing generation
    if (this.turnState?.isProcessing) {
      this.turnState.abortController.abort();
    }

    // Close STT
    if (this.sttSession) {
      try {
        this.sttSession.close();
      } catch (error) {
        logger.warn({ sessionId: this.sessionId }, 'Error closing STT session');
      }
      this.sttSession = null;
    }

    // Close TTS
    if (this.ttsSession) {
      try {
        this.ttsSession.close();
      } catch (error) {
        logger.warn({ sessionId: this.sessionId }, 'Error closing TTS session');
      }
      this.ttsSession = null;
    }

    logger.info({ sessionId: this.sessionId }, 'Voice pipeline ended');
  }

  /**
   * Check if exit_convo was used during conversation
   */
  wasExitConvoUsed(): boolean {
    return this.turnState?.exitConvoUsed ?? false;
  }

  /**
   * Check if pipeline is active
   */
  get active(): boolean {
    return this.isActive;
  }

  // --- Private Methods ---

  /**
   * Handle STT transcript events
   */
  private handleSTTTranscript(event: TranscriptEvent): void {
    if (!event.isFinal) {
      // Emit interim to client for live preview
      this.events.onTranscript(event.text, false);
      // New interim = new speech turn. Reset suppress flag.
      this.pendingSTTFinal = false;
      // Accumulate interim transcript for commit() to use
      this.accumulatedTranscript = event.text;
      return;
    }

    // --- Final transcript ---
    // CRITICAL: Clear accumulated transcript since STT provided final
    this.accumulatedTranscript = '';

    if (this.pendingSTTFinal) {
      // commit() already processed this utterance via interim text.
      // processAggregatedTranscript() already emitted onTranscript to the client.
      // Discard this STT final to prevent a duplicate NPC response.
      this.pendingSTTFinal = false;
      logger.debug({ sessionId: this.sessionId }, 'Discarding STT final — already processed via commit interim');
      return;
    }

    // Non-commit path: aggregate and let processAggregatedTranscript emit to client
    this.aggregateTranscript(event);
  }

  /**
   * Aggregate transcript chunks with a debounce window
   * This combines fragmented speech into complete utterances
   */
  private aggregateTranscript(event: TranscriptEvent): void {
    const text = event.text.trim();
    if (!text) return;

    // Clear existing timer
    if (this.transcriptAggregator.timer) {
      clearTimeout(this.transcriptAggregator.timer);
    }

    // Append to aggregated text, skipping duplicates (commit() may have already added this text)
    if (!this.transcriptAggregator.text.includes(text)) {
      if (this.transcriptAggregator.text) {
        this.transcriptAggregator.text += ' ' + text;
      } else {
        this.transcriptAggregator.text = text;
      }
    }
    this.transcriptAggregator.lastTimestamp = Date.now();

    logger.debug({
      sessionId: this.sessionId,
      aggregatedLength: this.transcriptAggregator.text.length,
      latestChunk: text.slice(0, 30)
    }, 'Transcript aggregated, waiting for more');

    // Set timer to process after window expires
    this.transcriptAggregator.timer = setTimeout(() => {
      this.processAggregatedTranscript();
    }, VoicePipeline.AGGREGATION_WINDOW_MS);
  }

  /**
   * Process the aggregated transcript after the debounce window
   */
  private processAggregatedTranscript(): void {
    const aggregatedText = this.transcriptAggregator.text.trim();

    // Reset aggregator
    this.transcriptAggregator.text = '';
    this.transcriptAggregator.timer = null;

    if (!aggregatedText) return;

    logger.info({
      sessionId: this.sessionId,
      textLength: aggregatedText.length,
      text: aggregatedText.slice(0, 50)
    }, 'Processing aggregated transcript');

    // Emit final transcript to client — this is the single authoritative emit point
    // for final transcripts (both commit path and non-commit/STT-final path)
    this.events.onTranscript(aggregatedText, true);

    // Deduplication check
    const hash = aggregatedText.toLowerCase().trim();
    const now = Date.now();
    const timeSinceLast = now - this.lastProcessedTimestamp;

    if (timeSinceLast < VoicePipeline.DEDUP_WINDOW_MS && hash === this.lastProcessedHash) {
      logger.warn({ sessionId: this.sessionId }, 'Duplicate aggregated transcript, skipping');
      return;
    }

    // Update deduplication state
    this.lastProcessedTimestamp = now;
    this.lastProcessedHash = hash;

    // Create synthetic event with combined text
    const event: TranscriptEvent = {
      text: aggregatedText,
      isFinal: true,
      timestamp: now,
    };

    // Process with lock
    this.processTranscriptWithLock(event);
  }


  /**
   * Handle STT errors
   */
  private handleSTTError(error: Error): void {
    logger.error({ sessionId: this.sessionId, error: error.message }, 'STT error');
    this.events.onError('STT_ERROR', error.message);
  }

  /**
   * Handle STT session close
   */
  private handleSTTClose(): void {
    logger.debug({ sessionId: this.sessionId }, 'STT session closed');
  }

  /**
   * Handle TTS audio chunks
   */
  private handleTTSAudioChunk(chunk: TTSChunk): void {
    logger.info({ sessionId: this.sessionId, audioBytes: chunk.audio.length, isComplete: chunk.isComplete }, 'TTS audio chunk received');
    const audioBase64 = encodeTtsAudio(chunk.audio);
    this.events.onAudioChunk(audioBase64);
  }

  /**
   * Handle TTS errors
   */
  private handleTTSError(error: Error): void {
    logger.error({ sessionId: this.sessionId, error: error.message }, 'TTS error');
    // TTS errors are not fatal - we can fall back to text-only
    this.events.onError('TTS_ERROR', error.message);
  }

  /**
   * Process transcript with lock to prevent concurrent processing
   * This ensures only one transcript is processed at a time
   */
  private processTranscriptWithLock(event: TranscriptEvent): void {
    // If already processing, queue this one (only keep latest)
    if (this.isProcessingTranscript) {
      logger.debug({ sessionId: this.sessionId }, 'Transcript queued - already processing');
      this.pendingTranscript = event;
      return;
    }

    this.isProcessingTranscript = true;

    this.processTranscript(event)
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ sessionId: this.sessionId, error: message }, 'Failed to process transcript');
        this.events.onError('PROCESSING_ERROR', message);
      })
      .finally(() => {
        this.isProcessingTranscript = false;

        // Process queued transcript if any
        if (this.pendingTranscript) {
          const pending = this.pendingTranscript;
          this.pendingTranscript = null;
          this.processTranscriptWithLock(pending);
        }
      });
  }

  /**
   * Process a final transcript through the full pipeline
   */
  private async processTranscript(event: TranscriptEvent): Promise<void> {
    const text = event.text.trim();
    if (text.length === 0) {
      return;
    }

    logger.info({ sessionId: this.sessionId, textLength: text.length }, 'Processing transcript');

    // Get session state
    const stored = sessionStore.get(this.sessionId);
    if (!stored) {
      throw new SessionError(`Session not found: ${this.sessionId}`, 'SESSION_NOT_FOUND');
    }

    const { state } = stored;

    // Security pipeline
    const securityContext = await this.runSecurityPipeline(
      text,
      state.project_id,
      state.player_id,
      state.definition_id
    );

    if (!securityContext) {
      // Input blocked by security
      return;
    }

    // Get session context for LLM
    const context = await getSessionContext(this.sessionId);

    // Add user message to session history
    const userMessage: Message = { role: 'user', content: securityContext.sanitized ? text : text };
    addMessageToSession(this.sessionId, userMessage);

    // Process turn with LLM
    await this.processTurn(text, context, securityContext);
  }

  /**
   * Run the security pipeline on input
   */
  private async runSecurityPipeline(
    input: string,
    projectId: string,
    playerId: string,
    npcId: string
  ): Promise<SecurityContext | null> {
    // 1. Sanitize
    const sanitizeResult = sanitize(input);
    if (sanitizeResult.violations.length > 0) {
      logger.warn(
        { sessionId: this.sessionId, violations: sanitizeResult.violations },
        'Input sanitization violations'
      );
    }

    // 2. Rate limit
    const rateLimitResult = rateLimiter.checkLimit(projectId, playerId, npcId);
    if (!rateLimitResult.allowed) {
      logger.warn({ sessionId: this.sessionId, resetAt: rateLimitResult.resetAt }, 'Rate limit exceeded');
      this.events.onError('RATE_LIMIT', 'Too many messages. Please wait before sending more.');
      return null;
    }

    // 3. Moderate
    const moderationResult = await moderate(sanitizeResult.sanitized);

    const securityContext: SecurityContext = {
      sanitized: true,
      moderated: true,
      rateLimited: false,
      exitRequested: moderationResult.action === 'exit',
      moderationFlags: moderationResult.flagged ? [moderationResult.reason || 'flagged'] : [],
      inputViolations: sanitizeResult.violations,
    };

    if (moderationResult.action === 'exit') {
      logger.warn({ sessionId: this.sessionId, reason: moderationResult.reason }, 'Moderation triggered exit');
    }

    return securityContext;
  }

  /**
   * Process an NPC turn - parallel Speaker (LLM) + Mind (agent loop), then follow-up TTS
   */
  private async processTurn(
    _userInput: string,
    context: SessionContext,
    securityContext: SecurityContext
  ): Promise<void> {
    this.turnState = {
      abortController: new AbortController(),
      isProcessing: true,
      exitConvoUsed: false,
    };

    try {
      const storedForPlayerInfo = sessionStore.get(this.sessionId);
      const playerInfo = storedForPlayerInfo?.state.player_info || null;

      // Use slim system prompt (no knowledge, no tools) for the Speaker
      const systemPrompt = await assembleSlimSystemPrompt(
        context.definition,
        context.instance,
        securityContext,
        { voiceMode: this.mode.output === 'voice' },
        playerInfo
      );

      // Assemble conversation history
      const stored = sessionStore.get(this.sessionId);
      const history = stored?.state.conversation_history ?? [];
      const llmMessages = assembleConversationHistory(history);

      // --- PARALLEL: Speaker + Mind ---
      const mindTimeoutMs = context.project.settings.mind_timeout_ms ?? 15000;

      // Speaker: stream LLM with NO tools (pure voice)
      const speakerPromise = (async () => {
        let fullResponse = '';
        let providerUsage: { input_tokens: number; output_tokens: number } | undefined;

        for await (const chunk of this.llmProvider.streamChat({
          systemPrompt,
          messages: llmMessages,
          signal: this.turnState!.abortController.signal,
          // NO tools -- Speaker is pure voice
        })) {
          if (this.turnState!.abortController.signal.aborted) {
            logger.debug({ sessionId: this.sessionId }, 'Speaker LLM stream aborted');
            break;
          }

          if (chunk.text) {
            fullResponse += chunk.text;
            this.events.onTextChunk(chunk.text);

            if (this.mode.output === 'voice') {
              const sentences = this.sentenceDetector.addChunk(chunk.text);
              for (const sentence of sentences) {
                await this.synthesizeSentence(sentence);
              }
            }
          }

          if (chunk.done && chunk.usage) {
            providerUsage = chunk.usage;
          }
        }

        // Flush remaining Speaker text to TTS
        if (this.mode.output === 'voice') {
          const remaining = this.sentenceDetector.flush();
          if (remaining) {
            await this.synthesizeSentence(remaining);
          }
          if (this.ttsSession) {
            await this.ttsSession.flush();
          }
        }

        return { text: fullResponse, usage: providerUsage };
      })();

      // Mind: agent loop with ALL tools (recall + conversation + exit_convo)
      const mindAbortController = new AbortController();
      const mindTimeout = setTimeout(() => mindAbortController.abort(), mindTimeoutMs);
      const projectTools = mcpToolRegistry.getProjectTools(context.project.id);

      const mindPromise = (async (): Promise<MindResult | null> => {
        try {
          const result = await runMindAgentLoop(
            context.definition,
            context.instance,
            _userInput,
            '',  // Speaker response not available (parallel execution)
            llmMessages,
            this.mindProvider,
            context.project.id,
            context.knowledgeBase,
            mcpToolRegistry,
            securityContext,
            projectTools,
            mindAbortController.signal,
          );
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          logger.error({ sessionId: this.sessionId, error: msg }, 'Mind agent loop failed in voice pipeline');
          return null;
        } finally {
          clearTimeout(mindTimeout);
        }
      })();

      // Wait for both
      const [speakerResult, mindResult] = await Promise.all([speakerPromise, mindPromise]);

      // Determine if Mind has useful output
      const hasFollowup = !!(mindResult?.follow_up_text);
      const hasMindActivity = !!(mindResult && mindResult.tools_called.length > 0);

      // Emit generation_end for Speaker phase when Mind has something to add
      if (hasFollowup || hasMindActivity) {
        this.events.onGenerationEnd('speaker');
      }

      // Emit Mind activity (tool call chips for UI)
      if (hasMindActivity && mindResult) {
        this.events.onMindActivity({
          tools_called: mindResult.tools_called.map(tc => ({
            name: tc.tool_name,
            args: tc.arguments,
            status: tc.status,
          })),
          duration_ms: mindResult.duration_ms,
          completed: mindResult.completed,
        });
      }

      // Stream follow-up through TTS if Mind generated one
      if (hasFollowup && mindResult) {
        this.events.onFollowupStart();

        // Emit follow-up text for UI
        this.events.onTextChunk(mindResult.follow_up_text);

        // Synthesize follow-up through TTS
        if (this.mode.output === 'voice') {
          const followupSentences = this.sentenceDetector.addChunk(mindResult.follow_up_text);
          for (const sentence of followupSentences) {
            await this.synthesizeSentence(sentence);
          }
          const remaining = this.sentenceDetector.flush();
          if (remaining) {
            await this.synthesizeSentence(remaining);
          }
          if (this.ttsSession) {
            await this.ttsSession.flush();
          }
        }

        this.events.onGenerationEnd('followup');
      } else if (!hasMindActivity) {
        // No Mind activity at all -- emit plain generation_end (backward compatible)
        this.events.onGenerationEnd();
      } else {
        // Mind had activity but no follow-up -- emit plain generation_end after mind_activity
        this.events.onGenerationEnd();
      }

      // Handle exit_convo from Mind
      if (mindResult?.exit_convo_used) {
        if (this.turnState) {
          this.turnState.exitConvoUsed = true;
        }

        const exitResult = handleExitConvo(
          this.sessionId,
          { reason: mindResult.exit_convo_reason ?? 'Mind decided to end conversation' },
          securityContext
        );

        processExitResult(
          exitResult,
          context.project.id,
          sessionStore.get(this.sessionId)?.state.player_id || '',
          context.definition.id
        );

        try {
          await endSession(this.sessionId, this.llmProvider, true);
          logger.info({ sessionId: this.sessionId }, 'Session ended by Mind exit_convo');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ sessionId: this.sessionId, error: errorMessage }, 'Failed to end session after Mind exit_convo');
        }

        this.isActive = false;
        this.events.onExitConvo(exitResult.reason, exitResult.cooldownSeconds);
        return;
      }

      // Store combined response (speaker + follow-up)
      const combinedResponse = hasFollowup && mindResult
        ? `${speakerResult.text}\n\n${mindResult.follow_up_text}`
        : speakerResult.text;

      if (combinedResponse.trim().length > 0) {
        const assistantMessage: Message = { role: 'assistant', content: combinedResponse };
        addMessageToSession(this.sessionId, assistantMessage);
      }

      // Track token usage
      try {
        addTokensToSession(this.sessionId, {
          voice_input_chars: _userInput.length,
          voice_output_chars: combinedResponse.length,
          ...(speakerResult.usage && {
            text_input_tokens: speakerResult.usage.input_tokens,
            text_output_tokens: speakerResult.usage.output_tokens,
          }),
        });
        // Mind tokens
        if (mindResult?.usage) {
          addTokensToSession(this.sessionId, {
            text_input_tokens: mindResult.usage.input_tokens,
            text_output_tokens: mindResult.usage.output_tokens,
          });
        }
      } catch {
        // Never break the voice pipeline for token tracking
      }

      // Update instance state
      updateSessionInstance(this.sessionId, context.instance);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug({ sessionId: this.sessionId }, 'Turn processing aborted');
        return;
      }
      throw error;
    } finally {
      if (this.turnState) {
        this.turnState.isProcessing = false;
      }
    }
  }

  /**
   * Synthesize a sentence with TTS
   */
  private async synthesizeSentence(sentence: string): Promise<void> {
    if (!this.ttsSession || !sentence.trim()) {
      logger.warn({ sessionId: this.sessionId, hasTtsSession: !!this.ttsSession, sentenceLength: sentence?.length }, 'synthesizeSentence: skipping');
      return;
    }

    logger.info({ sessionId: this.sessionId, textLength: sentence.length }, 'Synthesizing sentence');

    try {
      await this.ttsSession.synthesize(sentence, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId: this.sessionId, error: message }, 'TTS synthesis failed');
      // Don't throw - continue without audio
    }
  }
}

/**
 * Create a new voice pipeline instance
 */
export function createVoicePipeline(config: VoicePipelineConfig): VoicePipeline {
  return new VoicePipeline(config);
}
