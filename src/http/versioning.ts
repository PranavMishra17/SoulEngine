/**
 * API versioning helper.
 *
 * Mounts all routes under a canonical versioned prefix (e.g. /api/v1) and
 * installs a backward-compatible alias at the legacy prefix (e.g. /api).
 *
 * The legacy prefix injects Deprecation + Link headers per RFC 8594 so clients
 * can discover the stable versioned path. The canonical prefix is clean.
 *
 * Usage in index.ts:
 *   applyVersioning(app, '/api/v1', '/api', (v1) => {
 *     v1.route('/projects', projectRoutes);
 *     // ...
 *   });
 */

import { Hono } from 'hono';

/**
 * Single API version string advertised in response headers.
 * Bump this when making breaking changes to the v1 surface.
 */
export const API_VERSION = 'v1' as const;

/**
 * Apply versioned routing to an existing Hono app.
 *
 * @param app           Root Hono application
 * @param canonicalPath Versioned prefix, e.g. '/api/v1'
 * @param legacyPath    Legacy prefix,    e.g. '/api'
 * @param mount         Callback that mounts routes onto the v1 sub-app
 */
export function applyVersioning(
  app: Hono,
  canonicalPath: string,
  legacyPath: string,
  mount: (v1: Hono) => void
): void {
  // Build the canonical (v1) sub-app — no deprecation headers
  const v1 = new Hono();
  mount(v1);
  app.route(canonicalPath, v1);

  // Build the legacy sub-app — same routes, plus deprecation headers on every response.
  // Middleware must be registered BEFORE routes in Hono so that it runs first and can
  // set response headers after calling next().
  const legacyApp = new Hono();

  legacyApp.use('*', async (c, next) => {
    await next();
    // Inject deprecation signal per RFC 8594
    c.header('Deprecation', 'true');
    c.header('Link', `<${canonicalPath}>; rel="successor-version"`);
    c.header('Sunset', canonicalPath);
  });

  // Mount routes after the middleware is registered
  mount(legacyApp);

  app.route(legacyPath, legacyApp);
}
