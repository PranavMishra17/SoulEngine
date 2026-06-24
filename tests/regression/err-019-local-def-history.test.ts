import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  createDefinition,
  updateDefinition,
  getDefinition,
  getDefinitionHistory,
  getDefinitionSnapshot,
  rollbackDefinition
} from '../../src/storage/local/definitions.js';
import type { NPCDefinition } from '../../src/types/npc.js';

/**
 * ERR-019: Local definition history is stubbed (silent no-ops)
 *
 * Bug: src/storage/local/definitions.ts lines 415-437 stub out history methods:
 * - getDefinitionHistory returns []
 * - getDefinitionSnapshot throws NotFoundError
 * - rollbackDefinition silently returns current definition (no-op)
 *
 * Meanwhile, Supabase implements full versioning. This creates drift and
 * makes local development misleading (you can't test rollback locally).
 *
 * The fix should mirror the local instance history pattern (history/ subdirectory,
 * timestamped JSON snapshots, pruning).
 */
describe('ERR-019: local definition history implementation', () => {
  let tempDir: string;
  let originalDataDir: string | undefined;
  const projectId = 'test-project-def-history';

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soulengine-test-def-history-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;

    // Create project directory
    const projectDir = path.join(tempDir, 'projects', projectId);
    await fs.mkdir(projectDir, { recursive: true });
  });

  afterAll(async () => {
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates history entries when saving definition multiple times', async () => {
    // Create initial definition
    const created = await createDefinition(projectId, {
      name: 'Test NPC v1',
      description: 'Initial version',
      core_anchor: { backstory: 'Test backstory', principles: ['Principle 1'], trauma_flags: [] },
      personality_baseline: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
      cognitive_voice: { internal_monologue_style: 'default' },
      conversational_style: { greeting: 'Hello v1' },
      voice: { voice_id: '', provider: 'cartesia' },
      knowledge_access: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const npcId = created.id;

    // Update definition (should create history entry)
    await updateDefinition(projectId, npcId, {
      name: 'Test NPC v2',
      conversational_style: { greeting: 'Hello v2' },
      updated_at: new Date().toISOString(),
    });

    // Update again (another history entry)
    await updateDefinition(projectId, npcId, {
      name: 'Test NPC v3',
      conversational_style: { greeting: 'Hello v3' },
      updated_at: new Date().toISOString(),
    });

    // Get history - should have entries for v1 and v2 (current is v3)
    const history = await getDefinitionHistory(projectId, npcId);

    // Currently returns [] - should have 2 entries after fix
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('retrieves a specific historical snapshot', async () => {
    const created = await createDefinition(projectId, {
      name: 'Snapshot Test v1',
      description: 'First version',
      core_anchor: { backstory: 'Backstory v1', principles: ['Principle v1'], trauma_flags: [] },
      personality_baseline: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
      cognitive_voice: { internal_monologue_style: 'default' },
      conversational_style: { greeting: 'Greet v1' },
      voice: { voice_id: '', provider: 'cartesia' },
      knowledge_access: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const npcId = created.id;

    await updateDefinition(projectId, npcId, {
      name: 'Snapshot Test v2',
      core_anchor: { backstory: 'Backstory v2', principles: ['Principle v2'], trauma_flags: [] },
      updated_at: new Date().toISOString(),
    });

    // Get the history to find a version number
    const history = await getDefinitionHistory(projectId, npcId);
    expect(history.length).toBeGreaterThan(0);

    // Get the first (oldest) snapshot
    const firstVersion = history[history.length - 1].version;
    const snapshot = await getDefinitionSnapshot(projectId, npcId, firstVersion);

    // Currently throws - should return the actual snapshot after fix
    expect(snapshot).toBeDefined();
    expect(snapshot.snapshot).toBeDefined();
    expect(snapshot.snapshot.name).toBe('Snapshot Test v1');
  });

  it('rollbackDefinition actually restores a prior version', async () => {
    const created = await createDefinition(projectId, {
      name: 'Rollback Test v1',
      description: 'Original state',
      core_anchor: { backstory: 'Original backstory', principles: ['Original principle'], trauma_flags: [] },
      personality_baseline: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
      cognitive_voice: { internal_monologue_style: 'thoughtful' },
      conversational_style: { greeting: 'Original greeting' },
      voice: { voice_id: '', provider: 'cartesia' },
      knowledge_access: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const npcId = created.id;

    await updateDefinition(projectId, npcId, {
      name: 'Rollback Test v2',
      description: 'Modified state',
      conversational_style: { greeting: 'Modified greeting' },
      updated_at: new Date().toISOString(),
    });

    // Verify current state is v2
    const current = await getDefinition(projectId, npcId);
    expect(current.name).toBe('Rollback Test v2');
    expect(current.conversational_style?.greeting).toBe('Modified greeting');

    // Get version to rollback to
    const history = await getDefinitionHistory(projectId, npcId);
    expect(history.length).toBeGreaterThan(0);
    const targetVersion = history[history.length - 1].version;

    // Rollback to v1
    const rolled = await rollbackDefinition(projectId, npcId, targetVersion);

    // Currently returns current definition unchanged (no-op)
    // After fix, should restore v1 state
    expect(rolled.name).toBe('Rollback Test v1');
    expect(rolled.description).toBe('Original state');
    expect(rolled.conversational_style?.greeting).toBe('Original greeting');

    // Verify it's persisted
    const reloaded = await getDefinition(projectId, npcId);
    expect(reloaded.name).toBe('Rollback Test v1');
  });
});
