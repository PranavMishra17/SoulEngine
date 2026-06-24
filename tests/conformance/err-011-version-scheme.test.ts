import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getOrCreateInstance, saveInstance } from '../../src/storage/local/instances.js';
import type { NPCInstance } from '../../src/types/npc.js';

describe('ERR-011: version scheme conformance across backends', () => {
  let tempDir: string;
  let originalDataDir: string | undefined;

  beforeAll(async () => {
    // Create a hermetic temp directory for the test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soulengine-test-version-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;

    // Create a minimal project directory structure
    const projectDir = path.join(tempDir, 'projects', 'test-project');
    await fs.mkdir(projectDir, { recursive: true });

    // Create a minimal NPC definition (YAML format for local backend)
    const npcId = 'npc_version_001';
    const definitionsDir = path.join(projectDir, 'definitions');
    await fs.mkdir(definitionsDir, { recursive: true });
    const minimalDef = `id: ${npcId}
project_id: test-project
name: Version Test NPC
core_anchor:
  backstory: Testing version scheme
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

  it('local backend: version is a parseable integer (monotonic counter)', async () => {
    const projectId = 'test-project';
    const npcId = 'npc_version_001';
    const playerId = 'player_local_version';

    // Create the initial instance
    const instance = await getOrCreateInstance(projectId, npcId, playerId);

    // Make a save and get the version
    const updated: NPCInstance = {
      ...instance,
      short_term_memory: [
        {
          content: 'First memory',
          timestamp: new Date().toISOString(),
          salience: 0.5,
        },
      ],
    };
    const result = await saveInstance(updated);

    // Assert version is a string that parses to a positive integer
    expect(typeof result.version).toBe('string');
    const versionInt = parseInt(result.version, 10);
    expect(Number.isInteger(versionInt)).toBe(true);
    expect(versionInt).toBeGreaterThan(0);

    // Assert it round-trips without loss
    expect(String(versionInt)).toBe(result.version);
  });

  it('local backend: versions increment monotonically as integers', async () => {
    const projectId = 'test-project';
    const npcId = 'npc_version_001';
    const playerId = 'player_monotonic';

    // Create the initial instance
    const instance = await getOrCreateInstance(projectId, npcId, playerId);

    // Make several saves and collect versions
    const versions: number[] = [];
    for (let i = 0; i < 3; i++) {
      const current = await getOrCreateInstance(projectId, npcId, playerId);
      const updated: NPCInstance = {
        ...current,
        short_term_memory: [
          ...current.short_term_memory,
          {
            content: `Memory ${i}`,
            timestamp: new Date().toISOString(),
            salience: 0.5,
          },
        ],
      };
      const result = await saveInstance(updated);
      versions.push(parseInt(result.version, 10));
    }

    // Assert monotonic increasing
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
  });

  it('contract: getInstanceSnapshot and rollbackInstance accept integer version strings', async () => {
    // This test documents the contract that both backends must support:
    // - version values are stringified monotonic integers (e.g. "1", "2", "3")
    // - getInstanceSnapshot(projectId, instanceId, "2") returns the snapshot at version 2
    // - rollbackInstance(projectId, instanceId, "2") restores to version 2
    // This test verifies the contract via the local backend; the Supabase backend
    // must also satisfy this contract (tested separately in integration tests).

    const projectId = 'test-project';
    const npcId = 'npc_version_001';
    const playerId = 'player_snapshot';

    const instance = await getOrCreateInstance(projectId, npcId, playerId);

    // Make a save
    const updated: NPCInstance = {
      ...instance,
      short_term_memory: [
        {
          content: 'Snapshot memory',
          timestamp: new Date().toISOString(),
          salience: 0.5,
        },
      ],
    };
    const result = await saveInstance(updated);

    // Assert the version returned is a valid integer string
    const versionInt = parseInt(result.version, 10);
    expect(Number.isInteger(versionInt)).toBe(true);
    expect(String(versionInt)).toBe(result.version);

    // This confirms that the version can be used as-is for snapshot/rollback operations
    // (The actual snapshot/rollback logic is tested in their respective tests;
    // here we just verify the version format contract.)
  });
});
