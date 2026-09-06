/**
 * ERR-022 — recall_memories could almost never match, and then told the NPC so.
 *
 * Found by driving a real conversation through the text harness. The Mind emits
 * natural-language queries ("Pranav is terrified of deep water."), and the
 * matcher used the entire query as a single substring needle:
 *
 *     memories.filter(m => m.content.toLowerCase().includes(query))
 *
 * A whole sentence is essentially never a substring of a stored memory, so
 * recall returned nothing regardless of what the NPC actually remembered.
 *
 * It then returned the string 'No matching memories found.' with status
 * 'success', and the turn loop deferred that into the NEXT turn's speaker
 * prompt as "- Retrieved (recall_memories): No matching memories found." —
 * actively telling the character it has no memory of the thing the player had
 * just said. That is worse than injecting nothing at all.
 *
 * Two guards below: the matcher must work on terms, and a lookup that found
 * nothing must not become deferred context.
 */
import { describe, it, expect } from 'vitest';
import { matchMemoriesByQuery } from '../../src/core/memory.js';
import { partitionMindToolResults } from '../../src/conversation/turn.js';
import type { Memory } from '../../src/types/npc.js';
import type { MindToolResult } from '../../src/types/mind.js';

function memory(id: string, content: string, salience = 0.5): Memory {
  return {
    id,
    content,
    salience,
    timestamp: new Date('2026-01-01T00:00:00Z').toISOString(),
    type: 'short_term',
  } as Memory;
}

function toolResult(name: string, content: string): MindToolResult {
  return {
    tool_name: name,
    arguments: { query: 'x' },
    result_content: content,
    status: 'success',
  } as MindToolResult;
}

describe('ERR-022: recall query matching', () => {
  const memories = [
    memory('m1', 'The player said they are terrified of deep water.', 0.8),
    memory('m2', 'The player haggled over the price of rope.', 0.4),
    memory('m3', 'A storm rolled in from the north.', 0.6),
  ];

  it('matches a natural-language query against memory terms', () => {
    // The exact failure from the live session: a full sentence as the query.
    const matched = matchMemoriesByQuery(memories, 'Pranav is terrified of deep water.', 5);

    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].id).toBe('m1');
  });

  it('matches on a partial phrase too', () => {
    const matched = matchMemoriesByQuery(memories, 'what is the player afraid of', 5);
    expect(matched.map((m) => m.id)).toContain('m1');
  });

  it('returns nothing for a genuinely unrelated query', () => {
    const matched = matchMemoriesByQuery(memories, 'dragons and taxation', 5);
    expect(matched).toEqual([]);
  });

  it('is not defeated by short filler words alone', () => {
    // "the", "of", "is" appear in nearly every memory. Matching on those would
    // make every query return everything, which is the opposite failure.
    const matched = matchMemoriesByQuery(memories, 'the of is a', 5);
    expect(matched).toEqual([]);
  });

  it('ranks a stronger term overlap above a merely more salient memory', () => {
    const matched = matchMemoriesByQuery(memories, 'storm from the north', 5);
    expect(matched[0].id).toBe('m3');
  });

  it('respects the result limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => memory(`x${i}`, 'rope and rigging', 0.5));
    expect(matchMemoriesByQuery(many, 'rope', 3)).toHaveLength(3);
  });
});

describe('ERR-022: a lookup that found nothing must not become deferred context', () => {
  it('drops an empty recall result instead of deferring it', () => {
    const { recallLines } = partitionMindToolResults([
      toolResult('recall_memories', ''),
    ]);

    expect(recallLines).toEqual([]);
  });

  it('still defers a recall result that actually retrieved something', () => {
    const { recallLines } = partitionMindToolResults([
      toolResult('recall_memories', 'They are terrified of deep water.'),
    ]);

    expect(recallLines).toHaveLength(1);
    expect(recallLines[0]).toContain('- Retrieved (recall_memories):');
  });

  it('keeps action results separate from recall results', () => {
    const { recallLines, mcpLines } = partitionMindToolResults([
      toolResult('recall_memories', 'a memory'),
      toolResult('lock_door', 'door locked'),
    ]);

    expect(recallLines).toHaveLength(1);
    expect(mcpLines).toHaveLength(1);
    expect(mcpLines[0]).toContain('- Action taken (lock_door):');
  });
});
