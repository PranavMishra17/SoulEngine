import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import type { KnowledgeBase, KnowledgeCategory } from '../../types/knowledge.js';
import { StorageError, StorageNotFoundError, StorageValidationError, StorageLimitError } from '../interface.js';
import { getConfig } from '../../config.js';

const logger = createLogger('supabase-knowledge');

/**
 * Validate a single category
 */
function validateCategory(category: KnowledgeCategory): void {
  const config = getConfig();

  if (!category.id || typeof category.id !== 'string') {
    throw new StorageValidationError('Category must have an id');
  }

  if (category.description !== undefined && typeof category.description !== 'string') {
    throw new StorageValidationError(`Category ${category.id} description must be a string`);
  }

  if (!category.depths || typeof category.depths !== 'object') {
    throw new StorageValidationError(`Category ${category.id} must have depths object`);
  }

  const depthCount = Object.keys(category.depths).length;
  if (depthCount > config.limits.maxDepthTiers) {
    throw new StorageLimitError(
      `Depth tier count (${depthCount}) for category ${category.id} exceeds limit (${config.limits.maxDepthTiers})`
    );
  }
}

/**
 * Convert database rows to KnowledgeBase format
 */
function rowsToKnowledgeBase(rows: Array<{ name: string; entries: unknown }>): KnowledgeBase {
  const categories: Record<string, KnowledgeCategory> = {};
  
  for (const row of rows) {
    // Convert entries array to depths object
    // Entries are stored as [{depth, content}] - we concatenate content at same depth
    const entries = row.entries as Array<{ depth: number; content: string }> || [];
    const depths: Record<number, string> = {};
    
    for (const entry of entries) {
      if (!depths[entry.depth]) {
        depths[entry.depth] = entry.content;
      } else {
        // Concatenate multiple entries at same depth with newline
        depths[entry.depth] += '\n' + entry.content;
      }
    }
    
    categories[row.name] = {
      id: row.name,
      description: '',
      depths,
    };
  }
  
  return { categories };
}

/**
 * Convert KnowledgeCategory to database entry format
 */
function categoryToEntries(category: KnowledgeCategory): Array<{ depth: number; content: string }> {
  const entries: Array<{ depth: number; content: string }> = [];
  
  for (const [depthStr, content] of Object.entries(category.depths)) {
    const depth = parseInt(depthStr, 10);
    // Each depth level has a single string content
    entries.push({ depth, content });
  }
  
  return entries;
}

/**
 * Get the knowledge base for a project
 */
export async function getKnowledgeBase(projectId: string): Promise<KnowledgeBase> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('knowledge_categories')
      .select('name, entries')
      .eq('project_id', projectId);

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const kb = rowsToKnowledgeBase(data || []);

    const duration = Date.now() - startTime;
    logger.debug(
      { projectId, categoryCount: Object.keys(kb.categories).length, duration },
      'Knowledge base loaded'
    );

    return kb;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const config = getConfig();
    const categoryCount = Object.keys(knowledgeBase.categories).length;
    
    if (categoryCount > config.limits.maxCategories) {
      throw new StorageLimitError(
        `Category count (${categoryCount}) exceeds limit (${config.limits.maxCategories})`
      );
    }

    // Validate all categories
    for (const category of Object.values(knowledgeBase.categories)) {
      validateCategory(category);
    }

    // Delete all existing categories for this project
    const { error: deleteError } = await supabase
      .from('knowledge_categories')
      .delete()
      .eq('project_id', projectId);

    if (deleteError) {
      throw new StorageError(`Database error: ${deleteError.message}`);
    }

    // Insert all new categories
    if (categoryCount > 0) {
      const inserts = Object.entries(knowledgeBase.categories).map(([name, category]) => ({
        project_id: projectId,
        name,
        entries: categoryToEntries(category),
      }));

      const { error: insertError } = await supabase
        .from('knowledge_categories')
        .insert(inserts);

      if (insertError) {
        throw new StorageError(`Database error: ${insertError.message}`);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      { projectId, categoryCount, duration },
      'Knowledge base updated'
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageValidationError || error instanceof StorageLimitError || error instanceof StorageError) {
      throw error;
    }
    
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
  const supabase = getSupabaseAdmin();

  try {
    validateCategory(category);

    // Check limit if adding new category
    const { count, error: countError } = await supabase
      .from('knowledge_categories')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (countError) {
      throw new StorageError(`Database error: ${countError.message}`);
    }

    // Check if category exists
    const { data: existing } = await supabase
      .from('knowledge_categories')
      .select('id')
      .eq('project_id', projectId)
      .eq('name', category.id)
      .single();

    const config = getConfig();
    if (!existing && (count || 0) >= config.limits.maxCategories) {
      throw new StorageLimitError(
        `Cannot add category: limit of ${config.limits.maxCategories} categories reached`
      );
    }

    // Upsert the category
    const { error } = await supabase
      .from('knowledge_categories')
      .upsert({
        project_id: projectId,
        name: category.id,
        entries: categoryToEntries(category),
      }, {
        onConflict: 'project_id,name',
      });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const kb = await getKnowledgeBase(projectId);

    const duration = Date.now() - startTime;
    logger.info(
      { projectId, categoryId: category.id, isNew: !existing, duration },
      'Category upserted'
    );

    return kb;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageValidationError || error instanceof StorageLimitError || error instanceof StorageError) {
      throw error;
    }
    
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
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('knowledge_categories')
      .delete()
      .eq('project_id', projectId)
      .eq('name', categoryId)
      .select();

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new StorageNotFoundError('Category', categoryId);
    }

    const kb = await getKnowledgeBase(projectId);

    const duration = Date.now() - startTime;
    logger.info({ projectId, categoryId, duration }, 'Category deleted');

    return kb;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('knowledge_categories')
    .select('name, entries')
    .eq('project_id', projectId)
    .eq('name', categoryId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new StorageNotFoundError('Category', categoryId);
    }
    throw new StorageError(`Database error: ${error.message}`);
  }

  const entries = data.entries as Array<{ depth: number; content: string }> || [];
  const depths: Record<number, string> = {};
  
  for (const entry of entries) {
    if (!depths[entry.depth]) {
      depths[entry.depth] = entry.content;
    } else {
      depths[entry.depth] += '\n' + entry.content;
    }
  }

  return {
    id: data.name,
    description: '',
    depths,
  };
}

/**
 * List all category IDs in a project's knowledge base
 */
export async function listCategoryIds(projectId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('knowledge_categories')
    .select('name')
    .eq('project_id', projectId);

  if (error) {
    throw new StorageError(`Database error: ${error.message}`);
  }

  return (data || []).map(row => row.name);
}
