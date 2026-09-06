/**
 * The eval harness must run the turn loop that ships, not a copy of it.
 *
 * `src/eval/replay.ts` used to reimplement the turn: it joined recall results
 * without the `- Retrieved (<tool>): ` prefix, never produced the follow-up
 * utterance after an action, never stripped narration, and had no Mind timeout.
 * An eval built on a private copy of the code measures the copy. Every defect
 * the text harness found this week lived in the real loop and would have been
 * invisible here.
 *
 * These tests pin the observable consequences of replay going through
 * `runConversationTurn`. See specs/5.19.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { runReplay } from '../../src/eval/replay.js';
import { readSessionLog } from '../../src/telemetry/session-log.js';
import * as storage from '../../src/storage/index.js';
import type { ConversationFixture } from '../../src/schema/eval.js';

function fixture(overrides: Partial<ConversationFixture> = {}): ConversationFixture {
  return {
    name: 'shared-turn-check',
    description: 'Two turns: the first recalls, the second must see the result.',
    npc: {
      definition: {
        id: 'test-npc-1',
        project_id: 'test-project-1',
        name: 'Aria',
        description: 'A shopkeeper who remembers customer preferences',
        core_anchor: {
          backstory: 'Runs a small bookshop in the town square',
          principles: ['Honesty', 'Helpfulness'],
          trauma_flags: [],
        },
        personality_baseline: {
          openness: 0.7,
          conscientiousness: 0.6,
          extraversion: 0.5,
          agreeableness: 0.8,
          neuroticism: 0.3,
        },
        voice: { provider: 'elevenlabs', voice_id: 'test-voice', speed: 1.0 },
        schedule: [],
        mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
        knowledge_access: {},
        network: [],
      },
      instance: {
        id: 'test-instance-1',
        definition_id: 'test-npc-1',
        project_id: 'test-project-1',
        player_id: 'test-player-1',
        created_at: '2026-09-05T00:00:00Z',
        current_mood: { valence: 0.6, arousal: 0.4, dominance: 0.5 },
        trait_modifiers: {},
        short_term_memory: [
          {
            id: 'mem_books',
            content: 'Alex told me they love mystery novels with historical settings.',
            salience: 0.8,
            timestamp: '2026-09-05T00:00:00Z',
            type: 'short_term',
          },
        ],
        long_term_memory: [],
        relationships: {},
        daily_pulse: null,
        cycle_metadata: { last_weekly: null, last_persona_shift: null },
      },
    },
    playerInfo: {
      name: 'Alex',
      description: 'Regular customer',
      role: 'Customer',
      context: 'Has visited the shop several times',
    },
    turns: [
      {
        playerInput: 'Do you remember what I like to read?',
        mindResponses: [
          {
            toolCalls: [{ name: 'recall_memories', arguments: { query: 'mystery novels historical' } }],
            latencyMs: 1,
          },
          { text: 'Recalled.', latencyMs: 1 },
        ],
        // Narration the shared loop is expected to strip.
        speakerResponses: [{ text: '*shrugs* Let me think on that.', latencyMs: 1 }],
        expectations: { toolsCalled: ['recall_memories'] },
      },
      {
        playerInput: 'Well? Anything coming back to you?',
        mindResponses: [{ text: 'Nothing further.', latencyMs: 1 }],
        speakerResponses: [{ text: 'Mystery novels, historical ones.', latencyMs: 1 }],
        expectations: { recallFacts: ['mystery novels'] },
      },
    ],
    ...overrides,
  } as ConversationFixture;
}

let logDir: string;
const savedLogDir = process.env.SESSION_LOG_DIR;

beforeEach(async () => {
  logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-replay-'));
  process.env.SESSION_LOG_DIR = logDir;
});

afterEach(async () => {
  if (savedLogDir === undefined) delete process.env.SESSION_LOG_DIR;
  else process.env.SESSION_LOG_DIR = savedLogDir;
  await fs.rm(logDir, { recursive: true, force: true });
});

describe('eval replay runs the shipped turn loop', () => {
  it('carries deferred recall forward in the shared format', async () => {
    const report = await runReplay(fixture());

    // The old private copy joined results with a bare newline. This prefix is
    // written in one place only -- partitionMindToolResults in the shared loop.
    expect(report.turns[1].speakerPrompt).toContain('- Retrieved (recall_memories):');
    expect(report.turns[1].speakerPrompt).toContain('mystery novels');
  });

  it('strips narration from what it reports the character said', async () => {
    const report = await runReplay(fixture());

    expect(report.turns[0].speakerResponse).toBe('Let me think on that.');
  });

  it('opens a real session and records it as an eval run', async () => {
    const report = await runReplay(fixture());

    const records = await readSessionLog(report.sessionId);

    expect(records.map((r) => r.type)).toEqual([
      'session_started',
      'turn',
      'turn',
      'session_ended',
    ]);
    // Only the turn records carry the channel today: startSession and
    // endSession hardcode 'unknown' for every caller, voice and HTTP
    // included. That gap is backlog 5.23, not this change.
    expect(records.filter((r) => r.type === 'turn').every((r) => r.channel === 'eval')).toBe(true);
  });

  it('removes the scratch project it created', async () => {
    const report = await runReplay(fixture());

    await expect(storage.getProject(report.projectId)).rejects.toThrow();
  });

  it('still reports per-turn and aggregate metrics', async () => {
    const report = await runReplay(fixture());

    expect(report.turns).toHaveLength(2);
    expect(report.turns[0].tools.actualCalls).toContain('recall_memories');
    expect(report.turns[0].tools.accuracy).toBe(1);
    expect(report.turns[1].recall.factsInReply).toContain('mystery novels');
    expect(report.aggregate.recallHitRate).toBe(1);
    expect(report.aggregate.avgTotalLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
