/**
 * 1.14 — the Supabase knowledge layer must map the `description` column.
 * (1.12 added the column; reads/writes previously omitted it, so cloud round-trips
 * silently dropped category descriptions.)
 */

import { describe, it, expect } from 'vitest';
import { rowsToKnowledgeBase } from '../../src/storage/supabase/knowledge.js';

describe('Supabase knowledge description mapping', () => {
  it('preserves category description when mapping DB rows', () => {
    const kb = rowsToKnowledgeBase([
      { name: 'lore', description: 'World lore', entries: [{ depth: 1, content: 'basics' }] },
    ]);
    expect(kb.categories.lore.description).toBe('World lore');
    expect(kb.categories.lore.depths[1]).toBe('basics');
  });

  it('leaves description undefined when the column is null', () => {
    const kb = rowsToKnowledgeBase([{ name: 'x', description: null, entries: [] }]);
    expect(kb.categories.x.description).toBeUndefined();
  });
});
