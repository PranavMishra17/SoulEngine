/**
 * API Versioning: routes under /api/v1 and backward-compatible /api alias
 *
 * Verifies:
 * 1. Routes are reachable under /api/v1/...
 * 2. The same routes under /api/... return a Deprecation response header
 * 3. Legacy paths still return valid responses (not broken)
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { applyVersioning } from '../../src/http/versioning.js';

/**
 * Build a minimal Hono app that mirrors the real routing structure but uses
 * stub routes so no filesystem or Supabase I/O happens.
 */
function buildTestApp(): Hono {
  const stubProjectRoutes = new Hono();
  stubProjectRoutes.get('/', (c) => c.json({ projects: [] }));
  stubProjectRoutes.get('/:projectId', (c) => {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
  });

  const app = new Hono();

  applyVersioning(app, '/api/v1', '/api', (v1) => {
    v1.route('/projects', stubProjectRoutes);
  });

  return app;
}

describe('API versioning', () => {
  const app = buildTestApp();

  it('GET /api/v1/projects returns 200 with a projects array', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects'));
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: unknown[] };
    expect(Array.isArray(body.projects)).toBe(true);
  });

  it('GET /api/projects (legacy) returns 200 with a projects array', async () => {
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: unknown[] };
    expect(Array.isArray(body.projects)).toBe(true);
  });

  it('GET /api/projects (legacy) includes a Deprecation header', async () => {
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    expect(res.headers.has('Deprecation')).toBe(true);
  });

  it('Deprecation header value is non-empty (RFC 8594 compliant)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    const header = res.headers.get('Deprecation') ?? '';
    expect(header.length).toBeGreaterThan(0);
  });

  it('Link or Sunset header on legacy path points toward /api/v1', async () => {
    const res = await app.fetch(new Request('http://localhost/api/projects'));
    const link = res.headers.get('Link') ?? res.headers.get('Sunset') ?? '';
    expect(link).toMatch(/\/api\/v1/);
  });

  it('GET /api/v1/projects does NOT include a Deprecation header', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects'));
    expect(res.headers.has('Deprecation')).toBe(false);
  });

  it('GET /api/v1/projects/:projectId returns a structured 404 error envelope', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/projects/nonexistent-id'));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('GET /api/projects/:projectId (legacy) also has Deprecation header on 404', async () => {
    const res = await app.fetch(new Request('http://localhost/api/projects/nonexistent-id'));
    expect(res.status).toBe(404);
    expect(res.headers.has('Deprecation')).toBe(true);
  });
});
