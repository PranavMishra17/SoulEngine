export type ProjectID = string;

export interface ProjectSettings {
  llm_provider: string;
  llm_model?: string;
  stt_provider: string;
  tts_provider: string;
  default_voice_id: string;
  game_client_api_key_hash?: string;
  timeouts: {
    session?: number;
    llm?: number;
    stt?: number;
    tts?: number;
  };
}

export interface ProjectLimits {
  max_npcs: number;
  max_categories: number;
  max_concurrent_sessions: number;
}

export interface Project {
  id: ProjectID;
  name: string;
  created_at: string;
  settings: ProjectSettings;
  limits: ProjectLimits;
}

