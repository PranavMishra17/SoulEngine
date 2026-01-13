import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../../logger.js';

const logger = createLogger('supabase-client');

let supabaseAdmin: SupabaseClient | null = null;

/**
 * Get the Supabase admin client (uses service role key, bypasses RLS)
 * This is used for server-side operations
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for production mode');
  }

  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  logger.info('Supabase admin client initialized');
  return supabaseAdmin;
}

/**
 * Create a Supabase client that respects RLS (uses user's JWT)
 * Use this for operations that should be scoped to a specific user
 */
export function createUserClient(accessToken: string): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for production mode');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Verify a JWT token and get the user
 */
export async function verifyToken(token: string): Promise<{ userId: string; email?: string } | null> {
  const supabase = getSupabaseAdmin();
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      logger.debug({ error: error?.message }, 'Token verification failed');
      return null;
    }
    
    return {
      userId: user.id,
      email: user.email,
    };
  } catch (error) {
    logger.error({ error: String(error) }, 'Token verification error');
    return null;
  }
}

/**
 * Check if we're in production mode (Supabase enabled)
 */
export function isSupabaseEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
