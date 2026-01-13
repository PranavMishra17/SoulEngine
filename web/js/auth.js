/**
 * SoulEngine Authentication Module
 * Handles Supabase authentication for the frontend
 */

// Auth state
let supabase = null;
let currentUser = null;
let currentSession = null;
let authListeners = [];
let authConfig = null;

/**
 * Load auth configuration from the server
 */
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      console.warn('[Auth] Failed to load config:', response.status);
      return null;
    }
    const config = await response.json();
    return config.auth;
  } catch (error) {
    console.warn('[Auth] Failed to load config:', error);
    return null;
  }
}

/**
 * Initialize the Supabase client
 * @returns {boolean} Whether initialization was successful
 */
export async function initAuth() {
  // Check if Supabase SDK is available (loaded via CDN)
  if (typeof window.supabase === 'undefined') {
    console.log('[Auth] Supabase SDK not loaded - running in local mode');
    return false;
  }

  // Load configuration from server
  authConfig = await loadConfig();
  
  if (!authConfig || !authConfig.enabled) {
    console.log('[Auth] Auth not enabled on server - running in local mode');
    return false;
  }

  if (!authConfig.supabaseUrl || !authConfig.supabaseAnonKey) {
    console.log('[Auth] Supabase not configured - running in local mode');
    return false;
  }

  try {
    supabase = window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });

    // Set up auth state change listener
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] State change:', event);
      currentSession = session;
      currentUser = session?.user || null;
      
      // Notify all listeners
      authListeners.forEach(callback => {
        try {
          callback(event, session, currentUser);
        } catch (e) {
          console.error('[Auth] Listener error:', e);
        }
      });
    });

    // Check for existing session
    await checkSession();

    console.log('[Auth] Initialized successfully');
    return true;
  } catch (error) {
    console.error('[Auth] Initialization failed:', error);
    return false;
  }
}

/**
 * Check for an existing session
 */
async function checkSession() {
  if (!supabase) return null;

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[Auth] Session check error:', error);
      return null;
    }
    
    currentSession = session;
    currentUser = session?.user || null;
    return session;
  } catch (error) {
    console.error('[Auth] Session check failed:', error);
    return null;
  }
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  if (!supabase) {
    console.warn('[Auth] Cannot sign in - Supabase not initialized');
    return { error: { message: 'Authentication not available' } };
  }

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      console.error('[Auth] Google sign in error:', error);
      return { error };
    }

    return { data };
  } catch (error) {
    console.error('[Auth] Google sign in failed:', error);
    return { error: { message: error.message || 'Sign in failed' } };
  }
}

/**
 * Sign out the current user
 */
export async function signOut() {
  if (!supabase) {
    console.warn('[Auth] Cannot sign out - Supabase not initialized');
    return { error: { message: 'Authentication not available' } };
  }

  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error('[Auth] Sign out error:', error);
      return { error };
    }

    currentUser = null;
    currentSession = null;
    return { error: null };
  } catch (error) {
    console.error('[Auth] Sign out failed:', error);
    return { error: { message: error.message || 'Sign out failed' } };
  }
}

/**
 * Get the current session
 * @returns {Object|null} The current session or null
 */
export function getSession() {
  return currentSession;
}

/**
 * Get the current user
 * @returns {Object|null} The current user or null
 */
export function getUser() {
  return currentUser;
}

/**
 * Get the current access token
 * @returns {string|null} The access token or null
 */
export function getAccessToken() {
  return currentSession?.access_token || null;
}

/**
 * Check if the user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!currentUser;
}

/**
 * Check if auth is enabled (Supabase is configured)
 * @returns {boolean}
 */
export function isAuthEnabled() {
  return !!supabase;
}

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Called with (event, session, user)
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  authListeners.push(callback);
  
  // Immediately call with current state
  if (currentUser !== null || currentSession !== null) {
    callback('INITIAL', currentSession, currentUser);
  }
  
  // Return unsubscribe function
  return () => {
    authListeners = authListeners.filter(cb => cb !== callback);
  };
}

/**
 * Get user display info
 * @returns {Object} User display info
 */
export function getUserDisplayInfo() {
  if (!currentUser) {
    return null;
  }

  return {
    id: currentUser.id,
    email: currentUser.email,
    name: currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0],
    avatar: currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture,
  };
}

export default {
  initAuth,
  signInWithGoogle,
  signOut,
  getSession,
  getUser,
  getAccessToken,
  isAuthenticated,
  isAuthEnabled,
  onAuthStateChange,
  getUserDisplayInfo,
};
