/**
 * The scenario files under tests/fixtures/playground are what a person runs
 * with `npm run npc -- play --scenario <file>`. They must stay valid against
 * the schema the CLI enforces, or the documented commands stop working.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlaygroundScenarioSchema } from '../../src/schema/eval.js';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'playground');

describe('playground scenario fixtures', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));

  it('has the two fixtures the harness spec names', () => {
    expect(files).toEqual(expect.arrayContaining(['deferred-recall.json', 'abusive-player.json']));
  });

  for (const file of files) {
    it(`${file} parses as a playground scenario`, () => {
      const parsed = PlaygroundScenarioSchema.safeParse(JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')));
      expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
      if (parsed.success) {
        // Every expectation must point at a scripted turn, or it can never pass.
        const turns = parsed.data.player?.script.length ?? 0;
        for (const e of parsed.data.expect ?? []) expect(e.turn).toBeLessThanOrEqual(turns);
      }
    });
  }
});
