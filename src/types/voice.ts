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

