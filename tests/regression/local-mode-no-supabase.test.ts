/**
 * Local mode must work without an online Supabase.
 *
 * When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, every storage
 * selector must fall back to the local filesystem backend — even when a userId
 * is present — and no Supabase client should be required. This guards against a
 * regression where the app starts depending on a live Supabase in local/dev.
 */

import { describe, it, expect } from 'vitest';
import * as local from '../../src/storage/local/index.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import { getStorage, isSupabaseAvailable } from '../../src/storage/factory.js';
import { isSupabaseEnabled } from '../../src/storage/supabase/client.js';

const supabaseConfigured = !!(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe('local mode without Supabase', () => {
  it('reports Supabase as unavailable when env is not configured', () => {
    if (supabaseConfigured) return; // only meaningful when Supabase is absent
    expect(isSupabaseAvailable()).toBe(false);
    expect(isSupabaseEnabled()).toBe(false);
  });

  it('falls back to the local backend even when a userId is present', () => {
    if (supabaseConfigured) return;
    // Identity check: the returned namespace IS the local module.
    expect(getStorageForUser(null).getProject).toBe(local.getProject);
    expect(getStorageForUser('user_123').getProject).toBe(local.getProject);
    expect(getStorage('user_123').getProject).toBe(local.getProject);
  });

  it('local backend provides the full storage + session surface offline', () => {
    if (supabaseConfigured) return;
    expect(typeof local.getProject).toBe('function');
    expect(typeof local.saveInstance).toBe('function');
    expect(typeof local.persistSession).toBe('function');
    expect(typeof local.loadPersistedSession).toBe('function');
    expect(typeof local.loadApiKeys).toBe('function');
  });
});
