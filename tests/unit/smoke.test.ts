import { describe, it, expect } from 'vitest';

// Proves the harness runs and asserts. Real coverage arrives per backlog item.
const slugify = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '-');

describe('test harness', () => {
  it('runs and asserts', () => {
    expect(slugify('  Hello World ')).toBe('hello-world');
  });
});
