import { describe, it, expect } from 'vitest';
import { parseInputLine, buildTurnRecord } from '../../src/harness/playground.js';
import type { TurnResult } from '../../src/conversation/turn.js';
import type { MoodVector } from '../../src/types.js';

describe('playground protocol', () => {
  describe('parseInputLine', () => {
    it('parses say command', () => {
      const result = parseInputLine('{"say": "hello"}');
      expect(result).toEqual({ type: 'say', text: 'hello' });
    });

    it('parses event command with text only', () => {
      const result = parseInputLine('{"event": {"text": "thunder strikes"}}');
      expect(result).toEqual({ type: 'event', text: 'thunder strikes', salience: undefined });
    });

    it('parses event command with salience', () => {
      const result = parseInputLine('{"event": {"text": "door opens", "salience": 0.8}}');
      expect(result).toEqual({ type: 'event', text: 'door opens', salience: 0.8 });
    });

    it('parses inspect command', () => {
      const result = parseInputLine('{"inspect": true}');
      expect(result).toEqual({ type: 'inspect' });
    });

    it('parses end command', () => {
      const result = parseInputLine('{"end": true}');
      expect(result).toEqual({ type: 'end' });
    });

    it('returns unsupported error for state command', () => {
      const result = parseInputLine('{"state": {"quest": "active"}}');
      expect(result).toEqual({
        type: 'error',
        code: 'unsupported',
        message: 'quest state arrives with backlog 7.9',
      });
    });

    it('returns bad-input error for malformed JSON', () => {
      const result = parseInputLine('{invalid json}');
      expect(result.type).toBe('error');
      expect(result.code).toBe('bad-input');
    });

    it('returns bad-input error for unknown command', () => {
      const result = parseInputLine('{"unknown": "command"}');
      expect(result.type).toBe('error');
      expect(result.code).toBe('bad-input');
    });

    it('returns bad-input error for empty object', () => {
      const result = parseInputLine('{}');
      expect(result.type).toBe('error');
      expect(result.code).toBe('bad-input');
    });
  });

  describe('buildTurnRecord', () => {
    it('produces complete turn record with all required fields', () => {
      const mood: MoodVector = { valence: 0.5, arousal: 0.3, dominance: 0.6 };
      const turnResult: TurnResult = {
        responseText: 'Hello there!',
        followUpText: null,
        mood,
        mindResult: {
          decision: 'respond',
          tools_called: [{ tool_name: 'recall_npc', arguments: { query: 'player name' }, status: 'success' }],
          reasoning: 'Need to recall player info',
          durationMs: 150,
          usage: { input_tokens: 500, output_tokens: 50 },
        },
        toolCalls: [{ id: 'call-1', name: 'recall_npc', arguments: { query: 'player name' } }],
        toolResults: [{ tool_call_id: 'call-1', result: 'Player is John' }],
        speakerPrompt: 'System: You are a helpful NPC.\nUser: hi',
        deferredContextInjected: null,
        deferredContextForNextTurn: 'Retrieved (recall_npc): Player is John',
        recallResultCount: 1,
        mcpResultCount: 0,
        securityContext: { sanitized: true, moderated: true, rateLimited: false, exitRequested: false, moderationFlags: [], inputViolations: [] },
        moderationAction: 'none',
        sanitizationViolations: [],
        timings: {
          mindMs: 150,
          speakerMs: 200,
          speakerTtftMs: 50,
          followUpMs: null,
          followUpTtftMs: null,
          wallMs: 250,
        },
        usage: {
          speaker: { input_tokens: 400, output_tokens: 30, cached_input_tokens: 200 },
          mind: { input_tokens: 500, output_tokens: 50 },
        },
        usageEstimated: false,
      };

      const beforeSnapshot = {
        mood: { valence: 0.4, arousal: 0.3, dominance: 0.6 },
        relationship: null,
        stmCount: 2,
        ltmCount: 5,
      };

      const afterSnapshot = {
        mood,
        relationship: null,
        stmCount: 2,
        ltmCount: 5,
      };

      const record = buildTurnRecord(
        turnResult,
        beforeSnapshot,
        afterSnapshot,
        1,
        'sess-123',
        'hi there',
        [{ name: 'recall_npc', offered: true }, { name: 'recall_knowledge', offered: true }],
        []
      );

      expect(record.type).toBe('turn');
      expect(record.turn).toBe(1);
      expect(record.sessionId).toBe('sess-123');
      expect(record.input).toBe('hi there');
      expect(record.reply).toBe('Hello there!');
      expect(record.followUp).toBeNull();

      expect(record.tools.offered).toEqual(['recall_npc', 'recall_knowledge']);
      expect(record.tools.called).toHaveLength(1);
      expect(record.tools.called[0].name).toBe('recall_npc');
      expect(record.tools.called[0].status).toBe('completed');
      expect(record.tools.denied).toEqual([]);

      expect(record.timings).toEqual(turnResult.timings);
      expect(record.usage).toEqual(turnResult.usage);

      expect(record.security.moderationAction).toBe('none');
      expect(record.security.sanitizationViolations).toEqual([]);

      expect(record.exit.requested).toBe(false);
      expect(record.exit.forcedByModeration).toBe(false);
      expect(record.exit.reason).toBeNull();

      expect(record.deferred.injected).toBeNull();
      expect(record.deferred.forNextTurn).toBe('Retrieved (recall_npc): Player is John');

      expect(record.delta.mood.before).toEqual(beforeSnapshot.mood);
      expect(record.delta.mood.after).toEqual(mood);
      expect(record.delta.relationship).toEqual({ before: null, after: null });
      expect(record.delta.memories.stm).toEqual([2, 2]);
      expect(record.delta.memories.ltm).toEqual([5, 5]);

      // Must never include the raw system prompt
      expect(JSON.stringify(record)).not.toContain('System: You are');
    });

    it('includes exit info when conversation was exited', () => {
      const mood: MoodVector = { valence: 0.5, arousal: 0.3, dominance: 0.6 };
      const turnResult: TurnResult = {
        responseText: 'Goodbye!',
        followUpText: null,
        mood,
        mindResult: null,
        toolCalls: [],
        toolResults: [],
        exitConvoResult: { triggered: true, reason: 'player said goodbye', forcedByModeration: false, sessionId: 'sess-1' },
        speakerPrompt: 'System prompt',
        deferredContextInjected: null,
        deferredContextForNextTurn: null,
        recallResultCount: 0,
        mcpResultCount: 0,
        securityContext: { sanitized: true, moderated: true, rateLimited: false, exitRequested: false, moderationFlags: [], inputViolations: [] },
        moderationAction: 'none',
        sanitizationViolations: [],
        timings: {
          mindMs: null,
          speakerMs: 100,
          speakerTtftMs: 20,
          followUpMs: null,
          followUpTtftMs: null,
          wallMs: 100,
        },
        usage: { speaker: { input_tokens: 200, output_tokens: 15 } },
        usageEstimated: false,
      };

      const snapshot = {
        mood,
        relationship: null,
        stmCount: 3,
        ltmCount: 7,
      };

      const record = buildTurnRecord(
        turnResult,
        snapshot,
        snapshot,
        2,
        'sess-456',
        'bye',
        [],
        []
      );

      expect(record.exit.requested).toBe(true);
      expect(record.exit.forcedByModeration).toBe(false);
      expect(record.exit.reason).toBe('player said goodbye');
    });
  });
});
