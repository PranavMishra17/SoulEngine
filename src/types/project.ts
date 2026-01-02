export type ProjectID = string;

export interface ProjectSettings {
  llm_provider: string;
  stt_provider: string;
  tts_provider: string;
  default_voice_id: string;
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

