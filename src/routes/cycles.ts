import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  getInstance,
  saveInstance,
  getDefinition,
  StorageNotFoundError,
} from '../storage/index.js';
import {
  runDailyPulse,
  runWeeklyWhisper,
  runPersonaShift,
  DayContext,
} from '../core/cycles.js';
import type { LLMProvider } from '../providers/llm/interface.js';

const logger = createLogger('routes-cycles');

/**
 * Zod schemas for request validation
 */
const DailyPulseSchema = z.object({
  game_context: z
    .object({
      events: z.array(z.string()).optional(),
      overallMood: z.enum(['positive', 'neutral', 'negative']).optional(),
      interactions: z.array(z.string()).optional(),
    })
    .optional(),
});

const WeeklyWhisperSchema = z.object({
  retain_count: z.number().int().min(1).max(10).optional(),
});

/**
 * Create cycle routes with injected LLM provider
 */
export function createCycleRoutes(llmProvider: LLMProvider): Hono {
  const cycleRoutes = new Hono();

  /**
   * POST /api/instances/:instanceId/daily-pulse - Run daily pulse cycle
   *
   * Lightweight emotional state capture at session/day boundaries.
   * Generates a mood baseline and single-sentence takeaway.
   */
  cycleRoutes.post('/:instanceId/daily-pulse', async (c) => {
    const startTime = Date.now();
    const instanceId = c.req.param('instanceId');

    try {
      // Parse optional body
      let dayContext: DayContext | undefined;
      try {
        const body = await c.req.json();
        const parsed = DailyPulseSchema.safeParse(body);
        if (parsed.success && parsed.data.game_context) {
          dayContext = parsed.data.game_context;
        }
      } catch {
        // Empty body is fine
      }

      // Find and load instance
      const instance = await findInstanceById(instanceId);
      if (!instance) {
        logger.warn({ instanceId }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Get definition for NPC name
      const definition = await getDefinition(instance.project_id, instance.definition_id);

      // Run daily pulse
      const result = await runDailyPulse(instance, llmProvider, definition.name, dayContext);

      if (!result.success) {
        return c.json({ error: 'Daily pulse failed' }, 500);
      }

      // Save updated instance
      const saveResult = await saveInstance(instance);

      const duration = Date.now() - startTime;
      logger.info({ instanceId, duration }, 'Daily pulse completed via API');

      return c.json({
        ...result,
        version: saveResult.version,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof StorageNotFoundError) {
        logger.warn({ instanceId, duration }, 'Instance or definition not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ instanceId, error: errorMessage, duration }, 'Daily pulse failed');
      return c.json({ error: 'Failed to run daily pulse', details: errorMessage }, 500);
    }
  });

  /**
   * POST /api/instances/:instanceId/weekly-whisper - Run weekly whisper cycle
   *
   * Memory curation with cyclic pruning. REPLACES STM with retained memories.
   * Promotes high-salience memories to LTM based on NPC's salience_threshold.
   */
  cycleRoutes.post('/:instanceId/weekly-whisper', async (c) => {
    const startTime = Date.now();
    const instanceId = c.req.param('instanceId');

    try {
      // Parse optional body
      let retainCount = 3; // Default
      try {
        const body = await c.req.json();
        const parsed = WeeklyWhisperSchema.safeParse(body);
        if (parsed.success && parsed.data.retain_count) {
          retainCount = parsed.data.retain_count;
        }
      } catch {
        // Empty body is fine
      }

      // Find and load instance
      const instance = await findInstanceById(instanceId);
      if (!instance) {
        logger.warn({ instanceId }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Load NPC definition to get salience threshold
      const definition = await getDefinition(instance.project_id, instance.definition_id);
      const salienceThreshold = definition.salience_threshold ?? 0.7;
      
      logger.debug({ 
        instanceId, 
        salienceThreshold,
        npcName: definition.name 
      }, 'Using NPC-specific salience threshold');

      // Run weekly whisper with NPC's salience threshold
      const result = await runWeeklyWhisper(instance, retainCount, salienceThreshold);

      if (!result.success) {
        return c.json({ error: 'Weekly whisper failed' }, 500);
      }

      // Save updated instance
      const saveResult = await saveInstance(instance);

      const duration = Date.now() - startTime;
      logger.info({ instanceId, duration, salienceThreshold }, 'Weekly whisper completed via API');

      return c.json({
        ...result,
        salience_threshold: salienceThreshold,
        version: saveResult.version,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof StorageNotFoundError) {
        logger.warn({ instanceId, duration }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ instanceId, error: errorMessage, duration }, 'Weekly whisper failed');
      return c.json({ error: 'Failed to run weekly whisper', details: errorMessage }, 500);
    }
  });

  /**
   * POST /api/instances/:instanceId/persona-shift - Run persona shift cycle
   *
   * Major personality recalibration. Reviews experiences and adjusts traits.
   * NEVER modifies the Core Anchor.
   */
  cycleRoutes.post('/:instanceId/persona-shift', async (c) => {
    const startTime = Date.now();
    const instanceId = c.req.param('instanceId');

    try {
      // Find and load instance
      const instance = await findInstanceById(instanceId);
      if (!instance) {
        logger.warn({ instanceId }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Get definition for NPC context
      const definition = await getDefinition(instance.project_id, instance.definition_id);

      // Run persona shift
      const result = await runPersonaShift(
        instance,
        llmProvider,
        definition.name,
        definition.core_anchor.backstory,
        definition.core_anchor.principles
      );

      if (!result.success) {
        return c.json({ error: 'Persona shift failed' }, 500);
      }

      // Save updated instance
      const saveResult = await saveInstance(instance);

      const duration = Date.now() - startTime;
      logger.info({ instanceId, duration }, 'Persona shift completed via API');

      return c.json({
        ...result,
        version: saveResult.version,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof StorageNotFoundError) {
        logger.warn({ instanceId, duration }, 'Instance or definition not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ instanceId, error: errorMessage, duration }, 'Persona shift failed');
      return c.json({ error: 'Failed to run persona shift', details: errorMessage }, 500);
    }
  });

  return cycleRoutes;
}

/**
 * Helper to find an instance by ID across all projects.
 * In a production system, this would be more efficient.
 */
async function findInstanceById(instanceId: string): Promise<import('../types/npc.js').NPCInstance | null> {
  // The instance ID contains enough info to derive the project
  // For now, we'll try to load it from all projects
  // This could be optimized with a separate index

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
