/**
 * Standard error envelope: { error: { code, message, details? } }
 *
 * Verifies:
 * 1. NOT_FOUND errors return the standard envelope with an enum code
 * 2. VALIDATION_FAILED errors return the standard envelope
 * 3. UNAUTHORIZED errors (when applicable) return the standard envelope
 * 4. Raw exception strings do not leak in error responses
 * 5. Stable error code values come from the ApiErrorCode enum
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { errorResponse, ApiErrorCode } from '../../src/http/envelope.js';

/**
 * Build a minimal test app exercising the error envelope helper.
 */
function buildTestApp(): Hono {
  const app = new Hono();

  // Simulates a route that returns NOT_FOUND
  app.get('/not-found-demo', (c) => {
    return errorResponse(c, 404, ApiErrorCode.NOT_FOUND, 'Resource does not exist');
  });

  // Simulates a validation failure with details
  app.post('/validate-demo', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ApiErrorCode.VALIDATION_FAILED, 'Request body is not valid JSON');
    }
    if (!body || typeof (body as Record<string, unknown>).name !== 'string') {
      return errorResponse(c, 400, ApiErrorCode.VALIDATION_FAILED, 'name is required', [
        { field: 'name', issue: 'string expected' },
      ]);
    }
    return c.json({ ok: true });
  });

  // Simulates an unauthorized error
  app.get('/auth-demo', (c) => {
    return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'Bearer token required');
  });

  // Simulates an internal error — should NOT expose stack trace
  app.get('/internal-demo', (c) => {
    const internalError = new Error('Postgres connection refused at host:5432 token=super-secret');
    // Correct usage: log the real error, return a safe envelope message
    void internalError; // would normally be logged
    return errorResponse(c, 500, ApiErrorCode.INTERNAL, 'An internal error occurred');
  });

  // Simulates LLM_NOT_CONFIGURED
  app.get('/llm-demo', (c) => {
    return errorResponse(c, 503, ApiErrorCode.LLM_NOT_CONFIGURED, 'No LLM provider configured');
  });

  return app;
}

describe('Standard error envelope', () => {
  const app = buildTestApp();

  it('NOT_FOUND returns { error: { code, message } } with correct HTTP status', async () => {
    const res = await app.fetch(new Request('http://localhost/not-found-demo'));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ApiErrorCode.NOT_FOUND);
    expect(body.error.message).toBe('Resource does not exist');
  });

  it('VALIDATION_FAILED returns envelope with details array', async () => {
    const res = await app.fetch(new Request('http://localhost/validate-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123 }),  // wrong type
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string; details?: unknown[] } };
    expect(body.error.code).toBe(ApiErrorCode.VALIDATION_FAILED);
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('UNAUTHORIZED returns 401 with standard envelope', async () => {
    const res = await app.fetch(new Request('http://localhost/auth-demo'));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });

  it('INTERNAL error does NOT expose raw stack or connection string', async () => {
    const res = await app.fetch(new Request('http://localhost/internal-demo'));
    expect(res.status).toBe(500);
    const text = await res.text();
    // Must not contain the raw error internals
    expect(text).not.toMatch(/Postgres/);
    expect(text).not.toMatch(/super-secret/);
    expect(text).not.toMatch(/5432/);
  });

  it('INTERNAL error still returns valid error envelope JSON', async () => {
    const res = await app.fetch(new Request('http://localhost/internal-demo'));
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ApiErrorCode.INTERNAL);
    expect(typeof body.error.message).toBe('string');
  });

  it('LLM_NOT_CONFIGURED returns 503 with standard envelope', async () => {
    const res = await app.fetch(new Request('http://localhost/llm-demo'));
    expect(res.status).toBe(503);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ApiErrorCode.LLM_NOT_CONFIGURED);
  });

  it('ApiErrorCode enum has all required stable codes', () => {
    const requiredCodes: string[] = [
      'NOT_FOUND',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'LLM_NOT_CONFIGURED',
      'CONFLICT',
      'INTERNAL',
    ];
    for (const code of requiredCodes) {
      expect(ApiErrorCode).toHaveProperty(code);
    }
  });

  it('error envelope does not include extra properties beyond error', async () => {
    const res = await app.fetch(new Request('http://localhost/not-found-demo'));
    const body = await res.json() as Record<string, unknown>;
    // The top-level object should only have "error"
    expect(Object.keys(body)).toEqual(['error']);
  });
});

describe('Pagination helper', () => {
  it('parsePagination extracts limit and cursor from query params', async () => {
    const { parsePagination } = await import('../../src/http/pagination.js');
    const result = parsePagination({ limit: '20', cursor: 'abc123' });
    expect(result.limit).toBe(20);
    expect(result.cursor).toBe('abc123');
  });

  it('parsePagination applies defaults when params are missing', async () => {
    const { parsePagination } = await import('../../src/http/pagination.js');
    const result = parsePagination({});
    expect(result.limit).toBeGreaterThan(0);
    expect(result.cursor).toBeUndefined();
  });

  it('parsePagination clamps limit to a maximum', async () => {
    const { parsePagination } = await import('../../src/http/pagination.js');
    const result = parsePagination({ limit: '9999' });
    expect(result.limit).toBeLessThanOrEqual(200);
  });

  it('paginatedResponse wraps items with consistent shape', async () => {
    const { paginatedResponse } = await import('../../src/http/pagination.js');
    const items = [{ id: '1' }, { id: '2' }];
    const wrapped = paginatedResponse(items, { limit: 10, cursor: undefined }, 'next-cursor');
    expect(wrapped).toHaveProperty('items');
    expect(wrapped).toHaveProperty('pagination');
    expect(wrapped.pagination).toHaveProperty('limit');
    expect(wrapped.pagination).toHaveProperty('next_cursor');
    expect(Array.isArray(wrapped.items)).toBe(true);
  });
});
