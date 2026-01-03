import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  listProjects,
} from '../storage/projects.js';
import { saveApiKeys, loadApiKeys } from '../storage/secrets.js';
import { StorageNotFoundError, StorageValidationError } from '../storage/interface.js';

const logger = createLogger('routes-projects');

/**
 * Zod schemas for request validation
 */
const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: z
    .object({
      llm_provider: z.string().optional(),
      stt_provider: z.string().optional(),
      tts_provider: z.string().optional(),
      default_voice_id: z.string().optional(),
      timeouts: z
        .object({
          session: z.number().positive().optional(),
          llm: z.number().positive().optional(),
          stt: z.number().positive().optional(),
          tts: z.number().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  limits: z
    .object({
      max_npcs: z.number().int().positive().optional(),
      max_categories: z.number().int().positive().optional(),
      max_concurrent_sessions: z.number().int().positive().optional(),
    })
    .optional(),
});

const UpdateApiKeysSchema = z.object({
  gemini: z.string().optional(),
  deepgram: z.string().optional(),
  cartesia: z.string().optional(),
  elevenlabs: z.string().optional(),
});

/**
 * Project routes
 */
export const projectRoutes = new Hono();

/**
 * POST /api/projects - Create a new project
 */
projectRoutes.post('/', async (c) => {
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const parsed = CreateProjectSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, 'Invalid create project request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const project = await createProject(parsed.data.name);

    const duration = Date.now() - startTime;
    logger.info({ projectId: project.id, duration }, 'Project created via API');

    return c.json(project, 201);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, duration }, 'Failed to create project');
    return c.json({ error: 'Failed to create project', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects - List all projects
 */
projectRoutes.get('/', async (c) => {
  const startTime = Date.now();

  try {
    const projects = await listProjects();

    const duration = Date.now() - startTime;
    logger.debug({ count: projects.length, duration }, 'Projects listed via API');

    return c.json({ projects });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, duration }, 'Failed to list projects');
    return c.json({ error: 'Failed to list projects', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId - Get a project by ID
 */
projectRoutes.get('/:projectId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const project = await getProject(projectId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'Project retrieved via API');

    return c.json(project);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to get project');
    return c.json({ error: 'Failed to get project', details: errorMessage }, 500);
  }
});

/**
 * PUT /api/projects/:projectId - Update a project
 */
projectRoutes.put('/:projectId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const body = await c.req.json();
    const parsed = UpdateProjectSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, errors: parsed.error.issues }, 'Invalid update project request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    // Only include fields that are present in the request
    const updates: Parameters<typeof updateProject>[1] = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.settings !== undefined) updates.settings = parsed.data.settings as typeof updates.settings;
    if (parsed.data.limits !== undefined) updates.limits = parsed.data.limits as typeof updates.limits;

    const project = await updateProject(projectId, updates);

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Project updated via API');

    return c.json(project);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    if (error instanceof StorageValidationError) {
      logger.warn({ projectId, error: error.message, duration }, 'Validation error');
      return c.json({ error: 'Validation error', details: error.message }, 400);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update project');
    return c.json({ error: 'Failed to update project', details: errorMessage }, 500);
  }
});

/**
 * PUT /api/projects/:projectId/keys - Update API keys
 */
projectRoutes.put('/:projectId/keys', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    // Verify project exists
    await getProject(projectId);

    const body = await c.req.json();
    const parsed = UpdateApiKeysSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, errors: parsed.error.issues }, 'Invalid update API keys request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    // Load existing keys and merge with updates
    const existingKeys = await loadApiKeys(projectId);
    const mergedKeys = { ...existingKeys };

    // Only update provided keys
    if (parsed.data.gemini !== undefined) mergedKeys.gemini = parsed.data.gemini;
    if (parsed.data.deepgram !== undefined) mergedKeys.deepgram = parsed.data.deepgram;
    if (parsed.data.cartesia !== undefined) mergedKeys.cartesia = parsed.data.cartesia;
    if (parsed.data.elevenlabs !== undefined) mergedKeys.elevenlabs = parsed.data.elevenlabs;

    await saveApiKeys(projectId, mergedKeys);

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'API keys updated via API');

    // Return masked keys for confirmation
    return c.json({
      message: 'API keys updated',
      keys: {
        gemini: mergedKeys.gemini ? '***' : undefined,
        deepgram: mergedKeys.deepgram ? '***' : undefined,
        cartesia: mergedKeys.cartesia ? '***' : undefined,
        elevenlabs: mergedKeys.elevenlabs ? '***' : undefined,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    if (error instanceof StorageValidationError) {
      logger.warn({ projectId, error: error.message, duration }, 'Validation error');
      return c.json({ error: 'Validation error', details: error.message }, 400);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update API keys');
    return c.json({ error: 'Failed to update API keys', details: errorMessage }, 500);
  }
});

/**
 * DELETE /api/projects/:projectId - Delete a project
 */
projectRoutes.delete('/:projectId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    await deleteProject(projectId);

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Project deleted via API');

    return c.json({ message: 'Project deleted' });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to delete project');
    return c.json({ error: 'Failed to delete project', details: errorMessage }, 500);
  }
});
