import type { TranscriptEvent } from '../../types/voice.js';

/**
 * Configuration for STT provider
 */
export interface STTProviderConfig {
  apiKey: string;
  model?: string;
  language?: string;
  sampleRate?: number;
  encoding?: 'linear16' | 'opus' | 'flac';
}

/**
 * STT session configuration for individual streaming sessions
 */
export interface STTSessionConfig {
  /** Sample rate of input audio in Hz (default: 16000) */
  sampleRate?: number;
  /** Audio encoding format */
  encoding?: 'linear16' | 'opus' | 'flac';
  /** Language code for transcription */
  language?: string;
  /** Enable punctuation in output */
  punctuate?: boolean;
  /** Enable interim results */
  interimResults?: boolean;
}

/**
 * Events emitted by an STT session
 */
export interface STTSessionEvents {
  /** Called when a transcript is received */
  onTranscript: (event: TranscriptEvent) => void;
  /** Called when an error occurs */
  onError: (error: Error) => void;
  /** Called when the session is closed */
  onClose: () => void;
  /** Called when the session is ready to receive audio */
  onOpen?: () => void;
}

/**
 * An active STT streaming session
 */
export interface STTSession {
  /**
   * Send audio data to the STT service
   * @param audioChunk Raw PCM audio bytes
   */
  sendAudio(audioChunk: Buffer): void;

  /**
   * Signal that no more audio will be sent
   * Allows the service to finalize any pending transcriptions
   */
  finalize(): void;

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
 * STT Provider interface - all STT implementations must conform to this
 */
export interface STTProvider {
  /**
   * Create a new streaming transcription session
   * @param config Session-specific configuration
   * @param events Event handlers for the session
   * @returns A promise that resolves to the active session
   */
  createSession(config: STTSessionConfig, events: STTSessionEvents): Promise<STTSession>;

  /**
   * Get the provider name for logging
   */
  readonly name: string;
}
