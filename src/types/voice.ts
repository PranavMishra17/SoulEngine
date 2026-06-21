/**
 * Input modality for conversation
 */
export type InputMode = 'text' | 'voice';

/**
 * Output modality for conversation
 */
export type OutputMode = 'text' | 'voice';

/**
 * Combined conversation mode configuration
 */
export interface ConversationMode {
  input: InputMode;
  output: OutputMode;
}

/**
 * Predefined mode shortcuts
 */
export const CONVERSATION_MODES = {
  TEXT_TEXT: { input: 'text', output: 'text' } as ConversationMode,
  VOICE_VOICE: { input: 'voice', output: 'voice' } as ConversationMode,
  TEXT_VOICE: { input: 'text', output: 'voice' } as ConversationMode,
  VOICE_TEXT: { input: 'voice', output: 'text' } as ConversationMode,
} as const;

export interface VoiceConfig {
  provider: string;
  voice_id: string;
  speed: number;
}

export interface AudioChunk {
  data: Buffer;
  sampleRate: number;
  channels: number;
  timestamp: number;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface TTSChunk {
  audio: Buffer;
  text: string;
  isComplete: boolean;
  timestamp: number;
}

/**
 * Describes the encoding of a single audio stream direction (input from client,
 * or output to client). Having this in the `ready` message removes the need for
 * clients to hardcode per-provider sample rates.
 */
export interface AudioFormat {
  /** Samples per second, e.g. 16000 or 44100 */
  sampleRate: number;
  /**
   * PCM encoding name.
   * - Input (client -> server): always "linear16" (16-bit signed little-endian)
   * - Output (server -> client): "pcm_f32le" for Cartesia, "pcm_s16le" for ElevenLabs
   */
  encoding: string;
  /** Number of audio channels (1 = mono) */
  channels: number;
}

/**
 * The dual-direction audio format descriptor included in the `ready` handshake
 * message. Clients must use these values instead of hardcoding provider defaults.
 */
export interface ProtocolAudioFormats {
  /** Format the server expects to receive from the client (STT input) */
  input: AudioFormat;
  /** Format the server will send to the client (TTS output) */
  output: AudioFormat;
}

/**
 * Current version of the /ws/voice wire protocol.
 * Increment when a breaking change is made to the message schema.
 */
export const VOICE_PROTOCOL_VERSION = '1';

/**
 * Known TTS provider output audio formats.
 * These are the authoritative values served in the `ready` handshake message.
 */
export const TTS_OUTPUT_FORMATS: Record<string, AudioFormat> = {
  cartesia: {
    sampleRate: 44100,
    encoding: 'pcm_f32le',
    channels: 1,
  },
  elevenlabs: {
    sampleRate: 16000,
    encoding: 'pcm_s16le',
    channels: 1,
  },
};

/**
 * The authoritative STT (Deepgram) input format the server expects from clients.
 */
export const STT_INPUT_FORMAT: AudioFormat = {
  sampleRate: 16000,
  encoding: 'linear16',
  channels: 1,
};

