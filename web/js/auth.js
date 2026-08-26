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
let authMode = null; // null | 'supabase' | 'dev'

const DEV_SESSION_STORAGE_KEY = 'se_dev_session';

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
 * Persist a dev session to localStorage so it survives a page refresh.
 */
function persistDevSession(token, user) {
  try {
    localStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify({ token, user }));
  } catch (e) {
    console.warn('[Auth] Failed to persist dev session:', e);
  }
}

function clearDevSession() {
  authMode = null;
  currentUser = null;
  currentSession = null;
  try {
    localStorage.removeItem(DEV_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Restore a previously persisted dev session, if any.
 * @returns {boolean} Whether a session was restored.
 */
function restoreDevSession() {
  try {
    const raw = localStorage.getItem(DEV_SESSION_STORAGE_KEY);
    if (!raw) return false;

    const { token, user } = JSON.parse(raw);
    if (!token || !user) return false;

    authMode = 'dev';
    currentSession = { access_token: token };
    currentUser = user;
    return true;
  } catch (e) {
    console.warn('[Auth] Failed to restore dev session:', e);
    return false;
  }
}

/**
 * Whether local/dev-only sign-in is available on this server. Only true
 * outside a real production deployment (see src/security/dev-auth.ts).
 * @returns {boolean}
 */
export function isDevLoginAvailable() {
  return !!authConfig?.devLoginAvailable;
}

/**
 * Sign in locally with just an email (+ optional display name), without
 * ever contacting Supabase. Only works when isDevLoginAvailable() is true.
 * @param {string} email
 * @param {string} [name]
 * @returns {Promise<{data?: {user: object}, error?: {message: string}}>}
 */
export async function devSignIn(email, name = '') {
  if (!isDevLoginAvailable()) {
    return { error: { message: 'Dev sign-in is not available on this server' } };
  }

  try {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { error: { message: body.error || 'Dev sign-in failed' } };
    }

    const { token, user } = await response.json();

    authMode = 'dev';
    currentSession = { access_token: token };
    currentUser = user;
    persistDevSession(token, user);

    authListeners.forEach(callback => {
      try {
        callback('SIGNED_IN', currentSession, currentUser);
      } catch (e) {
        console.error('[Auth] Listener error:', e);
      }
    });

    return { data: { user } };
  } catch (error) {
    console.error('[Auth] Dev sign in failed:', error);
    return { error: { message: error.message || 'Dev sign-in failed' } };
  }
}

/**
 * Initialize the Supabase client
 * @returns {boolean} Whether initialization was successful
 */
export async function initAuth() {
  // Guard against double initialization
  if (supabase || authMode === 'dev') {
    return true;
  }

  // Load configuration from server — needed for both Supabase and dev-login
  // availability, regardless of whether the Supabase SDK loaded.
  authConfig = await loadConfig();

  // Local/dev-only sign-in: restore a persisted session if one exists. This
  // never touches Supabase and works even if the Supabase project is
  // unreachable or unconfigured.
  if (authConfig?.devLoginAvailable && restoreDevSession()) {
    console.log('[Auth] Restored local dev session');
    return true;
  }

  if (authConfig?.devLoginAvailable) {
    // No persisted dev session, but dev sign-in is available — the nav
    // should still render its auth controls.
    return true;
  }

  // Check if Supabase SDK is available (loaded via CDN)
  if (typeof window.supabase === 'undefined') {
    console.log('[Auth] Supabase SDK not loaded - running in local mode');
    return false;
  }

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
      authMode = session ? 'supabase' : null;
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
    if (session) authMode = 'supabase';
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
  if (authMode === 'dev') {
    clearDevSession();
    const event = 'SIGNED_OUT';
    authListeners.forEach(callback => {
      try {
        callback(event, null, null);
      } catch (e) {
        console.error('[Auth] Listener error:', e);
      }
    });
    return { error: null };
  }

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
 * Get the current access token.
 * If the in-memory session hasn't been populated yet (page-load race),
 * falls back to a live Supabase getSession() call so the token is always
 * available even before onAuthStateChange fires.
 * @returns {Promise<string|null>}
 */
export async function getAccessToken() {
  if (currentSession?.access_token) return currentSession.access_token;
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      currentSession = data.session;
      currentUser = data.session.user;
    }
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
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
    name: currentUser.name || currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0],
    avatar: currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture,
  };
}

export default {
  initAuth,
  signInWithGoogle,
  devSignIn,
  isDevLoginAvailable,
  signOut,
  getSession,
  getUser,
  getAccessToken,
  isAuthenticated,
  isAuthEnabled,
  onAuthStateChange,
  getUserDisplayInfo,
};
