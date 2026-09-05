import { describe, it, expect } from 'vitest';
import { runReplay } from '../../src/eval/replay.js';
import { ConversationFixtureSchema } from '../../src/schema/eval.js';
import deferredRecallFixture from '../fixtures/conversations/deferred-recall.json';

describe('Replay Determinism', () => {
  it('produces identical recall and tool results across runs', async () => {
    const parsed = ConversationFixtureSchema.safeParse(deferredRecallFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Fixture validation failed');
    }

    // Run twice
    const report1 = await runReplay(parsed.data);
    const report2 = await runReplay(parsed.data);

    // Compare recall results
    for (let i = 0; i < report1.turns.length; i++) {
      const turn1 = report1.turns[i];
      const turn2 = report2.turns[i];

      expect(turn2.recall.factsInReply).toEqual(turn1.recall.factsInReply);
      expect(turn2.recall.factsInPrompt).toEqual(turn1.recall.factsInPrompt);
      expect(turn2.recall.hitRate).toBe(turn1.recall.hitRate);
    }

    // Compare tool results
    for (let i = 0; i < report1.turns.length; i++) {
      const turn1 = report1.turns[i];
      const turn2 = report2.turns[i];

      expect(turn2.tools.actualCalls).toEqual(turn1.tools.actualCalls);
      expect(turn2.tools.unexpectedCalls).toEqual(turn1.tools.unexpectedCalls);
      expect(turn2.tools.accuracy).toBe(turn1.tools.accuracy);
    }

    // Aggregate metrics should be identical
    expect(report2.aggregate.recallHitRate).toBe(report1.aggregate.recallHitRate);
    expect(report2.aggregate.toolAccuracy).toBe(report1.aggregate.toolAccuracy);
  }, 60000);
});
