import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  NPCDefinitionSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  KnowledgeBaseSchema,
  KnowledgeCategorySchema,
  NPCInstanceSchema,
  MCPToolDefinitionSchema,
  ProjectMCPToolsSchema,
  SessionStateSchema,
} from '../../src/schema/index.js';

// ---------------------------------------------------------------------------
// SCHEMA_VERSION
// ---------------------------------------------------------------------------

describe('SCHEMA_VERSION', () => {
  it('is a non-empty string', () => {
    expect(typeof SCHEMA_VERSION).toBe('string');
    expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it('is stable (same value across multiple imports)', async () => {
    const { SCHEMA_VERSION: v2 } = await import('../../src/schema/index.js');
    expect(v2).toBe(SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// NPCDefinitionSchema
// ---------------------------------------------------------------------------

const validNPCDefinition = {
  id: 'npc_abc123_xyz456',
  project_id: 'proj_abc123_xyz456',
  name: 'Aria',
  description: 'A wise elf sage',
  core_anchor: {
    backstory: 'She was raised in the forest.',
    principles: ['Never lie', 'Protect the weak'],
    trauma_flags: ['fire'],
  },
  personality_baseline: {
    openness: 0.8,
    conscientiousness: 0.7,
    extraversion: 0.4,
    agreeableness: 0.9,
    neuroticism: 0.2,
  },
  voice: {
    provider: 'cartesia',
    voice_id: 'aria_voice',
    speed: 1.0,
  },
  schedule: [
    { start: '08:00', end: '12:00', location_id: 'forest_grove', activity: 'studying' },
  ],
  mcp_permissions: {
    conversation_tools: ['recall_npc'],
    game_event_tools: ['lock_door'],
    denied: [],
  },
  knowledge_access: { lore: 2, politics: 1 },
  network: [],
};

describe('NPCDefinitionSchema', () => {
  it('accepts a valid NPC definition', () => {
    const result = NPCDefinitionSchema.safeParse(validNPCDefinition);
    expect(result.success).toBe(true);
  });

  it('accepts optional fields (player_recognition, salience_threshold, profile_image, status, version)', () => {
    const result = NPCDefinitionSchema.safeParse({
      ...validNPCDefinition,
      player_recognition: { can_know_player: true, reveal_player_identity: false },
      salience_threshold: 0.6,
      profile_image: 'aria.png',
      status: 'complete',
      version: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when name is missing', () => {
    const { name: _omit, ...noName } = validNPCDefinition;
    const result = NPCDefinitionSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it('rejects when personality trait is out of range', () => {
    const bad = {
      ...validNPCDefinition,
      personality_baseline: { ...validNPCDefinition.personality_baseline, openness: 1.5 },
    };
    const result = NPCDefinitionSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Verify the error path reaches the offending field
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths.some(p => p.includes('personality_baseline'))).toBe(true);
    }
  });

  it('rejects invalid status value', () => {
    const bad = { ...validNPCDefinition, status: 'published' };
    const result = NPCDefinitionSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects when id is missing', () => {
    const { id: _omit, ...noId } = validNPCDefinition;
    const result = NPCDefinitionSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProjectSettingsSchema
// ---------------------------------------------------------------------------

const validProjectSettings = {
  llm_provider: 'gemini',
  stt_provider: 'deepgram',
  tts_provider: 'cartesia',
  default_voice_id: 'voice_abc',
  timeouts: { session: 1800000, llm: 30000, stt: 10000, tts: 10000 },
};

describe('ProjectSettingsSchema', () => {
  it('accepts valid settings', () => {
    expect(ProjectSettingsSchema.safeParse(validProjectSettings).success).toBe(true);
  });

  it('accepts optional mind fields', () => {
    const result = ProjectSettingsSchema.safeParse({
      ...validProjectSettings,
      llm_model: 'gemini-2.0-flash',
      mind_provider: 'openai',
      mind_model: 'gpt-4o-mini',
      mind_timeout_ms: 8000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when llm_provider is missing', () => {
    const { llm_provider: _omit, ...bad } = validProjectSettings;
    expect(ProjectSettingsSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProjectSchema
// ---------------------------------------------------------------------------

const validProject = {
  id: 'proj_abc123_xyz456',
  name: 'My Game',
  created_at: '2025-01-01T00:00:00.000Z',
  settings: validProjectSettings,
  limits: { max_npcs: 10, max_categories: 20, max_concurrent_sessions: 5 },
};

describe('ProjectSchema', () => {
  it('accepts a valid project', () => {
    expect(ProjectSchema.safeParse(validProject).success).toBe(true);
  });

  it('accepts null user_id', () => {
    expect(ProjectSchema.safeParse({ ...validProject, user_id: null }).success).toBe(true);
  });

  it('rejects when name is missing', () => {
    const { name: _omit, ...bad } = validProject;
    expect(ProjectSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects when created_at is not an ISO string', () => {
    expect(ProjectSchema.safeParse({ ...validProject, created_at: 'not-a-date' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KnowledgeCategorySchema
// ---------------------------------------------------------------------------

const validKnowledgeCategory = {
  id: 'lore',
  description: 'World lore',
  depths: { 1: 'Basic lore', 2: 'Detailed lore', 3: 'Secret lore' },
};

describe('KnowledgeCategorySchema', () => {
  it('accepts a valid category', () => {
    expect(KnowledgeCategorySchema.safeParse(validKnowledgeCategory).success).toBe(true);
  });

  it('accepts missing description (optional)', () => {
    const { description: _omit, ...noDesc } = validKnowledgeCategory;
    expect(KnowledgeCategorySchema.safeParse(noDesc).success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const { id: _omit, ...bad } = validKnowledgeCategory;
    expect(KnowledgeCategorySchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KnowledgeBaseSchema
// ---------------------------------------------------------------------------

describe('KnowledgeBaseSchema', () => {
  it('accepts a valid knowledge base', () => {
    expect(
      KnowledgeBaseSchema.safeParse({ categories: { lore: validKnowledgeCategory } }).success
    ).toBe(true);
  });

  it('accepts an empty categories object', () => {
    expect(KnowledgeBaseSchema.safeParse({ categories: {} }).success).toBe(true);
  });

  it('rejects when categories is not an object', () => {
    expect(KnowledgeBaseSchema.safeParse({ categories: 'bad' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NPCInstanceSchema
// ---------------------------------------------------------------------------

const validInstance = {
  id: 'inst_abc123',
  definition_id: 'npc_abc123_xyz456',
  project_id: 'proj_abc123_xyz456',
  player_id: 'player_001',
  created_at: '2025-01-01T00:00:00.000Z',
  current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
  trait_modifiers: { openness: 0.1 },
  short_term_memory: [
    { id: 'mem_1', content: 'Met the hero', timestamp: '2025-01-01T00:00:00.000Z', salience: 0.8, type: 'short_term' },
  ],
  long_term_memory: [],
  relationships: {
    player_001: { trust: 0.5, familiarity: 0.3, sentiment: 0.7 },
  },
  daily_pulse: null,
  cycle_metadata: { last_weekly: null, last_persona_shift: null },
};

describe('NPCInstanceSchema', () => {
  it('accepts a valid NPC instance', () => {
    expect(NPCInstanceSchema.safeParse(validInstance).success).toBe(true);
  });

  it('accepts daily_pulse when present', () => {
    const result = NPCInstanceSchema.safeParse({
      ...validInstance,
      daily_pulse: {
        mood: { valence: 0.6, arousal: 0.4, dominance: 0.5 },
        takeaway: 'A good day',
        timestamp: '2025-01-02T00:00:00.000Z',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const { id: _omit, ...bad } = validInstance;
    expect(NPCInstanceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects memory entry with invalid type', () => {
    const bad = {
      ...validInstance,
      short_term_memory: [{ id: 'mem_1', content: 'x', timestamp: '2025-01-01T00:00:00.000Z', salience: 0.5, type: 'emotional' }],
    };
    expect(NPCInstanceSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MCPToolDefinitionSchema
// ---------------------------------------------------------------------------

const validMCPTool = {
  id: 'lock_door',
  name: 'Lock Door',
  description: 'Locks a door in the game world',
  parameters: {
    type: 'object',
    properties: {
      door_id: { type: 'string', description: 'Door identifier' },
    },
    required: ['door_id'],
  },
};

describe('MCPToolDefinitionSchema', () => {
  it('accepts a valid tool definition', () => {
    expect(MCPToolDefinitionSchema.safeParse(validMCPTool).success).toBe(true);
  });

  it('accepts tool without parameters (optional)', () => {
    const { parameters: _omit, ...noParams } = validMCPTool;
    expect(MCPToolDefinitionSchema.safeParse(noParams).success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const { id: _omit, ...bad } = validMCPTool;
    expect(MCPToolDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects when description is missing', () => {
    const { description: _omit, ...bad } = validMCPTool;
    expect(MCPToolDefinitionSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProjectMCPToolsSchema
// ---------------------------------------------------------------------------

describe('ProjectMCPToolsSchema', () => {
  it('accepts valid project MCP tools', () => {
    expect(
      ProjectMCPToolsSchema.safeParse({
        conversation_tools: [validMCPTool],
        game_event_tools: [],
      }).success
    ).toBe(true);
  });

  it('rejects when conversation_tools is not an array', () => {
    expect(
      ProjectMCPToolsSchema.safeParse({ conversation_tools: null, game_event_tools: [] }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionStateSchema
// ---------------------------------------------------------------------------

const validSessionState = {
  session_id: 'sess_abc123_xyz',
  project_id: 'proj_abc123_xyz456',
  definition_id: 'npc_abc123_xyz456',
  instance: validInstance,
  conversation_history: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ],
  created_at: '2025-01-01T00:00:00.000Z',
  last_activity: '2025-01-01T00:01:00.000Z',
  player_id: 'player_001',
  player_info: null,
  mode: 'text-text',
  token_usage: {
    text_input_tokens: 100,
    text_output_tokens: 50,
    voice_input_chars: 0,
    voice_output_chars: 0,
  },
  user_id: null,
};

describe('SessionStateSchema', () => {
  it('accepts a valid session state', () => {
    expect(SessionStateSchema.safeParse(validSessionState).success).toBe(true);
  });

  it('accepts optional deferred_mind_context', () => {
    expect(
      SessionStateSchema.safeParse({ ...validSessionState, deferred_mind_context: 'context data' }).success
    ).toBe(true);
  });

  it('accepts optional player_info', () => {
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      player_info: { name: 'Hero', description: 'Brave adventurer', role: 'knight' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when session_id is missing', () => {
    const { session_id: _omit, ...bad } = validSessionState;
    expect(SessionStateSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects when conversation_history has invalid role', () => {
    const bad = {
      ...validSessionState,
      conversation_history: [{ role: 'bot', content: 'Hello' }],
    };
    expect(SessionStateSchema.safeParse(bad).success).toBe(false);
  });
});
