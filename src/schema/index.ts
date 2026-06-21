/**
 * Versioned zod data contracts for SoulEngine persisted entities.
 *
 * These schemas COMPLEMENT the TypeScript interfaces in src/types/* — they
 * do not replace them. Use z.infer<typeof XxxSchema> to derive a type that
 * stays in sync, or validate raw data read from storage before use.
 *
 * Each schema has a .parse() method (throws on failure) and a .safeParse()
 * method (returns { success, data | error }).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

/**
 * Monotonically-bumped string version for the data contract.
 * Increment this when a breaking field change is made so consumers can detect
 * schema mismatches at runtime.
 */
export const SCHEMA_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const ISODateString = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export const KnowledgeCategorySchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  /** Map of depth level (number key) to content string */
  depths: z.record(z.coerce.string(), z.string()),
});

export const KnowledgeBaseSchema = z.object({
  categories: z.record(z.string(), KnowledgeCategorySchema),
});

// ---------------------------------------------------------------------------
// NPC — nested types first
// ---------------------------------------------------------------------------

export const CoreAnchorSchema = z.object({
  backstory: z.string(),
  principles: z.array(z.string()),
  trauma_flags: z.array(z.string()),
});

export const PersonalityBaselineSchema = z.object({
  openness: z.number().min(0).max(1),
  conscientiousness: z.number().min(0).max(1),
  extraversion: z.number().min(0).max(1),
  agreeableness: z.number().min(0).max(1),
  neuroticism: z.number().min(0).max(1),
});

export const VoiceConfigSchema = z.object({
  provider: z.string().min(1),
  voice_id: z.string(),
  speed: z.number(),
});

export const ScheduleBlockSchema = z.object({
  start: z.string(),
  end: z.string(),
  location_id: z.string(),
  activity: z.string(),
});

export const MCPPermissionsSchema = z.object({
  conversation_tools: z.array(z.string()),
  game_event_tools: z.array(z.string()),
  denied: z.array(z.string()),
});

export const PlayerRecognitionSchema = z.object({
  can_know_player: z.boolean(),
  default_player_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  reveal_player_identity: z.boolean(),
});

export const NPCNetworkEntrySchema = z.object({
  npc_id: z.string(),
  familiarity_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mutual_awareness: z.boolean().optional(),
  reverse_context: z.string().optional(),
});

export const NPCDefinitionSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  core_anchor: CoreAnchorSchema,
  personality_baseline: PersonalityBaselineSchema,
  voice: VoiceConfigSchema,
  schedule: z.array(ScheduleBlockSchema),
  mcp_permissions: MCPPermissionsSchema,
  knowledge_access: z.record(z.string(), z.number()),
  network: z.array(NPCNetworkEntrySchema),
  player_recognition: PlayerRecognitionSchema.optional(),
  salience_threshold: z.number().min(0).max(1).optional(),
  profile_image: z.string().optional(),
  status: z.enum(['draft', 'complete']).optional(),
  version: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// NPC Instance
// ---------------------------------------------------------------------------

export const MoodVectorSchema = z.object({
  valence: z.number(),
  arousal: z.number(),
  dominance: z.number(),
});

export const MemorySchema = z.object({
  id: z.string(),
  content: z.string(),
  timestamp: z.string(),
  salience: z.number(),
  type: z.enum(['short_term', 'long_term']),
});

export const RelationshipStateSchema = z.object({
  trust: z.number(),
  familiarity: z.number(),
  sentiment: z.number(),
});

export const DailyPulseSchema = z.object({
  mood: MoodVectorSchema,
  takeaway: z.string(),
  timestamp: z.string(),
});

export const CycleMetadataSchema = z.object({
  last_weekly: z.string().nullable(),
  last_persona_shift: z.string().nullable(),
});

export const NPCInstanceSchema = z.object({
  id: z.string().min(1),
  definition_id: z.string().min(1),
  project_id: z.string().min(1),
  player_id: z.string().min(1),
  created_at: z.string(),
  current_mood: MoodVectorSchema,
  trait_modifiers: PersonalityBaselineSchema.partial(),
  short_term_memory: z.array(MemorySchema),
  long_term_memory: z.array(MemorySchema),
  relationships: z.record(z.string(), RelationshipStateSchema),
  daily_pulse: DailyPulseSchema.nullable(),
  cycle_metadata: CycleMetadataSchema,
});

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const ProjectSettingsSchema = z.object({
  llm_provider: z.string().min(1),
  llm_model: z.string().optional(),
  stt_provider: z.string().min(1),
  tts_provider: z.string().min(1),
  default_voice_id: z.string(),
  game_client_api_key_hash: z.string().optional(),
  timeouts: z.object({
    session: z.number().optional(),
    llm: z.number().optional(),
    stt: z.number().optional(),
    tts: z.number().optional(),
  }),
  mind_provider: z.string().optional(),
  mind_model: z.string().optional(),
  mind_timeout_ms: z.number().optional(),
});

export const ProjectLimitsSchema = z.object({
  max_npcs: z.number().int(),
  max_categories: z.number().int(),
  max_concurrent_sessions: z.number().int(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  created_at: ISODateString,
  settings: ProjectSettingsSchema,
  limits: ProjectLimitsSchema,
  user_id: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// MCP Tools
// ---------------------------------------------------------------------------

export const MCPToolParametersSchema = z.object({
  type: z.string(),
  properties: z.record(
    z.string(),
    z.object({ type: z.string(), description: z.string().optional() })
  ).optional(),
  required: z.array(z.string()).optional(),
});

export const MCPToolDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: MCPToolParametersSchema.optional(),
});

export const ProjectMCPToolsSchema = z.object({
  conversation_tools: z.array(MCPToolDefinitionSchema),
  game_event_tools: z.array(MCPToolDefinitionSchema),
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const PlayerInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  role: z.string().optional(),
  context: z.string().optional(),
});

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

export const SessionTokenUsageSchema = z.object({
  text_input_tokens: z.number(),
  text_output_tokens: z.number(),
  voice_input_chars: z.number(),
  voice_output_chars: z.number(),
});

export const SessionStateSchema = z.object({
  session_id: z.string().min(1),
  project_id: z.string().min(1),
  definition_id: z.string().min(1),
  instance: NPCInstanceSchema,
  conversation_history: z.array(MessageSchema),
  created_at: z.string(),
  last_activity: z.string(),
  player_id: z.string(),
  player_info: PlayerInfoSchema.nullable(),
  mode: z.string(),
  token_usage: SessionTokenUsageSchema,
  deferred_mind_context: z.string().optional(),
  user_id: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Re-export inferred types for callers that want zod-derived types
// ---------------------------------------------------------------------------

export type NPCDefinition = z.infer<typeof NPCDefinitionSchema>;
export type NPCInstance = z.infer<typeof NPCInstanceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;
export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>;
export type ProjectMCPTools = z.infer<typeof ProjectMCPToolsSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
