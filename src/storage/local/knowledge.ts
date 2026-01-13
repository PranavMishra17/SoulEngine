import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createLogger } from '../../logger.js';
import { getConfig } from '../../config.js';
import type { KnowledgeBase, KnowledgeCategory } from '../../types/knowledge.js';
import { StorageError, StorageNotFoundError, StorageValidationError, StorageLimitError } from '../interface.js';

const logger = createLogger('knowledge-storage');

/**
 * Get the path to a project's knowledge base file
 */
function getKnowledgePath(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId, 'knowledge_base.yaml');
}

/**
 * Validate knowledge base structure
 */
function validateKnowledgeBase(kb: KnowledgeBase): void {
  const config = getConfig();

  if (!kb.categories || typeof kb.categories !== 'object') {
    throw new StorageValidationError('Knowledge base must have a categories object');
  }

  const categoryCount = Object.keys(kb.categories).length;
  if (categoryCount > config.limits.maxCategories) {
    throw new StorageLimitError(
      `Category count (${categoryCount}) exceeds limit (${config.limits.maxCategories})`
    );
  }

  for (const [categoryId, category] of Object.entries(kb.categories)) {
    validateCategory(categoryId, category);
  }
}

/**
 * Validate a single category
 */
function validateCategory(categoryId: string, category: KnowledgeCategory): void {
  const config = getConfig();

  if (!category.id || category.id !== categoryId) {
    throw new StorageValidationError(`Category ID mismatch: ${categoryId}`);
  }

  // Description is optional, but if provided must be a string
  if (category.description !== undefined && typeof category.description !== 'string') {
    throw new StorageValidationError(`Category ${categoryId} description must be a string`);
  }

  if (!category.depths || typeof category.depths !== 'object') {
    throw new StorageValidationError(`Category ${categoryId} must have depths object`);
  }

  const depthCount = Object.keys(category.depths).length;
  if (depthCount > config.limits.maxDepthTiers) {
    throw new StorageLimitError(
      `Depth tier count (${depthCount}) for category ${categoryId} exceeds limit (${config.limits.maxDepthTiers})`
    );
  }

  // Validate depth keys are numbers
  for (const key of Object.keys(category.depths)) {
    const depthNum = parseInt(key, 10);
    if (isNaN(depthNum) || depthNum < 0) {
      throw new StorageValidationError(
        `Invalid depth key '${key}' in category ${categoryId}. Must be a non-negative integer.`
      );
    }
  }
}

/**
 * Get the knowledge base for a project
 */
export async function getKnowledgeBase(projectId: string): Promise<KnowledgeBase> {
  const startTime = Date.now();
  const kbPath = getKnowledgePath(projectId);

  try {
    const content = await fs.readFile(kbPath, 'utf-8');
    const kb = yaml.load(content) as KnowledgeBase;

    // Ensure categories exists
    if (!kb.categories) {
      kb.categories = {};
    }

    const duration = Date.now() - startTime;
    logger.debug(
      { projectId, categoryCount: Object.keys(kb.categories).length, duration },
      'Knowledge base loaded'
    );

    return kb;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Return empty knowledge base if file doesn't exist
      logger.debug({ projectId, duration }, 'No knowledge base file, returning empty');
      return { categories: {} };
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to load knowledge base');
    throw new StorageError(`Failed to load knowledge base: ${errorMessage}`);
  }
}

/**
 * Update the entire knowledge base for a project
 */
export async function updateKnowledgeBase(
  projectId: string,
  knowledgeBase: KnowledgeBase
): Promise<void> {
  const startTime = Date.now();
  const kbPath = getKnowledgePath(projectId);

  try {
    // Validate before saving
    validateKnowledgeBase(knowledgeBase);

    await fs.writeFile(kbPath, yaml.dump(knowledgeBase), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info(
      { projectId, categoryCount: Object.keys(knowledgeBase.categories).length, duration },
      'Knowledge base updated'
    );
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageLimitError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update knowledge base');
    throw new StorageError(`Failed to update knowledge base: ${errorMessage}`);
  }
}

/**
 * Add or update a category in the knowledge base
 */
export async function upsertCategory(
  projectId: string,
  category: KnowledgeCategory
): Promise<KnowledgeBase> {
  const startTime = Date.now();

  try {
    const kb = await getKnowledgeBase(projectId);

    // Validate the category
    validateCategory(category.id, category);

    // Check limit if adding new category
    const config = getConfig();
    const isNew = !(category.id in kb.categories);
    if (isNew && Object.keys(kb.categories).length >= config.limits.maxCategories) {
      throw new StorageLimitError(
        `Cannot add category: limit of ${config.limits.maxCategories} categories reached`
      );
    }

    kb.categories[category.id] = category;
    await updateKnowledgeBase(projectId, kb);

    const duration = Date.now() - startTime;
    logger.info(
      { projectId, categoryId: category.id, isNew, duration },
      'Category upserted'
    );

    return kb;
  } catch (error) {
    if (
      error instanceof StorageValidationError ||
      error instanceof StorageLimitError ||
      error instanceof StorageError
    ) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to upsert category');
    throw new StorageError(`Failed to upsert category: ${errorMessage}`);
  }
}

/**
 * Delete a category from the knowledge base
 */
export async function deleteCategory(
  projectId: string,
  categoryId: string
): Promise<KnowledgeBase> {
  const startTime = Date.now();

  try {
    const kb = await getKnowledgeBase(projectId);

    if (!(categoryId in kb.categories)) {
      throw new StorageNotFoundError('Category', categoryId);
    }

    delete kb.categories[categoryId];
    await updateKnowledgeBase(projectId, kb);

    const duration = Date.now() - startTime;
    logger.info({ projectId, categoryId, duration }, 'Category deleted');

    return kb;
  } catch (error) {
    if (
      error instanceof StorageNotFoundError ||
      error instanceof StorageError
    ) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, categoryId, error: errorMessage, duration }, 'Failed to delete category');
    throw new StorageError(`Failed to delete category: ${errorMessage}`);
  }
}

/**
 * Get a specific category from the knowledge base
 */
export async function getCategory(
  projectId: string,
  categoryId: string
): Promise<KnowledgeCategory> {
  const kb = await getKnowledgeBase(projectId);

  if (!(categoryId in kb.categories)) {
    throw new StorageNotFoundError('Category', categoryId);
  }

  return kb.categories[categoryId];
}

/**
 * List all category IDs in a project's knowledge base
 */
export async function listCategoryIds(projectId: string): Promise<string[]> {
  const kb = await getKnowledgeBase(projectId);
  return Object.keys(kb.categories);
}
