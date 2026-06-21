export type ProjectID = string;

/** A single named, revocable game-client API key entry */
export interface GameClientApiKey {
  /** Opaque unique identifier for this key (used as revocation handle) */
  id: string;
  /** Human-readable label set by the dashboard user */
  name: string;
  /** SHA-256 hex hash of the raw key — never store plaintext */
  hash: string;
}

export interface ProjectSettings {
  llm_provider: string;
  llm_model?: string;
  stt_provider: string;
  tts_provider: string;
  default_voice_id: string;
  /** Legacy single-key hash — kept for backward compatibility */
  game_client_api_key_hash?: string;
  /** Named revocable keys — supports multiple game-client identities per project */
  game_client_api_keys?: GameClientApiKey[];
  timeouts: {
    session?: number;
    llm?: number;
    stt?: number;
    tts?: number;
  };
  /** LLM provider for the Mind instance (defaults to llm_provider if not set) */
  mind_provider?: string;
  /** LLM model for the Mind instance (defaults to llm_model if not set) */
  mind_model?: string;
  /** Timeout for the Mind agent loop in milliseconds (default: 5000) */
  mind_timeout_ms?: number;
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
  user_id?: string | null;
}

