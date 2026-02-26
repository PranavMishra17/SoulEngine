import * as local from './local/index.js';
import * as supabaseStorage from './supabase/index.js';

const hasSupabase = !!(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Returns the appropriate storage backend per-request.
 * - If userId is present AND Supabase is configured → Supabase storage (user's cloud data)
 * - Otherwise → Local file storage (fallback for logged-out users or dev mode)
 */
export function getStorageForUser(userId?: string | null) {
  if (userId && hasSupabase) {
    return supabaseStorage;
  }
  return local;
}
