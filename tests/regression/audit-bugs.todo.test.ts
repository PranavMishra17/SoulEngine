import { describe, it } from 'vitest';

// Pending regression tests — one per row in ../../ERRORS.md.
// As each backlog item is implemented, its `it.todo` becomes a real test in this
// folder that fails before the fix and passes after. `it.todo` never fails the suite.
describe('audit regressions (pending — see ERRORS.md)', () => {
  it.todo('ERR-001 Weekly Whisper retains high-salience memories');
  it.todo('ERR-002 Core Anchor immutability is enforced, not just logged');
  it.todo('ERR-003 realtime voice WebSocket is served on the main HTTP port');
  it.todo('ERR-004 project routes reject cross-tenant access');
  it.todo('ERR-005 one storage backend selector governs a request end-to-end');
  it.todo('ERR-006 secrets round-trip and survive an encryption-key rotation');
  it.todo('ERR-007 no undefined CSS custom properties are referenced');
  it.todo('ERR-008 concurrent local usage appends do not lose data');
  it.todo('ERR-009 deferred recall context survives a voice reconnect');
  it.todo('ERR-010 knowledge category descriptions survive a Supabase round-trip');
  it.todo('ERR-011 instance version scheme is consistent across backends');
  it.todo('ERR-012 concurrent instance saves do not lose updates');
});
