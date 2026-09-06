import { describe, it, expect } from 'vitest';
import { runReplay } from '../../src/eval/replay.js';
import { ConversationFixtureSchema } from '../../src/schema/eval.js';
import deferredRecallFixture from '../fixtures/conversations/deferred-recall.json';

describe('Deferred Recall Baseline Metrics', () => {
  it('reports baseline timing and recall metrics for deferred-recall fixture', async () => {
    const parsed = ConversationFixtureSchema.safeParse(deferredRecallFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Fixture validation failed');
    }

    const report = await runReplay(parsed.data);

    // Print detailed baseline numbers for the completion report
    console.log('\n=== Deferred-Recall Baseline Numbers (Parallel Topology) ===');
    console.log(`\nFixture: ${report.fixture}`);
    console.log(`Total Turns: ${report.turns.length}`);

    for (const turn of report.turns) {
      console.log(`\nTurn ${turn.turn}:`);
      console.log(`  Player Input: "${turn.playerInput}"`);
      console.log(`  Mind Duration: ${turn.timings.mindDurationMs}ms`);
      console.log(`  Speaker Duration: ${turn.timings.speakerDurationMs}ms`);
      console.log(`  Wall-Clock Total: ${turn.timings.totalMs}ms`);
      console.log(`  Sum of Stages: ${turn.timings.mindDurationMs + turn.timings.speakerDurationMs}ms`);
      console.log(`  Overlap Savings: ${(turn.timings.mindDurationMs + turn.timings.speakerDurationMs) - turn.timings.totalMs}ms`);
      console.log(`  Recall Hit Rate: ${(turn.recall.hitRate * 100).toFixed(1)}%`);
      console.log(`  Tool Accuracy: ${(turn.tools.accuracy * 100).toFixed(1)}%`);
    }

    console.log(`\nAggregate Metrics:`);
    console.log(`  Avg Mind Latency: ${report.aggregate.avgMindLatencyMs.toFixed(1)}ms`);
    console.log(`  Avg Speaker Latency: ${report.aggregate.avgSpeakerLatencyMs.toFixed(1)}ms`);
    console.log(`  Avg Wall-Clock Total: ${report.aggregate.avgTotalLatencyMs.toFixed(1)}ms`);
    console.log(`  Overall Recall Hit Rate: ${(report.aggregate.recallHitRate * 100).toFixed(1)}%`);
    console.log(`  Overall Tool Accuracy: ${(report.aggregate.toolAccuracy * 100).toFixed(1)}%`);
    console.log('');

    // Verify the deferred-recall behavior is still correct
    expect(report.turns.length).toBe(2);

    // Deferral is the behaviour under measurement: a recall issued in turn 1
    // cannot reach turn 1's own reply, and must reach turn 2.
    //
    // This used to assert turn 2 scored 0%, which recorded a broken fixture as
    // the baseline -- its instance held no memories, so recall could never
    // match anything. With a memory to find, the deferred result lands.
    expect(report.turns[0].recall.factsInReply).toHaveLength(0);
    expect(report.turns[1].recall.expectedFacts).toHaveLength(2);
    expect(report.turns[1].recall.factsInPrompt).toEqual(report.turns[1].recall.expectedFacts);
    expect(report.turns[1].recall.hitRate).toBe(1.0);

    // Tool accuracy should be 100%
    expect(report.aggregate.toolAccuracy).toBe(1.0);
  }, 60000);
});
