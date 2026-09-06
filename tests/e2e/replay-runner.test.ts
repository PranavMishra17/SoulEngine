import { describe, it, expect } from 'vitest';
import { runReplay } from '../../src/eval/replay.js';
import { ConversationFixtureSchema } from '../../src/schema/eval.js';
import deferredRecallFixture from '../fixtures/conversations/deferred-recall.json';

describe('Replay Runner', () => {
  it('executes deferred-recall fixture end-to-end', async () => {
    // Validate fixture
    const parsed = ConversationFixtureSchema.safeParse(deferredRecallFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Fixture validation failed');
    }

    // Run replay
    const report = await runReplay(parsed.data);

    // Verify report structure
    expect(report.fixture).toBe('deferred-recall');
    expect(report.turns).toHaveLength(2);

    // Turn 1: Player states preference
    const turn1 = report.turns[0];
    expect(turn1.turn).toBe(1);
    expect(turn1.playerInput).toContain('mystery novels');
    expect(turn1.speakerResponse).toBeTruthy();
    expect(turn1.timings.mindDurationMs).toBeGreaterThan(0);
    expect(turn1.timings.speakerDurationMs).toBeGreaterThan(0);
    expect(turn1.timings.totalMs).toBeGreaterThan(0);
    expect(turn1.tools.actualCalls).toContain('recall_memories');

    // Turn 2: Player asks about preference
    const turn2 = report.turns[1];
    expect(turn2.turn).toBe(2);
    expect(turn2.playerInput).toContain('remember');
    expect(turn2.speakerResponse).toBeTruthy();
    expect(turn2.timings.mindDurationMs).toBeGreaterThan(0);
    expect(turn2.timings.speakerDurationMs).toBeGreaterThan(0);

    // Check recall expectations (this is where we measure deferred behavior)
    expect(turn2.recall.expectedFacts).toEqual(['mystery novels', 'historical']);

    // Aggregate metrics
    expect(report.aggregate.avgMindLatencyMs).toBeGreaterThan(0);
    expect(report.aggregate.avgSpeakerLatencyMs).toBeGreaterThan(0);
    expect(report.aggregate.toolAccuracy).toBeGreaterThanOrEqual(0);
    expect(report.aggregate.recallHitRate).toBeGreaterThanOrEqual(0);

    // Log baseline measurements
    console.log('\nBaseline Measurements (deferred-recall):');
    console.log(`  Turn 1 - Mind: ${turn1.timings.mindDurationMs}ms | Speaker: ${turn1.timings.speakerDurationMs}ms`);
    console.log(`  Turn 2 - Mind: ${turn2.timings.mindDurationMs}ms | Speaker: ${turn2.timings.speakerDurationMs}ms`);
    console.log(`  Recall Hit Rate: ${(report.aggregate.recallHitRate * 100).toFixed(0)}% (${turn2.recall.factsInReply.length}/${turn2.recall.expectedFacts.length} facts in reply)`);
    console.log(`  Tool Accuracy: ${(report.aggregate.toolAccuracy * 100).toFixed(0)}%`);
  }, 30000);

  it('produces non-zero timings', async () => {
    const parsed = ConversationFixtureSchema.safeParse(deferredRecallFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Fixture validation failed');
    }

    const report = await runReplay(parsed.data);

    for (const turn of report.turns) {
      expect(turn.timings.mindDurationMs).toBeGreaterThan(0);
      expect(turn.timings.speakerDurationMs).toBeGreaterThan(0);
      expect(turn.timings.totalMs).toBeGreaterThan(0);
      // Per-stage marks were dropped with src/eval/timer.ts; the shared turn
      // reports the follow-up leg instead, null when the turn had none.
      expect(turn.timings.followUpMs === null || turn.timings.followUpMs >= 0).toBe(true);
    }
  }, 30000);

  it('tracks tool calls correctly', async () => {
    const parsed = ConversationFixtureSchema.safeParse(deferredRecallFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Fixture validation failed');
    }

    const report = await runReplay(parsed.data);

    // Turn 1 looks the preference up. Turn 2 does not need to: the result
    // arrived as deferred context, which is the whole point of the fixture.
    expect(report.turns[0].tools.actualCalls).toContain('recall_memories');
    expect(report.turns[1].tools.actualCalls).not.toContain('recall_memories');
  }, 30000);
});
