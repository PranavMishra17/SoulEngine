/**
 * Regression test: src/voice/interruption.ts must not exist.
 * Item 4.1 - the barge-in module was orphaned when barge-in was removed.
 */

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

describe('dead interruption module', () => {
  it('src/voice/interruption.ts does not exist', () => {
    const filePath = join(repoRoot, 'src', 'voice', 'interruption.ts');
    expect(existsSync(filePath)).toBe(false);
  });

  it('pipeline.ts does not import from interruption', () => {
    const pipelineSrc = readFileSync(
      join(repoRoot, 'src', 'voice', 'pipeline.ts'),
      'utf8'
    );
    expect(pipelineSrc).not.toMatch(/from ['"].*interruption['"]/);
    expect(pipelineSrc).not.toMatch(/require\(['"].*interruption['"]\)/);
  });
});
