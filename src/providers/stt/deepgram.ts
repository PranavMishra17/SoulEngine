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

/**
 * Deepgram STT Session implementation
 */
class DeepgramSession implements STTSession {
  private connection: ListenLiveClient | null = null;
  private _isConnected = false;
  private reconnectAttempts = 0;
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

    try {
      const client = createClient(this.providerConfig.apiKey);

      this.connection = client.listen.live({
        model: this.providerConfig.model ?? DEFAULT_MODEL,
        punctuate: this.config.punctuate,
        encoding: this.config.encoding,
        sample_rate: this.config.sampleRate,
        language: this.config.language,
        interim_results: this.config.interimResults,
      });

      this.setupEventHandlers();

      // Wait for connection to open
      await this.waitForOpen();

      const duration = Date.now() - startTime;
      logger.info({ duration, model: this.providerConfig.model ?? DEFAULT_MODEL }, 'Deepgram session connected');
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'Failed to connect Deepgram session');
      throw new DeepgramConnectionError(errorMessage);
    }
  }

  private setupEventHandlers(): void {
    if (!this.connection) return;

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      this._isConnected = true;
      this.reconnectAttempts = 0;
      logger.debug('Deepgram connection opened');
      this.events.onOpen?.();
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      try {
        const transcript = this.parseTranscript(data);
        if (transcript) {
          this.events.onTranscript(transcript);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: errorMessage }, 'Error parsing Deepgram transcript');
      }
    });

    this.connection.on(LiveTranscriptionEvents.Error, (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Deepgram transcription error');

      if (this.shouldReconnect(errorMessage)) {
        this.attemptReconnect();
      } else {
        this.events.onError(new DeepgramError(errorMessage));
      }
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      this._isConnected = false;
      logger.debug('Deepgram connection closed');
      this.events.onClose();
    });
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

    // Note: In Deepgram SDK, is_final being false means it's a final transcript
    // This is counter-intuitive but documented in SDK_REFERENCE.md
    const isFinal = transcriptData.is_final === false || transcriptData.speech_final === true;

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
    if (!this.connection) return;

    try {
      // Request final transcription before closing
      this.connection.requestClose();
      logger.debug('Deepgram finalize requested');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Error finalizing Deepgram session');
    }
  }

  close(): void {
    if (!this.connection) return;

    try {
      this._isConnected = false;
      this.connection.requestClose();
      this.connection = null;
      logger.debug('Deepgram session closed');
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
