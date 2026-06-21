import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import {
  StorageNotFoundError,
  StorageValidationError,
  StorageLimitError,
} from '../storage/index.js';
import { getStorage } from '../storage/factory.js';
import { requireProjectOwnership } from '../middleware/ownership.js';

const logger = createLogger('routes-knowledge');

/**
 * Zod schemas for request validation
 */
const DepthsSchema = z.record(z.string(), z.string());

const KnowledgeCategorySchema = z.object({
  id: z.string().min(1).max(50),
  description: z.string().max(500).default(''),  // Description is optional
  depths: DepthsSchema,
});

const UpdateKnowledgeBaseSchema = z.object({
  categories: z.record(z.string(), KnowledgeCategorySchema),
});

/**
 * Knowledge routes
 */
export const knowledgeRoutes = new Hono();

/**
 * GET /api/projects/:projectId/knowledge - Get knowledge base
 */
knowledgeRoutes.get('/', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    const userId = c.get('userId') ?? null;
    const storage = getStorage(userId);

    // Verify project exists and ownership
    const project = await storage.getProject(projectId);
    const ownershipError = requireProjectOwnership(c, project);
    if (ownershipError) return ownershipError;

    const knowledgeBase = await storage.getKnowledgeBase(projectId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, categoryCount: Object.keys(knowledgeBase.categories).length, duration }, 'Knowledge base retrieved via API');

    return c.json(knowledgeBase);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to get knowledge base');
    return c.json({ error: 'Failed to get knowledge base', details: errorMessage }, 500);
  }
});

/**
 * PUT /api/projects/:projectId/knowledge - Update entire knowledge base
 */
knowledgeRoutes.put('/', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  try {
    const userId = c.get('userId') ?? null;
    const storage = getStorage(userId);

    // Verify project exists and ownership
    const project = await storage.getProject(projectId);
    const ownershipError = requireProjectOwnership(c, project);
    if (ownershipError) return ownershipError;

    const body = await c.req.json();
    const parsed = UpdateKnowledgeBaseSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ projectId, errors: parsed.error.issues }, 'Invalid update knowledge base request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    await storage.updateKnowledgeBase(projectId, parsed.data);

    const duration = Date.now() - startTime;
    logger.info({ projectId, categoryCount: Object.keys(parsed.data.categories).length, duration }, 'Knowledge base updated via API');

    return c.json({ message: 'Knowledge base updated', categories: Object.keys(parsed.data.categories) });
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
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update knowledge base');
    return c.json({ error: 'Failed to update knowledge base', details: errorMessage }, 500);
  }
});

// ---------------------------------------------------------------------------
// Batch category upsert
// ---------------------------------------------------------------------------

/**
 * Outer wrapper for batch category upsert.
 * Validates that items is a non-empty array; per-item validation happens below.
 */
const BatchUpsertOuterSchema = z.object({
  items: z.array(z.unknown()).min(1, 'items must have at least one element'),
});

/**
 * POST /api/projects/:projectId/knowledge/categories/batch
 *
 * Upsert multiple knowledge categories in a single request.
 * Each item is processed independently — an error on one does not prevent
 * others from being saved.
 *
 * Response body:
 *   { results: Array<{ index, id, status: 'upserted' } | { index, id, status: 'error', error }> }
 */
knowledgeRoutes.post('/categories/batch', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ error: 'Project ID is required' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate outer structure only
  const outerParsed = BatchUpsertOuterSchema.safeParse(body);
  if (!outerParsed.success) {
    logger.warn({ projectId, errors: outerParsed.error.issues }, 'Invalid batch upsert categories request');
    return c.json({ error: 'Invalid request', details: outerParsed.error.issues }, 400);
  }

  const userId = c.get('userId') ?? null;
  const storage = getStorage(userId);

  // Verify project exists and ownership
  try {
    const project = await storage.getProject(projectId);
    const ownershipError = requireProjectOwnership(c, project);
    if (ownershipError) return ownershipError;
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to verify project', details: errorMessage }, 500);
  }

  const results = await Promise.all(
    outerParsed.data.items.map(async (rawItem, index) => {
      // Per-item schema validation
      const itemParsed = KnowledgeCategorySchema.safeParse(rawItem);
      if (!itemParsed.success) {
        const id = (rawItem as Record<string, unknown>)?.id as string | undefined;
        return {
          index,
          id: id ?? `item_${index}`,
          status: 'error' as const,
          error: itemParsed.error.issues.map(i => i.message).join('; '),
        };
      }
      try {
        await storage.upsertCategory(projectId, itemParsed.data);
        return { index, id: itemParsed.data.id, status: 'upserted' as const };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn({ projectId, categoryId: itemParsed.data.id, index, error: errorMessage }, 'Batch upsert categories: item failed');
        return { index, id: itemParsed.data.id, status: 'error' as const, error: errorMessage };
      }
    })
  );

  const duration = Date.now() - startTime;
  const upserted = results.filter(r => r.status === 'upserted').length;
  logger.info({ projectId, total: results.length, upserted, duration }, 'Batch category upsert complete');

  return c.json({ results });
});

/**
 * GET /api/projects/:projectId/knowledge/categories/:categoryId - Get a specific category
 */
knowledgeRoutes.get('/categories/:categoryId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const categoryId = c.req.param('categoryId');

  if (!projectId || !categoryId) {
    return c.json({ error: 'Project ID and Category ID are required' }, 400);
  }

  try {
    const userId = c.get('userId') ?? null;
    const storage = getStorage(userId);

    // Verify project exists and ownership
    const project = await storage.getProject(projectId);
    const ownershipError = requireProjectOwnership(c, project);
    if (ownershipError) return ownershipError;

    const category = await storage.getCategory(projectId, categoryId);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, categoryId, duration }, 'Category retrieved via API');

    return c.json(category);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      if (error.message.includes('Category')) {
        logger.warn({ projectId, categoryId, duration }, 'Category not found');
        return c.json({ error: 'Category not found' }, 404);
      }
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, categoryId, error: errorMessage, duration }, 'Failed to get category');
    return c.json({ error: 'Failed to get category', details: errorMessage }, 500);
  }
});

/**
 * PUT /api/projects/:projectId/knowledge/categories/:categoryId - Upsert a category
 */
knowledgeRoutes.put('/categories/:categoryId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const categoryId = c.req.param('categoryId');

  if (!projectId || !categoryId) {
    return c.json({ error: 'Project ID and Category ID are required' }, 400);
  }

  try {
    const userId = c.get('userId') ?? null;
    const storage = getStorage(userId);

    // Verify project exists and ownership
    const project = await storage.getProject(projectId);
    const ownershipError = requireProjectOwnership(c, project);
    if (ownershipError) return ownershipError;

    const body = await c.req.json();

    // Add the category ID from the URL if not present
    const categoryData = { ...body, id: categoryId };
    const parsed = KnowledgeCategorySchema.safeParse(categoryData);

    if (!parsed.success) {
      logger.warn({ projectId, categoryId, errors: parsed.error.issues }, 'Invalid category request');
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const knowledgeBase = await storage.upsertCategory(projectId, parsed.data);

    const duration = Date.now() - startTime;
    logger.info({ projectId, categoryId, duration }, 'Category upserted via API');

    return c.json({ message: 'Category updated', category: knowledgeBase.categories[categoryId] });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    if (error instanceof StorageValidationError) {
      logger.warn({ projectId, categoryId, error: error.message, duration }, 'Validation error');
      return c.json({ error: 'Validation error', details: error.message }, 400);
    }

    if (error instanceof StorageLimitError) {
      logger.warn({ projectId, categoryId, error: error.message, duration }, 'Limit exceeded');
      return c.json({ error: 'Limit exceeded', details: error.message }, 400);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, categoryId, error: errorMessage, duration }, 'Failed to upsert category');
    return c.json({ error: 'Failed to upsert category', details: errorMessage }, 500);
  }
});

/**
 * DELETE /api/projects/:projectId/knowledge/categories/:categoryId - Delete a category
 */
knowledgeRoutes.delete('/categories/:categoryId', async (c) => {
  const startTime = Date.now();
  const projectId = c.req.param('projectId');
  const categoryId = c.req.param('categoryId');

  if (!projectId || !categoryId) {
    return c.json({ error: 'Project ID and Category ID are required' }, 400);
  }

  try {
    const userId = c.get('userId') ?? null;
    const storage = getStorage(userId);

    // Verify project exists and ownership
    const project = await storage.getProject(projectId);
    const ownershipError = requireProjectOwnership(c, project);
    if (ownershipError) return ownershipError;

    await storage.deleteCategory(projectId, categoryId);

    const duration = Date.now() - startTime;
    logger.info({ projectId, categoryId, duration }, 'Category deleted via API');

    return c.json({ message: 'Category deleted' });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof StorageNotFoundError) {
      if (error.message.includes('Category')) {
        logger.warn({ projectId, categoryId, duration }, 'Category not found');
        return c.json({ error: 'Category not found' }, 404);
      }
      logger.warn({ projectId, duration }, 'Project not found');
      return c.json({ error: 'Project not found' }, 404);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, categoryId, error: errorMessage, duration }, 'Failed to delete category');
    return c.json({ error: 'Failed to delete category', details: errorMessage }, 500);
  }
});
