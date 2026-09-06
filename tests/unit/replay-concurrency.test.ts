import { describe, it, expect } from 'vitest';
import { runReplay } from '../../src/eval/replay.js';
import type { ConversationFixture } from '../../src/schema/eval.js';

/**
 * Mind and Speaker must overlap; a sequential loop would show wall-clock time
 * near the sum of the two stages rather than near the longer of them.
 *
 * The scripted latencies are deliberately large. Wall-clock now measures a real
 * turn -- sanitization, moderation, session context loading, storage writes and
 * the session log append all sit inside it -- so the fixed overhead has to stay
 * small next to the stage times for the ratio below to mean anything. At the
 * original 100ms per stage the margin was under 50ms and the overhead ate it.
 */
describe('Replay Concurrency', () => {
  it('runs Mind and Speaker in parallel, wall-clock < sum of stages', async () => {
    // Create a minimal fixture with known latencies
    const fixture: ConversationFixture = {
      name: 'concurrency-test',
      description: 'Tests that Mind and Speaker run concurrently',
      npc: {
        definition: {
          id: 'test-npc',
          project_id: 'test-project',
          name: 'Test NPC',
          description: 'Test',
          core_anchor: {
            backstory: 'Test',
            principles: ['Test'],
            trauma_flags: [],
          },
          personality_baseline: {
            openness: 0.5,
            conscientiousness: 0.5,
            extraversion: 0.5,
            agreeableness: 0.5,
            neuroticism: 0.5,
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: 'test',
            speed: 1.0,
          },
          schedule: [],
          mcp_permissions: {
            conversation_tools: [],
            game_event_tools: [],
            denied: [],
          },
          knowledge_access: {},
          network: [],
        },
        instance: {
          id: 'test-instance',
          definition_id: 'test-npc',
          project_id: 'test-project',
          player_id: 'test-player',
          created_at: '2026-09-05T00:00:00Z',
          current_mood: {
            valence: 0.5,
            arousal: 0.5,
            dominance: 0.5,
          },
          trait_modifiers: {},
          short_term_memory: [],
          long_term_memory: [],
          relationships: {},
          daily_pulse: null,
          cycle_metadata: {
            last_weekly: null,
            last_persona_shift: null,
          },
        },
      },
      turns: [
        {
          playerInput: 'Hello',
          // Mind takes 400ms
          mindResponses: [
            {
              text: 'thinking',
              latencyMs: 400,
            },
          ],
          // Speaker takes 400ms
          speakerResponses: [
            {
              text: 'Hello there',
              latencyMs: 400,
            },
          ],
        },
      ],
    };

    const report = await runReplay(fixture);

    expect(report.turns.length).toBe(1);
    const turn = report.turns[0];

    // Both stages should have run
    expect(turn.timings.mindDurationMs).toBeGreaterThan(0);
    expect(turn.timings.speakerDurationMs).toBeGreaterThan(0);

    // Wall-clock total should be meaningfully less than the sum if they ran in parallel
    // With 100ms each, sequential would be ~200ms, parallel would be ~100ms
    const sumOfStages = turn.timings.mindDurationMs + turn.timings.speakerDurationMs;
    const wallClockTotal = turn.timings.totalMs;

    // Allow for some overhead, but wall-clock should be significantly less than sum
    // If they run in parallel with 100ms each, wall-clock should be close to max(100, 100) = 100
    // Sequential would be 100 + 100 = 200
    expect(wallClockTotal).toBeLessThan(sumOfStages * 0.75);
    expect(wallClockTotal).toBeGreaterThan(Math.max(turn.timings.mindDurationMs, turn.timings.speakerDurationMs) * 0.9);
  }, 60000);

  it('wall-clock reflects overlap for turns with different stage durations', async () => {
    const fixture: ConversationFixture = {
      name: 'asymmetric-concurrency-test',
      description: 'Mind takes longer than Speaker',
      npc: {
        definition: {
          id: 'test-npc',
          project_id: 'test-project',
          name: 'Test NPC',
          description: 'Test',
          core_anchor: {
            backstory: 'Test',
            principles: ['Test'],
            trauma_flags: [],
          },
          personality_baseline: {
            openness: 0.5,
            conscientiousness: 0.5,
            extraversion: 0.5,
            agreeableness: 0.5,
            neuroticism: 0.5,
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: 'test',
            speed: 1.0,
          },
          schedule: [],
          mcp_permissions: {
            conversation_tools: [],
            game_event_tools: [],
            denied: [],
          },
          knowledge_access: {},
          network: [],
        },
        instance: {
          id: 'test-instance',
          definition_id: 'test-npc',
          project_id: 'test-project',
          player_id: 'test-player',
          created_at: '2026-09-05T00:00:00Z',
          current_mood: {
            valence: 0.5,
            arousal: 0.5,
            dominance: 0.5,
          },
          trait_modifiers: {},
          short_term_memory: [],
          long_term_memory: [],
          relationships: {},
          daily_pulse: null,
          cycle_metadata: {
            last_weekly: null,
            last_persona_shift: null,
          },
        },
      },
      turns: [
        {
          playerInput: 'Hello',
          // Mind takes 800ms
          mindResponses: [
            {
              text: 'thinking',
              latencyMs: 800,
            },
          ],
          // Speaker takes 400ms
          speakerResponses: [
            {
              text: 'Hi',
              latencyMs: 400,
            },
          ],
        },
      ],
    };

    const report = await runReplay(fixture);
    const turn = report.turns[0];

    const wallClockTotal = turn.timings.totalMs;
    const longestStage = Math.max(turn.timings.mindDurationMs, turn.timings.speakerDurationMs);
    const shortestStage = Math.min(turn.timings.mindDurationMs, turn.timings.speakerDurationMs);

    // Overlapping, wall-clock lands at the longer stage plus turn overhead
    // (~5ms typically, occasionally over 150ms under load). Sequential, it
    // would land at the sum -- a further 400ms out. The bound sits between the
    // two: it absorbs 240ms of overhead and still fails a sequential loop.
    expect(wallClockTotal).toBeLessThan(longestStage + shortestStage * 0.6);
    expect(wallClockTotal).toBeGreaterThan(longestStage * 0.9);
  }, 60000);
});
