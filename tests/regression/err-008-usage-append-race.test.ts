import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { appendProjectUsage, getProjectUsage } from '../../src/storage/local/usage.js';
import type { SessionTokenUsage } from '../../src/types/usage.js';

describe('ERR-008: concurrent usage append race condition', () => {
  let tempDir: string;
  let originalDataDir: string | undefined;

  beforeAll(async () => {
    // Create a hermetic temp directory for the test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soulengine-test-usage-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
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

  it('does not lose updates when many concurrent appends run for the same project', async () => {
    const projectId = 'test-project-concurrent';
    const numConcurrentCalls = 20;

    // Each call will add a distinct amount of tokens
    const sessionUsages: SessionTokenUsage[] = [];
    for (let i = 1; i <= numConcurrentCalls; i++) {
      sessionUsages.push({
        text_input_tokens: i * 10,       // 10, 20, 30, ..., 200
        text_output_tokens: i * 5,       // 5, 10, 15, ..., 100
        voice_input_chars: i * 2,        // 2, 4, 6, ..., 40
        voice_output_chars: i * 3,       // 3, 6, 9, ..., 60
      });
    }

    // Calculate expected totals
    const expectedInputTokens = sessionUsages.reduce((sum, s) => sum + s.text_input_tokens, 0);
    const expectedOutputTokens = sessionUsages.reduce((sum, s) => sum + s.text_output_tokens, 0);
    const expectedInputChars = sessionUsages.reduce((sum, s) => sum + s.voice_input_chars, 0);
    const expectedOutputChars = sessionUsages.reduce((sum, s) => sum + s.voice_output_chars, 0);
    const expectedConversations = numConcurrentCalls;

    // Fire all appends concurrently
    await Promise.all(
      sessionUsages.map(usage => appendProjectUsage(projectId, usage))
    );

    // Read the final result
    const final = await getProjectUsage(projectId);

    // Assert all increments are reflected
    expect(final.total_conversations).toBe(expectedConversations);
    expect(final.text_input_tokens).toBe(expectedInputTokens);
    expect(final.text_output_tokens).toBe(expectedOutputTokens);
    expect(final.voice_input_chars).toBe(expectedInputChars);
    expect(final.voice_output_chars).toBe(expectedOutputChars);
  });

  it('allows concurrent appends for different projects without blocking', async () => {
    // This test ensures the lock is per-project, not global
    const projectIds = ['proj-a', 'proj-b', 'proj-c'];
    const usage: SessionTokenUsage = {
      text_input_tokens: 100,
      text_output_tokens: 50,
      voice_input_chars: 20,
      voice_output_chars: 30,
    };

    // Fire appends for different projects concurrently
    await Promise.all(
      projectIds.map(projectId => appendProjectUsage(projectId, usage))
    );

    // Verify each project got its update
    for (const projectId of projectIds) {
      const result = await getProjectUsage(projectId);
      expect(result.total_conversations).toBe(1);
      expect(result.text_input_tokens).toBe(100);
      expect(result.text_output_tokens).toBe(50);
      expect(result.voice_input_chars).toBe(20);
      expect(result.voice_output_chars).toBe(30);
    }
  });
});
