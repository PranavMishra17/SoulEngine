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

const NPCNetworkEntrySchema = z.object({
  npc_id: z.string().min(1),
  familiarity_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mutual_awareness: z.boolean().optional(),
  reverse_context: z.string().max(200).optional(),
});

const PlayerRecognitionSchema = z.object({
  can_know_player: z.boolean(),
  default_player_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  reveal_player_identity: z.boolean(),
});

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
  network: z.array(NPCNetworkEntrySchema).max(5).default([]),
  player_recognition: PlayerRecognitionSchema.optional(),
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
  network: z.array(NPCNetworkEntrySchema).max(5).optional(),
  player_recognition: PlayerRecognitionSchema.optional(),
});

/**
 * Helper functions for bidirectional network updates
 */

async function addToOtherNpcNetwork(
  projectId: string,
  otherNpcId: string,
  thisNpcId: string,
  tier: 1 | 2 | 3
): Promise<void> {
  try {
    const otherNpc = await getDefinition(projectId, otherNpcId);
    const network = otherNpc.network || [];

    // Check if already in network
    if (network.find(n => n.npc_id === thisNpcId)) {
      return;
    }

    // Check limit
    if (network.length >= 5) {
      logger.warn({ projectId, otherNpcId, thisNpcId }, 'Cannot add to network - limit reached');
      return;
    }

    network.push({ npc_id: thisNpcId, familiarity_tier: tier });
    await updateDefinition(projectId, otherNpcId, { network });
    logger.debug({ projectId, otherNpcId, thisNpcId, tier }, 'Added to other NPC network');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ projectId, otherNpcId, thisNpcId, error: errorMessage }, 'Failed to add to other NPC network');
  }
}

async function removeFromOtherNpcNetwork(
  projectId: string,
  otherNpcId: string,
  thisNpcId: string
): Promise<void> {
  try {
    const otherNpc = await getDefinition(projectId, otherNpcId);
    const network = otherNpc.network || [];

    const idx = network.findIndex(n => n.npc_id === thisNpcId);
    if (idx === -1) {
      return;
    }

    network.splice(idx, 1);
    await updateDefinition(projectId, otherNpcId, { network });
    logger.debug({ projectId, otherNpcId, thisNpcId }, 'Removed from other NPC network');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ projectId, otherNpcId, thisNpcId, error: errorMessage }, 'Failed to remove from other NPC network');
  }
}

async function updateOtherNpcNetworkTier(
  projectId: string,
  otherNpcId: string,
  thisNpcId: string,
  tier: 1 | 2 | 3
): Promise<void> {
  try {
    const otherNpc = await getDefinition(projectId, otherNpcId);
    const network = otherNpc.network || [];

    const entry = network.find(n => n.npc_id === thisNpcId);
    if (!entry) {
      // Not in their network, add them
      await addToOtherNpcNetwork(projectId, otherNpcId, thisNpcId, tier);
      return;
    }

    entry.familiarity_tier = tier;
    await updateDefinition(projectId, otherNpcId, { network });
    logger.debug({ projectId, otherNpcId, thisNpcId, tier }, 'Updated tier in other NPC network');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ projectId, otherNpcId, thisNpcId, error: errorMessage }, 'Failed to update tier in other NPC network');
  }
}

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
 * Query params:
 * - bidirectional: 'true' (default) or 'false' - whether to update network connections bidirectionally
 */
npcRoutes.put('/:npcId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');
  const bidirectional = c.req.query('bidirectional') !== 'false';

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

    // Handle bidirectional network updates
    if (bidirectional && parsed.data.network !== undefined) {
      try {
        const currentDef = await getDefinition(projectId, npcId);
        const oldNetwork = currentDef.network || [];
        const newNetwork = parsed.data.network || [];

        // Find added connections
        const added = newNetwork.filter(n => !oldNetwork.find(o => o.npc_id === n.npc_id));

        // Find removed connections
        const removed = oldNetwork.filter(o => !newNetwork.find(n => n.npc_id === o.npc_id));

        // Find tier changes
        const changed = newNetwork.filter(n => {
          const old = oldNetwork.find(o => o.npc_id === n.npc_id);
          return old && old.familiarity_tier !== n.familiarity_tier;
        });

        // Apply reciprocal changes
        for (const entry of added) {
          await addToOtherNpcNetwork(projectId, entry.npc_id, npcId, entry.familiarity_tier);
        }

        for (const entry of removed) {
          await removeFromOtherNpcNetwork(projectId, entry.npc_id, npcId);
        }

        for (const entry of changed) {
          await updateOtherNpcNetworkTier(projectId, entry.npc_id, npcId, entry.familiarity_tier);
        }

        logger.debug(
          { projectId, npcId, added: added.length, removed: removed.length, changed: changed.length },
          'Bidirectional network updates applied'
        );
      } catch (networkError) {
        // Log but don't fail the main update
        const errorMessage = networkError instanceof Error ? networkError.message : 'Unknown error';
        logger.warn({ projectId, npcId, error: errorMessage }, 'Failed to apply some bidirectional network updates');
      }
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
