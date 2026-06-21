/**
 * Regression test for migrateLocalToSupabase.
 *
 * Uses a hermetic temp DATA_DIR (same pattern as err-008-usage-append-race.test.ts).
 * The Supabase backend is fully mocked so no real network calls are made.
 *
 * Note: vitest.config.ts sets clearMocks:true which resets spy call history before
 * each test. As a result, mock-call assertions must be made within the same `it` block
 * as the migration call.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Mock the supabase storage modules BEFORE any module imports.
// vi.mock is hoisted to the top of the file by vitest automatically.
// ---------------------------------------------------------------------------

vi.mock('../../src/storage/supabase/projects.js', () => ({
  updateProject: vi.fn().mockResolvedValue(undefined),
  createProject: vi.fn(),
  getProject: vi.fn(),
  deleteProject: vi.fn(),
  listProjects: vi.fn(),
  projectExists: vi.fn(),
  isValidProjectId: vi.fn(),
}));

vi.mock('../../src/storage/supabase/knowledge.js', () => ({
  updateKnowledgeBase: vi.fn().mockResolvedValue(undefined),
  getKnowledgeBase: vi.fn(),
  upsertCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getCategory: vi.fn(),
  listCategoryIds: vi.fn(),
}));

vi.mock('../../src/storage/supabase/definitions.js', () => ({
  createDefinition: vi.fn(async (projectId: string, def: Record<string, unknown>) => ({
    ...def,
    id: 'npc_mock_id',
    project_id: projectId,
  })),
  getDefinition: vi.fn(),
  updateDefinition: vi.fn(),
  deleteDefinition: vi.fn(),
  listDefinitions: vi.fn(),
  definitionExists: vi.fn(),
  isValidNpcId: vi.fn(),
}));

vi.mock('../../src/storage/supabase/instances.js', () => ({
  saveInstance: vi.fn().mockResolvedValue({ version: '1', timestamp: new Date().toISOString() }),
  getInstance: vi.fn(),
  getOrCreateInstance: vi.fn(),
  getInstanceHistory: vi.fn(),
  getInstanceSnapshot: vi.fn(),
  rollbackInstance: vi.fn(),
  deleteInstance: vi.fn(),
  listInstances: vi.fn(),
  listInstancesForNpc: vi.fn(),
  listInstancesForPlayer: vi.fn(),
  instanceExists: vi.fn(),
  resetInstance: vi.fn(),
}));

vi.mock('../../src/storage/supabase/mcp-tools.js', () => ({
  saveMCPTools: vi.fn().mockResolvedValue(undefined),
  getMCPTools: vi.fn(),
}));

vi.mock('../../src/storage/supabase/secrets.js', () => ({
  saveApiKeys: vi.fn().mockResolvedValue(undefined),
  loadApiKeys: vi.fn().mockResolvedValue({}),
  updateApiKeys: vi.fn(),
  deleteApiKeys: vi.fn(),
  hasApiKeys: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Import mocked module namespaces so tests can inspect spies.
// These imports see the vi.mock-replaced versions.
// ---------------------------------------------------------------------------

import * as supabaseProjects from '../../src/storage/supabase/projects.js';
import * as supabaseKnowledge from '../../src/storage/supabase/knowledge.js';
import * as supabaseDefinitions from '../../src/storage/supabase/definitions.js';
import * as supabaseInstances from '../../src/storage/supabase/instances.js';
import * as supabaseMcpTools from '../../src/storage/supabase/mcp-tools.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeProject(projectId: string) {
  return {
    id: projectId,
    name: 'Test Project',
    created_at: '2025-01-01T00:00:00.000Z',
    settings: {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: '',
      timeouts: { session: 1800000, llm: 30000, stt: 10000, tts: 10000 },
    },
    limits: { max_npcs: 10, max_categories: 20, max_concurrent_sessions: 5 },
    user_id: null,
  };
}

function makeDefinition(projectId: string, npcId: string) {
  return {
    id: npcId,
    project_id: projectId,
    name: 'Aria',
    description: 'A wise sage',
    core_anchor: { backstory: 'Forest-born', principles: ['Honesty'], trauma_flags: [] },
    personality_baseline: {
      openness: 0.8, conscientiousness: 0.7, extraversion: 0.4, agreeableness: 0.9, neuroticism: 0.2,
    },
    voice: { provider: 'cartesia', voice_id: 'aria_v1', speed: 1.0 },
    schedule: [],
    mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
    knowledge_access: {},
    network: [],
  };
}

function makeInstance(projectId: string, npcId: string, instanceId: string) {
  return {
    id: instanceId,
    definition_id: npcId,
    project_id: projectId,
    player_id: 'player_001',
    created_at: '2025-01-01T00:00:00.000Z',
    current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
    trait_modifiers: {},
    short_term_memory: [],
    long_term_memory: [],
    relationships: {},
    daily_pulse: null,
    cycle_metadata: { last_weekly: null, last_persona_shift: null },
  };
}

async function writeLocalFixtures(
  dataDir: string,
  projectId: string,
  npcId: string,
  instanceId: string
): Promise<void> {
  const projectDir = path.join(dataDir, 'projects', projectId);
  const defsDir = path.join(projectDir, 'definitions');
  const instancesDir = path.join(projectDir, 'instances', instanceId);

  await fs.mkdir(defsDir, { recursive: true });
  await fs.mkdir(instancesDir, { recursive: true });

  await fs.writeFile(
    path.join(projectDir, 'project.yaml'),
    yaml.dump(makeProject(projectId)),
    'utf-8'
  );

  await fs.writeFile(
    path.join(projectDir, 'knowledge_base.yaml'),
    yaml.dump({
      categories: {
        lore: { id: 'lore', description: 'World lore', depths: { 1: 'Basic' } },
      },
    }),
    'utf-8'
  );

  await fs.writeFile(
    path.join(defsDir, `${npcId}.yaml`),
    yaml.dump(makeDefinition(projectId, npcId)),
    'utf-8'
  );

  await fs.writeFile(
    path.join(instancesDir, 'current.json'),
    JSON.stringify(makeInstance(projectId, npcId, instanceId), null, 2),
    'utf-8'
  );

  await fs.writeFile(
    path.join(projectDir, 'mcp_tools.yaml'),
    yaml.dump({ conversation_tools: [], game_event_tools: [] }),
    'utf-8'
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrateLocalToSupabase', () => {
  const projectId = 'proj_migrate_test01';
  const npcId = 'npc_migrate_npc001';
  const instanceId = 'inst_migrate_inst01';
  const userId = 'user_migrate_001';

  let tempDir: string;
  let originalDataDir: string | undefined;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soulengine-migrate-test-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
    process.env.ENCRYPTION_KEY = 'test-migration-encryption-key-32chars!!';

    await writeLocalFixtures(tempDir, projectId, npcId, instanceId);
  });

  afterAll(async () => {
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    delete process.env.ENCRYPTION_KEY;
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Restore default mock implementations before each test because clearMocks:true
  // clears call history but does NOT reset implementations. However, a test that
  // calls mockRejectedValueOnce for a partial failure test can leave the spy in a
  // weird state, so we reset here to be safe.
  beforeEach(() => {
    vi.mocked(supabaseProjects.updateProject).mockResolvedValue(undefined as never);
    vi.mocked(supabaseKnowledge.updateKnowledgeBase).mockResolvedValue(undefined as never);
    vi.mocked(supabaseDefinitions.createDefinition).mockImplementation(
      async (pid: string, def: Record<string, unknown>) => ({ ...def, id: 'npc_mock_id', project_id: pid }) as never
    );
    vi.mocked(supabaseInstances.saveInstance).mockResolvedValue({
      version: '1',
      timestamp: new Date().toISOString(),
    });
    vi.mocked(supabaseMcpTools.saveMCPTools).mockResolvedValue(undefined as never);
  });

  it('returns a summary with all expected fields', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    const summary = await migrateLocalToSupabase(projectId, userId);

    expect(summary).toBeDefined();
    expect(typeof summary.project).toBe('string');
    expect(typeof summary.definitions).toBe('number');
    expect(typeof summary.instances).toBe('number');
    expect(typeof summary.knowledgeBase).toBe('string');
    expect(typeof summary.mcpTools).toBe('string');
    expect(Array.isArray(summary.errors)).toBe(true);
  });

  it('calls supabase updateProject with project data and assigns userId', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    await migrateLocalToSupabase(projectId, userId);

    expect(supabaseProjects.updateProject).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ name: 'Test Project', user_id: userId })
    );
  });

  it('calls supabase updateKnowledgeBase with the local knowledge base data', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    await migrateLocalToSupabase(projectId, userId);

    expect(supabaseKnowledge.updateKnowledgeBase).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({
        categories: expect.objectContaining({
          lore: expect.objectContaining({ id: 'lore' }),
        }),
      })
    );
  });

  it('calls supabase createDefinition for each NPC definition', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    await migrateLocalToSupabase(projectId, userId);

    expect(supabaseDefinitions.createDefinition).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ name: 'Aria' })
    );
  });

  it('calls supabase saveInstance for each instance', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    await migrateLocalToSupabase(projectId, userId);

    expect(supabaseInstances.saveInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        id: instanceId,
        project_id: projectId,
      })
    );
  });

  it('calls supabase saveMCPTools with the local MCP tools', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    await migrateLocalToSupabase(projectId, userId);

    expect(supabaseMcpTools.saveMCPTools).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({
        conversation_tools: expect.any(Array),
        game_event_tools: expect.any(Array),
      })
    );
  });

  it('reports definitions and instances counts matching local storage', async () => {
    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    const summary = await migrateLocalToSupabase(projectId, userId);

    expect(summary.definitions).toBe(1);
    expect(summary.instances).toBe(1);
    expect(summary.project).toBe('ok');
    expect(summary.knowledgeBase).toBe('ok');
    expect(summary.mcpTools).toBe('ok');
    expect(summary.errors).toHaveLength(0);
  });

  it('handles partial failures gracefully — error is reported, migration continues', async () => {
    // Make definition creation fail for this test
    vi.mocked(supabaseDefinitions.createDefinition).mockRejectedValueOnce(
      new Error('DB write failed')
    );

    const { migrateLocalToSupabase } = await import('../../src/storage/migrate.js');
    const summary = await migrateLocalToSupabase(projectId, userId);

    // Must not throw; other entities (project, kb, instances) still migrate
    expect(summary).toBeDefined();
    expect(Array.isArray(summary.errors)).toBe(true);
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(summary.errors[0]).toMatch(/definition|Aria|DB write failed/i);

    // Instances should still have migrated
    expect(summary.instances).toBe(1);
    // Definitions count should be 0 (the only definition failed)
    expect(summary.definitions).toBe(0);
  });
});
