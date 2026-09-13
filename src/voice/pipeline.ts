import { createLogger } from '../logger.js';
import { rateLimiter } from '../security/rate-limiter.js';
import {
  getSessionContext,
  addTokensToSession,
  endSession,
  SessionContext,
  SessionError,
} from '../session/manager.js';
import { sessionStore } from '../session/store.js';
import { runConversationTurn } from '../conversation/turn.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { processExitResult } from '../mcp/exit-handler.js';
import { resolveRateLimitPrincipal } from '../security/principal.js';
import { SentenceDetector } from './sentence-detector.js';
import { encodeTtsAudio } from './audio.js';

import type { SessionID } from '../types/session.js';
import type { SecurityContext } from '../types/security.js';
import type { TranscriptEvent, TTSChunk, VoiceConfig, ConversationMode } from '../types/voice.js';
import type { MindActivity } from '../types/mind.js';
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
  /** Called when the NPC's turn is complete */
  onGenerationEnd: () => void;
  /** Called on error */
  onError: (code: string, message: string) => void;
  /** Called when exit_convo is triggered */
  onExitConvo: (reason: string, cooldownSeconds?: number) => void;
  /** Called when Mind completes with tool activity */
  onMindActivity: (activity: MindActivity) => void;
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
  /**
   * Client IP address from the WebSocket upgrade request (e.g. x-forwarded-for).
   * Used as a fallback principal for rate limiting when the user is not authenticated.
   */
  clientIp?: string;
  /** Utterance end timeout in ms (passed to STT provider, default: provider-specific) */
  utteranceEndMs?: number;
  /** Endpointing minimum silence in ms (passed to STT provider, default: provider-specific) */
  endpointingMs?: number;
  /** Client-side aggregation window debounce in ms (default: 400) */
  aggregationWindowMs?: number;
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
 * Lightweight per-turn latency tracker.
 *
 * Records named stages as millisecond offsets from markStart().
 * Designed to be called in fire-and-forget style (mark() is synchronous).
 *
 * Standard stages:
 *   commit           — user's commit() received by pipeline
 *   first_transcript — first final transcript emitted to the LLM
 *   first_token      — first LLM token received from streamer
 *   first_audio      — first TTS audio chunk emitted to client
 */
export class LatencyTracker {
  private stages: Map<string, number> = new Map();
  private startTime: number | null = null;

  /** Mark the beginning of a new turn; clears all previous stages. */
  markStart(): void {
    this.startTime = Date.now();
    this.stages.clear();
  }

  /** Record a named stage with its elapsed ms offset from the last markStart(). */
  mark(stage: string): void {
    if (this.startTime === null) return;
    if (!this.stages.has(stage)) {
      // Only record the FIRST occurrence of each stage per turn.
      this.stages.set(stage, Date.now() - this.startTime);
    }
  }

  /** Return all recorded stages and their elapsed-ms values. */
  getStages(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this.stages) {
      result[k] = v;
    }
    return result;
  }

  /** True if a stage was recorded this turn. */
  hasStage(stage: string): boolean {
    return this.stages.has(stage);
  }

  /** Elapsed ms between two stages; null if either is missing. */
  elapsed(fromStage: string, toStage: string): number | null {
    const from = this.stages.get(fromStage);
    const to = this.stages.get(toStage);
    if (from === undefined || to === undefined) return null;
    return to - from;
  }
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
  private readonly voiceConfig: VoiceConfig;
  private readonly events: VoicePipelineEvents;
  private readonly mode: ConversationMode;
  private readonly utteranceEndMs?: number;
  private readonly endpointingMs?: number;

  private sttSession: STTSession | null = null;
  private ttsSession: TTSSession | null = null;
  private sentenceDetector: SentenceDetector;
  private turnState: TurnState | null = null;
  private readonly latencyTracker: LatencyTracker = new LatencyTracker();

  private accumulatedTranscript: string = '';
  private isActive: boolean = false;

  // Deduplication: prevent processing same transcript twice
  private lastProcessedTimestamp: number = 0;
  private lastProcessedHash: string = '';
  private static readonly DEDUP_WINDOW_MS = 1000; // Ignore duplicate transcripts within 1 second

  // Processing lock: prevent concurrent transcript processing
  private isProcessingTranscript: boolean = false;
  private pendingTranscript: TranscriptEvent | null = null;

  // Transcript aggregation: combine fragmented speech into complete utterances.
  //
  // Latency budget: configurable per-project via ProjectSettings.voice_latency
  //   - utterance_end_ms:       server-side VAD silence detection (default 1000ms)
  //   - endpointing_ms:         minimum silence for endpoint (default 500ms)
  //   - aggregation_window_ms:  client-side debounce after commit/speech_final (default 400ms)
  //
  // Total worst-case endpointing latency: sum of utterance_end_ms + aggregation_window_ms (~1.4s with defaults).
  // On the commit path, only aggregation_window_ms applies (VAD bypassed).
  private transcriptAggregator: {
    text: string;
    timer: NodeJS.Timeout | null;
    lastTimestamp: number;
  } = { text: '', timer: null, lastTimestamp: 0 };
  private readonly aggregationWindowMs: number; // Client-side debounce window

  // Per-utterance monotonic ID for robust STT-final deduplication.
  //
  // Problem with a boolean (pendingSTTFinal):
  //   commit() would set it true -> new interim arrives -> resets it false -> late STT final
  //   for the original utterance arrives and is processed again (double NPC turn).
  //
  // Fix: each new interim bumps currentUtteranceId. commit() captures it as
  // committedUtteranceId. Any STT final whose ID <= committedUtteranceId is
  // suppressed, regardless of when a subsequent interim arrived.
  private currentUtteranceId: number = 0;
  private committedUtteranceId: number | null = null;

  // Client IP from the WebSocket upgrade (used for rate-limit principal resolution)
  private readonly clientIp: string | undefined;

  constructor(config: VoicePipelineConfig) {
    this.sessionId = config.sessionId;
    this.sttProvider = config.sttProvider;
    this.ttsProvider = config.ttsProvider;
    this.llmProvider = config.llmProvider;
    this.voiceConfig = config.voiceConfig;
    this.events = config.events;
    this.mode = config.mode;
    this.clientIp = config.clientIp;
    this.utteranceEndMs = config.utteranceEndMs;
    this.endpointingMs = config.endpointingMs;
    this.aggregationWindowMs = config.aggregationWindowMs ?? 400;
    this.sentenceDetector = new SentenceDetector();

    logger.info({
      sessionId: this.sessionId,
      mode: this.mode,
      // STT values log as 'provider-default' when unset; the provider owns the numbers.
      voiceLatency: {
        utteranceEndMs: this.utteranceEndMs ?? 'provider-default',
        endpointingMs: this.endpointingMs ?? 'provider-default',
        aggregationWindowMs: this.aggregationWindowMs,
      },
    }, 'VoicePipeline created');
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
      ...(this.utteranceEndMs !== undefined && { utteranceEndMs: this.utteranceEndMs }),
      ...(this.endpointingMs !== undefined && { endpointingMs: this.endpointingMs }),
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
    // Start latency tracking for this turn from the moment of commit
    this.latencyTracker.markStart();
    this.latencyTracker.mark('commit');

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
      }, this.aggregationWindowMs);

      // Capture the current utterance ID as committed so any late-arriving STT final
      // for this utterance is suppressed even if a new interim arrives first.
      this.committedUtteranceId = this.currentUtteranceId;
      logger.debug({
        sessionId: this.sessionId,
        textLength: this.transcriptAggregator.text.length,
        committedUtteranceId: this.committedUtteranceId
      }, 'Commit: debounce timer (re)started');
    } else {
      logger.debug({ sessionId: this.sessionId }, 'Commit: nothing to process, STT finalize sent');
    }
  }

  /**
   * Handle interruption - no-op (barge-in removed; VAD is paused during NPC speech)
   */
  async handleInterruption(): Promise<void> {
    logger.debug({ sessionId: this.sessionId }, 'handleInterruption called (no-op — barge-in removed)');
  }

  /**
   * End the pipeline - close all connections
   */
  async end(): Promise<void> {
    logger.info({ sessionId: this.sessionId }, 'Ending voice pipeline');

    this.isActive = false;

    // Clean up transcript state
    this.resetTranscriptState();

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
      // Each new interim marks the start of a potentially new utterance.
      // Bump the monotonic ID so commit() can capture it for deduplication.
      this.currentUtteranceId++;
      // Accumulate interim transcript for commit() to use
      this.accumulatedTranscript = event.text;
      return;
    }

    // --- Final transcript ---
    // CRITICAL: Clear accumulated transcript since STT provided final
    this.accumulatedTranscript = '';

    // Suppress if commit() already processed this utterance.
    // currentUtteranceId <= committedUtteranceId means this final belongs to
    // an utterance that was already forwarded to the LLM via the commit path.
    // This is robust against new interims arriving between commit and final
    // because the ID comparison is monotonic, not a toggled boolean.
    if (
      this.committedUtteranceId !== null &&
      this.currentUtteranceId <= this.committedUtteranceId
    ) {
      logger.debug({
        sessionId: this.sessionId,
        currentUtteranceId: this.currentUtteranceId,
        committedUtteranceId: this.committedUtteranceId
      }, 'Discarding STT final — utterance already processed via commit');
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
    }, this.aggregationWindowMs);
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

    // Deduplication check FIRST — before emitting to client
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

    // Record latency: first final transcript ready to send to LLM
    this.latencyTracker.mark('first_transcript');

    // Emit final transcript to client AFTER dedup passes
    this.events.onTranscript(aggregatedText, true);

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
    // Record latency: first audio chunk emitted to client
    this.latencyTracker.mark('first_audio');

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
        // Reset all transcript state so next utterance starts clean
        this.resetTranscriptState();
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
   * Reset all transcript accumulation state for a clean next utterance.
   * Called after processTurn completes and on pipeline end.
   */
  private resetTranscriptState(): void {
    this.accumulatedTranscript = '';
    if (this.transcriptAggregator.timer) {
      clearTimeout(this.transcriptAggregator.timer);
    }
    this.transcriptAggregator.text = '';
    this.transcriptAggregator.timer = null;
    // Clear committed utterance ID so the next utterance starts fresh.
    // Do NOT reset currentUtteranceId — it must keep incrementing to stay
    // monotonically ahead of any in-flight STT finals from this turn.
    this.committedUtteranceId = null;
    this.lastProcessedHash = '';
    if (this.sttSession?.clearAccumulator) {
      this.sttSession.clearAccumulator();
    }
    logger.debug({ sessionId: this.sessionId }, 'Transcript state reset');
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

    // Security pipeline — resolve trusted principal before calling
    const rateLimitPrincipal = resolveRateLimitPrincipal({
      userId: state.user_id,
      gameKeyHash: undefined, // game-key validated at session start, hash not re-available here
      ip: this.clientIp,
      playerId: state.player_id,
    });
    const securityContext = await this.runSecurityPipeline(
      text,
      state.project_id,
      state.player_id,
      state.definition_id,
      rateLimitPrincipal
    );

    if (!securityContext) {
      // Input blocked by security
      return;
    }

    // Get session context for LLM (retry once on transient fetch failure)
    let context: SessionContext;
    try {
      context = await getSessionContext(this.sessionId);
    } catch (firstErr) {
      logger.warn({ sessionId: this.sessionId, error: firstErr instanceof Error ? firstErr.message : 'Unknown' }, 'getSessionContext failed, retrying in 500ms');
      await new Promise(r => setTimeout(r, 500));
      context = await getSessionContext(this.sessionId);
    }

    // Process turn with LLM (the host adds the user message)
    await this.processTurn(text, context, securityContext, rateLimitPrincipal);
  }

  /**
   * Run the security pipeline (rate limiting only).
   *
   * Sanitization and moderation are now done by the conversation host, which
   * surfaces moderation exits via `result.moderationAction`.
   *
   * @param _input - The raw input text (unused; kept for signature compat)
   * @param projectId - The project ID
   * @param playerId - Client-supplied player ID (untrusted)
   * @param npcId - The NPC ID
   * @param principal - Trusted principal resolved by the caller (user ID, IP, etc.)
   *                    Used to key the rate limit so player_id rotation cannot bypass it.
   */
  private async runSecurityPipeline(
    _input: string,
    projectId: string,
    playerId: string,
    npcId: string,
    principal: string
  ): Promise<SecurityContext | null> {
    // Rate limit — key on the trusted principal, not player_id
    const rateLimitResult = rateLimiter.checkLimit(projectId, playerId, npcId, principal);
    if (!rateLimitResult.allowed) {
      logger.warn({ sessionId: this.sessionId, resetAt: rateLimitResult.resetAt }, 'Rate limit exceeded');
      this.events.onError('RATE_LIMIT', 'Too many messages. Please wait before sending more.');
      return null;
    }

    // Return a minimal security context; the host does sanitization and moderation.
    const securityContext: SecurityContext = {
      sanitized: true,
      moderated: true,
      rateLimited: false,
      exitRequested: false,
      moderationFlags: [],
      inputViolations: [],
    };

    return securityContext;
  }

  /**
   * Process an NPC turn — parallel Mind + Speaker.
   *
   * Speaker streams immediately (zero wait). Mind runs in parallel.
   * - Recall tools (recall_npc / recall_knowledge / recall_memories): results deferred to NEXT turn.
   * - MCP/project tools (request_credentials, lock_door, etc.): trigger a follow-up speech.
   * - exit_convo: ends the session after Speaker finishes (or immediately if moderation forced it).
   *
   * @param _userInput - The user's input text
   * @param context - The session context
   * @param securityContext - The security context
   * @param principal - Trusted principal (used for cooldown keying on exit_convo)
  /**
   * Process a turn: run the shared turn host and stream events to TTS.
   *
   * This is now a thin adapter over `runConversationTurn` that feeds text/follow_up
   * deltas into SentenceDetector -> TTS as they stream.
   *
   * @param _userInput - The sanitized user input
   * @param _context - The session context (unused; the host fetches it)
   * @param securityContext - The security context
   * @param principal - Trusted principal (used for cooldown keying on exit_convo)
   */
  private async processTurn(
    _userInput: string,
    _context: SessionContext,
    securityContext: SecurityContext,
    principal: string
  ): Promise<void> {
    this.turnState = {
      abortController: new AbortController(),
      isProcessing: true,
      exitConvoUsed: false,
    };

    try {
      // TTS pipelining: collect in-flight synthesis promises in order
      const ttsPipeline: Promise<void>[] = [];
      let firstTextSeen = false;
      let followUpStarted = false;

      const result = await runConversationTurn({
        sessionId: this.sessionId,
        content: _userInput,
        fallbackProvider: this.llmProvider,
        toolRegistry: mcpToolRegistry,
        channel: 'voice',
        onEvent: (event) => {
          if (event.type === 'text') {
            // Record latency: first LLM token
            if (!firstTextSeen) {
              this.latencyTracker.mark('first_token');
              firstTextSeen = true;
            }

            this.events.onTextChunk(event.delta);

            if (this.mode.output === 'voice') {
              const sentences = this.sentenceDetector.addChunk(event.delta);
              for (const sentence of sentences) {
                ttsPipeline.push(this.synthesizeSentence(sentence));
              }
            }
          } else if (event.type === 'follow_up') {
            // The primary reply is complete once the first follow-up delta arrives:
            // flush its tail once so the follow-up never glues onto its last sentence.
            if (!followUpStarted) {
              followUpStarted = true;
              if (this.mode.output === 'voice') {
                const remaining = this.sentenceDetector.flush();
                if (remaining) {
                  ttsPipeline.push(this.synthesizeSentence(remaining));
                }
              }
            }

            this.events.onTextChunk(event.delta);

            if (this.mode.output === 'voice') {
              const sentences = this.sentenceDetector.addChunk(event.delta);
              for (const sentence of sentences) {
                ttsPipeline.push(this.synthesizeSentence(sentence));
              }
            }
          } else if (event.type === 'tool_call') {
            this.events.onToolCall(event.call.name, event.call.arguments);
          } else if (event.type === 'tool_result') {
            const tr = event.result;
            this.events.onMindActivity({
              tools_called: [{
                name: tr.tool_name,
                args: tr.arguments,
                status: tr.status,
              }],
              duration_ms: 0,
              completed: true,
            });
          }
        },
      });

      // Flush remaining TTS
      if (this.mode.output === 'voice') {
        const remaining = this.sentenceDetector.flush();
        if (remaining) {
          ttsPipeline.push(this.synthesizeSentence(remaining));
        }
        for (const p of ttsPipeline) {
          await p;
        }
        if (this.ttsSession) {
          await this.ttsSession.flush();
        }
      }

      // Handle moderation exit (result.moderationAction === 'exit' or securityContext.exitRequested)
      if (result.moderationAction === 'exit' || securityContext.exitRequested) {
        if (this.turnState) {
          this.turnState.exitConvoUsed = true;
        }

        try {
          await endSession(this.sessionId, this.llmProvider, true);
          logger.info({ sessionId: this.sessionId }, 'Session ended by moderation');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ sessionId: this.sessionId, error: errorMessage }, 'Failed to end session after moderation exit');
        }

        this.isActive = false;
        this.events.onExitConvo('Inappropriate content detected', 300);
        this.events.onGenerationEnd();
        return;
      }

      // Handle exit_convo tool
      if (result.exitConvoResult) {
        if (this.turnState) {
          this.turnState.exitConvoUsed = true;
        }

        processExitResult(
          result.exitConvoResult,
          sessionStore.get(this.sessionId)?.state.project_id || '',
          sessionStore.get(this.sessionId)?.state.player_id || '',
          sessionStore.get(this.sessionId)?.state.definition_id || '',
          principal
        );

        try {
          await endSession(this.sessionId, this.llmProvider, true);
          logger.info({ sessionId: this.sessionId }, 'Session ended by exit_convo');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error({ sessionId: this.sessionId, error: errorMessage }, 'Failed to end session after exit_convo');
        }

        this.isActive = false;
        this.events.onExitConvo(result.exitConvoResult.reason, result.exitConvoResult.cooldownSeconds);
        this.events.onGenerationEnd();
        return;
      }

      // Generation complete — log turn latency breakdown
      const latencyStages = this.latencyTracker.getStages();
      logger.info({
        sessionId: this.sessionId,
        latency: {
          commit_to_first_transcript: this.latencyTracker.elapsed('commit', 'first_transcript'),
          first_transcript_to_first_token: this.latencyTracker.elapsed('first_transcript', 'first_token'),
          first_token_to_first_audio: this.latencyTracker.elapsed('first_token', 'first_audio'),
          total_commit_to_first_audio: this.latencyTracker.elapsed('commit', 'first_audio'),
          stages: latencyStages,
        }
      }, 'Turn latency breakdown');

      this.events.onGenerationEnd();

      // Track token usage
      try {
        addTokensToSession(this.sessionId, {
          voice_input_chars: _userInput.length,
          voice_output_chars: result.responseText.length,
          ...(result.usage.speaker && {
            text_input_tokens: result.usage.speaker.input_tokens,
            text_output_tokens: result.usage.speaker.output_tokens,
          }),
        });
        if (result.usage.mind) {
          addTokensToSession(this.sessionId, {
            text_input_tokens: result.usage.mind.input_tokens,
            text_output_tokens: result.usage.mind.output_tokens,
          });
        }
      } catch {
        // Never break the voice pipeline for token tracking
      }

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
