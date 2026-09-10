/**
 * ERR-029 -- production reached for the local filesystem.
 *
 * Storage was selected from `userId`: present and Supabase configured meant
 * Supabase, anything else meant local files. On Cloud Run the application
 * filesystem is read-only, so every request without a user JWT died with
 * `EACCES: permission denied, mkdir 'data/projects'`.
 *
 * The anonymous studio visitor was the small half. A game client authenticates
 * with a project API key and carries no user id, so the whole runtime path --
 * start session, converse, end session -- selected local storage in production.
 *
 * The backend now follows the deployment. `userId` still decides which rows a
 * caller sees; it no longer decides which database is consulted. See
 * specs/5.25.md.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';

const SUPABASE_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
};

/** The module reads env at import time, so each case needs a fresh module. */
async function loadFactory(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, '');
    else vi.stubEnv(k, v);
  }
  return import('../../src/storage/factory.js');
}

/** Supabase and local both export listProjects; tell them apart by identity. */
async function backends() {
  const local = await import('../../src/storage/local/index.js');
  const supabase = await import('../../src/storage/supabase/index.js');
  return { local, supabase };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('ERR-029: a cloud deployment never falls back to local files', () => {
  it('gives the game client Supabase even though it has no user id', async () => {
    // The load-bearing case. A project API key is a principal; it just is not a
    // user, and before the fix that meant local disk on a read-only container.
    const { getStorage } = await loadFactory({ NODE_ENV: 'production', ...SUPABASE_ENV });
    const { supabase } = await backends();

    expect(getStorage(null).listProjects).toBe(supabase.listProjects);
    expect(getStorage(undefined).listProjects).toBe(supabase.listProjects);
  });

  it('gives an authenticated studio user Supabase', async () => {
    const { getStorage } = await loadFactory({ NODE_ENV: 'production', ...SUPABASE_ENV });
    const { supabase } = await backends();

    expect(getStorage('user_abc123').listProjects).toBe(supabase.listProjects);
  });

  it('still gives a local dev identity local storage, even in production', async () => {
    // isDevUserId exists so a locally signed-in developer never depends on
    // Supabase. Deployment mode must not override that.
    const { getStorage } = await loadFactory({ NODE_ENV: 'production', ...SUPABASE_ENV });
    const { isDevUserId } = await import('../../src/security/dev-auth.js');
    const { local } = await backends();

    const devId = 'dev_local_user';
    expect(isDevUserId(devId), 'test fixture must be a dev id').toBe(true);
    expect(getStorage(devId).listProjects).toBe(local.listProjects);
  });

  it('uses local storage when Supabase is not configured at all', async () => {
    const { getStorage } = await loadFactory({
      NODE_ENV: 'production',
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });
    const { local } = await backends();

    expect(getStorage(null).listProjects).toBe(local.listProjects);
    expect(getStorage('user_abc123').listProjects).toBe(local.listProjects);
  });

  it('on a dev machine, a cloud user gets Supabase and an anonymous caller does not', async () => {
    const { getStorage } = await loadFactory({ NODE_ENV: 'development', ...SUPABASE_ENV });
    const { local, supabase } = await backends();

    expect(getStorage('user_abc123').listProjects).toBe(supabase.listProjects);
    expect(getStorage(null).listProjects).toBe(local.listProjects);
  });

  it('reports the mode it will actually use', async () => {
    const { getStorageMode } = await loadFactory({ NODE_ENV: 'production', ...SUPABASE_ENV });

    expect(getStorageMode(null)).toBe('supabase');
    expect(getStorageMode('user_abc123')).toBe('supabase');
    expect(getStorageMode('dev_local_user')).toBe('local');
  });
});

describe('ERR-029: one selector, not two', () => {
  it('has no second copy of the decision', () => {
    // hybrid.ts held a byte-identical copy that session/manager.ts used. Two
    // copies of a decision this consequential is how the turn loop drifted in
    // 5.19: the next edit moves only one of them.
    expect(existsSync(path.join(process.cwd(), 'src/storage/hybrid.ts'))).toBe(false);
  });
});
