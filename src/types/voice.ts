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

