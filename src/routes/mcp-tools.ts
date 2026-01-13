import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  getMCPTools,
  saveMCPTools,
  getProject,
  StorageNotFoundError,
  StorageValidationError,
  type ProjectMCPTools,
} from '../storage/index.js';

const logger = createLogger('routes-mcp-tools');

/**
 * Zod schema for MCP tool parameter property (JSON Schema format)
 */
const ParameterPropertySchema = z.object({
  type: z.string(),
  description: z.string().optional(),
});

/**
 * Zod schema for MCP tool
 */
const MCPToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z
    .object({
      type: z.string(),
      properties: z.record(z.string(), ParameterPropertySchema).optional(),
      required: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * Zod schema for updating MCP tools
 */
const UpdateMCPToolsSchema = z.object({
  conversation_tools: z.array(MCPToolSchema),
  game_event_tools: z.array(MCPToolSchema),
});

/**
 * MCP tools routes
 */
export const mcpToolsRoutes = new Hono();

/**
 * GET /api/projects/:projectId/mcp-tools - Get MCP tools for a project
 */
mcpToolsRoutes.get('/', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    // Verify project exists
    await getProject(projectId);

    const tools = await getMCPTools(projectId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'MCP tools retrieved via API');

    return c.json(tools);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to get MCP tools');
    return c.json({ error: 'Failed to get MCP tools', details: errorMessage }, 500);
  }
});

/**
 * PUT /api/projects/:projectId/mcp-tools - Update MCP tools for a project
 */
mcpToolsRoutes.put('/', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    // Verify project exists
    await getProject(projectId);

    const body = await c.req.json();
    const parsed = UpdateMCPToolsSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, errors: parsed.error.issues }, 'Invalid MCP tools update request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    await saveMCPTools(projectId, parsed.data as ProjectMCPTools);

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'MCP tools updated via API');

    return c.json({
      message: 'MCP tools updated',
      conversation_tools: parsed.data.conversation_tools.length,
      game_event_tools: parsed.data.game_event_tools.length,
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
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update MCP tools');
    return c.json({ error: 'Failed to update MCP tools', details: errorMessage }, 500);
  }
});
