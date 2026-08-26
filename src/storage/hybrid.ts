import * as local from './local/index.js';
import * as supabaseStorage from './supabase/index.js';
import { isDevUserId } from '../security/dev-auth.js';

const hasSupabase = !!(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Returns the appropriate storage backend per-request.
 * - If userId is present AND Supabase is configured AND it isn't a local
 *   dev-auth identity → Supabase storage (user's cloud data)
 * - Otherwise → Local file storage (fallback for logged-out users, dev mode,
 *   or a locally-signed-in dev user, who must never depend on Supabase)
 */
export function getStorageForUser(userId?: string | null) {
  if (userId && hasSupabase && !isDevUserId(userId)) {
    return supabaseStorage;
  }
  return local;
}
