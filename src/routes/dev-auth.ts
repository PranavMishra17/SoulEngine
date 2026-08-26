import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { deriveDevUserId, isDevLoginEnabled, issueDevToken } from '../security/dev-auth.js';

const logger = createLogger('routes-dev-auth');

const DevLoginSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
});

/**
 * Local/dev-only sign-in routes. Mounted by src/index.ts only when
 * isDevLoginEnabled() is true, so the route doesn't exist at all in a real
 * production deployment. The handler re-checks the same flag as
 * defense-in-depth in case this router is ever mounted unconditionally.
 */
export const devAuthRoutes = new Hono();

devAuthRoutes.post('/login', async (c) => {
  if (!isDevLoginEnabled()) {
    return c.json({ error: 'Dev login is disabled' }, 404);
  }

  try {
    const body = await c.req.json();
    const parsed = DevLoginSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { email, name } = parsed.data;
    const token = issueDevToken(email, name ?? '');

    if (!token) {
      return c.json({ error: 'Dev login is disabled' }, 404);
    }

    logger.info({ email }, 'Dev login issued');

    return c.json({
      token,
      user: {
        id: deriveDevUserId(email),
        email: email.trim().toLowerCase(),
        name: name?.trim() || email.split('@')[0],
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Dev login failed');
    return c.json({ error: 'Dev login failed', details: errorMessage }, 500);
  }
});
