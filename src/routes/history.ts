import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  getInstance,
  getInstanceHistory,
  rollbackInstance,
} from '../storage/instances.js';
import { StorageNotFoundError } from '../storage/interface.js';

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

  try {
    // Find the instance
    const instance = await findInstanceById(instanceId);
    if (!instance) {
      logger.warn({ instanceId }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    // Get history
    const history = await getInstanceHistory(instance.project_id, instanceId);

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

  try {
    const body = await c.req.json();
    const parsed = RollbackSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ instanceId, errors: parsed.error.issues }, 'Invalid rollback request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { version } = parsed.data;

    // Find the instance
    const instance = await findInstanceById(instanceId);
    if (!instance) {
      logger.warn({ instanceId }, 'Instance not found');
      return c.json({ error: 'Instance not found' }, 404);
    }

    // Perform rollback
    const rolledBackInstance = await rollbackInstance(instance.project_id, instanceId, version);

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
 * GET /api/instances/:instanceId - Get current instance state
 *
 * Returns the current state of an instance.
 */
historyRoutes.get('/:instanceId', async (c) => {
  const startTime = Date.now();
  const instanceId = c.req.param('instanceId');

  try {
    // Find the instance
    const instance = await findInstanceById(instanceId);
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
 * Helper to find an instance by ID across all projects.
 */
async function findInstanceById(instanceId: string): Promise<import('../types/npc.js').NPCInstance | null> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { getConfig } = await import('../config.js');

  const config = getConfig();
  const projectsDir = path.join(config.dataDir, 'projects');

  try {
    const projects = await fs.readdir(projectsDir);

    for (const projectId of projects) {
      if (!projectId.startsWith('proj_')) continue;

      try {
        const instance = await getInstance(projectId, instanceId);
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
