/**
 * The harness reports on a mind's affordances. These tests pin the two things
 * that were easy to get wrong and that a reader would otherwise trust blindly:
 * how knowledge depths are rendered, and why a tool was not offered.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAffordances,
  renderAffordances,
  countRecallResults,
} from '../../src/harness/diagnostics.js';
import type { KnowledgeBase } from '../../src/types/knowledge.js';
import type { NPCDefinition } from '../../src/types/npc.js';
import type { SecurityContext } from '../../src/types/security.js';
import type { Tool } from '../../src/types/mcp.js';

const OPEN_SECURITY: SecurityContext = {
  sanitized: true,
  moderated: true,
  rateLimited: false,
  exitRequested: false,
  moderationFlags: [],
  inputViolations: [],
};

function knowledgeBase(): KnowledgeBase {
  return {
    categories: {
      // A depth-0 tier exists here on purpose: resolveCategoryKnowledge counts
      // depth <= granted, so 0 is reachable, while getMindAvailableTools only
      // lists categories granted above 0. Rendering "2 of 3" would hide that.
      world_history: { id: 'world_history', depths: { 0: 'a', 1: 'b', 2: 'c', 3: 'd' } },
      secrets: { id: 'secrets', depths: { 1: 'x', 2: 'y' } },
    },
  };
}

function definition(overrides: Partial<NPCDefinition> = {}): NPCDefinition {
  return {
    id: 'npc_test',
    name: 'Test',
    project_id: 'proj_test',
    core_anchor: { backstory: 'b', principles: [], trauma_flags: [] },
    personality_baseline: {},
    voice: {},
    schedule: [],
    knowledge_access: { world_history: 2 },
    mcp_permissions: { conversation_tools: ['wave'], game_event_tools: [], denied: ['shout'] },
    network: [],
    salience_threshold: 0.5,
    ...overrides,
  } as unknown as NPCDefinition;
}

function tool(name: string): Tool {
  return { name, description: name, parameters: { type: 'object', properties: {} } };
}

describe('harness affordances', () => {
  it('renders granted depths as a range within the range that exists', async () => {
    const a = await computeAffordances(definition(), knowledgeBase(), {}, OPEN_SECURITY, []);
    const world = a.knowledge.find((k) => k.category === 'world_history');

    expect(world?.existing).toEqual([0, 1, 2, 3]);
    expect(world?.granted).toBe(2);
    // Depth 0 counts as reachable.
    expect(world?.reachable).toEqual([0, 1, 2]);

    expect(renderAffordances(a)).toContain('world_history        depths 0-2 of 0-3');
  });

  it('marks a category the NPC has no access to as not granted', async () => {
    const a = await computeAffordances(definition(), knowledgeBase(), {}, OPEN_SECURITY, []);
    const secrets = a.knowledge.find((k) => k.category === 'secrets');

    expect(secrets?.granted).toBeNull();
    expect(secrets?.reachable).toEqual([]);
    expect(renderAffordances(a)).toContain('secrets              not granted');
  });

  it('separates offered tools from withheld ones and says why', async () => {
    const projectTools: Record<string, Tool> = {
      wave: tool('wave'),
      shout: tool('shout'),
      give_item: tool('give_item'),
    };

    const a = await computeAffordances(definition(), knowledgeBase(), projectTools, OPEN_SECURITY, []);

    const wave = a.tools.find((t) => t.name === 'wave');
    expect(wave?.offered).toBe(true);

    const shout = a.tools.find((t) => t.name === 'shout');
    expect(shout?.offered).toBe(false);
    expect(shout?.withheldReason).toBe('in denied list');

    const give = a.tools.find((t) => t.name === 'give_item');
    expect(give?.offered).toBe(false);
    expect(give?.withheldReason).toBe('not in conversation_tools');
  });

  it('always offers the recall tools, which is why a bare tool count misleads', async () => {
    const a = await computeAffordances(definition(), knowledgeBase(), {}, OPEN_SECURITY, []);
    const offered = a.tools.filter((t) => t.offered).map((t) => t.name);

    expect(offered).toContain('recall_knowledge');
    expect(offered).toContain('recall_memories');
  });
});

describe('deferred recall counting', () => {
  it('counts retrieved entries and ignores anything else', () => {
    const blob = [
      '- Retrieved (recall_memories): No matching memories found.',
      '- Retrieved (recall_knowledge): The tide comes in at dusk.',
      'stray line that is not a retrieval',
    ].join('\n');

    expect(countRecallResults(blob)).toBe(2);
  });

  it('treats absent context as zero rather than throwing', () => {
    expect(countRecallResults(null)).toBe(0);
    expect(countRecallResults('')).toBe(0);
  });
});
