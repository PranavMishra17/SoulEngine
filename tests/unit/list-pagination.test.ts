/**
 * 2.10 — list endpoints expose consistent pagination. The default limit must cover
 * a full small project so the NPC/knowledge lists are never silently truncated, and
 * oversized limits are clamped.
 */

import { describe, it, expect } from 'vitest';
import { parsePagination } from '../../src/http/pagination.js';
import { getConfig } from '../../src/config.js';

describe('list pagination params', () => {
  it('default limit covers a full small project (>= max NPCs per project)', () => {
    const { limit } = parsePagination({});
    expect(limit).toBeGreaterThanOrEqual(getConfig().limits.maxNpcsPerProject);
  });

  it('clamps an oversized limit to a bounded maximum', () => {
    const { limit } = parsePagination({ limit: '99999' });
    expect(limit).toBeLessThanOrEqual(200);
  });

  it('honors an explicit valid limit', () => {
    const { limit } = parsePagination({ limit: '5' });
    expect(limit).toBe(5);
  });
});
