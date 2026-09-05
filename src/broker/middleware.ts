/**
 * Middleware for broker token validation
 *
 * Validates HMAC signature, expiry, and required scopes.
 * Fails closed on every error path.
 */

import type { Context, Next } from 'hono';
import { verifyBrokerToken } from './token.js';
import { errorResponse, ApiErrorCode } from '../http/envelope.js';
import { createLogger } from '../logger.js';

const logger = createLogger('broker-middleware');

export interface BrokerTokenContext {
  tokenId: string;
  projectId: string;
  scopes: string[];
}

/**
 * Extend Hono context with broker token
 */
declare module 'hono' {
  interface ContextVariableMap {
    brokerToken: BrokerTokenContext;
  }
}

/**
 * Middleware to require a valid broker token with optional scope check
 *
 * @param requiredScopes Optional list of required scopes
 * @returns Hono middleware
 */
export function requireBrokerToken(requiredScopes?: string[]) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      logger.warn({ path: c.req.path }, 'Missing Authorization header');
      return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'Authorization header required');
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      logger.warn({ path: c.req.path }, 'Invalid Authorization format');
      return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'Invalid Authorization format (expected Bearer token)');
    }

    const token = match[1];
    const verified = verifyBrokerToken(token, requiredScopes);

    if (!verified.valid || !verified.payload) {
      logger.warn(
        { path: c.req.path, error: verified.error },
        'Broker token verification failed'
      );

      // Distinguish between expired and missing scope
      if (verified.error?.includes('scope')) {
        return errorResponse(c, 403, ApiErrorCode.FORBIDDEN, verified.error);
      }

      return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'Invalid or expired broker token');
    }

    // Attach token context to Hono context
    const tokenContext: BrokerTokenContext = {
      tokenId: verified.payload.jti,
      projectId: verified.payload.projectId,
      scopes: verified.payload.scopes,
    };

    c.set('brokerToken', tokenContext);

    await next();
  };
}
