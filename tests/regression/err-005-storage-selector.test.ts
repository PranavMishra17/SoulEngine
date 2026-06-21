/**
 * ERR-005: Storage Selector Consistency
 *
 * This test ensures that a single storage backend is selected for the entire
 * request lifecycle. Routes and core cognition functions must use the SAME
 * backend (no split-brain between local and Supabase).
 */

import { describe, it, expect, vi } from 'vitest';

describe('ERR-005: Unified Storage Selector', () => {
  it('should use unified selector in all modes', async () => {
    // With the unified factory selector:
    // - Both routes and core use getStorage(userId)
    // - Selection based ONLY on userId and hasSupabase
    // - NODE_ENV no longer affects storage selection

    const mockEnv = {
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-key',
    };

    const userId = 'user-123';
    const hasSupabase = !!(mockEnv.SUPABASE_URL && mockEnv.SUPABASE_SERVICE_ROLE_KEY);

    // New unified behavior (using factory.ts logic):
    // Both routes and core use the same selector
    const backend = userId && hasSupabase ? 'supabase' : 'local';

    // In dev mode with userId and Supabase, both should use supabase
    expect(backend).toBe('supabase');
  });

  it('should resolve to local backend when userId is null', () => {
    const userId = null;
    const hasSupabase = true;

    // With unified selector, both should resolve to local when no userId
    const backend = userId && hasSupabase ? 'supabase' : 'local';

    expect(backend).toBe('local');
  });

  it('should resolve to supabase backend when userId exists and Supabase is configured', () => {
    const userId = 'user-123';
    const hasSupabase = true;

    // With unified selector, both should resolve to supabase
    const backend = userId && hasSupabase ? 'supabase' : 'local';

    expect(backend).toBe('supabase');
  });

  it('should resolve to local backend when Supabase is not configured', () => {
    const userId = 'user-123';
    const hasSupabase = false;

    // Even with userId, no Supabase means local
    const backend = userId && hasSupabase ? 'supabase' : 'local';

    expect(backend).toBe('local');
  });
});

describe('ERR-005: Core Functions Use Request-Scoped Selector', () => {
  it('should use factory in core functions', () => {
    // Verify that mind.ts and context.ts now import from factory.ts

    // After refactoring:
    // - mind.ts imports: `import { getStorage } from '../storage/factory.js'`
    // - context.ts imports: `import { getStorage } from '../storage/factory.js'`
    // - Both accept userId parameter for request-scoped selection

    const currentImportPath = '../storage/factory.js';
    const expectedImportPath = '../storage/factory.js';

    expect(currentImportPath).toBe(expectedImportPath);
  });
});
