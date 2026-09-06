/**
 * ERR-025 — a character reached its own conversation holding one memory.
 *
 * The Speaker's prompt is built by a "slim" assembler that deliberately omits
 * world knowledge and tools. It also passed `formatMemories(instance, 2)`,
 * which split into one short-term and one long-term entry. When the highest
 * short-term and highest long-term memory were the same promoted entry, the
 * section rendered that one memory twice and nothing else.
 *
 * Observed live: an NPC holding 13 short-term memories about a player told them
 * "I don't believe we've met before."
 *
 * Two separate defects, guarded separately below:
 *   - the same memory could occupy more than one slot
 *   - selection was purely by salience, so something said moments ago lost to
 *     an older, more dramatic memory and never reached the prompt at all
 */
import { describe, it, expect } from 'vitest';
import { selectMemoriesForPrompt } from '../../src/core/memory.js';
import type { Memory } from '../../src/types/npc.js';

function mem(id: string, content: string, salience: number, daysAgo: number, type: Memory['type'] = 'short_term'): Memory {
  const t = new Date('2026-06-01T00:00:00Z').getTime() - daysAgo * 86400000;
  return { id, content, salience, timestamp: new Date(t).toISOString(), type };
}

describe('ERR-025: memory selection for the prompt', () => {
  it('never gives the same memory two slots', () => {
    // A promoted memory that still exists in both stores, as seen in live data.
    const shared = mem('m_shared', 'An unsettling conversation about the town.', 0.74, 30);
    const selected = selectMemoriesForPrompt(
      [shared, mem('m_a', 'Haggled over rope.', 0.4, 1)],
      [{ ...shared, type: 'long_term' }],
      8
    );

    const ids = selected.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the most recent memory even when older ones are more salient', () => {
    // The live failure: the Kael memory was recent but scored 0.58, and lost to
    // a 0.74 memory from weeks earlier.
    const stm = [
      mem('m_old', 'A dramatic flood years ago.', 0.95, 60),
      mem('m_old2', 'An unsettling conversation.', 0.9, 45),
      mem('m_old3', 'A long argument about prices.', 0.85, 40),
      mem('m_recent', 'Their brother Kael owes the harbourmaster forty crowns.', 0.58, 0),
    ];

    const selected = selectMemoriesForPrompt(stm, [], 3);

    expect(selected.map((m) => m.id)).toContain('m_recent');
  });

  it('still includes the strongest memories, not only the newest', () => {
    const stm = [
      mem('m_strong', 'The flood that shaped them.', 0.95, 60),
      mem('m_1', 'Small talk.', 0.2, 3),
      mem('m_2', 'More small talk.', 0.2, 2),
      mem('m_3', 'Yet more small talk.', 0.2, 1),
      mem('m_4', 'Still more small talk.', 0.2, 0),
    ];

    const selected = selectMemoriesForPrompt(stm, [], 4);

    expect(selected.map((m) => m.id)).toContain('m_strong');
  });

  it('respects the requested size', () => {
    const stm = Array.from({ length: 20 }, (_, i) => mem(`m${i}`, `memory ${i}`, 0.5, i));
    expect(selectMemoriesForPrompt(stm, [], 6)).toHaveLength(6);
  });

  it('draws on long-term memory as well as short-term', () => {
    const selected = selectMemoriesForPrompt(
      [mem('s1', 'Recent chatter.', 0.3, 0)],
      [mem('l1', 'A defining event.', 0.9, 200, 'long_term')],
      4
    );

    expect(selected.map((m) => m.id).sort()).toEqual(['l1', 's1']);
  });

  it('handles an NPC with no memories at all', () => {
    expect(selectMemoriesForPrompt([], [], 8)).toEqual([]);
  });

  it('does not exceed the number of memories that exist', () => {
    expect(selectMemoriesForPrompt([mem('a', 'one', 0.5, 0)], [], 8)).toHaveLength(1);
  });
});
