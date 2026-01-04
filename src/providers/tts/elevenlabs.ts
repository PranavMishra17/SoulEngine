import WebSocket from 'ws';
import { createLogger } from '../../logger.js';
import type { TTSChunk } from '../../types/voice.js';
import type {
  TTSProvider,
  TTSProviderConfig,
  TTSSession,
  TTSSessionConfig,
  TTSSessionEvents,
} from './interface.js';

const logger = createLogger('elevenlabs-provider');

const ELEVENLABS_WS_BASE = 'wss://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_turbo_v2';

/**
 * ElevenLabs TTS Session implementation using raw WebSocket
 */
class ElevenLabsSession implements TTSSession {
  private ws: WebSocket | null = null;
  private _isConnected = false;
  private readonly events: TTSSessionEvents;
  private readonly config: TTSSessionConfig;
  private readonly providerConfig: TTSProviderConfig;
  private currentText = '';

  constructor(
    providerConfig: TTSProviderConfig,
    sessionConfig: TTSSessionConfig,
    events: TTSSessionEvents
  ) {
    this.providerConfig = providerConfig;
    this.config = sessionConfig;
    this.events = events;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    const startTime = Date.now();

    try {
      // ElevenLabs WebSocket URL requires output_format parameter
      const model = this.config.model ?? DEFAULT_MODEL;
      const wsUrl = `${ELEVENLABS_WS_BASE}/${this.config.voiceId}/stream-input?model_id=${model}&output_format=pcm_16000`;

      logger.info({ wsUrl: wsUrl.replace(/xi_api_key=[^&]+/, 'xi_api_key=***'), voiceId: this.config.voiceId, model }, 'ElevenLabs connecting to WebSocket');

      this.ws = new WebSocket(wsUrl);

      await this.waitForOpen();

      this._isConnected = true;

      const duration = Date.now() - startTime;
      logger.info(
        { duration, voiceId: this.config.voiceId, model },
        'ElevenLabs session connected'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'Failed to connect ElevenLabs session');
      throw new ElevenLabsConnectionError(errorMessage);
    }
  }

  private waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.setupEventHandlers();

        // Send BOS (Begin of Stream) message to initialize the stream
        this.sendBOS();

        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Send Begin of Stream message to initialize ElevenLabs streaming
   */
  private sendBOS(): void {
    if (!this.ws) return;

    const bosMessage = {
      text: ' ',  // Space character to initialize
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
      generation_config: {
        chunk_length_schedule: [120, 160, 250, 290],
      },
      xi_api_key: this.providerConfig.apiKey,
    };

    this.ws.send(JSON.stringify(bosMessage));
    logger.info('ElevenLabs BOS message sent');
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        // Check if it's binary audio data
        if (data instanceof Buffer) {
          logger.info({ audioBytes: data.length }, 'ElevenLabs binary audio chunk received');
          const chunk: TTSChunk = {
            audio: data,
            text: this.currentText,
            isComplete: false,
            timestamp: Date.now(),
          };
          this.events.onAudioChunk(chunk);
        } else {
          // Try to parse as JSON for control messages
          const message = JSON.parse(data.toString()) as {
            audio?: string;
            isFinal?: boolean;
            normalizedAlignment?: unknown;
            error?: string;
          };

          if (message.error) {
            logger.error({ error: message.error }, 'ElevenLabs server error');
            this.events.onError(new ElevenLabsError(message.error));
            return;
          }

          if (message.audio) {
            const audioBuffer = Buffer.from(message.audio, 'base64');
            logger.info({ audioBytes: audioBuffer.length, isFinal: message.isFinal }, 'ElevenLabs JSON audio chunk received');
            const chunk: TTSChunk = {
              audio: audioBuffer,
              text: this.currentText,
              isComplete: message.isFinal === true,
              timestamp: Date.now(),
            };
            this.events.onAudioChunk(chunk);
          }

          if (message.isFinal) {
            logger.info('ElevenLabs stream complete');
            this.events.onComplete();
          }
        }
      } catch (error) {
        // Binary data that isn't a Buffer - treat as audio
        if (data instanceof ArrayBuffer) {
          logger.info({ audioBytes: (data as ArrayBuffer).byteLength }, 'ElevenLabs ArrayBuffer audio received');
          const chunk: TTSChunk = {
            audio: Buffer.from(data),
            text: this.currentText,
            isComplete: false,
            timestamp: Date.now(),
          };
          this.events.onAudioChunk(chunk);
        }
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this._isConnected = false;
      logger.info({ code, reason: reason?.toString() }, 'ElevenLabs WebSocket closed');
    });

    this.ws.on('error', (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'ElevenLabs WebSocket error');
      this.events.onError(new ElevenLabsError(errorMessage));
    });
  }

  async synthesize(text: string, _isContinuation = false): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ElevenLabsError('Session not connected');
    }

    if (!text || text.trim() === '') {
      return;
    }

    this.currentText = text;
    const startTime = Date.now();

    try {
      // Voice settings already sent in BOS message
      const message = {
        text,
        try_trigger_generation: true,
      };

      this.ws.send(JSON.stringify(message));

      const duration = Date.now() - startTime;
      logger.info({ duration, textLength: text.length }, 'ElevenLabs synthesis message sent');
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'ElevenLabs synthesis failed');
      throw new ElevenLabsError(errorMessage);
    }
  }

  async flush(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('ElevenLabs flush: WebSocket not open');
      return;
    }

    try {
      // Send EOS (End of Stream) message - empty string signals end of input
      const message = {
        text: '',
      };

      this.ws.send(JSON.stringify(message));
      logger.info('ElevenLabs EOS (flush) sent');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'ElevenLabs flush failed');
    }
  }

  abort(): void {
    // Close connection to abort current generation
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    logger.debug('ElevenLabs synthesis aborted');
  }

  close(): void {
    this.abort();
    this._isConnected = false;
    this.ws = null;
    logger.debug('ElevenLabs session closed');
  }
}

/**
 * ElevenLabs TTS Provider implementation
 */
export class ElevenLabsTtsProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  private readonly config: TTSProviderConfig;

  constructor(config: TTSProviderConfig) {
    if (!config.apiKey) {
      throw new Error('ElevenLabs API key is required');
    }

    this.config = config;
    logger.info({ defaultVoiceId: config.defaultVoiceId }, 'ElevenLabs provider initialized');
  }

  async createSession(
    sessionConfig: TTSSessionConfig,
    events: TTSSessionEvents
  ): Promise<TTSSession> {
    const session = new ElevenLabsSession(this.config, sessionConfig, events);
    await session.connect();
    return session;
  }
}

/**
 * Base ElevenLabs error class
 */
export class ElevenLabsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElevenLabsError';
  }
}

/**
 * ElevenLabs connection error
 */
export class ElevenLabsConnectionError extends ElevenLabsError {
  constructor(message: string) {
    super(message);
    this.name = 'ElevenLabsConnectionError';
  }
}

/**
 * Factory function to create an ElevenLabs provider
 */
export function createElevenLabsProvider(config: TTSProviderConfig): TTSProvider {
  return new ElevenLabsTtsProvider(config);
}
