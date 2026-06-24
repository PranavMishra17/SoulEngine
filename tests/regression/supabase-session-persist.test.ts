/**
 * Regression test: Supabase session persistence functions must not be no-ops.
 *
 * Before the fix: persistSession, loadPersistedSession, and deletePersistedSession
 * all did nothing — they logged warnings and returned early. Any session started
 * via the Supabase backend could not be resumed because nothing was stored.
 *
 * After the fix: the three functions perform real Supabase client calls on the
 * sessions table. This test injects a fake Supabase client to verify those calls
 * are made and the correct data is passed / returned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionState } from '../../src/types/session.js';

// ---------------------------------------------------------------------------
// Minimal fake Supabase query builder
// Supports: .from().upsert(), .from().select().eq().single(),
//           .from().delete().eq()
// ---------------------------------------------------------------------------

type FakeRow = { session_id: string; state: SessionState };

function makeFakeClient(store: Map<string, SessionState>) {
  return {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, _opts?: unknown) {
          if (table !== 'sessions') {
            return Promise.resolve({ data: null, error: { message: `unexpected table: ${table}` } });
          }
          const sessionId = row['session_id'] as string;
          const state = row['state'] as SessionState;
          store.set(sessionId, state);
          return Promise.resolve({ data: null, error: null });
        },

        select(_cols?: string) {
          const self = this as ReturnType<typeof makeFakeClient>['from'];
          return {
            eq(col: string, val: unknown) {
              return {
                single() {
                  if (table !== 'sessions') {
                    return Promise.resolve({ data: null, error: { message: `unexpected table: ${table}` } });
                  }
                  const sessionId = val as string;
                  const session = store.get(sessionId);
                  if (!session) {
                    return Promise.resolve({
                      data: null,
                      error: { code: 'PGRST116', message: 'Row not found' },
                    });
                  }
                  return Promise.resolve({ data: { state: session }, error: null });
                },
                eq(_col2: string, _val2: unknown) {
                  return {
                    single() {
                      if (table !== 'sessions') {
                        return Promise.resolve({ data: null, error: { message: `unexpected table: ${table}` } });
                      }
                      const sessionId = val as string;
                      const session = store.get(sessionId);
                      if (!session) {
                        return Promise.resolve({
                          data: null,
                          error: { code: 'PGRST116', message: 'Row not found' },
                        });
                      }
                      return Promise.resolve({ data: { state: session }, error: null });
                    },
                  };
                },
              };
            },
          };
        },

        delete() {
          return {
            eq(_col: string, val: unknown) {
              if (table === 'sessions') {
                store.delete(val as string);
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture session
// ---------------------------------------------------------------------------

function makeSession(id: string): SessionState {
  return {
    session_id: id,
    project_id: 'proj_test',
    definition_id: 'npc_test',
    player_id: 'player_test',
    instance: {
      id: 'inst_test',
      definition_id: 'npc_test',
      project_id: 'proj_test',
      player_id: 'player_test',
      created_at: new Date().toISOString(),
      current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
      trait_modifiers: {},
      short_term_memory: [],
      long_term_memory: [],
      relationships: {},
      daily_pulse: null,
      cycle_metadata: { last_weekly: null, last_persona_shift: null },
    },
    conversation_history: [{ role: 'user', content: 'hello' }],
    created_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    player_info: null,
    mode: 'text-text',
    token_usage: { prompt: 0, completion: 0, total: 0 },
    user_id: 'user_test',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Supabase session persistence (not a no-op)', () => {
  let store: Map<string, SessionState>;

  beforeEach(() => {
    store = new Map();
    // Provide the fake client via module mock
    vi.doMock('../../src/storage/supabase/client.js', () => ({
      getSupabaseAdmin: () => makeFakeClient(store),
    }));
  });

  it('persistSession writes to the sessions table (not a no-op)', async () => {
    const { persistSession } = await import('../../src/storage/supabase/sessions.js');

    const session = makeSession('sess_persist_test');
    await persistSession(session);

    // The in-memory store must now contain the session
    expect(store.has('sess_persist_test')).toBe(true);
    expect(store.get('sess_persist_test')?.session_id).toBe('sess_persist_test');
  });

  it('loadPersistedSession reads back what persistSession wrote', async () => {
    const { persistSession, loadPersistedSession } = await import('../../src/storage/supabase/sessions.js');

    const session = makeSession('sess_roundtrip_test');
    await persistSession(session);

    const loaded = await loadPersistedSession('sess_roundtrip_test');

    expect(loaded).not.toBeNull();
    expect(loaded?.session_id).toBe('sess_roundtrip_test');
    expect(loaded?.project_id).toBe('proj_test');
    expect(loaded?.conversation_history).toHaveLength(1);
  });

  it('loadPersistedSession returns null for a missing session (consistent with local backend)', async () => {
    const { loadPersistedSession } = await import('../../src/storage/supabase/sessions.js');

    const result = await loadPersistedSession('sess_does_not_exist');
    expect(result).toBeNull();
  });

  it('deletePersistedSession removes the session from storage (not a no-op)', async () => {
    const { persistSession, deletePersistedSession, loadPersistedSession } = await import(
      '../../src/storage/supabase/sessions.js'
    );

    const session = makeSession('sess_delete_test');
    await persistSession(session);
    expect(store.has('sess_delete_test')).toBe(true);

    await deletePersistedSession('sess_delete_test');

    // After deletion the store should not contain the session
    expect(store.has('sess_delete_test')).toBe(false);

    // And loadPersistedSession should return null
    const result = await loadPersistedSession('sess_delete_test');
    expect(result).toBeNull();
  });
});
