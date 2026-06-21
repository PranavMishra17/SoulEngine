import { describe, it, expect } from 'vitest';
import type { NPCDefinition, NPCInstance } from '../../src/types/npc.js';
import type { KnowledgeBase } from '../../src/types/knowledge.js';
import type { SecurityContext } from '../../src/types/security.js';
import { assembleSystemPrompt, assembleSlimSystemPrompt, estimateTokenCount } from '../../src/core/context.js';
import { resolveKnowledge } from '../../src/core/knowledge.js';

describe('Context token budget enforcement', () => {
  const mockDefinition: NPCDefinition = {
    id: 'test-npc-id',
    name: 'TestNPC',
    description: 'A test NPC',
    project_id: 'test-project',
    core_anchor: {
      backstory: 'Test backstory',
      principles: ['honesty', 'loyalty'],
      trauma_flags: [],
    },
    personality_baseline: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    },
    knowledge_access: {
      'oversized-category': 3,
    },
    schedule: [],
    network: [],
    metadata: {
      version_num: 1,
      version_timestamp: new Date().toISOString(),
    },
  };

  const mockInstance: NPCInstance = {
    id: 'test-instance-id',
    definition_id: 'test-npc-id',
    player_id: 'test-player-id',
    current_mood: {
      arousal: 0.5,
      valence: 0.5,
      dominance: 0.5,
    },
    trait_modifiers: {},
    relationships: {},
    short_term_memory: [],
    long_term_memory: [],
    episodic_memory: [],
    knowledge_updates: {},
    metadata: {
      created_at: new Date().toISOString(),
      version: 1,
    },
  };

  const mockSecurityContext: SecurityContext = {
    sanitized: true,
    moderated: true,
    rateLimited: false,
    exitRequested: false,
    moderationFlags: [],
    inputViolations: [],
  };

  it('truncates oversized knowledge when resolving categories', () => {
    // Build an oversized knowledge base with a category containing massive depth content
    const hugeContent = 'X'.repeat(10000); // 10k characters in one depth tier
    const knowledgeBase: KnowledgeBase = {
      categories: {
        'oversized-category': {
          description: 'A category with massive depth content',
          depths: {
            1: hugeContent,
            2: hugeContent,
            3: hugeContent,
          },
        },
      },
    };

    // With budgeting, resolveKnowledge should cap each category
    const resolved = resolveKnowledge(knowledgeBase, mockDefinition.knowledge_access);
    const resolvedTokens = estimateTokenCount(resolved);

    // After the fix: the category is capped at the budget (default 2000 tokens)
    expect(resolvedTokens).toBeLessThanOrEqual(2100); // Small margin for metadata
  });

  it('enforces a token budget during full system prompt assembly', async () => {
    // Create a knowledge base with very large depth tiers
    const largeContent = 'Y'.repeat(20000); // Much larger to test budgeting
    const knowledgeBase: KnowledgeBase = {
      categories: {
        'oversized-category': {
          description: 'Oversized test category',
          depths: {
            1: largeContent,
            2: largeContent,
            3: largeContent,
          },
        },
      },
    };

    // Resolve knowledge WITH budgeting (after the fix)
    const resolvedKnowledge = resolveKnowledge(knowledgeBase, mockDefinition.knowledge_access);
    const knowledgeTokens = estimateTokenCount(resolvedKnowledge);

    // After the fix: knowledge is capped at the per-category budget
    expect(knowledgeTokens).toBeLessThanOrEqual(2100);

    // Assemble the full system prompt
    const systemPrompt = await assembleSystemPrompt(
      mockDefinition,
      mockInstance,
      resolvedKnowledge,
      mockSecurityContext,
      { includeKnowledge: true, includeMemories: true }
    );

    const totalTokens = estimateTokenCount(systemPrompt);

    // After the fix: with budgeted knowledge, the prompt is predictable
    // Base prompt ~200-300 tokens + knowledge ~2000 + memories ~1500 = ~4000 max
    expect(totalTokens).toBeLessThanOrEqual(5000);
  });

  it('caps knowledge even with multiple massive depth tiers', async () => {
    // The main issue identified in AUDIT.md Tier 1.8:
    // "resolveKnowledge concatenates all depth tiers with no length cap"

    // Build knowledge with multiple massive depth tiers
    const hugeDepthContent = 'K'.repeat(15000); // 15k chars per depth
    const knowledgeBase: KnowledgeBase = {
      categories: {
        'oversized-category': {
          description: 'Test category',
          depths: {
            1: hugeDepthContent,
            2: hugeDepthContent,
            3: hugeDepthContent,
          },
        },
      },
    };

    const resolved = resolveKnowledge(knowledgeBase, mockDefinition.knowledge_access);
    const knowledgeTokens = estimateTokenCount(resolved);

    // After the fix: resolveKnowledge enforces a per-category budget
    // Even with 3 × 15k chars, the output is capped at ~2000 tokens
    expect(knowledgeTokens).toBeLessThanOrEqual(2100);
  });

  it('degrades gracefully when content exceeds budget (no throw)', async () => {
    // Build massive knowledge
    const massive = 'Z'.repeat(20000);
    const knowledgeBase: KnowledgeBase = {
      categories: {
        'oversized-category': {
          description: 'Extremely large category',
          depths: {
            1: massive,
            2: massive,
            3: massive,
          },
        },
      },
    };

    const resolvedKnowledge = resolveKnowledge(knowledgeBase, mockDefinition.knowledge_access);

    // This should NOT throw, even with oversized content
    await expect(
      assembleSystemPrompt(
        mockDefinition,
        mockInstance,
        resolvedKnowledge,
        mockSecurityContext,
        { includeKnowledge: true }
      )
    ).resolves.toBeDefined();

    // The prompt should be capped, not infinite
    const prompt = await assembleSystemPrompt(
      mockDefinition,
      mockInstance,
      resolvedKnowledge,
      mockSecurityContext,
      { includeKnowledge: true }
    );

    // After the fix: budgeting ensures the prompt stays predictable
    expect(estimateTokenCount(prompt)).toBeLessThanOrEqual(5000);
  });
});
