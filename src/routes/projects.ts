import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { getStarterPack } from '../data/starter-packs.js';
import {
  StorageNotFoundError,
  StorageValidationError,
} from '../storage/index.js';
import { getStorageForUser } from '../storage/hybrid.js';

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
      llm_model: z.string().optional(),
      stt_provider: z.string().optional(),
      tts_provider: z.string().optional(),
      default_voice_id: z.string().optional(),
      // game_client_api_key_hash is managed via POST/DELETE /:projectId/api-key endpoints
      timeouts: z
        .object({
          session: z.number().positive().optional(),
          llm: z.number().positive().optional(),
          stt: z.number().positive().optional(),
          tts: z.number().positive().optional(),
        })
        .optional(),
      // Mind configuration
      mind_provider: z.string().optional(),
      mind_model: z.string().optional(),
      mind_timeout_ms: z.number().int().min(1000).max(30000).optional(),
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

    // Get user ID from auth context (null if logged out → local storage)
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    const project = await storage.createProject(parsed.data.name, userId);

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
    const storage = getStorageForUser(userId);

    const projects = await storage.listProjects(userId);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    const project = await storage.getProject(projectId);

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

    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Only include fields that are present in the request
    const updates: Parameters<typeof storage.updateProject>[1] = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.settings !== undefined) updates.settings = parsed.data.settings as typeof updates.settings;
    if (parsed.data.limits !== undefined) updates.limits = parsed.data.limits as typeof updates.limits;

    const project = await storage.updateProject(projectId, updates);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists
    await storage.getProject(projectId);

    // Load keys and return masked status
    const keys = await storage.loadApiKeys(projectId);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists
    await storage.getProject(projectId);

    const body = await c.req.json();
    const parsed = UpdateApiKeysSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, errors: parsed.error.issues }, 'Invalid update API keys request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    // Load existing keys and merge with updates
    const existingKeys = await storage.loadApiKeys(projectId);
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

    await storage.saveApiKeys(projectId, mergedKeys);

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
 * POST /api/projects/:projectId/import-keys - Copy API keys from another project
 */
projectRoutes.post('/:projectId/import-keys', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify target project belongs to this user
    await storage.getProject(projectId);

    const body = await c.req.json();
    const fromProjectId = body?.from_project_id;

    if (!fromProjectId || typeof fromProjectId !== 'string') {
      return c.json({ error: 'from_project_id is required' }, 400);
    }

    if (fromProjectId === projectId) {
      return c.json({ error: 'Cannot import from the same project' }, 400);
    }

    // Verify source project belongs to this user
    await storage.getProject(fromProjectId);

    const sourceKeys = await storage.loadApiKeys(fromProjectId);
    const targetKeys = await storage.loadApiKeys(projectId);

    // Merge: non-empty source keys override target
    const mergedKeys = { ...targetKeys };
    let copiedCount = 0;
    for (const [k, v] of Object.entries(sourceKeys)) {
      if (v) {
        (mergedKeys as Record<string, string>)[k] = v as string;
        copiedCount++;
      }
    }

    await storage.saveApiKeys(projectId, mergedKeys);

    const duration = Date.now() - startTime;
    logger.info({ projectId, fromProjectId, copiedCount, duration }, 'API keys imported from project');

    return c.json({ message: `Imported ${copiedCount} API key${copiedCount !== 1 ? 's' : ''}`, keys_imported: copiedCount });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to import API keys');
    return c.json({ error: 'Failed to import API keys', details: errorMessage }, 500);
  }
});

/**
 * DELETE /api/projects/:projectId - Delete a project
 */
projectRoutes.delete('/:projectId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    await storage.deleteProject(projectId);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists and load API keys
    await storage.getProject(projectId);
    const apiKeys = await storage.loadApiKeys(projectId);

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
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists
    const project = await storage.getProject(projectId);

    // Gather stats in parallel
    const [definitions, instances, knowledgeBase, mcpTools, apiKeys] = await Promise.all([
      storage.listDefinitions(projectId).catch(() => []),
      storage.listInstances(projectId).catch(() => []),
      storage.getKnowledgeBase(projectId).catch(() => ({ categories: {} })),
      storage.getMCPTools(projectId).catch(() => ({ conversation_tools: [], game_event_tools: [] })),
      storage.loadApiKeys(projectId).catch(() => ({})),
    ]);

    // Calculate stats
    const categories = knowledgeBase.categories || {};
    const categoryCount = Object.keys(categories).length;
    // Count number of depth levels across all categories (depths are key-value pairs, not arrays)
    const totalKnowledgeEntries = Object.values(categories).reduce((sum: number, cat) => {
      const depths = (cat as { depths?: Record<string, string> }).depths || {};
      return sum + Object.keys(depths).length;
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
          profile_image: d.profile_image || '',
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

/**
 * POST /api/projects/:projectId/generate-npc-content - Generate NPC content using LLM
 */
const GenerateContentSchema = z.object({
  field: z.enum(['backstory', 'principles', 'trauma_flags']),
  prompt: z.string().min(1).max(2000),
});

projectRoutes.post('/:projectId/generate-npc-content', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists and get API keys
    await storage.getProject(projectId);
    const apiKeys = await storage.loadApiKeys(projectId);

    const body = await c.req.json();
    const parsed = GenerateContentSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { field, prompt } = parsed.data;

    // Find an LLM key to use
    const llmKey = apiKeys.gemini || apiKeys.openai || apiKeys.anthropic || apiKeys.grok;
    const llmProvider = apiKeys.gemini ? 'gemini' : apiKeys.openai ? 'openai' : apiKeys.anthropic ? 'anthropic' : 'grok';

    if (!llmKey) {
      return c.json({ error: 'No LLM API key configured. Add a key in Project Settings.' }, 400);
    }

    // Build the generation prompt based on field
    let systemPrompt = '';
    let userPrompt = '';

    if (field === 'backstory') {
      systemPrompt = `You are a creative writer helping design NPCs for a video game. Generate a concise backstory (100-200 words) that establishes the character's fundamental worldview based on the user's description. Focus on formative experiences, childhood context, and core psychological drivers. Return ONLY the backstory text, no explanations.`;
      userPrompt = `Generate 3 different backstory variations for this character. Separate each variation with "---" on its own line.\n\nCharacter description: ${prompt}`;
    } else if (field === 'principles') {
      systemPrompt = `You are a creative writer helping design NPCs for a video game. Generate 3-5 core principles or unbreakable beliefs for the character. These should be fundamental values that the character would never compromise. Return ONLY a comma-separated list of principles.`;
      userPrompt = `Generate 3 different sets of principles for this character. Separate each set with "---" on its own line.\n\nCharacter description: ${prompt}`;
    } else if (field === 'trauma_flags') {
      systemPrompt = `You are a creative writer helping design NPCs for a video game. Generate trauma flags or emotional triggers for the character. These are past experiences that affect their behavior and reactions. Return ONLY a comma-separated list of trauma flags (keep each brief, 2-5 words).`;
      userPrompt = `Generate 3 different sets of trauma flags for this character. Separate each set with "---" on its own line.\n\nCharacter description: ${prompt}`;
    }

    // Call the appropriate LLM API
    let variations: string[] = [];

    if (llmProvider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${llmKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 1024 },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error({ error: err }, 'Gemini API error');
        throw new Error('LLM generation failed');
      }

      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      variations = text.split('---').map((s: string) => s.trim()).filter(Boolean);

    } else if (llmProvider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.9,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error({ error: err }, 'OpenAI API error');
        throw new Error('LLM generation failed');
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content || '';
      variations = text.split('---').map((s: string) => s.trim()).filter(Boolean);

    } else if (llmProvider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': llmKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error({ error: err }, 'Anthropic API error');
        throw new Error('LLM generation failed');
      }

      const data = await response.json() as { content?: Array<{ text?: string }> };
      const text = data.content?.[0]?.text || '';
      variations = text.split('---').map((s: string) => s.trim()).filter(Boolean);
    }

    // Ensure we have at least 1 variation
    if (variations.length === 0) {
      variations = ['Generation produced no results. Please try again with more detail.'];
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, field, variationCount: variations.length, duration }, 'NPC content generated');

    return c.json({ variations });

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to generate NPC content');
    return c.json({ error: 'Failed to generate content', details: errorMessage }, 500);
  }
});

/**
 * POST /api/projects/:projectId/load-starter-pack
 * Body: { pack_id: string }
 *
 * Loads the requested starter pack into an EMPTY project.
 * Enforces one-pack-per-project: rejects if the project already has NPCs.
 */
projectRoutes.post('/:projectId/load-starter-pack', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    let packId = 'space'; // default for backward compatibility
    try {
      const body = await c.req.json();
      if (body?.pack_id) packId = String(body.pack_id);
    } catch {
      // Body parse failure — use default
    }

    const pack = getStarterPack(packId);
    if (!pack) {
      return c.json({ error: `Starter pack '${packId}' not found` }, 404);
    }

    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists
    await storage.getProject(projectId);

    // One-pack-per-project: reject if project already has NPCs
    const existingNpcs = await storage.listDefinitions(projectId);
    if (existingNpcs.length > 0) {
      return c.json({
        error: 'This project already has NPCs. A starter pack can only be loaded into an empty project.',
        code: 'PROJECT_NOT_EMPTY',
      }, 409);
    }

    const results = {
      pack_id: packId,
      pack_name: pack.meta.name,
      npcs_added: 0,
      knowledge_categories_added: 0,
      conversation_tools_added: 0,
      game_event_tools_added: 0,
    };

    // Map old NPC IDs → new project-specific IDs (for network remapping)
    const npcIdMap: Record<string, string> = {};
    const packNpcs = pack.npcs as Array<{ id: string; name: string; network?: Array<{ npc_id: string; familiarity_tier: number }> } & Record<string, unknown>>;

    // Pass 1: create all NPCs without network links
    for (const npc of packNpcs) {
      try {
        const { id: oldId, ...npcData } = npc;
        const created = await storage.createDefinition(projectId, { ...npcData, network: [] } as unknown as Parameters<typeof storage.createDefinition>[1]);
        npcIdMap[oldId] = created.id;
        results.npcs_added++;
      } catch (error) {
        logger.warn({ npcName: npc.name, error: String(error) }, 'Failed to create starter pack NPC');
      }
    }

    // Pass 2: update each NPC's network with remapped IDs
    for (const npc of packNpcs) {
      const newId = npcIdMap[npc.id];
      if (!newId || !npc.network?.length) continue;
      try {
        const newNetwork = npc.network
          .filter((e) => npcIdMap[e.npc_id])
          .map((e) => ({ npc_id: npcIdMap[e.npc_id], familiarity_tier: e.familiarity_tier as 1 | 2 | 3 }));
        if (newNetwork.length > 0) {
          await storage.updateDefinition(projectId, newId, { network: newNetwork });
        }
      } catch (error) {
        logger.warn({ npcId: newId, error: String(error) }, 'Failed to update NPC network');
      }
    }

    // Load knowledge base — merge with existing
    try {
      const existing = await storage.getKnowledgeBase(projectId);
      const packCategories = pack.knowledge.categories as Record<string, unknown>;
      await storage.updateKnowledgeBase(projectId, {
        categories: { ...existing.categories, ...(packCategories as typeof existing.categories) },
      });
      results.knowledge_categories_added = Object.keys(packCategories).length;
    } catch (error) {
      logger.warn({ error: String(error) }, 'Failed to load starter pack knowledge base');
    }

    // Load MCP tools — merge, deduplicate by id
    try {
      const existing = await storage.getMCPTools(projectId);
      const existingConvIds = new Set(existing.conversation_tools.map((t) => t.id));
      const existingGameIds = new Set(existing.game_event_tools.map((t) => t.id));

      const newConvTools = (pack.tools.conversation_tools as typeof existing.conversation_tools)
        .filter((t) => !existingConvIds.has(t.id));
      const newGameTools = (pack.tools.game_event_tools as typeof existing.game_event_tools)
        .filter((t) => !existingGameIds.has(t.id));

      await storage.saveMCPTools(projectId, {
        conversation_tools: [...existing.conversation_tools, ...newConvTools],
        game_event_tools: [...existing.game_event_tools, ...newGameTools],
      });
      results.conversation_tools_added = newConvTools.length;
      results.game_event_tools_added = newGameTools.length;
    } catch (error) {
      logger.warn({ error: String(error) }, 'Failed to load starter pack MCP tools');
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, packId, results, duration }, 'Starter pack loaded');

    return c.json({ message: 'Starter pack loaded successfully', ...results }, 201);

  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to load starter pack');
    return c.json({ error: 'Failed to load starter pack', details: errorMessage }, 500);
  }
});

/**
 * POST /api/projects/:projectId/api-key - Generate a new Game Client API Key
 * Returns the raw key exactly once. Only the SHA-256 hash is stored.
 */
projectRoutes.post('/:projectId/api-key', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists and belongs to this user
    await storage.getProject(projectId);

    const { randomBytes, createHash } = await import('crypto');
    const rawKey = 'gcak_' + randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    await storage.updateProject(projectId, {
      settings: { game_client_api_key_hash: keyHash } as Parameters<typeof storage.updateProject>[1]['settings'],
    });

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Game Client API Key generated');

    return c.json({ api_key: rawKey }, 201);
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to generate Game Client API Key');
    return c.json({ error: 'Failed to generate Game Client API Key', details: errorMessage }, 500);
  }
});

/**
 * DELETE /api/projects/:projectId/api-key - Revoke the Game Client API Key
 */
projectRoutes.delete('/:projectId/api-key', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);

    // Verify project exists and belongs to this user
    const project = await storage.getProject(projectId);

    if (!project.settings?.game_client_api_key_hash) {
      return c.json({ error: 'No Game Client API Key configured' }, 404);
    }

    // Clear the hash by setting it to undefined
    const updatedSettings = { ...project.settings };
    delete updatedSettings.game_client_api_key_hash;

    await storage.updateProject(projectId, { settings: updatedSettings });

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Game Client API Key revoked');

    return c.json({ success: true });
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to revoke Game Client API Key');
    return c.json({ error: 'Failed to revoke Game Client API Key', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/api-key/status - Check if a Game Client API Key is configured
 */
projectRoutes.get('/:projectId/api-key/status', async (c) => {
  const projectId = c.req.param('projectId');

  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);
    const project = await storage.getProject(projectId);

    return c.json({ configured: !!project.settings?.game_client_api_key_hash });
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage }, 'Failed to get API key status');
    return c.json({ error: 'Failed to get API key status', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/usage - Get cumulative token/char usage totals
 */
projectRoutes.get('/:projectId/usage', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);
    // Verify project exists
    await storage.getProject(projectId);
    const usage = await storage.getProjectUsage(projectId);
    return c.json(usage);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage }, 'Failed to get project usage');
    return c.json({ error: 'Failed to get usage', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/transcripts - List conversation transcripts (most recent first)
 */
projectRoutes.get('/:projectId/transcripts', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);
    await storage.getProject(projectId);
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
    const transcripts = await storage.listConversationTranscripts(projectId, limit);
    return c.json({ transcripts });
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    // Graceful fallback — don't fail the project if transcripts fail to load
    logger.warn({ projectId, error: error instanceof Error ? error.message : 'Unknown' }, 'Failed to list transcripts');
    return c.json({ transcripts: [] });
  }
});

/**
 * GET /api/projects/:projectId/transcripts/:transcriptId - Get a full transcript
 */
projectRoutes.get('/:projectId/transcripts/:transcriptId', async (c) => {
  const projectId = c.req.param('projectId');
  const transcriptId = c.req.param('transcriptId');
  try {
    const userId = c.get('userId') ?? undefined;
    const storage = getStorageForUser(userId);
    await storage.getProject(projectId);
    const transcript = await storage.getConversationTranscript(projectId, transcriptId);
    if (!transcript) {
      return c.json({ error: 'Transcript not found' }, 404);
    }
    return c.json(transcript);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, transcriptId, error: errorMessage }, 'Failed to get transcript');
    return c.json({ error: 'Failed to get transcript', details: errorMessage }, 500);
  }
});

