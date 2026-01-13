import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  listProjects,
  saveApiKeys,
  loadApiKeys,
  listDefinitions,
  listInstances,
  getKnowledgeBase,
  getMCPTools,
  StorageNotFoundError,
  StorageValidationError,
} from '../storage/index.js';

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
  // LLM providers
  gemini: z.string().optional(),
  openai: z.string().optional(),
  anthropic: z.string().optional(),
  grok: z.string().optional(),
  // STT providers
  deepgram: z.string().optional(),
  // TTS providers
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

    // Get user ID from auth context (will be null in dev mode, required in prod with Supabase)
    const userId = c.get('userId') ?? undefined;
    
    const project = await createProject(parsed.data.name, userId);

    const duration = Date.now() - startTime;
    logger.info({ projectId: project.id, userId, duration }, 'Project created via API');

    return c.json(project, 201);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, duration }, 'Failed to create project');
    return c.json({ error: 'Failed to create project', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects - List all projects (filtered by user in authenticated mode)
 */
projectRoutes.get('/', async (c) => {
  const startTime = Date.now();

  try {
    // Get user ID from auth context to filter projects (undefined in dev mode = all projects)
    const userId = c.get('userId') ?? undefined;
    
    const projects = await listProjects(userId);

    const duration = Date.now() - startTime;
    logger.debug({ count: projects.length, userId, duration }, 'Projects listed via API');

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
 * GET /api/projects/:projectId/keys - Get API keys status (not the actual keys)
 */
projectRoutes.get('/:projectId/keys', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    // Verify project exists
    await getProject(projectId);

    // Load keys and return masked status
    const keys = await loadApiKeys(projectId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'API keys status retrieved via API');

    return c.json({
      // LLM providers
      gemini: keys.gemini ? true : false,
      openai: keys.openai ? true : false,
      anthropic: keys.anthropic ? true : false,
      grok: keys.grok ? true : false,
      // STT providers
      deepgram: keys.deepgram ? true : false,
      // TTS providers
      cartesia: keys.cartesia ? true : false,
      elevenlabs: keys.elevenlabs ? true : false,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to get API keys status');
    return c.json({ error: 'Failed to get API keys status', details: errorMessage }, 500);
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
    // LLM providers
    if (parsed.data.gemini !== undefined) mergedKeys.gemini = parsed.data.gemini;
    if (parsed.data.openai !== undefined) mergedKeys.openai = parsed.data.openai;
    if (parsed.data.anthropic !== undefined) mergedKeys.anthropic = parsed.data.anthropic;
    if (parsed.data.grok !== undefined) mergedKeys.grok = parsed.data.grok;
    // STT providers
    if (parsed.data.deepgram !== undefined) mergedKeys.deepgram = parsed.data.deepgram;
    // TTS providers
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
        openai: mergedKeys.openai ? '***' : undefined,
        anthropic: mergedKeys.anthropic ? '***' : undefined,
        grok: mergedKeys.grok ? '***' : undefined,
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

/**
 * GET /api/projects/:projectId/voices - Fetch available voices from TTS provider
 */
projectRoutes.get('/:projectId/voices', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const provider = c.req.query('provider') || 'cartesia';

  try {
    // Verify project exists and load API keys
    await getProject(projectId);
    const apiKeys = await loadApiKeys(projectId);

    let voices: Array<{ id: string; name: string; description?: string; preview_url?: string }> = [];

    if (provider === 'cartesia') {
      const apiKey = apiKeys.cartesia;
      if (!apiKey) {
        return c.json({ error: 'Cartesia API key not configured' }, 400);
      }

      // Request preview_file_url expansion for voice previews
      const response = await fetch('https://api.cartesia.ai/voices?expand[]=preview_file_url', {
        headers: {
          'X-API-Key': apiKey,
          'Cartesia-Version': '2024-06-10',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn({ projectId, provider, status: response.status, error }, 'Failed to fetch Cartesia voices');
        return c.json({ error: 'Failed to fetch voices from Cartesia' }, 502);
      }

      const data = (await response.json()) as Array<{ id: string; name: string; description?: string; preview_file_url?: string | null }>;
      voices = (data || []).map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description || '',
        // Cartesia preview URLs require auth - we'll proxy them or handle client-side
        preview_url: v.preview_file_url || undefined,
      }));
    } else if (provider === 'elevenlabs') {
      const apiKey = apiKeys.elevenlabs;
      if (!apiKey) {
        return c.json({ error: 'ElevenLabs API key not configured' }, 400);
      }

      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: {
          'xi-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn({ projectId, provider, status: response.status, error }, 'Failed to fetch ElevenLabs voices');
        return c.json({ error: 'Failed to fetch voices from ElevenLabs' }, 502);
      }

      const data = (await response.json()) as { voices: Array<{ voice_id: string; name: string; description?: string; preview_url?: string }> };
      voices = (data.voices || []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        description: v.description || '',
        preview_url: v.preview_url,
      }));
    } else {
      return c.json({ error: 'Invalid provider. Use "cartesia" or "elevenlabs"' }, 400);
    }

    const duration = Date.now() - startTime;
    logger.debug({ projectId, provider, count: voices.length, duration }, 'Voices fetched via API');

    return c.json({
      provider,
      voices,
      library_url: provider === 'cartesia'
        ? 'https://play.cartesia.ai/voices'
        : 'https://elevenlabs.io/voice-library',
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, provider, error: errorMessage, duration }, 'Failed to fetch voices');
    return c.json({ error: 'Failed to fetch voices', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/stats - Get project statistics
 */
projectRoutes.get('/:projectId/stats', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    // Verify project exists
    const project = await getProject(projectId);

    // Gather stats in parallel
    const [definitions, instances, knowledgeBase, mcpTools, apiKeys] = await Promise.all([
      listDefinitions(projectId).catch(() => []),
      listInstances(projectId).catch(() => []),
      getKnowledgeBase(projectId).catch(() => ({ categories: {} })),
      getMCPTools(projectId).catch(() => ({ conversation_tools: [], game_event_tools: [] })),
      loadApiKeys(projectId).catch(() => ({})),
    ]);

    // Calculate stats
    const categories = knowledgeBase.categories || {};
    const categoryCount = Object.keys(categories).length;
    const totalKnowledgeEntries = Object.values(categories).reduce((sum: number, cat) => {
      const depths = (cat as { depths?: Record<string, string[]> }).depths || {};
      return sum + Object.values(depths).reduce((s: number, entries) => s + (entries?.length || 0), 0);
    }, 0);

    const conversationTools = mcpTools.conversation_tools || [];
    const gameEventTools = mcpTools.game_event_tools || [];

    // Check if any API keys are configured
    const hasApiKeys = Object.values(apiKeys).some(key => !!key);

    const stats = {
      project: {
        id: project.id,
        name: project.name,
        created_at: project.created_at,
      },
      npcs: {
        total: definitions.length,
        definitions: definitions.slice(0, 6).map((d: { id: string; name: string; description?: string; profile_image?: string }) => ({
          id: d.id,
          name: d.name,
          description: d.description || '',
          hasImage: !!d.profile_image,
        })),
      },
      instances: {
        total: instances.length,
      },
      knowledge: {
        categories: categoryCount,
        totalEntries: totalKnowledgeEntries,
        categoryNames: Object.keys(categories).slice(0, 6),
      },
      tools: {
        conversation: conversationTools.length,
        gameEvent: gameEventTools.length,
        total: conversationTools.length + gameEventTools.length,
        conversationNames: conversationTools.slice(0, 3).map((t: { name: string }) => t.name),
        gameEventNames: gameEventTools.slice(0, 3).map((t: { name: string }) => t.name),
      },
      apiKeys: {
        configured: hasApiKeys,
      },
    };

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'Project stats retrieved via API');

    return c.json(stats);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to get project stats');
    return c.json({ error: 'Failed to get project stats', details: errorMessage }, 500);
  }
});
