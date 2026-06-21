import { describe, it } from 'vitest';

// Pending regression tests — one per still-OPEN row in ../../ERRORS.md.
// As each backlog item is implemented, its `it.todo` becomes a real test file
// (e.g. tests/regression/err-0NN-*.test.ts) and its line here is removed.
// `it.todo` never fails the suite. ERR-001..012, 018, 019 are now real tests.
describe('audit regressions (pending — see ERRORS.md)', () => {
  it.todo('ERR-013 history/instance GETs work when no LLM key is configured');
  it.todo('ERR-014 /projects/new route is registered (landing CTA works)');
  it.todo('ERR-015 diff-modal buttons are bound after the template renders');
  it.todo('ERR-016 dead src/voice/interruption.ts is removed / not imported');
  it.todo('ERR-017 transcripts are deduplicated by a per-utterance id');
  it.todo('ERR-020 app version comes from a single source (package.json)');
});
