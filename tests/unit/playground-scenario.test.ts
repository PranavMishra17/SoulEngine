import { describe, it, expect } from 'vitest';
import { PlaygroundScenarioSchema } from '../../src/schema/eval.js';
import { evaluateExpectations, summarise } from '../../src/harness/playground.js';

describe('playground scenario', () => {
  describe('PlaygroundScenarioSchema', () => {
    it('accepts embedded npc', () => {
      const scenario = {
        name: 'Test Scenario',
        description: 'A test',
        npc: {
          definition: {
            id: 'npc-1',
            project_id: 'proj-1',
            name: 'Test NPC',
            description: 'A test NPC',
            core_anchor: {
              backstory: 'A test NPC',
              principles: ['Helpfulness'],
              trauma_flags: [],
            },
            personality_baseline: {
              openness: 0.5,
              conscientiousness: 0.5,
              extraversion: 0.5,
              agreeableness: 0.5,
              neuroticism: 0.5,
            },
            voice: { provider: 'elevenlabs', voice_id: 'test-voice', speed: 1.0 },
            schedule: [],
            mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
            knowledge_access: {},
            network: [],
          },
          instance: {
            id: 'inst-1',
            definition_id: 'npc-1',
            project_id: 'proj-1',
            player_id: 'player-1',
            created_at: new Date().toISOString(),
            current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
            trait_modifiers: {},
            short_term_memory: [],
            long_term_memory: [],
            relationships: {},
            daily_pulse: null,
            cycle_metadata: { last_weekly: null, last_persona_shift: null },
          },
        },
        player: {
          script: ['Hello', 'How are you?'],
        },
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(true);
    });

    it('accepts npcId instead of embedded npc', () => {
      const scenario = {
        name: 'Test Scenario',
        description: 'A test',
        npcId: 'existing-npc-id',
        player: {
          script: ['Hello'],
        },
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(true);
    });

    it('rejects neither npc nor npcId', () => {
      const scenario = {
        name: 'Test Scenario',
        description: 'A test',
        player: {
          script: ['Hello'],
        },
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(false);
    });

    it('rejects both npc and npcId', () => {
      const scenario = {
        name: 'Test Scenario',
        description: 'A test',
        npc: {
          definition: {
            id: 'npc-1',
            project_id: 'proj-1',
            name: 'Test NPC',
            description: 'A test',
            core_anchor: { backstory: 'Test', principles: [], trauma_flags: [] },
            personality_baseline: {
              openness: 0.5,
              conscientiousness: 0.5,
              extraversion: 0.5,
              agreeableness: 0.5,
              neuroticism: 0.5,
            },
            voice: { provider: 'elevenlabs', voice_id: 'test', speed: 1.0 },
            schedule: [],
            mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
            knowledge_access: {},
            network: [],
          },
          instance: {
            id: 'inst-1',
            definition_id: 'npc-1',
            project_id: 'proj-1',
            player_id: 'player-1',
            created_at: new Date().toISOString(),
            current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
            trait_modifiers: {},
            short_term_memory: [],
            long_term_memory: [],
            relationships: {},
            daily_pulse: null,
            cycle_metadata: { last_weekly: null, last_persona_shift: null },
          },
        },
        npcId: 'also-this',
        player: {
          script: ['Hello'],
        },
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(false);
    });

    it('accepts expectations with all check types', () => {
      const scenario = {
        name: 'Test',
        description: 'Test',
        npcId: 'npc-1',
        player: { script: ['hi', 'bye'] },
        expect: [
          {
            turn: 1,
            toolsCalled: ['recall_npc'],
            toolsNotCalled: ['exit_convo'],
            recallFacts: ['player name'],
            replyMatches: 'hello.*world',
            exitRequested: false,
            moderationAction: 'allow',
          },
        ],
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(true);
    });

    it('accepts events with afterTurn', () => {
      const scenario = {
        name: 'Test',
        description: 'Test',
        npcId: 'npc-1',
        player: { script: ['hi', 'continue'] },
        events: [
          { afterTurn: 1, text: 'A bell rings', salience: 0.7 },
        ],
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(true);
    });

    it('accepts trials field', () => {
      const scenario = {
        name: 'Test',
        description: 'Test',
        npcId: 'npc-1',
        player: { script: ['hi'] },
        trials: 5,
      };

      const result = PlaygroundScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(true);
    });
  });

  describe('evaluateExpectations', () => {
    const mockTurnRecord = (overrides: any = {}) => ({
      type: 'turn' as const,
      turn: 1,
      sessionId: 'sess-1',
      input: 'test input',
      reply: 'test reply',
      followUp: null,
      tools: {
        offered: ['recall_npc', 'recall_knowledge'],
        called: [{ name: 'recall_npc', arguments: {}, status: 'success' }],
        denied: [],
      },
      timings: {
        mindMs: 100,
        speakerMs: 150,
        speakerTtftMs: 30,
        followUpMs: null,
        followUpTtftMs: null,
        wallMs: 200,
      },
      usage: {
        speaker: { input_tokens: 200, output_tokens: 20 },
      },
      security: {
        moderationAction: 'allow',
        sanitizationViolations: [],
      },
      exit: {
        requested: false,
        forcedByModeration: false,
        reason: null,
      },
      deferred: {
        injected: null,
        forNextTurn: null,
      },
      delta: {
        mood: {
          before: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
          after: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
        },
        relationship: null,
        memories: { stm: [2, 2], ltm: [5, 5] },
      },
      ...overrides,
    });

    it('passes when toolsCalled matches', () => {
      const record = mockTurnRecord();
      const expectation = { turn: 1, toolsCalled: ['recall_npc'] };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(true);
      expect(result[0].check).toBe('toolsCalled');
    });

    it('fails when toolsCalled does not match', () => {
      const record = mockTurnRecord();
      const expectation = { turn: 1, toolsCalled: ['recall_knowledge'] };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(false);
      expect(result[0].check).toBe('toolsCalled');
    });

    it('passes when toolsNotCalled is respected', () => {
      const record = mockTurnRecord();
      const expectation = { turn: 1, toolsNotCalled: ['exit_convo'] };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(true);
      expect(result[0].check).toBe('toolsNotCalled');
    });

    it('fails when toolsNotCalled is violated', () => {
      const record = mockTurnRecord();
      const expectation = { turn: 1, toolsNotCalled: ['recall_npc'] };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(false);
      expect(result[0].check).toBe('toolsNotCalled');
    });

    it('passes when recallFacts substring matches reply', () => {
      const record = mockTurnRecord({ reply: 'Hello John, nice to meet you' });
      const expectation = { turn: 1, recallFacts: ['John'] };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(true);
      expect(result[0].check).toBe('recallFacts');
    });

    it('fails when recallFacts not in reply', () => {
      const record = mockTurnRecord({ reply: 'Hello there' });
      const expectation = { turn: 1, recallFacts: ['player name'] };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(false);
    });

    it('passes when replyMatches regex matches', () => {
      const record = mockTurnRecord({ reply: 'Hello, how are you?' });
      const expectation = { turn: 1, replyMatches: 'hello.*you' };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(true);
      expect(result[0].check).toBe('replyMatches');
    });

    it('fails when replyMatches regex does not match', () => {
      const record = mockTurnRecord({ reply: 'Greetings' });
      const expectation = { turn: 1, replyMatches: 'hello' };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(false);
    });

    it('passes when exitRequested matches', () => {
      const record = mockTurnRecord({ exit: { requested: true, forcedByModeration: false, reason: 'done' } });
      const expectation = { turn: 1, exitRequested: true };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(true);
      expect(result[0].check).toBe('exitRequested');
    });

    it('passes when moderationAction matches', () => {
      const record = mockTurnRecord({ security: { moderationAction: 'block', sanitizationViolations: [] } });
      const expectation = { turn: 1, moderationAction: 'block' };
      const result = evaluateExpectations([record], [expectation]);

      expect(result[0].passed).toBe(true);
      expect(result[0].check).toBe('moderationAction');
    });
  });

  describe('summarise', () => {
    it('computes passK as 1 when all trials passed', () => {
      const trialResults = [
        { passed: true, records: [], evaluations: [] },
        { passed: true, records: [], evaluations: [] },
        { passed: true, records: [], evaluations: [] },
      ];

      const summary = summarise('Test Scenario', trialResults, []);

      expect(summary.trials).toBe(3);
      expect(summary.passed).toBe(3);
      expect(summary.passK).toBe(1);
    });

    it('computes passK as 0 when any trial failed', () => {
      const trialResults = [
        { passed: true, records: [], evaluations: [] },
        { passed: false, records: [], evaluations: [] },
        { passed: true, records: [], evaluations: [] },
      ];

      const summary = summarise('Test Scenario', trialResults, []);

      expect(summary.trials).toBe(3);
      expect(summary.passed).toBe(2);
      expect(summary.passK).toBe(0);
    });

    it('computes per-expectation pass rates', () => {
      const trialResults = [
        {
          passed: true,
          records: [],
          evaluations: [
            { turn: 1, check: 'toolsCalled', passed: true },
            { turn: 1, check: 'exitRequested', passed: true },
          ],
        },
        {
          passed: false,
          records: [],
          evaluations: [
            { turn: 1, check: 'toolsCalled', passed: false },
            { turn: 1, check: 'exitRequested', passed: true },
          ],
        },
        {
          passed: true,
          records: [],
          evaluations: [
            { turn: 1, check: 'toolsCalled', passed: true },
            { turn: 1, check: 'exitRequested', passed: true },
          ],
        },
      ];

      const summary = summarise('Test', trialResults, []);

      expect(summary.perExpectation).toHaveLength(2);
      const toolsCalledRate = summary.perExpectation.find((e) => e.check === 'toolsCalled');
      expect(toolsCalledRate?.passRate).toBeCloseTo(2 / 3);

      const exitRate = summary.perExpectation.find((e) => e.check === 'exitRequested');
      expect(exitRate?.passRate).toBe(1.0);
    });

    it('computes p50 and p95 latency percentiles', () => {
      const trialResults = [
        {
          passed: true,
          records: [
            {
              type: 'turn' as const,
              turn: 1,
              sessionId: 's1',
              input: 'hi',
              reply: 'hello',
              followUp: null,
              tools: { offered: [], called: [], denied: [] },
              timings: { mindMs: null, speakerMs: 100, speakerTtftMs: 20, followUpMs: null, followUpTtftMs: null, wallMs: 100 },
              usage: {},
              security: { moderationAction: 'allow', sanitizationViolations: [] },
              exit: { requested: false, forcedByModeration: false, reason: null },
              deferred: { injected: null, forNextTurn: null },
              delta: {
                mood: {
                  before: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                  after: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                },
                relationship: null,
                memories: { stm: [0, 0], ltm: [0, 0] },
              },
            },
          ],
          evaluations: [],
        },
        {
          passed: true,
          records: [
            {
              type: 'turn' as const,
              turn: 1,
              sessionId: 's2',
              input: 'hi',
              reply: 'hello',
              followUp: null,
              tools: { offered: [], called: [], denied: [] },
              timings: { mindMs: null, speakerMs: 200, speakerTtftMs: 40, followUpMs: null, followUpTtftMs: null, wallMs: 200 },
              usage: {},
              security: { moderationAction: 'allow', sanitizationViolations: [] },
              exit: { requested: false, forcedByModeration: false, reason: null },
              deferred: { injected: null, forNextTurn: null },
              delta: {
                mood: {
                  before: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                  after: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                },
                relationship: null,
                memories: { stm: [0, 0], ltm: [0, 0] },
              },
            },
          ],
          evaluations: [],
        },
      ];

      const summary = summarise('Test', trialResults, []);

      expect(summary.latency.wallMs.p50).toBe(150);
      expect(summary.latency.speakerMs.p50).toBe(150);
      expect(summary.latency.speakerTtftMs.p50).toBe(30);
    });

    it('sums usage across trials', () => {
      const trialResults = [
        {
          passed: true,
          records: [
            {
              type: 'turn' as const,
              turn: 1,
              sessionId: 's1',
              input: 'hi',
              reply: 'hello',
              followUp: null,
              tools: { offered: [], called: [], denied: [] },
              timings: { mindMs: null, speakerMs: 100, speakerTtftMs: null, followUpMs: null, followUpTtftMs: null, wallMs: 100 },
              usage: {
                speaker: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 50 },
              },
              security: { moderationAction: 'allow', sanitizationViolations: [] },
              exit: { requested: false, forcedByModeration: false, reason: null },
              deferred: { injected: null, forNextTurn: null },
              delta: {
                mood: {
                  before: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                  after: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                },
                relationship: null,
                memories: { stm: [0, 0], ltm: [0, 0] },
              },
            },
          ],
          evaluations: [],
        },
        {
          passed: true,
          records: [
            {
              type: 'turn' as const,
              turn: 1,
              sessionId: 's2',
              input: 'hi',
              reply: 'hello',
              followUp: null,
              tools: { offered: [], called: [], denied: [] },
              timings: { mindMs: null, speakerMs: 100, speakerTtftMs: null, followUpMs: null, followUpTtftMs: null, wallMs: 100 },
              usage: {
                speaker: { input_tokens: 150, output_tokens: 25, cached_input_tokens: 75 },
              },
              security: { moderationAction: 'allow', sanitizationViolations: [] },
              exit: { requested: false, forcedByModeration: false, reason: null },
              deferred: { injected: null, forNextTurn: null },
              delta: {
                mood: {
                  before: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                  after: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                },
                relationship: null,
                memories: { stm: [0, 0], ltm: [0, 0] },
              },
            },
          ],
          evaluations: [],
        },
      ];

      const summary = summarise('Test', trialResults, []);

      expect(summary.usage.inputTokens).toBe(250);
      expect(summary.usage.outputTokens).toBe(45);
      expect(summary.usage.cachedInputTokens).toBe(125);
    });
  });
});
