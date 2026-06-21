/**
 * Standard HTTP response envelope for SoulEngine API.
 *
 * All error responses are shaped as:
 *   { error: { code: ApiErrorCode, message: string, details?: unknown } }
 *
 * This module is the single source of truth for error codes. Routes import
 * ApiErrorCode and errorResponse instead of crafting ad-hoc strings.
 */

import type { Context } from 'hono';

/**
 * Stable error code enum.
 *
 * These values are part of the public API contract — do NOT rename or remove
 * existing values; add new ones at the bottom.
 */
export const ApiErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  LLM_NOT_CONFIGURED: 'LLM_NOT_CONFIGURED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * Standard error response shape.
 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Return a standard error response.
 *
 * @param c       Hono context
 * @param status  HTTP status code (4xx / 5xx)
 * @param code    Stable error code from ApiErrorCode
 * @param message Human-readable message — MUST NOT include raw exception text in production
 * @param details Optional structured details (e.g. Zod validation issues)
 */
export function errorResponse(
  c: Context,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  return c.json(body, status as Parameters<typeof c.json>[1]);
}
