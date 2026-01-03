import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  createDefinition,
  getDefinition,
  updateDefinition,
  deleteDefinition,
  listDefinitions,
} from '../storage/definitions.js';
import { getProject } from '../storage/projects.js';
import {
  StorageNotFoundError,
  StorageValidationError,
  StorageLimitError,
} from '../storage/interface.js';

const logger = createLogger('routes-npcs');

/**
 * Zod schemas for request validation
 */
const CoreAnchorSchema = z.object({
  backstory: z.string().min(1).max(2000),
  principles: z.array(z.string().min(1).max(500)).min(1).max(10),
  trauma_flags: z.array(z.string().max(200)).default([]),
});

const PersonalityBaselineSchema = z.object({
  openness: z.number().min(0).max(1),
  conscientiousness: z.number().min(0).max(1),
  extraversion: z.number().min(0).max(1),
  agreeableness: z.number().min(0).max(1),
  neuroticism: z.number().min(0).max(1),
});

const VoiceConfigSchema = z.object({
  provider: z.string().default('cartesia'),
  voice_id: z.string().min(1),
  speed: z.number().min(0.5).max(2).default(1),
});

const ScheduleBlockSchema = z.object({
  start: z.string(),
  end: z.string(),
  location_id: z.string(),
  activity: z.string(),
});

const MCPPermissionsSchema = z.object({
  conversation_tools: z.array(z.string()).default([]),
  game_event_tools: z.array(z.string()).default([]),
  denied: z.array(z.string()).default([]),
});

const KnowledgeAccessSchema = z.record(z.string(), z.number().int().min(0));

const CreateNPCSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  core_anchor: CoreAnchorSchema,
  personality_baseline: PersonalityBaselineSchema,
  voice: VoiceConfigSchema,
  schedule: z.array(ScheduleBlockSchema).default([]),
  mcp_permissions: MCPPermissionsSchema.default({
    conversation_tools: [],
    game_event_tools: [],
    denied: [],
  }),
  knowledge_access: KnowledgeAccessSchema.default({}),
});

const UpdateNPCSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(1000).optional(),
  core_anchor: CoreAnchorSchema.partial().optional(),
  personality_baseline: PersonalityBaselineSchema.partial().optional(),
  voice: VoiceConfigSchema.partial().optional(),
  schedule: z.array(ScheduleBlockSchema).optional(),
  mcp_permissions: MCPPermissionsSchema.partial().optional(),
  knowledge_access: KnowledgeAccessSchema.optional(),
});

/**
 * NPC routes
 */
export const npcRoutes = new Hono();

/**
 * POST /api/projects/:projectId/npcs - Create an NPC definition
 */
npcRoutes.post('/', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    // Verify project exists
    await getProject(projectId);

    const body = await c.req.json();
    const parsed = CreateNPCSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, errors: parsed.error.issues }, 'Invalid create NPC request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const definition = await createDefinition(projectId, parsed.data);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId: definition.id, name: definition.name, duration }, 'NPC created via API');

    return c.json(definition, 201);
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

    if (error instanceof StorageLimitError) {
      logger.warn({ projectId, error: error.message, duration }, 'Limit exceeded');
      return c.json({ error: 'Limit exceeded', details: error.message }, 400);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to create NPC');
    return c.json({ error: 'Failed to create NPC', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/npcs - List all NPCs in a project
 */
npcRoutes.get('/', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    // Verify project exists
    await getProject(projectId);

    const definitions = await listDefinitions(projectId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, count: definitions.length, duration }, 'NPCs listed via API');

    return c.json({ npcs: definitions });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to list NPCs');
    return c.json({ error: 'Failed to list NPCs', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/npcs/:npcId - Get an NPC by ID
 */
npcRoutes.get('/:npcId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');

  if (!projectId || !npcId) {
    return c.json({ error: 'Project ID and NPC ID are required' }, 400);
  }

  try {
    const definition = await getDefinition(projectId, npcId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, npcId, duration }, 'NPC retrieved via API');

    return c.json(definition);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      if (error.message.includes('NPC')) {
        logger.warn({ projectId, npcId, duration }, 'NPC not found');
        return c.json({ error: 'NPC not found' }, 404);
      }
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to get NPC');
    return c.json({ error: 'Failed to get NPC', details: errorMessage }, 500);
  }
});

/**
 * PUT /api/projects/:projectId/npcs/:npcId - Update an NPC
 */
npcRoutes.put('/:npcId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');

  if (!projectId || !npcId) {
    return c.json({ error: 'Project ID and NPC ID are required' }, 400);
  }

  try {
    const body = await c.req.json();
    const parsed = UpdateNPCSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, npcId, errors: parsed.error.issues }, 'Invalid update NPC request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const definition = await updateDefinition(projectId, npcId, parsed.data as Parameters<typeof updateDefinition>[2]);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, duration }, 'NPC updated via API');

    return c.json(definition);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      if (error.message.includes('NPC')) {
        logger.warn({ projectId, npcId, duration }, 'NPC not found');
        return c.json({ error: 'NPC not found' }, 404);
      }
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    if (error instanceof StorageValidationError) {
      logger.warn({ projectId, npcId, error: error.message, duration }, 'Validation error');
      return c.json({ error: 'Validation error', details: error.message }, 400);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to update NPC');
    return c.json({ error: 'Failed to update NPC', details: errorMessage }, 500);
  }
});

/**
 * DELETE /api/projects/:projectId/npcs/:npcId - Delete an NPC
 */
npcRoutes.delete('/:npcId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');

  if (!projectId || !npcId) {
    return c.json({ error: 'Project ID and NPC ID are required' }, 400);
  }

  try {
    await deleteDefinition(projectId, npcId);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, duration }, 'NPC deleted via API');

    return c.json({ message: 'NPC deleted' });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      if (error.message.includes('NPC')) {
        logger.warn({ projectId, npcId, duration }, 'NPC not found');
        return c.json({ error: 'NPC not found' }, 404);
      }
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to delete NPC');
    return c.json({ error: 'Failed to delete NPC', details: errorMessage }, 500);
  }
});
