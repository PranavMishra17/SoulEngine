import { createClient, LiveTranscriptionEvents, ListenLiveClient } from '@deepgram/sdk';
import { createLogger } from '../../logger.js';
import type { TranscriptEvent } from '../../types/voice.js';
import type {
  STTProvider,
  STTProviderConfig,
  STTSession,
  STTSessionConfig,
  STTSessionEvents,
} from './interface.js';

const logger = createLogger('deepgram-provider');

const DEFAULT_MODEL = 'nova-2';
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_LANGUAGE = 'en';
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1000;
const KEEPALIVE_INTERVAL_MS = 5000; // Send keepalive every 5 seconds

/**
 * Deepgram STT Session implementation
 */
class DeepgramSession implements STTSession {
  private connection: ListenLiveClient | null = null;
  private _isConnected = false;
  private reconnectAttempts = 0;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private readonly events: STTSessionEvents;
  private readonly config: Required<STTSessionConfig>;
  private readonly providerConfig: STTProviderConfig;

  constructor(
    providerConfig: STTProviderConfig,
    sessionConfig: STTSessionConfig,
    events: STTSessionEvents
  ) {
    this.providerConfig = providerConfig;
    this.events = events;
    this.config = {
      sampleRate: sessionConfig.sampleRate ?? providerConfig.sampleRate ?? DEFAULT_SAMPLE_RATE,
      encoding: sessionConfig.encoding ?? providerConfig.encoding ?? 'linear16',
      language: sessionConfig.language ?? providerConfig.language ?? DEFAULT_LANGUAGE,
      punctuate: sessionConfig.punctuate ?? true,
      interimResults: sessionConfig.interimResults ?? true,
    };
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    const startTime = Date.now();

    logger.info({
      model: this.providerConfig.model ?? DEFAULT_MODEL,
      sampleRate: this.config.sampleRate,
      language: this.config.language
    }, 'DeepgramSession.connect: starting');

    try {
      const client = createClient(this.providerConfig.apiKey);

      logger.debug('DeepgramSession.connect: client created, starting live connection');

      this.connection = client.listen.live({
        model: this.providerConfig.model ?? DEFAULT_MODEL,
        punctuate: this.config.punctuate,
        encoding: this.config.encoding,
        sample_rate: this.config.sampleRate,
        language: this.config.language,
        interim_results: this.config.interimResults,
        // Keep connection alive during silence (prevents idle timeout)
        keep_alive: true,
        // Longer utterance detection window to reduce fragmented speech
        utterance_end_ms: 1500,  // Wait 1.5s of silence before utterance_end
        endpointing: 500,        // Minimum silence for endpoint (ms)
      });

      this.setupEventHandlers();

      logger.debug('DeepgramSession.connect: waiting for WebSocket open');

      // Wait for connection to open
      await this.waitForOpen();

      const duration = Date.now() - startTime;
      logger.info({
        duration,
        model: this.providerConfig.model ?? DEFAULT_MODEL
      }, 'DeepgramSession.connect: success');
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error({
        duration,
        error: errorMessage,
        stack: errorStack
      }, 'DeepgramSession.connect: failed');

      throw new DeepgramConnectionError(errorMessage);
    }
  }

  private setupEventHandlers(): void {
    if (!this.connection) {
      logger.warn('DeepgramSession.setupEventHandlers: no connection');
      return;
    }

    logger.debug('DeepgramSession.setupEventHandlers: setting up handlers');

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      this._isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('DeepgramSession: connection OPEN');

      // Start keepalive interval to prevent idle timeout
      this.startKeepalive();

      this.events.onOpen?.();
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      logger.debug({
        hasChannel: !!(data as Record<string, unknown>)?.channel,
        isFinal: (data as Record<string, unknown>)?.is_final,
        speechFinal: (data as Record<string, unknown>)?.speech_final
      }, 'DeepgramSession: transcript event received');

      try {
        const transcript = this.parseTranscript(data);
        if (transcript) {
          logger.debug({
            text: transcript.text.slice(0, 30),
            isFinal: transcript.isFinal
          }, 'DeepgramSession: parsed transcript');
          this.events.onTranscript(transcript);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: errorMessage }, 'DeepgramSession: error parsing transcript');
      }
    });

    this.connection.on(LiveTranscriptionEvents.Error, (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'DeepgramSession: transcription error');

      if (this.shouldReconnect(errorMessage)) {
        logger.info('DeepgramSession: attempting reconnect');
        this.attemptReconnect();
      } else {
        this.events.onError(new DeepgramError(errorMessage));
      }
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      this._isConnected = false;
      this.stopKeepalive();
      logger.info('DeepgramSession: connection CLOSE');

      // Attempt reconnect on unexpected close
      if (this.shouldReconnect('connection closed')) {
        logger.info('DeepgramSession: attempting reconnect after close');
        this.attemptReconnect();
      } else {
        this.events.onClose();
      }
    });
  }

  /**
   * Start sending keepalive messages to prevent idle timeout
   */
  private startKeepalive(): void {
    this.stopKeepalive(); // Clear any existing interval

    this.keepaliveInterval = setInterval(() => {
      if (this.connection && this._isConnected) {
        try {
          this.connection.keepAlive();
          logger.debug('DeepgramSession: keepalive sent');
        } catch (error) {
          logger.warn('DeepgramSession: failed to send keepalive');
        }
      }
    }, KEEPALIVE_INTERVAL_MS);

    logger.debug('DeepgramSession: keepalive interval started');
  }

  /**
   * Stop the keepalive interval
   */
  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
      logger.debug('DeepgramSession: keepalive interval stopped');
    }
  }

  private parseTranscript(data: unknown): TranscriptEvent | null {
    const transcriptData = data as {
      channel?: {
        alternatives?: Array<{
          transcript?: string;
          confidence?: number;
        }>;
      };
      is_final?: boolean;
      speech_final?: boolean;
    };

    const alternatives = transcriptData.channel?.alternatives;
    if (!alternatives || alternatives.length === 0) {
      return null;
    }

    const transcript = alternatives[0].transcript;
    if (!transcript || transcript.trim() === '') {
      return null;
    }

    // is_final: true means this transcript chunk is final for its audio segment (can fire multiple times)
    // speech_final: true means the speaker has finished their complete utterance (fires once per turn)
    // ONLY use speech_final to trigger processing - using OR causes duplicate LLM calls and overlapping audio
    const isFinal = transcriptData.speech_final === true;

    logger.debug(
      {
        transcript: transcript.substring(0, 50),
        isFinal,
        is_final: transcriptData.is_final,
        speech_final: transcriptData.speech_final
      },
      'Parsed Deepgram transcript'
    );

    return {
      text: transcript,
      isFinal,
      timestamp: Date.now(),
    };
  }

  private waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Connection not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      const openHandler = () => {
        clearTimeout(timeout);
        resolve();
      };

      const errorHandler = (error: unknown) => {
        clearTimeout(timeout);
        const errorMessage = error instanceof Error ? error.message : String(error);
        reject(new Error(`Connection failed: ${errorMessage}`));
      };

      this.connection.on(LiveTranscriptionEvents.Open, openHandler);
      this.connection.on(LiveTranscriptionEvents.Error, errorHandler);
    });
  }

  private shouldReconnect(errorMessage: string): boolean {
    // Don't reconnect on auth errors
    if (errorMessage.includes('401') || errorMessage.includes('403')) {
      return false;
    }

    // Don't reconnect on rate limit (should back off externally)
    if (errorMessage.includes('429')) {
      return false;
    }

    return this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;

    logger.warn(
      { attempt: this.reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS, delayMs: delay },
      'Attempting Deepgram reconnection'
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, attempt: this.reconnectAttempts }, 'Reconnection failed');

      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.events.onError(new DeepgramConnectionError(`Max reconnection attempts reached: ${errorMessage}`));
      }
    }
  }

  sendAudio(audioChunk: Buffer): void {
    if (!this.connection || !this._isConnected) {
      logger.warn('Cannot send audio: not connected');
      return;
    }

    try {
      // Convert Buffer to ArrayBuffer for Deepgram SDK compatibility
      const arrayBuffer = audioChunk.buffer.slice(
        audioChunk.byteOffset,
        audioChunk.byteOffset + audioChunk.byteLength
      );
      this.connection.send(arrayBuffer);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error sending audio to Deepgram');
    }
  }

  finalize(): void {
    // For continuous conversation, we do NOT close the connection on finalize.
    // Deepgram will send final transcripts based on speech_final detection.
    // The connection stays open for the next utterance.
    // Only close() should actually terminate the connection.
    logger.debug('Deepgram finalize called (no-op for continuous mode)');
  }

  close(): void {
    // Stop keepalive first
    this.stopKeepalive();

    // Reset reconnect attempts to prevent auto-reconnect on intentional close
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS;

    if (!this.connection) return;

    try {
      this._isConnected = false;
      this.connection.requestClose();
      this.connection = null;
      logger.info('Deepgram session closed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error closing Deepgram session');
    }
  }
}

/**
 * Deepgram STT Provider implementation
 */
export class DeepgramSttProvider implements STTProvider {
  readonly name = 'deepgram';
  private readonly config: STTProviderConfig;

  constructor(config: STTProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Deepgram API key is required');
    }
    this.config = config;
    logger.info({ model: config.model ?? DEFAULT_MODEL }, 'Deepgram provider initialized');
  }

  async createSession(
    sessionConfig: STTSessionConfig,
    events: STTSessionEvents
  ): Promise<STTSession> {
    const session = new DeepgramSession(this.config, sessionConfig, events);
    await session.connect();
    return session;
  }
}

/**
 * Base Deepgram error class
 */
export class DeepgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepgramError';
  }
}

/**
 * Deepgram connection error
 */
export class DeepgramConnectionError extends DeepgramError {
  constructor(message: string) {
    super(message);
    this.name = 'DeepgramConnectionError';
  }
}

/**
 * Factory function to create a Deepgram provider
 */
export function createDeepgramProvider(config: STTProviderConfig): STTProvider {
  return new DeepgramSttProvider(config);
}
