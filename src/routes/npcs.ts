import { Hono } from 'hono';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
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

const DATA_DIR = process.env.DATA_DIR || './data';

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

/**
 * POST /api/projects/:projectId/npcs/:npcId/avatar - Upload NPC profile image
 * 
 * Accepts multipart form data with an image file.
 * Max file size: 1MB
 * Supported formats: PNG, JPG, WebP, GIF
 */
npcRoutes.post('/:npcId/avatar', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');

  if (!projectId || !npcId) {
    return c.json({ error: 'Project ID and NPC ID are required' }, 400);
  }

  try {
    // Verify NPC exists
    const npc = await getDefinition(projectId, npcId);

    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get('avatar') as File | null;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    // Check file size (1MB max)
    const MAX_SIZE = 1 * 1024 * 1024; // 1MB
    if (file.size > MAX_SIZE) {
      return c.json({ error: 'File too large. Maximum size is 1MB.' }, 400);
    }

    // Check file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Allowed: PNG, JPG, WebP, GIF' }, 400);
    }

    // Determine file extension
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = extMap[file.type] || 'png';

    // Create filename with NPC ID to avoid collisions
    const filename = `${npcId}-avatar.${ext}`;
    const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
    const filePath = path.join(npcDir, filename);

    // Ensure directory exists
    await fs.mkdir(npcDir, { recursive: true });

    // Delete old avatar if exists (different extension)
    const oldAvatar = npc.profile_image;
    if (oldAvatar && oldAvatar !== filename) {
      try {
        await fs.unlink(path.join(npcDir, oldAvatar));
      } catch {
        // Ignore if file doesn't exist
      }
    }

    // Write file
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));

    // Update NPC definition with new profile_image
    await updateDefinition(projectId, npcId, { profile_image: filename });

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, filename, duration }, 'NPC avatar uploaded');

    return c.json({ 
      message: 'Avatar uploaded', 
      filename,
      url: `/api/projects/${projectId}/npcs/${npcId}/avatar`
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, npcId, duration }, 'NPC not found');
      return c.json({ error: 'NPC not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to upload avatar');
    return c.json({ error: 'Failed to upload avatar', details: errorMessage }, 500);
  }
});

/**
 * GET /api/projects/:projectId/npcs/:npcId/avatar - Get NPC profile image
 */
npcRoutes.get('/:npcId/avatar', async (c) => {
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');

  if (!projectId || !npcId) {
    return c.json({ error: 'Project ID and NPC ID are required' }, 400);
  }

  try {
    const npc = await getDefinition(projectId, npcId);

    if (!npc.profile_image) {
      return c.json({ error: 'No avatar set' }, 404);
    }

    const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
    const filePath = path.join(npcDir, npc.profile_image);

    const fileBuffer = await fs.readFile(filePath);

    // Determine content type
    const ext = path.extname(npc.profile_image).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const contentType = contentTypes[ext] || 'image/png';

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'NPC not found' }, 404);
    }

    // File not found
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return c.json({ error: 'Avatar file not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage }, 'Failed to get avatar');
    return c.json({ error: 'Failed to get avatar' }, 500);
  }
});

/**
 * DELETE /api/projects/:projectId/npcs/:npcId/avatar - Delete NPC profile image
 */
npcRoutes.delete('/:npcId/avatar', async (c) => {
  const projectId = c.req.param('projectId');
  const npcId = c.req.param('npcId');

  if (!projectId || !npcId) {
    return c.json({ error: 'Project ID and NPC ID are required' }, 400);
  }

  try {
    const npc = await getDefinition(projectId, npcId);

    if (!npc.profile_image) {
      return c.json({ message: 'No avatar to delete' });
    }

    const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
    const filePath = path.join(npcDir, npc.profile_image);

    // Delete file
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Update NPC definition
    await updateDefinition(projectId, npcId, { profile_image: undefined });

    logger.info({ projectId, npcId }, 'NPC avatar deleted');

    return c.json({ message: 'Avatar deleted' });
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'NPC not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage }, 'Failed to delete avatar');
    return c.json({ error: 'Failed to delete avatar' }, 500);
  }
});
