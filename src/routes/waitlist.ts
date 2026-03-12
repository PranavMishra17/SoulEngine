import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { isSupabaseEnabled, getSupabaseAdmin } from '../storage/supabase/client.js';

const logger = createLogger('routes-waitlist');

const WaitlistSchema = z.object({
  email: z.string().email().max(320),
});

export const waitlistRoutes = new Hono();

/**
 * POST /api/waitlist - Add an email to the Unity package waitlist
 */
waitlistRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = WaitlistSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid email address' }, 400);
    }

    const email = parsed.data.email.toLowerCase().trim();

    if (!isSupabaseEnabled()) {
      // Local dev fallback — just log it
      logger.info({ email }, 'Waitlist signup (local mode, not persisted)');
      return c.json({ success: true, already_registered: false });
    }

    const supabase = getSupabaseAdmin();

    // Check if already exists
    const { data: existing } = await supabase
      .from('unity_waitlist')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      logger.info({ email }, 'Waitlist signup — already registered');
      return c.json({ success: true, already_registered: true });
    }

    // Insert new entry
    const { error: insertError } = await supabase
      .from('unity_waitlist')
      .insert({ email });

    if (insertError) {
      // Handle unique constraint race condition
      if (insertError.code === '23505') {
        return c.json({ success: true, already_registered: true });
      }
      logger.error({ error: insertError.message, email }, 'Failed to insert waitlist entry');
      return c.json({ error: 'Failed to join waitlist' }, 500);
    }

    logger.info({ email }, 'Waitlist signup — new entry');
    return c.json({ success: true, already_registered: false });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: msg }, 'Waitlist endpoint error');
    return c.json({ error: 'Failed to process request' }, 500);
  }
});
