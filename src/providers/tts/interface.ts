import type { TTSChunk } from '../../types/voice.js';

/**
 * Configuration for TTS provider
 */
export interface TTSProviderConfig {
  apiKey: string;
  defaultVoiceId?: string;
  defaultModel?: string;
}

/**
 * TTS session configuration for individual synthesis sessions
 */
export interface TTSSessionConfig {
  /** Voice ID to use for synthesis */
  voiceId: string;
  /** Model to use (provider-specific) */
  model?: string;
  /** Speech speed multiplier (1.0 = normal) */
  speed?: number;
  /** Output sample rate in Hz */
  sampleRate?: number;
  /** Output audio format */
  outputFormat?: 'pcm_f32le' | 'pcm_s16le' | 'mp3';
  /** Language code */
  language?: string;
}

/**
 * Events emitted by a TTS session
 */
export interface TTSSessionEvents {
  /** Called when an audio chunk is received */
  onAudioChunk: (chunk: TTSChunk) => void;
  /** Called when synthesis is complete */
  onComplete: () => void;
  /** Called when an error occurs */
  onError: (error: Error) => void;
}

/**
 * An active TTS streaming session
 */
export interface TTSSession {
  /**
   * Send text to synthesize
   * @param text Text to convert to speech
   * @param isContinuation Whether this continues a previous chunk (maintains prosody)
   */
  synthesize(text: string, isContinuation?: boolean): Promise<void>;

  /**
   * Signal that no more text will be sent for this turn
   * Flushes any buffered text and completes the synthesis
   */
  flush(): Promise<void>;

  /**
   * Abort the current synthesis
   * Stops generation and discards any buffered content
   */
  abort(): void;

  /**
   * Close the session and clean up resources
   */
  close(): void;

  /**
   * Whether the session is currently connected and ready
   */
  readonly isConnected: boolean;
}

/**
 * TTS Provider interface - all TTS implementations must conform to this
 */
export interface TTSProvider {
  /**
   * Create a new TTS streaming session
   * @param config Session-specific configuration
   * @param events Event handlers for the session
   * @returns A promise that resolves to the active session
   */
  createSession(config: TTSSessionConfig, events: TTSSessionEvents): Promise<TTSSession>;

  /**
   * Get the provider name for logging
   */
  readonly name: string;
}

/**
 * Supported TTS provider types
 */
export type TTSProviderType = 'cartesia' | 'elevenlabs';
