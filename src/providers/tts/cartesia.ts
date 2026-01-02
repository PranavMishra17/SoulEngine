import { CartesiaClient } from '@cartesia/cartesia-js';
import { createLogger } from '../../logger.js';
import type { TTSChunk } from '../../types/voice.js';
import type {
  TTSProvider,
  TTSProviderConfig,
  TTSSession,
  TTSSessionConfig,
  TTSSessionEvents,
} from './interface.js';

const logger = createLogger('cartesia-provider');

const DEFAULT_MODEL = 'sonic-2024-10-01';
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_LANGUAGE = 'en';

/**
 * Cartesia TTS Session implementation
 */
class CartesiaSession implements TTSSession {
  private client: CartesiaClient;
  private websocket: ReturnType<CartesiaClient['tts']['websocket']> | null = null;
  private contextId: string;
  private _isConnected = false;
  private abortController: AbortController | null = null;
  private readonly events: TTSSessionEvents;
  private readonly config: TTSSessionConfig;
  private readonly providerConfig: TTSProviderConfig;

  constructor(
    client: CartesiaClient,
    providerConfig: TTSProviderConfig,
    sessionConfig: TTSSessionConfig,
    events: TTSSessionEvents
  ) {
    this.client = client;
    this.providerConfig = providerConfig;
    this.config = sessionConfig;
    this.events = events;
    this.contextId = this.generateContextId();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async connect(): Promise<void> {
    const startTime = Date.now();

    try {
      const outputFormat = this.mapOutputFormat(this.config.outputFormat);

      this.websocket = this.client.tts.websocket({
        container: 'raw',
        encoding: outputFormat,
        sampleRate: this.config.sampleRate ?? DEFAULT_SAMPLE_RATE,
      });

      this._isConnected = true;

      const duration = Date.now() - startTime;
      logger.info(
        { duration, voiceId: this.config.voiceId, model: this.config.model ?? DEFAULT_MODEL },
        'Cartesia session connected'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'Failed to connect Cartesia session');
      throw new CartesiaConnectionError(errorMessage);
    }
  }

  private mapOutputFormat(format?: string): 'pcm_f32le' | 'pcm_s16le' {
    switch (format) {
      case 'pcm_s16le':
        return 'pcm_s16le';
      case 'pcm_f32le':
      default:
        return 'pcm_f32le';
    }
  }

  async synthesize(text: string, isContinuation = false): Promise<void> {
    if (!this.websocket || !this._isConnected) {
      throw new CartesiaError('Session not connected');
    }

    if (!text || text.trim() === '') {
      return;
    }

    const startTime = Date.now();
    this.abortController = new AbortController();

    try {
      const response = await this.websocket.send({
        modelId: this.config.model ?? this.providerConfig.defaultModel ?? DEFAULT_MODEL,
        voice: {
          mode: 'id',
          id: this.config.voiceId,
        },
        transcript: text,
        language: this.config.language ?? DEFAULT_LANGUAGE,
        contextId: this.contextId,
        continue: isContinuation,
      });

      // Process audio chunks from the response
      // Define the expected message structure from Cartesia
      interface CartesiaMessage {
        audio?: string;
        done?: boolean;
        error?: string;
      }

      for await (const rawMessage of response.events('message')) {
        // Check if aborted
        if (this.abortController?.signal.aborted) {
          logger.debug('Cartesia synthesis aborted');
          break;
        }

        // Type the message properly
        const message = rawMessage as CartesiaMessage;

        if (message.error) {
          throw new CartesiaError(message.error);
        }

        if (message.audio) {
          const audioBuffer = Buffer.from(message.audio, 'base64');
          const chunk: TTSChunk = {
            audio: audioBuffer,
            text,
            isComplete: message.done === true,
            timestamp: Date.now(),
          };
          this.events.onAudioChunk(chunk);
        }

        if (message.done) {
          break;
        }
      }

      const duration = Date.now() - startTime;
      logger.debug({ duration, textLength: text.length }, 'Cartesia synthesis completed');
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        return;
      }

      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'Cartesia synthesis failed');

      const cartesiaError = error instanceof CartesiaError ? error : new CartesiaError(errorMessage);
      this.events.onError(cartesiaError);
      throw cartesiaError;
    }
  }

  async flush(): Promise<void> {
    if (!this.websocket || !this._isConnected) {
      return;
    }

    try {
      // Send empty text with continue: false to signal end of input
      await this.websocket.send({
        modelId: this.config.model ?? this.providerConfig.defaultModel ?? DEFAULT_MODEL,
        voice: {
          mode: 'id',
          id: this.config.voiceId,
        },
        transcript: '',
        language: this.config.language ?? DEFAULT_LANGUAGE,
        contextId: this.contextId,
        continue: false,
      });

      // Generate new context ID for next turn
      this.contextId = this.generateContextId();

      this.events.onComplete();
      logger.debug('Cartesia flush completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Cartesia flush failed');
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Generate new context ID to abandon current stream
    this.contextId = this.generateContextId();
    logger.debug('Cartesia synthesis aborted');
  }

  close(): void {
    this.abort();
    this._isConnected = false;
    this.websocket = null;
    logger.debug('Cartesia session closed');
  }
}

/**
 * Cartesia TTS Provider implementation
 */
export class CartesiaTtsProvider implements TTSProvider {
  readonly name = 'cartesia';
  private readonly client: CartesiaClient;
  private readonly config: TTSProviderConfig;

  constructor(config: TTSProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Cartesia API key is required');
    }

    this.config = config;
    this.client = new CartesiaClient({
      apiKey: config.apiKey,
    });

    logger.info({ defaultVoiceId: config.defaultVoiceId }, 'Cartesia provider initialized');
  }

  async createSession(
    sessionConfig: TTSSessionConfig,
    events: TTSSessionEvents
  ): Promise<TTSSession> {
    const session = new CartesiaSession(this.client, this.config, sessionConfig, events);
    await session.connect();
    return session;
  }
}

/**
 * Base Cartesia error class
 */
export class CartesiaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartesiaError';
  }
}

/**
 * Cartesia connection error
 */
export class CartesiaConnectionError extends CartesiaError {
  constructor(message: string) {
    super(message);
    this.name = 'CartesiaConnectionError';
  }
}

/**
 * Factory function to create a Cartesia provider
 */
export function createCartesiaProvider(config: TTSProviderConfig): TTSProvider {
  return new CartesiaTtsProvider(config);
}
