import { Context, Next } from 'hono';
import { createLogger } from '../logger.js';

const logger = createLogger('auth-middleware');

// Import the correct verification function based on environment
const isProduction = process.env.NODE_ENV === 'production';
const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const useAuth = isProduction && hasSupabase;

let verifyTokenFn: ((token: string) => Promise<{ userId: string; email?: string } | null>) | null = null;

// Dynamically import the verify function only if needed
if (useAuth) {
  const { verifyToken } = await import('../storage/supabase/client.js');
  verifyTokenFn = verifyToken;
}

/**
 * User context type
 */
export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * Extend Hono context with user
 */
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser | null;
    userId: string | null;
  }
}

/**
 * Authentication middleware
 * 
 * In production mode (with Supabase), this middleware:
 * - Validates the JWT token from the Authorization header
 * - Attaches user info to the context
 * - Returns 401 if token is invalid or missing
 * 
 * In development mode:
 * - Always allows access (no auth required)
 * - Sets user to null
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  // In development/local mode, skip authentication
  if (!useAuth) {
    c.set('user', null);
    c.set('userId', null);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    logger.debug('Missing or invalid Authorization header');
    return c.json({ error: 'Unauthorized - missing token' }, 401);
  }

  const token = authHeader.substring(7);

  if (!verifyTokenFn) {
    logger.error('Auth middleware enabled but verifyToken function not available');
    return c.json({ error: 'Authentication service unavailable' }, 500);
  }

  const result = await verifyTokenFn(token);

  if (!result) {
    logger.debug('Token verification failed');
    return c.json({ error: 'Unauthorized - invalid token' }, 401);
  }

  // Attach user to context
  const user: AuthUser = {
    id: result.userId,
    email: result.email,
  };

  c.set('user', user);
  c.set('userId', result.userId);

  logger.debug({ userId: result.userId }, 'User authenticated');

  await next();
}

/**
 * Optional authentication middleware
 * 
 * Like authMiddleware, but doesn't require authentication.
 * If a valid token is provided, it attaches the user to context.
 * If no token or invalid token, sets user to null and continues.
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  // In development/local mode, skip authentication
  if (!useAuth) {
    c.set('user', null);
    c.set('userId', null);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    c.set('user', null);
    c.set('userId', null);
    await next();
    return;
  }

  const token = authHeader.substring(7);

  if (!verifyTokenFn) {
    c.set('user', null);
    c.set('userId', null);
    await next();
    return;
  }

  const result = await verifyTokenFn(token);

  if (!result) {
    c.set('user', null);
    c.set('userId', null);
    await next();
    return;
  }

  // Attach user to context
  const user: AuthUser = {
    id: result.userId,
    email: result.email,
  };

  c.set('user', user);
  c.set('userId', result.userId);

  await next();
}

/**
 * Check if authentication is enabled
 */
export function isAuthEnabled(): boolean {
  return useAuth;
}
