import { describe, test, expect, beforeEach } from 'vitest';
import type { NPCInstance, Memory } from '../../src/types/npc.js';
import { runWeeklyWhisper } from '../../src/core/cycles.js';
import { createMemory } from '../../src/core/memory.js';

/**
 * ERR-001: Weekly Whisper silently drops high-salience memories
 *
 * Bug: runWeeklyWhisper keeps only top 3 memories (hardcoded retainCount=3)
 * and discards all others, even when they have salience >= threshold and
 * STM is under maxStmMemories (20). This violates the documented behavior
 * that salience threshold governs retention.
 *
 * Expected: ALL memories with salience >= threshold are promoted to LTM,
 * and STM is retained up to maxStmMemories, not a hardcoded 3.
 */

describe('ERR-001: Weekly Whisper memory retention', () => {
  let instance: NPCInstance;

  beforeEach(() => {
    // Create a minimal instance with no LTM, empty relationships
    instance = {
      id: 'test-instance',
      npc_id: 'test-npc',
      project_id: 'test-project',
      status: 'active',
      short_term_memory: [],
      long_term_memory: [],
      current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
      trait_modifiers: { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 },
      relationships: {},
      cycle_metadata: {
        last_daily: new Date().toISOString(),
        last_weekly: new Date().toISOString(),
        last_persona_shift: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  test('promotes ALL memories with salience >= threshold, not just top 3', async () => {
    // Create 10 memories with varying salience
    // 6 above threshold (0.7), 4 below
    const memoryData = [
      { content: 'Very salient event A', salience: 0.95 },
      { content: 'Very salient event B', salience: 0.90 },
      { content: 'Very salient event C', salience: 0.85 },
      { content: 'High salience event D', salience: 0.80 }, // Rank 4 — would be lost with retainCount=3
      { content: 'High salience event E', salience: 0.75 }, // Rank 5 — would be lost with retainCount=3
      { content: 'Above-threshold event F', salience: 0.70 }, // Rank 6 — would be lost with retainCount=3
      { content: 'Below threshold G', salience: 0.65 },
      { content: 'Below threshold H', salience: 0.60 },
      { content: 'Below threshold I', salience: 0.55 },
      { content: 'Low salience J', salience: 0.50 },
    ];

    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));

    const result = await runWeeklyWhisper(instance, 3, 0.7);

    expect(result.success).toBe(true);

    // Acceptance criterion 1: ALL 6 memories with salience >= 0.7 should be promoted
    expect(result.memoriesPromoted).toBe(6);
    expect(instance.long_term_memory.length).toBe(6);

    // Verify promoted memories are the correct ones
    const promotedSaliences = instance.long_term_memory.map((m) => m.salience).sort((a, b) => b - a);
    expect(promotedSaliences).toEqual([0.95, 0.90, 0.85, 0.80, 0.75, 0.70]);
  });

  test('retains STM up to maxStmMemories (20), not hardcoded retainCount=3', async () => {
    // Create 15 memories, all below promotion threshold (0.7)
    // None will be promoted, so all should stay in STM (under maxStmMemories=20)
    const memoryData = Array.from({ length: 15 }, (_, i) => ({
      content: `Memory ${i}`,
      salience: 0.65 - i * 0.01, // 0.65, 0.64, 0.63, ...
    }));

    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));

    const result = await runWeeklyWhisper(instance, 3, 0.7);

    expect(result.success).toBe(true);

    // Acceptance criterion 2: No memories should be promoted (all below threshold)
    expect(result.memoriesPromoted).toBe(0);

    // With retainCount=3, only 3 would remain in STM (bug)
    // Expected: all 15 should remain (under maxStmMemories=20)
    expect(instance.short_term_memory.length).toBe(15);

    // Verify they are retained in salience order (highest first)
    const stmSaliences = instance.short_term_memory.map((m) => m.salience);
    const expectedSaliences = memoryData.map((m) => m.salience).sort((a, b) => b - a);
    expect(stmSaliences).toEqual(expectedSaliences);
  });

  test('salience threshold genuinely governs retention (lower threshold = more retained)', async () => {
    // Create 8 memories with salience distributed around threshold
    const memoryData = [
      { content: 'Event A', salience: 0.90 },
      { content: 'Event B', salience: 0.80 },
      { content: 'Event C', salience: 0.70 },
      { content: 'Event D', salience: 0.65 },
      { content: 'Event E', salience: 0.60 },
      { content: 'Event F', salience: 0.55 },
      { content: 'Event G', salience: 0.50 },
      { content: 'Event H', salience: 0.45 },
    ];

    // Test 1: threshold = 0.7 (high) — should promote 3 memories
    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));
    let result = await runWeeklyWhisper(instance, 3, 0.7);
    expect(result.memoriesPromoted).toBe(3); // 0.90, 0.80, 0.70

    // Reset instance
    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));
    instance.long_term_memory = [];

    // Test 2: threshold = 0.6 (lower) — should promote 5 memories
    result = await runWeeklyWhisper(instance, 3, 0.6);
    expect(result.memoriesPromoted).toBe(5); // 0.90, 0.80, 0.70, 0.65, 0.60

    // Reset instance
    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));
    instance.long_term_memory = [];

    // Test 3: threshold = 0.5 (even lower) — should promote 7 memories
    result = await runWeeklyWhisper(instance, 3, 0.5);
    expect(result.memoriesPromoted).toBe(7); // all except 0.45

    // Acceptance criterion 3: Lower threshold promotes/retains more
  });

  test('no high-salience memory is lost when STM is under maxStmMemories', async () => {
    // Create 12 memories, 8 above threshold, 4 below
    const memoryData = [
      { content: 'Event 1', salience: 0.95 },
      { content: 'Event 2', salience: 0.90 },
      { content: 'Event 3', salience: 0.85 },
      { content: 'Event 4', salience: 0.80 },
      { content: 'Event 5', salience: 0.75 },
      { content: 'Event 6', salience: 0.72 },
      { content: 'Event 7', salience: 0.71 },
      { content: 'Event 8', salience: 0.70 },
      { content: 'Event 9', salience: 0.65 },
      { content: 'Event 10', salience: 0.60 },
      { content: 'Event 11', salience: 0.55 },
      { content: 'Event 12', salience: 0.50 },
    ];

    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));

    const result = await runWeeklyWhisper(instance, 3, 0.7);

    expect(result.success).toBe(true);

    // 8 memories promoted to LTM
    expect(result.memoriesPromoted).toBe(8);
    expect(instance.long_term_memory.length).toBe(8);

    // 4 memories remain in STM (below threshold)
    expect(instance.short_term_memory.length).toBe(4);

    // Total: 8 + 4 = 12 — no memories lost
    const totalRetained = instance.long_term_memory.length + instance.short_term_memory.length;
    expect(totalRetained).toBe(12);

    // STM should contain the 4 below-threshold memories
    const stmSaliences = instance.short_term_memory.map((m) => m.salience).sort((a, b) => b - a);
    expect(stmSaliences).toEqual([0.65, 0.60, 0.55, 0.50]);
  });

  test('respects maxStmMemories when retaining below-threshold memories', async () => {
    // Create 25 memories, all below threshold
    // Only top 20 (by salience) should remain in STM
    const memoryData = Array.from({ length: 25 }, (_, i) => ({
      content: `Memory ${i}`,
      salience: 0.65 - i * 0.01, // 0.65, 0.64, 0.63, ..., 0.41
    }));

    instance.short_term_memory = memoryData.map((m) => createMemory(m.content, 'short_term', m.salience));

    const result = await runWeeklyWhisper(instance, 3, 0.7);

    expect(result.success).toBe(true);

    // No promotions (all below 0.7)
    expect(result.memoriesPromoted).toBe(0);

    // STM should be capped at maxStmMemories=20
    expect(instance.short_term_memory.length).toBe(20);

    // Should retain the highest-salience 20
    const stmSaliences = instance.short_term_memory.map((m) => m.salience);
    const expectedSaliences = memoryData
      .map((m) => m.salience)
      .sort((a, b) => b - a)
      .slice(0, 20);
    expect(stmSaliences).toEqual(expectedSaliences);

    // 5 lowest-salience memories should be discarded
    expect(result.memoriesDiscarded).toBe(5);
  });
});
