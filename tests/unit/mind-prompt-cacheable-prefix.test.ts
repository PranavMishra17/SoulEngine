import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMindSystemPromptParts, runMindAgentLoop } from '../../src/core/mind.js';
import type { NPCDefinition, NPCInstance } from '../../src/types/npc.js';
import type { LLMProvider, LLMMessage, LLMStreamChunk } from '../../src/providers/llm/interface.js';
import type { KnowledgeBase } from '../../src/types/knowledge.js';
import type { SecurityContext } from '../../src/types/security.js';
import type { Tool } from '../../src/types/mcp.js';
import type { MCPToolRegistry } from '../../src/mcp/registry.js';
import * as tools from '../../src/core/tools.js';

describe('Mind prompt cacheable prefix', () => {
  const baseDefinition: NPCDefinition = {
    id: 'test-npc',
    name: 'TestNPC',
    description: 'A test character',
    project_id: 'test-project',
    version: 1,
    personality_baseline: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    },
    core_anchor: {
      backstory: 'Test backstory',
      principles: ['honesty', 'loyalty'],
      trauma_flags: [],
    },
    current_location: 'test-location',
    network: [],
    knowledge_access: {},
    mcp_permissions: {
      conversation_tools: ['request_credentials'],
      game_event_tools: [],
      denied: [],
    },
  };

  const baseInstance: NPCInstance = {
    id: 'test-instance',
    npc_id: 'test-npc',
    project_id: 'test-project',
    player_id: 'test-player',
    current_mood: { valence: 0.0, arousal: 0.0, dominance: 0.0 },
    trait_modifiers: null,
    memories: [],
    relationship_level: 0,
    location: 'test-location',
    created_at: new Date(),
    updated_at: new Date(),
  };

  describe('buildMindSystemPromptParts', () => {
    it('should return byte-identical stable parts for different moods and trait modifiers', () => {
      const instance1: NPCInstance = {
        ...baseInstance,
        current_mood: { valence: 0.8, arousal: 0.6, dominance: 0.7 },
        trait_modifiers: { openness: 0.2 },
      };

      const instance2: NPCInstance = {
        ...baseInstance,
        current_mood: { valence: -0.5, arousal: 0.3, dominance: 0.2 },
        trait_modifiers: { conscientiousness: -0.3, neuroticism: 0.4 },
      };

      const parts1 = buildMindSystemPromptParts(baseDefinition, instance1);
      const parts2 = buildMindSystemPromptParts(baseDefinition, instance2);

      // Stable parts must be byte-identical
      expect(parts1.stable).toBe(parts2.stable);

      // Dynamic parts must differ
      expect(parts1.dynamic).not.toBe(parts2.dynamic);
    });

    it('should not include player line or history text in either part', () => {
      const parts = buildMindSystemPromptParts(baseDefinition, baseInstance);

      // Neither part should contain [CURRENT CONVERSATION]
      expect(parts.stable).not.toContain('[CURRENT CONVERSATION]');
      expect(parts.dynamic).not.toContain('[CURRENT CONVERSATION]');

      // Neither part should contain Player: prefix
      expect(parts.stable).not.toContain('Player:');
      expect(parts.dynamic).not.toContain('Player:');
    });

    it('should include baseline personality in stable part without modifiers', () => {
      const instanceWithModifiers: NPCInstance = {
        ...baseInstance,
        trait_modifiers: { openness: 0.3, extraversion: -0.2 },
      };

      const parts = buildMindSystemPromptParts(baseDefinition, instanceWithModifiers);

      // Stable should contain personality baseline
      expect(parts.stable).toContain('TestNPC');
      expect(parts.stable).toContain('Test backstory');
    });

    it('should include mood in dynamic part', () => {
      const happyInstance: NPCInstance = {
        ...baseInstance,
        current_mood: { valence: 0.8, arousal: 0.6, dominance: 0.7 },
      };

      const parts = buildMindSystemPromptParts(baseDefinition, happyInstance);

      // Dynamic should contain mood information
      expect(parts.dynamic.toLowerCase()).toMatch(/mood|feeling|emotional/);
    });

    it('should include trait shifts in dynamic part when present', () => {
      const driftedInstance: NPCInstance = {
        ...baseInstance,
        trait_modifiers: { openness: 0.3, neuroticism: -0.2 },
      };

      const parts = buildMindSystemPromptParts(baseDefinition, driftedInstance);

      // Dynamic should mention trait shifts
      expect(parts.dynamic).toContain('openness');
    });

    it('should include conservative action instruction in stable part', () => {
      const parts = buildMindSystemPromptParts(baseDefinition, baseInstance);

      // Should contain conservative wording
      expect(parts.stable.toLowerCase()).toContain('when in doubt');
      expect(parts.stable).toContain('NO_ACTION');

      // Should NOT contain proactive language
      expect(parts.stable).not.toContain('proactively');
      expect(parts.stable).not.toMatch(/use them.*when appropriate/i);
    });

    it('should include EXIT_CONVO_RULES in stable part', () => {
      const parts = buildMindSystemPromptParts(baseDefinition, baseInstance);

      // Should contain exit_convo rules
      expect(parts.stable).toContain('exit_convo');
    });
  });

  describe('runMindAgentLoop prompt structure', () => {
    let mockProvider: LLMProvider;
    let mockToolRegistry: MCPToolRegistry;
    let mockSecurityContext: SecurityContext;
    let mockProjectTools: Record<string, Tool>;
    let streamChatSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      streamChatSpy = vi.fn();
      mockProvider = {
        name: 'test-provider',
        streamChat: streamChatSpy,
      };

      mockToolRegistry = {
        executeTool: vi.fn(),
      } as unknown as MCPToolRegistry;

      mockSecurityContext = {
        exitRequested: false,
        jailbreakDetected: false,
        moderationTriggered: false,
      };

      mockProjectTools = {};
    });

    it('should send systemPromptPrefix, systemPrompt, and cacheKey in the first LLM call', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'model', content: 'Hi there' },
      ];
      const userMessage = 'How are you?';

      // Mock response with NO_ACTION
      streamChatSpy.mockReturnValue((async function* () {
        yield { text: 'NO_ACTION', toolCalls: [], done: false };
        yield {
          text: '',
          toolCalls: [],
          done: true,
          usage: { input_tokens: 100, output_tokens: 5, cached_input_tokens: 50 },
        };
      })());

      await runMindAgentLoop(
        baseDefinition,
        baseInstance,
        userMessage,
        history,
        mockProvider,
        'test-project',
        null,
        mockToolRegistry,
        mockSecurityContext,
        mockProjectTools,
        new AbortController().signal,
        'test-user',
      );

      // Verify streamChat was called
      expect(streamChatSpy).toHaveBeenCalled();
      const firstCall = streamChatSpy.mock.calls[0][0];

      // Should have systemPromptPrefix
      expect(firstCall).toHaveProperty('systemPromptPrefix');
      expect(typeof firstCall.systemPromptPrefix).toBe('string');
      expect(firstCall.systemPromptPrefix.length).toBeGreaterThan(0);

      // Should have systemPrompt
      expect(firstCall).toHaveProperty('systemPrompt');
      expect(typeof firstCall.systemPrompt).toBe('string');

      // Should have cacheKey matching definition id and version
      expect(firstCall).toHaveProperty('cacheKey');
      expect(firstCall.cacheKey).toBe('test-npc:1');

      // systemPromptPrefix should not contain [CURRENT CONVERSATION]
      expect(firstCall.systemPromptPrefix).not.toContain('[CURRENT CONVERSATION]');
      expect(firstCall.systemPrompt).not.toContain('[CURRENT CONVERSATION]');
    });

    it('should send history and user message in messages array', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Previous question' },
        { role: 'model', content: 'Previous answer' },
      ];
      const userMessage = 'Current question';

      streamChatSpy.mockReturnValue((async function* () {
        yield { text: 'NO_ACTION', toolCalls: [], done: false };
        yield {
          text: '',
          toolCalls: [],
          done: true,
          usage: { input_tokens: 100, output_tokens: 5 },
        };
      })());

      await runMindAgentLoop(
        baseDefinition,
        baseInstance,
        userMessage,
        history,
        mockProvider,
        'test-project',
        null,
        mockToolRegistry,
        mockSecurityContext,
        mockProjectTools,
        new AbortController().signal,
        'test-user',
      );

      const firstCall = streamChatSpy.mock.calls[0][0];

      // Should have messages array
      expect(firstCall).toHaveProperty('messages');
      expect(Array.isArray(firstCall.messages)).toBe(true);

      // Should contain history + current user message
      expect(firstCall.messages.length).toBe(3);
      expect(firstCall.messages[0]).toEqual({ role: 'user', content: 'Previous question' });
      expect(firstCall.messages[1]).toEqual({ role: 'model', content: 'Previous answer' });
      expect(firstCall.messages[2]).toEqual({ role: 'user', content: 'Current question' });
    });

    it('should propagate cached_input_tokens in MindResult.usage', async () => {
      streamChatSpy.mockReturnValue((async function* () {
        yield { text: 'NO_ACTION', toolCalls: [], done: false };
        yield {
          text: '',
          toolCalls: [],
          done: true,
          usage: { input_tokens: 2000, output_tokens: 10, cached_input_tokens: 1500 },
        };
      })());

      const result = await runMindAgentLoop(
        baseDefinition,
        baseInstance,
        'Test message',
        [],
        mockProvider,
        'test-project',
        null,
        mockToolRegistry,
        mockSecurityContext,
        mockProjectTools,
        new AbortController().signal,
        'test-user',
      );

      expect(result.usage).toBeDefined();
      expect(result.usage?.cached_input_tokens).toBe(1500);
      expect(result.usage?.input_tokens).toBe(2000);
      expect(result.usage?.output_tokens).toBe(10);
    });
  });

  describe('getAvailableTools removal', () => {
    it('should not export getAvailableTools', () => {
      // @ts-expect-error - should not exist
      expect(tools.getAvailableTools).toBeUndefined();
    });
  });
});
