/**
 * Tests for cacheable prefix/dynamic suffix split in slim system prompt.
 * Verifies that stable sections (definition-level data) are byte-identical
 * across turns, while dynamic sections (mood, relationships, memories) vary.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleSlimSystemPrompt,
  assembleSlimSystemPromptParts,
  augmentPromptWithMindContext,
} from '../../src/core/context.js';
import type { NPCDefinition, NPCInstance } from '../../src/types/npc.js';
import type { SecurityContext } from '../../src/types/session.js';
import type { PlayerInfo } from '../../src/types/player.js';

describe('Slim prompt cacheable prefix split', () => {
  const mockDefinition: NPCDefinition = {
    id: 'test-npc',
    project_id: 'test-project',
    name: 'TestNPC',
    description: 'A test NPC',
    personality_baseline: {
      openness: 0.7,
      conscientiousness: 0.6,
      extraversion: 0.5,
      agreeableness: 0.8,
      neuroticism: 0.3,
    },
    core_anchor: {
      backstory: 'A simple test backstory',
      principles: ['honesty', 'loyalty'],
      trauma_flags: [],
    },
    network: [],
    schedule: [],
    player_recognition: { reveal_player_identity: false },
  };

  const mockInstance1: NPCInstance = {
    id: 'instance-1',
    npc_id: 'test-npc',
    player_id: 'player-1',
    current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
    relationships: {
      'player-1': { trust: 0.5, familiarity: 0.3, sentiment: 0.4 },
    },
    short_term_memory: [
      { content: 'First memory', salience: 0.8, timestamp: new Date().toISOString() },
    ],
    long_term_memory: [],
    trait_modifiers: { extraversion: 0.1 },
    daily_pulse: { takeaway: 'First reflection' },
  };

  const mockInstance2: NPCInstance = {
    ...mockInstance1,
    current_mood: { valence: -0.3, arousal: 0.7, dominance: 0.2 },
    relationships: {
      'player-1': { trust: 0.8, familiarity: 0.9, sentiment: 0.7 },
    },
    short_term_memory: [
      { content: 'Different memory', salience: 0.9, timestamp: new Date().toISOString() },
    ],
    trait_modifiers: { agreeableness: -0.15 },
    daily_pulse: { takeaway: 'Different reflection' },
  };

  const securityContext1: SecurityContext = {
    exitRequested: false,
    jailbreakAttempted: false,
  };

  const securityContext2: SecurityContext = {
    exitRequested: true,
    jailbreakAttempted: false,
  };

  it('produces byte-identical stable prefix across different instance states', async () => {
    const parts1 = await assembleSlimSystemPromptParts(
      mockDefinition,
      mockInstance1,
      securityContext1
    );
    const parts2 = await assembleSlimSystemPromptParts(
      mockDefinition,
      mockInstance2,
      securityContext2
    );

    expect(parts1.stable).toBe(parts2.stable);
    expect(parts1.dynamic).not.toBe(parts2.dynamic);
  });

  it('stable section contains definition-level headers only', async () => {
    const parts = await assembleSlimSystemPromptParts(
      mockDefinition,
      mockInstance1,
      securityContext1
    );

    // Stable should have these headers
    expect(parts.stable).toContain('[ROLE]');
    expect(parts.stable).toContain('[WHO YOU ARE - IMMUTABLE]');
    expect(parts.stable).toContain('[NPC PERSONALITY & TRAITS]');
    expect(parts.stable).toContain('[HOW TO BEHAVE]');
    expect(parts.stable).toContain('[INJECTION RESISTANCE]');
    expect(parts.stable).toContain('[YOUR TASK]');

    // Stable should NOT have dynamic headers
    expect(parts.stable).not.toContain('[NPC CURRENT MOOD]');
    expect(parts.stable).not.toContain('[RELATIONSHIP TO PLAYER]');
    expect(parts.stable).not.toContain('[MEMORIES FROM BEFORE THIS CONVERSATION]');
    expect(parts.stable).not.toContain("[TODAY'S REFLECTION]");
  });

  it('dynamic section contains turn-specific headers', async () => {
    const parts = await assembleSlimSystemPromptParts(
      mockDefinition,
      mockInstance1,
      securityContext1
    );

    // Dynamic should have these headers
    expect(parts.dynamic).toContain('[NPC CURRENT MOOD]');
    expect(parts.dynamic).toContain('[RELATIONSHIP TO PLAYER]');
    expect(parts.dynamic).toContain('[MEMORIES FROM BEFORE THIS CONVERSATION]');
    expect(parts.dynamic).toContain("[TODAY'S REFLECTION]");
    expect(parts.dynamic).toContain('[SECURITY & BOUNDARIES]');

    // Dynamic should NOT have stable headers
    expect(parts.dynamic).not.toContain('[ROLE]');
    expect(parts.dynamic).not.toContain('[WHO YOU ARE - IMMUTABLE]');
    expect(parts.dynamic).not.toContain('[HOW TO BEHAVE]');
    expect(parts.dynamic).not.toContain('[INJECTION RESISTANCE]');
  });

  it('wrapper function combines parts with separator', async () => {
    const parts = await assembleSlimSystemPromptParts(
      mockDefinition,
      mockInstance1,
      securityContext1
    );
    const combined = await assembleSlimSystemPrompt(
      mockDefinition,
      mockInstance1,
      securityContext1
    );

    expect(combined).toBe(parts.stable + '\n\n' + parts.dynamic);
  });

  it('preserves all section headers from original implementation', async () => {
    // Capture headers from current implementation
    const current = await assembleSlimSystemPrompt(
      mockDefinition,
      mockInstance1,
      securityContext1
    );
    const currentHeaders = current.match(/\[[\w\s'&-]+\]/g) || [];

    // Get headers from parts
    const parts = await assembleSlimSystemPromptParts(
      mockDefinition,
      mockInstance1,
      securityContext1
    );
    const combined = parts.stable + '\n\n' + parts.dynamic;
    const combinedHeaders = combined.match(/\[[\w\s'&-]+\]/g) || [];

    expect(new Set(combinedHeaders)).toEqual(new Set(currentHeaders));
  });

  it('augmentPromptWithMindContext appends to dynamic suffix', () => {
    const dynamicSuffix = '[SOME DYNAMIC CONTENT]\nTest content';
    const mindContext = 'Tool result: success';

    const augmented = augmentPromptWithMindContext(dynamicSuffix, mindContext);

    expect(augmented).toContain('[MIND CONTEXT]');
    expect(augmented.indexOf('[MIND CONTEXT]')).toBeGreaterThan(
      augmented.indexOf('[SOME DYNAMIC CONTENT]')
    );
  });

  it('player identity section appears in dynamic when provided', async () => {
    const playerInfo: PlayerInfo = {
      name: 'Alice',
      description: 'A brave adventurer',
      role: 'Warrior',
      context: 'Saved the village',
    };

    const parts = await assembleSlimSystemPromptParts(
      { ...mockDefinition, player_recognition: { reveal_player_identity: true } },
      mockInstance1,
      securityContext1,
      {},
      playerInfo
    );

    expect(parts.dynamic).toContain("[THE PERSON YOU'RE TALKING TO]");
    expect(parts.dynamic).toContain('Alice');
    expect(parts.stable).not.toContain("[THE PERSON YOU'RE TALKING TO]");
  });
});
