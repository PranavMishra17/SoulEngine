import { KnowledgeAccess } from './knowledge.js';

export interface CoreAnchor {
  backstory: string;
  principles: string[];
  trauma_flags: string[];
}

export interface PersonalityBaseline {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface MoodVector {
  valence: number;
  arousal: number;
  dominance: number;
}

export interface VoiceConfig {
  provider: string;
  voice_id: string;
  speed: number;
}

export interface ScheduleBlock {
  start: string;
  end: string;
  location_id: string;
  activity: string;
}

export interface MCPPermissions {
  conversation_tools: string[];
  game_event_tools: string[];
  denied: string[];
}

/**
 * Player recognition settings for an NPC
 */
export interface PlayerRecognition {
  /** If true, NPC can be told who the player is before conversation */
  can_know_player: boolean;
  /** Default familiarity tier if player is known (1-3) - deprecated, optional for backward compatibility */
  default_player_tier?: 1 | 2 | 3;
  /** If true, player info is included in system prompt */
  reveal_player_identity: boolean;
}

/**
 * NPC network entry - represents another NPC this character knows
 * Familiarity tiers:
 * - 1 (Acquaintance): Name + description only
 * - 2 (Familiar): + backstory + schedule
 * - 3 (Close): + personality + principles + trauma flags
 */
export interface NPCNetworkEntry {
  npc_id: string;
  familiarity_tier: 1 | 2 | 3;
  /** Does this NPC know that the other NPC knows them back? */
  mutual_awareness?: boolean;
  /** How the other NPC knows this one (if different from how we know them) */
  reverse_context?: string;
}

export interface NPCDefinition {
  id: string;
  project_id: string;
  name: string;
  description: string;
  core_anchor: CoreAnchor;
  personality_baseline: PersonalityBaseline;
  voice: VoiceConfig;
  schedule: ScheduleBlock[];
  mcp_permissions: MCPPermissions;
  knowledge_access: KnowledgeAccess;
  /** NPCs this character knows (max 5) - now with bidirectional support */
  network: NPCNetworkEntry[];
  /** Player recognition settings */
  player_recognition?: PlayerRecognition;
  /**
   * Salience threshold for memory retention (0.0 - 1.0)
   * Lower value = better memory (remembers more, more detailed summaries)
   * Higher value = worse memory (forgets more, brief summaries)
   * Default: 0.7
   */
  salience_threshold?: number;
  /**
   * Profile image filename (stored in data/projects/{projectId}/npcs/)
   * For UI display only - not used in NPC context
   */
  profile_image?: string;
}

export interface Memory {
  id: string;
  content: string;
  timestamp: string;
  salience: number;
  type: 'short_term' | 'long_term';
}

export interface RelationshipState {
  trust: number;
  familiarity: number;
  sentiment: number;
}

export interface DailyPulse {
  mood: MoodVector;
  takeaway: string;
  timestamp: string;
}

export interface CycleMetadata {
  last_weekly: string | null;
  last_persona_shift: string | null;
}

export interface NPCInstance {
  id: string;
  definition_id: string;
  project_id: string;
  player_id: string;
  created_at: string;
  current_mood: MoodVector;
  trait_modifiers: Partial<PersonalityBaseline>;
  short_term_memory: Memory[];
  long_term_memory: Memory[];
  relationships: Record<string, RelationshipState>;
  daily_pulse: DailyPulse | null;
  cycle_metadata: CycleMetadata;
}

