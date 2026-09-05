import { describe, it, expect } from 'vitest';
import {
  ConversationFixtureSchema,
  StubResponseSchema,
  TurnExpectationsSchema,
} from '../../src/schema/eval.js';

describe('Fixture Validation', () => {
  describe('StubResponseSchema', () => {
    it('validates a valid text response', () => {
      const valid = { text: 'Hello world' };
      const result = StubResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('validates a tool call response', () => {
      const valid = {
        toolCalls: [{ name: 'recall_npc', arguments: { name: 'Alice' } }],
      };
      const result = StubResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('validates latency override', () => {
      const valid = { text: 'Slow', latencyMs: 100 };
      const result = StubResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.latencyMs).toBe(100);
      }
    });

    it('rejects negative latency', () => {
      const invalid = { text: 'Invalid', latencyMs: -10 };
      const result = StubResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('TurnExpectationsSchema', () => {
    it('validates recall fact expectations', () => {
      const valid = { recallFacts: ['fact1', 'fact2'] };
      const result = TurnExpectationsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('validates tool expectations', () => {
      const valid = {
        toolsCalled: ['recall_npc'],
        toolsNotCalled: ['exit_convo'],
      };
      const result = TurnExpectationsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('accepts empty expectations', () => {
      const valid = {};
      const result = TurnExpectationsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('ConversationFixtureSchema', () => {
    it('validates a minimal fixture', () => {
      const valid = {
        name: 'test-fixture',
        description: 'A test',
        npc: {
          definition: {
            id: 'npc1',
            project_id: 'proj1',
            name: 'TestNPC',
            description: 'A test NPC',
            core_anchor: {
              backstory: 'backstory',
              principles: ['principle1'],
              trauma_flags: [],
            },
            personality_baseline: {
              openness: 0.5,
              conscientiousness: 0.5,
              extraversion: 0.5,
              agreeableness: 0.5,
              neuroticism: 0.5,
            },
            voice: { provider: 'test', voice_id: 'v1', speed: 1.0 },
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
            id: 'inst1',
            definition_id: 'npc1',
            project_id: 'proj1',
            player_id: 'player1',
            created_at: '2026-09-05T00:00:00Z',
            current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
            trait_modifiers: {},
            short_term_memory: [],
            long_term_memory: [],
            relationships: {},
            daily_pulse: null,
            cycle_metadata: { last_weekly: null, last_persona_shift: null },
          },
        },
        turns: [],
      };

      const result = ConversationFixtureSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('validates a fixture with turns', () => {
      const valid = {
        name: 'test-fixture',
        description: 'A test',
        npc: {
          definition: {
            id: 'npc1',
            project_id: 'proj1',
            name: 'TestNPC',
            description: 'A test NPC',
            core_anchor: {
              backstory: 'backstory',
              principles: ['principle1'],
              trauma_flags: [],
            },
            personality_baseline: {
              openness: 0.5,
              conscientiousness: 0.5,
              extraversion: 0.5,
              agreeableness: 0.5,
              neuroticism: 0.5,
            },
            voice: { provider: 'test', voice_id: 'v1', speed: 1.0 },
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
            id: 'inst1',
            definition_id: 'npc1',
            project_id: 'proj1',
            player_id: 'player1',
            created_at: '2026-09-05T00:00:00Z',
            current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
            trait_modifiers: {},
            short_term_memory: [],
            long_term_memory: [],
            relationships: {},
            daily_pulse: null,
            cycle_metadata: { last_weekly: null, last_persona_shift: null },
          },
        },
        turns: [
          {
            playerInput: 'Hello',
            mindResponses: [{ text: 'NO_ACTION' }],
            speakerResponses: [{ text: 'Hi there' }],
          },
        ],
      };

      const result = ConversationFixtureSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects fixture missing required fields', () => {
      const invalid = {
        name: 'missing-description',
      };

      const result = ConversationFixtureSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
