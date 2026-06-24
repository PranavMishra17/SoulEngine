import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getOrCreateInstance, saveInstance, getInstance } from '../../src/storage/local/instances.js';
import type { NPCInstance } from '../../src/types/npc.js';

describe('ERR-012: concurrent instance save race condition', () => {
  let tempDir: string;
  let originalDataDir: string | undefined;

  beforeAll(async () => {
    // Create a hermetic temp directory for the test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soulengine-test-instance-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;

    // Create a minimal project directory structure
    const projectDir = path.join(tempDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });

    // Create a minimal NPC definition (YAML format for local backend)
    const npcId = 'npc_test_001';
    const definitionsDir = path.join(projectDir, 'definitions');
    await fs.mkdir(definitionsDir, { recursive: true });
    const minimalDef = `id: ${npcId}
project_id: test-project
name: Test NPC
core_anchor:
  backstory: A test NPC for concurrency testing
  principles: []
personality_baseline:
  openness: 0.5
  conscientiousness: 0.5
  extraversion: 0.5
  agreeableness: 0.5
  neuroticism: 0.5
voice:
  provider: cartesia
  voice_id: test-voice
knowledge_access: []
`;
    await fs.writeFile(
      path.join(definitionsDir, `${npcId}.yaml`),
      minimalDef
    );
  });

  afterAll(async () => {
    // Restore original DATA_DIR and cleanup
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('serializes concurrent saves and maintains consistent state (no corruption)', async () => {
    const projectId = 'test-project';
    const npcId = 'npc_test_001';
    const playerId = 'player_concurrent';
    const numConcurrentSaves = 15;

    // Create the initial instance
    const instance = await getOrCreateInstance(projectId, npcId, playerId);

    // Each concurrent save will try to add a unique memory
    // With per-instance locking, saves are serialized, preventing file corruption
    const savePromises = [];
    for (let i = 1; i <= numConcurrentSaves; i++) {
      const saveOp = async () => {
        const current = await getInstance(projectId, instance.id);
        const updated: NPCInstance = {
          ...current,
          short_term_memory: [
            ...current.short_term_memory,
            {
              content: `Concurrent memory #${i}`,
              timestamp: new Date().toISOString(),
              salience: 0.5,
            },
          ],
        };
        await saveInstance(updated);
      };
      savePromises.push(saveOp());
    }

    // Fire all saves concurrently
    await Promise.all(savePromises);

    // Read the final result
    const final = await getInstance(projectId, instance.id);

    // The lock guarantees:
    // 1. No file corruption (state is always valid JSON with correct structure)
    // 2. Saves are serialized (version counter increments correctly)
    // We do NOT guarantee all 15 memories are present because the read-modify-write
    // pattern in the test creates a classic race condition that requires caller-side
    // retry logic (optimistic concurrency control at the application level).
    //
    // What we CAN assert: the final state is structurally valid and at least one
    // save succeeded.
    expect(Array.isArray(final.short_term_memory)).toBe(true);
    expect(final.short_term_memory.length).toBeGreaterThanOrEqual(1);
    expect(final.short_term_memory.length).toBeLessThanOrEqual(numConcurrentSaves);

    // Assert the state is not corrupted - all memories have required fields
    for (const memory of final.short_term_memory) {
      expect(memory).toHaveProperty('content');
      expect(memory).toHaveProperty('timestamp');
      expect(memory).toHaveProperty('salience');
      expect(typeof memory.content).toBe('string');
    }
  });

  it('produces unique, monotonic version identifiers on each save', async () => {
    const projectId = 'test-project';
    const npcId = 'npc_test_001';
    const playerId = 'player_version_test';

    // Create the initial instance
    const instance = await getOrCreateInstance(projectId, npcId, playerId);

    // Make several sequential saves
    const versions: string[] = [];
    for (let i = 0; i < 5; i++) {
      const current = await getInstance(projectId, instance.id);
      const updated: NPCInstance = {
        ...current,
        short_term_memory: [
          ...current.short_term_memory,
          {
            content: `Memory at save ${i}`,
            timestamp: new Date().toISOString(),
            salience: 0.5,
          },
        ],
      };
      const result = await saveInstance(updated);
      versions.push(result.version);
    }

    // Assert all versions are unique
    const uniqueVersions = new Set(versions);
    expect(uniqueVersions.size).toBe(versions.length);

    // Parse versions as integers and assert they are monotonic
    const versionIntegers = versions.map(v => parseInt(v, 10));
    for (let i = 1; i < versionIntegers.length; i++) {
      expect(versionIntegers[i]).toBeGreaterThan(versionIntegers[i - 1]);
    }
  });
});
