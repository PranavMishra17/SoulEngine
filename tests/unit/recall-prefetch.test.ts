import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recallMemoriesFor, recallKnowledgeFor, recallNpcsFor } from '../../src/core/recall.js';
import { executeMindTool } from '../../src/core/mind.js';
import { mcpToolRegistry } from '../../src/mcp/registry.js';
import * as storage from '../../src/storage/index.js';
import { getStorage } from '../../src/storage/factory.js';
import type { NPCDefinition, NPCInstance, Memory } from '../../src/types/npc.js';
import type { KnowledgeBase } from '../../src/types/knowledge.js';

describe('Recall prefetch (Phase B)', () => {
  let projectId: string;
  let definition: NPCDefinition;
  let instance: NPCInstance;

  beforeEach(async () => {
    const project = await storage.createProject('recall-test');
    projectId = project.id;

    const definitionFields: Omit<NPCDefinition, 'id' | 'project_id'> = {
      name: 'Scholar',
      description: 'A knowledgeable scholar',
      personality_baseline: { openness: 0.8, conscientiousness: 0.7, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.3 },
      core_anchor: { backstory: 'Scholar backstory', principles: ['Knowledge'], trauma_flags: [] },
      voice: { provider: 'elevenlabs', voice_id: 'test', speed: 1.0 },
      schedule: [],
      mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
      knowledge_access: { history: 2, magic: 1 },
      network: [],
      player_recognition: { can_know_player: true, reveal_player_identity: true },
    };
    definition = await storage.createDefinition(projectId, definitionFields);

    instance = {
      id: 'test-instance',
      definition_id: definition.id,
      project_id: projectId,
      player_id: 'player-1',
      created_at: new Date().toISOString(),
      current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
      trait_modifiers: {},
      short_term_memory: [],
      long_term_memory: [],
      relationships: {},
      daily_pulse: null,
      cycle_metadata: { last_weekly: null, last_persona_shift: null },
    };
  });

  afterEach(async () => {
    if (projectId) {
      await storage.deleteProject(projectId);
    }
  });

  describe('recallMemoriesFor', () => {
    it('returns memories that match the query', () => {
      const memories: Memory[] = [
        { id: 'm1', content: 'Met a traveler named John', salience: 0.8, timestamp: new Date().toISOString(), type: 'short_term' },
        { id: 'm2', content: 'Learned about ancient magic', salience: 0.6, timestamp: new Date().toISOString(), type: 'short_term' },
        { id: 'm3', content: 'Discussed weather patterns', salience: 0.3, timestamp: new Date().toISOString(), type: 'short_term' },
      ];

      instance.short_term_memory = memories;

      const result = recallMemoriesFor(instance, 'magic ancient', 5);

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain('magic');
    });

    it('respects the limit parameter', () => {
      const memories: Memory[] = [
        { id: 'lm1', content: 'Magic spell alpha', salience: 0.8, timestamp: new Date().toISOString(), type: 'long_term' },
        { id: 'lm2', content: 'Magic spell beta', salience: 0.7, timestamp: new Date().toISOString(), type: 'long_term' },
        { id: 'lm3', content: 'Magic spell gamma', salience: 0.6, timestamp: new Date().toISOString(), type: 'long_term' },
      ];

      instance.long_term_memory = memories;

      const result = recallMemoriesFor(instance, 'magic', 2);

      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array when no match', () => {
      const memories: Memory[] = [
        { id: 'm4', content: 'Unrelated event', salience: 0.5, timestamp: new Date().toISOString(), type: 'short_term' },
      ];

      instance.short_term_memory = memories;

      const result = recallMemoriesFor(instance, 'dragons', 5);

      expect(result).toEqual([]);
    });
  });

  describe('recallKnowledgeFor', () => {
    it('includes a category whose description shares a term', () => {
      const knowledgeBase: KnowledgeBase = {
        categories: {
          history: {
            description: 'Ancient historical events',
            depths: {
              1: 'Basic history',
              2: 'Detailed historical accounts',
            },
          },
          magic: {
            description: 'Magical systems and theory',
            depths: {
              1: 'Basic magic knowledge',
            },
          },
        },
      };

      const result = recallKnowledgeFor(definition, knowledgeBase, 'ancient history', 1000);

      expect(result).toContain('history');
      expect(result).toContain('Depth 1');
    });

    it('resolves at the granted depth level', () => {
      const knowledgeBase: KnowledgeBase = {
        categories: {
          history: {
            description: 'Historical knowledge',
            depths: {
              1: 'Surface history',
              2: 'Deep history',
              3: 'Secret history',
            },
          },
        },
      };

      const result = recallKnowledgeFor(definition, knowledgeBase, 'history', 1000);

      expect(result).toContain('Depth 1');
      expect(result).toContain('Depth 2');
      expect(result).not.toContain('Depth 3');
    });

    it('excludes ungranted categories', () => {
      const knowledgeBase: KnowledgeBase = {
        categories: {
          secrets: {
            description: 'Secret knowledge',
            depths: {
              1: 'Hidden secrets',
            },
          },
        },
      };

      const result = recallKnowledgeFor(definition, knowledgeBase, 'secrets', 1000);

      expect(result).toBe('');
    });

    it('respects token budget', () => {
      const knowledgeBase: KnowledgeBase = {
        categories: {
          history: {
            description: 'Historical events',
            depths: {
              1: 'A'.repeat(10000),
            },
          },
        },
      };

      const result = recallKnowledgeFor(definition, knowledgeBase, 'history', 100);

      expect(result.length).toBeLessThan(10000);
      expect(result).toContain('truncated');
    });
  });

  describe('recallNpcsFor', () => {
    it('matches a network entry by name case-insensitively', async () => {
      // Create a second NPC to reference
      const otherDefFields: Omit<NPCDefinition, 'id' | 'project_id'> = {
        name: 'Aldric',
        description: 'A warrior',
        personality_baseline: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
        core_anchor: { backstory: 'Warrior backstory', principles: [], trauma_flags: [] },
        voice: { provider: 'elevenlabs', voice_id: 'test', speed: 1.0 },
        schedule: [],
        mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
        knowledge_access: {},
        network: [],
        player_recognition: { can_know_player: true, reveal_player_identity: true },
      };
      const otherDef = await storage.createDefinition(projectId, otherDefFields);

      definition.network = [{ npc_id: otherDef.id, familiarity_tier: 2 }];
      await storage.updateDefinition(projectId, definition.id, { network: definition.network });

      const store = getStorage(null);
      const result = await recallNpcsFor(definition, 'aldric', store);

      expect(result).toContain('Aldric');
    });

    it('returns empty string when NPC not in network', async () => {
      const store = getStorage(null);
      const result = await recallNpcsFor(definition, 'UnknownNPC', store);

      expect(result).toBe('');
    });
  });

  describe('Drift guard: Mind tools use same recall functions', () => {
    it('recall_memories tool returns same content as recallMemoriesFor', async () => {
      const memories: Memory[] = [
        { id: 'bm1', content: 'Met the blacksmith', salience: 0.7, timestamp: new Date().toISOString(), type: 'short_term' },
      ];

      instance.short_term_memory = memories;

      const toolResult = await executeMindTool(
        { id: 'call_1', name: 'recall_memories', arguments: { query: 'blacksmith' } },
        definition,
        instance,
        projectId,
        null,
        mcpToolRegistry,
        null,
      );

      const prefetchResult = recallMemoriesFor(instance, 'blacksmith', 5);

      expect(toolResult.status).toBe('success');
      expect(toolResult.result_content).toContain('blacksmith');
      expect(prefetchResult).toHaveLength(1);
      expect(prefetchResult[0].content).toContain('blacksmith');
    });

    it('recall_knowledge tool returns same content as recallKnowledgeFor', async () => {
      const knowledgeBase: KnowledgeBase = {
        categories: {
          history: {
            description: 'Historical knowledge',
            depths: {
              1: 'Ancient events',
              2: 'Detailed history',
            },
          },
        },
      };

      const toolResult = await executeMindTool(
        { id: 'call_1', name: 'recall_knowledge', arguments: { category: 'history' } },
        definition,
        instance,
        projectId,
        knowledgeBase,
        mcpToolRegistry,
        null,
      );

      const prefetchResult = recallKnowledgeFor(definition, knowledgeBase, 'history', 2000);

      expect(toolResult.status).toBe('success');
      expect(toolResult.result_content).toContain('Depth 1');
      expect(toolResult.result_content).toContain('Depth 2');
      expect(prefetchResult).toContain('Depth 1');
      expect(prefetchResult).toContain('Depth 2');
    });
  });
});
