import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  StorageNotFoundError,
} from '../storage/index.js';
import { getStorageForUser } from '../storage/hybrid.js';

const logger = createLogger('routes-history');

/**
 * Zod schemas for request validation
 */
const RollbackSchema = z.object({
  version: z.string().min(1),
});

/**
 * History routes for instance state versioning
 */
export const historyRoutes = new Hono();

/**
 * GET /api/instances/:instanceId/history - Get instance version history
 *
 * Returns a list of archived versions for an instance.
 * Each version has a timestamp and can be used for rollback.
 */
historyRoutes.get('/:instanceId/history', async (c) => {
  const startTime = Date.now();
  const instanceId = c.req.param('instanceId');
  const userId = c.get('userId') ?? undefined;
  const storage = getStorageForUser(userId);

  try {
    // Find the instance using the correct storage backend
    const instance = await findInstanceById(instanceId, userId);
    if (!instance) {
      logger.warn({ instanceId }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    // Get history from the correct storage backend
    const history = await storage.getInstanceHistory(instance.project_id, instanceId);

    const duration = Date.now() - startTime;
    logger.debug({ instanceId, versionCount: history.length, duration }, 'Instance history retrieved');

    return c.json({
      instance_id: instanceId,
      versions: history,
      count: history.length,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ instanceId, duration }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId, error: errorMessage, duration }, 'Failed to get instance history');
    return c.json({ error: 'Failed to get instance history', details: errorMessage }, 500);
  }
});

/**
 * POST /api/instances/:instanceId/rollback - Rollback instance to a previous version
 *
 * Restores the instance state to a previous version.
 * The current state is archived before rollback.
 */
historyRoutes.post('/:instanceId/rollback', async (c) => {
  const startTime = Date.now();
  const instanceId = c.req.param('instanceId');
  const userId = c.get('userId') ?? undefined;
  const storage = getStorageForUser(userId);

  try {
    const body = await c.req.json();
    const parsed = RollbackSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ instanceId, errors: parsed.error.issues }, 'Invalid rollback request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { version } = parsed.data;

    // Find the instance using the correct storage backend
    const instance = await findInstanceById(instanceId, userId);
    if (!instance) {
      logger.warn({ instanceId }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    // Perform rollback on the correct storage backend
    const rolledBackInstance = await storage.rollbackInstance(instance.project_id, instanceId, version);

    const duration = Date.now() - startTime;
    logger.info({ instanceId, version, duration }, 'Instance rolled back');

    return c.json({
      message: 'Instance rolled back successfully',
      version,
      instance: {
        id: rolledBackInstance.id,
        definition_id: rolledBackInstance.definition_id,
        player_id: rolledBackInstance.player_id,
        current_mood: rolledBackInstance.current_mood,
        stm_count: rolledBackInstance.short_term_memory.length,
        ltm_count: rolledBackInstance.long_term_memory.length,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      if (error.message.includes('version')) {
        logger.warn({ instanceId, duration }, 'Version not found');
        return c.json({ error: 'Version not found' }, 404);
      }
      logger.warn({ instanceId, duration }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId, error: errorMessage, duration }, 'Failed to rollback instance');
    return c.json({ error: 'Failed to rollback instance', details: errorMessage }, 500);
  }
});

/**
 * GET /api/instances/:instanceId/history/:version - Get a specific historical snapshot
 *
 * Returns a full NPCInstance snapshot for the given version without restoring it.
 */
historyRoutes.get('/:instanceId/history/:version', async (c) => {
  const startTime = Date.now();
  const instanceId = c.req.param('instanceId');
  const version = c.req.param('version');
  const userId = c.get('userId') ?? undefined;
  const storage = getStorageForUser(userId);

  try {
    const instance = await findInstanceById(instanceId, userId);
    if (!instance) {
      logger.warn({ instanceId, version }, 'Instance not found for snapshot');
      return c.json({ error: 'Instance not found' }, 404);
    }

    const snapshot = await storage.getInstanceSnapshot(instance.project_id, instanceId, version);

    const duration = Date.now() - startTime;
    logger.debug({ instanceId, version, duration }, 'Instance snapshot retrieved');

    return c.json({ snapshot });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ instanceId, version, duration }, 'Snapshot version not found');
      return c.json({ error: 'Version not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId, version, error: errorMessage, duration }, 'Failed to get instance snapshot');
    return c.json({ error: 'Failed to get instance snapshot', details: errorMessage }, 500);
  }
});

/**
 * GET /api/instances/:instanceId - Get current instance state
 *
 * Returns the current state of an instance.
 */
historyRoutes.get('/:instanceId', async (c) => {
  const startTime = Date.now();
  const instanceId = c.req.param('instanceId');
  const userId = c.get('userId') ?? undefined;

  try {
    // Find the instance using the correct storage backend
    const instance = await findInstanceById(instanceId, userId);
    if (!instance) {
      logger.warn({ instanceId }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    const duration = Date.now() - startTime;
    logger.debug({ instanceId, duration }, 'Instance retrieved');

    return c.json(instance);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ instanceId, duration }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId, error: errorMessage, duration }, 'Failed to get instance');
    return c.json({ error: 'Failed to get instance', details: errorMessage }, 500);
  }
});

/**
 * Helper to find an instance by ID across all projects using the correct storage backend.
 * Uses getStorageForUser() to ensure Supabase instances are found for authenticated users.
 */
async function findInstanceById(
  instanceId: string,
  userId?: string | null
): Promise<import('../types/npc.js').NPCInstance | null> {
  const storage = getStorageForUser(userId);

  try {
    const projects = await storage.listProjects(userId ?? undefined);

    for (const project of projects) {
      try {
        const instance = await storage.getInstance(project.id, instanceId);
        return instance;
      } catch {
        // Not in this project, continue
      }
    }

    return null;
  } catch {
    return null;
  }
}
