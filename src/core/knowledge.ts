import { createLogger } from '../logger.js';
import type { KnowledgeBase, KnowledgeAccess, KnowledgeCategory } from '../types/knowledge.js';

const logger = createLogger('knowledge-resolver');

/**
 * Resolve knowledge content for a single category up to the specified depth level.
 * Returns all depth tiers from 1 up to and including the access level.
 */
function resolveCategoryKnowledge(category: KnowledgeCategory, accessLevel: number): string {
  const lines: string[] = [];

  // Get all depth keys and sort numerically
  const depthKeys = Object.keys(category.depths)
    .map(Number)
    .filter((key) => !isNaN(key) && key <= accessLevel)
    .sort((a, b) => a - b);

  for (const depth of depthKeys) {
    const content = category.depths[depth];
    if (content && content.trim()) {
      lines.push(`  - Depth ${depth}: ${content.trim()}`);
    }
  }

  return lines.join('\n');
}

/**
 * Resolve knowledge from a KnowledgeBase based on the NPC's access permissions.
 *
 * For each category in the access map, includes all depth tiers up to the granted level.
 * Returns a formatted string suitable for injection into the system prompt.
 *
 * @param knowledgeBase - The project's knowledge base containing all categories
 * @param access - Map of category IDs to depth access levels
 * @returns Formatted knowledge string for prompt injection
 */
export function resolveKnowledge(knowledgeBase: KnowledgeBase, access: KnowledgeAccess): string {
  if (!knowledgeBase || !knowledgeBase.categories) {
    logger.debug('Empty knowledge base provided');
    return '';
  }

  if (!access || Object.keys(access).length === 0) {
    logger.debug('No knowledge access permissions provided');
    return '';
  }

  const sections: string[] = [];
  const resolvedCategories: string[] = [];
  const skippedCategories: string[] = [];

  for (const [categoryId, accessLevel] of Object.entries(access)) {
    // Skip if access level is 0 or negative
    if (accessLevel <= 0) {
      skippedCategories.push(categoryId);
      continue;
    }

    const category = knowledgeBase.categories[categoryId];

    if (!category) {
      logger.warn({ categoryId }, 'Knowledge category not found in knowledge base');
      skippedCategories.push(categoryId);
      continue;
    }

    const categoryContent = resolveCategoryKnowledge(category, accessLevel);

    if (categoryContent) {
      const description = category.description ? ` - ${category.description}` : '';
      sections.push(`- Category: ${categoryId}${description} (depth 1-${accessLevel})\n${categoryContent}`);
      resolvedCategories.push(categoryId);
    }
  }

  if (sections.length === 0) {
    logger.debug({ access }, 'No knowledge content resolved');
    return '';
  }

  logger.debug(
    {
      resolvedCount: resolvedCategories.length,
      skippedCount: skippedCategories.length,
      categories: resolvedCategories,
    },
    'Knowledge resolved'
  );

  return sections.join('\n');
}

/**
 * Validate that a knowledge access map only references existing categories.
 *
 * @param knowledgeBase - The project's knowledge base
 * @param access - Map of category IDs to depth access levels
 * @returns Object with valid flag and any invalid category IDs
 */
export function validateKnowledgeAccess(
  knowledgeBase: KnowledgeBase,
  access: KnowledgeAccess
): { valid: boolean; invalidCategories: string[] } {
  const invalidCategories: string[] = [];

  for (const categoryId of Object.keys(access)) {
    if (!knowledgeBase.categories[categoryId]) {
      invalidCategories.push(categoryId);
    }
  }

  return {
    valid: invalidCategories.length === 0,
    invalidCategories,
  };
}

/**
 * Get available depth levels for a specific category.
 *
 * @param category - The knowledge category
 * @returns Sorted array of available depth numbers
 */
export function getAvailableDepths(category: KnowledgeCategory): number[] {
  return Object.keys(category.depths)
    .map(Number)
    .filter((key) => !isNaN(key))
    .sort((a, b) => a - b);
}
