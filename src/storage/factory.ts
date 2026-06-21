/**
 * Storage Factory - Request-Scoped Backend Selection
 *
 * This module provides a unified, request-scoped storage selector.
 * Routes AND core cognition functions MUST use this factory to ensure
 * they access the same backend for a given request.
 *
 * Selection logic:
 * - If userId is present AND Supabase is configured → Supabase storage
 * - Otherwise → Local file storage
 *
 * This replaces the static storage/index.ts selector which was module-scoped
 * and caused split-brain issues (ERR-005).
 */

import * as local from './local/index.js';
import * as supabaseStorage from './supabase/index.js';

const hasSupabase = !!(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get the appropriate storage backend for a request.
 *
 * @param userId - The authenticated user ID (null for logged-out users)
 * @returns Storage backend (local or supabase)
 */
export function getStorage(userId?: string | null) {
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
  return userId && hasSupabase ? 'supabase' : 'local';
}
