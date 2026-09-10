/**
 * Storage Factory - Request-Scoped Backend Selection
 *
 * The single place that decides which storage backend serves a request. Routes
 * AND core cognition go through here, so a request cannot see one backend in
 * the route and another in the turn loop (ERR-005).
 *
 * Selection follows the DEPLOYMENT, not the caller:
 *
 *   - A local dev identity always gets local files. `isDevUserId` exists so a
 *     developer signed in locally never depends on Supabase, and that holds
 *     regardless of where the code is running. Checked first.
 *   - A Supabase-backed deployment always gets Supabase. Local files are
 *     unreachable there.
 *   - A dev machine with Supabase configured gets Supabase for a real user, and
 *     local files otherwise.
 *
 * It used to key off `userId` alone: present meant Supabase, absent meant local.
 * That was wrong for the caller this product exists to serve. A game client
 * authenticates with a project API key and carries no user id, so in production
 * the entire runtime path selected local file storage -- on Cloud Run, a
 * read-only filesystem, so every request failed with EACCES. See ERR-029.
 *
 * `userId` still decides which ROWS a caller may see. It no longer decides which
 * DATABASE is consulted. Those are separate questions and conflating them is
 * what caused the bug: callers with a legitimate non-user principal fell through
 * to a backend meant for offline development.
 */

import * as local from './local/index.js';
import * as supabaseStorage from './supabase/index.js';
import { isDevUserId } from '../security/dev-auth.js';

const hasSupabase = !!(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

const isProduction = process.env.NODE_ENV === 'production';

/**
 * True when this process is backed by Supabase rather than the local filesystem.
 *
 * Callers use it to refuse work that only makes sense with a scoped principal --
 * see the projects collection routes, where an unscoped list would otherwise
 * return every tenant's rows.
 */
export function isCloudDeployment(): boolean {
  return isProduction && hasSupabase;
}

/**
 * Get the appropriate storage backend for a request.
 *
 * @param userId - The authenticated user ID (null for a game client or an
 *                 anonymous visitor; neither implies local storage)
 * @returns Storage backend (local or supabase)
 */
export function getStorage(userId?: string | null) {
  if (isDevUserId(userId)) {
    return local;
  }
  if (isCloudDeployment()) {
    return supabaseStorage;
  }
  if (userId && hasSupabase) {
    return supabaseStorage;
  }
  return local;
}

/**
 * Check if Supabase storage is available and configured.
 */
export function isSupabaseAvailable(): boolean {
  return hasSupabase;
}

/**
 * Determine which storage mode would be used for a given userId.
 * Useful for logging and debugging.
 */
export function getStorageMode(userId?: string | null): 'local' | 'supabase' {
  return getStorage(userId) === supabaseStorage ? 'supabase' : 'local';
}
