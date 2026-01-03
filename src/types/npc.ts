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
 * NPC network entry - represents another NPC this character knows
 * Familiarity tiers:
 * - 1 (Acquaintance): Name + description only
 * - 2 (Familiar): + backstory + schedule
 * - 3 (Close): + personality + principles + trauma flags
 */
export interface NPCNetworkEntry {
  npc_id: string;
  familiarity_tier: 1 | 2 | 3;
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
  /** NPCs this character knows (max 5) */
  network: NPCNetworkEntry[];
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

