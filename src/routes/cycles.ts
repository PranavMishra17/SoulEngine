import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  StorageNotFoundError,
} from '../storage/index.js';
import { getStorageForUser } from '../storage/hybrid.js';
import {
  runDailyPulse,
  runWeeklyWhisper,
  runPersonaShift,
  DayContext,
} from '../core/cycles.js';
import type { LLMProvider } from '../providers/llm/interface.js';
import { resolveProjectLlmProvider } from '../providers/llm/factory.js';

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

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

      // Find and load instance using the correct storage backend
      const instance = await findInstanceById(instanceId, userId);
      if (!instance) {
        logger.warn({ instanceId }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Load project settings, definition, and API keys in parallel
      const [project, definition, apiKeys] = await Promise.all([
        storage.getProject(instance.project_id),
        storage.getDefinition(instance.project_id, instance.definition_id),
        storage.loadApiKeys(instance.project_id),
      ]);

      // Resolve per-project LLM provider (BYOK), falling back to global default
      const activeProvider = resolveProjectLlmProvider(project.settings, apiKeys as Partial<Record<string, string>>, llmProvider);
      if (!activeProvider) {
        logger.warn({ instanceId }, 'No LLM provider configured for daily pulse');
        return c.json({ error: 'No LLM provider configured' }, 503);
      }

      // Run daily pulse
      const result = await runDailyPulse(instance, activeProvider, definition.name, dayContext);

      if (!result.success) {
        return c.json({ error: 'Daily pulse failed' }, 500);
      }

      // Save updated instance to the correct storage backend
      const saveResult = await storage.saveInstance(instance);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

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

      // Find and load instance using the correct storage backend
      const instance = await findInstanceById(instanceId, userId);
      if (!instance) {
        logger.warn({ instanceId }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Load NPC definition to get salience threshold
      const definition = await storage.getDefinition(instance.project_id, instance.definition_id);
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

      // Save updated instance to the correct storage backend
      const saveResult = await storage.saveInstance(instance);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    try {
      // Find and load instance using the correct storage backend
      const instance = await findInstanceById(instanceId, userId);
      if (!instance) {
        logger.warn({ instanceId }, 'Instance not found');
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Load project settings, definition, and API keys in parallel
      const [project, definition, apiKeys] = await Promise.all([
        storage.getProject(instance.project_id),
        storage.getDefinition(instance.project_id, instance.definition_id),
        storage.loadApiKeys(instance.project_id),
      ]);

      // Resolve per-project LLM provider (BYOK), falling back to global default
      const activeProvider = resolveProjectLlmProvider(project.settings, apiKeys as Partial<Record<string, string>>, llmProvider);
      if (!activeProvider) {
        logger.warn({ instanceId }, 'No LLM provider configured for persona shift');
        return c.json({ error: 'No LLM provider configured' }, 503);
      }

      // Run persona shift
      const result = await runPersonaShift(
        instance,
        activeProvider,
        definition.name,
        definition.core_anchor.backstory,
        definition.core_anchor.principles
      );

      if (!result.success) {
        return c.json({ error: 'Persona shift failed' }, 500);
      }

      // Save updated instance to the correct storage backend
      const saveResult = await storage.saveInstance(instance);

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
