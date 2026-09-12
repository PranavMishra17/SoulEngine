import { createLogger } from '../logger.js';
import { matchMemoriesByQuery, retrieveSTM, retrieveLTM } from './memory.js';
import { resolveCategoryKnowledge } from './knowledge.js';
import { formatTier1Npc, formatTier2Npc, formatTier3Npc } from './context.js';
import { getStorage } from '../storage/factory.js';
import type { NPCDefinition, NPCInstance, Memory } from '../types/npc.js';
import type { KnowledgeBase } from '../types/knowledge.js';

type StorageAdapter = ReturnType<typeof getStorage>;

const logger = createLogger('recall-prefetch');

/**
 * Token budget for knowledge recall in single-call mode.
 * Constrains the total size of knowledge facts returned by the pre-fetch.
 */
export const RECALL_KNOWLEDGE_TOKEN_BUDGET = 1500;

/**
 * Recall memories matching a text query, for prefetching before a single-call generation.
 * Uses the same matcher as the recall_memories tool.
 *
 * @param instance - NPC instance with memory state
 * @param text - Query text (e.g., player input)
 * @param limit - Maximum memories to return
 * @returns Matching memories, ranked by overlap and salience
 */
export function recallMemoriesFor(instance: NPCInstance, text: string, limit: number): Memory[] {
  const stm = retrieveSTM(instance.short_term_memory);
  const ltm = retrieveLTM(instance.long_term_memory);
  const allMemories: Memory[] = [...stm, ...ltm];

  return matchMemoriesByQuery(allMemories, text, limit);
}

/**
 * Recall knowledge for a specific category.
 * Used by the recall_knowledge tool.
 *
 * @param definition - NPC definition with knowledge_access
 * @param knowledgeBase - Project knowledge base
 * @param category - Category ID or substring to match
 * @param tokenBudget - Maximum tokens for returned knowledge
 * @returns Formatted knowledge string, or empty if not found/not accessible
 */
export function recallKnowledgeByCategory(
  definition: NPCDefinition,
  knowledgeBase: KnowledgeBase | null,
  category: string,
  tokenBudget: number = RECALL_KNOWLEDGE_TOKEN_BUDGET,
): string {
  if (!knowledgeBase || !knowledgeBase.categories) {
    return '';
  }

  const queryCategory = category.toLowerCase();

  for (const [catId, cat] of Object.entries(knowledgeBase.categories)) {
    const idMatch = catId.toLowerCase().includes(queryCategory);
    const descMatch = cat.description?.toLowerCase().includes(queryCategory) ?? false;

    if (idMatch || descMatch) {
      const accessLevel = definition.knowledge_access?.[catId] ?? 0;
      if (accessLevel <= 0) {
        return '';
      }
      return resolveCategoryKnowledge(cat, accessLevel, tokenBudget);
    }
  }

  return '';
}

/**
 * Recall knowledge categories matching a text query.
 * Used by single-call runtime for pre-fetching based on player input.
 * Uses term-based matching: includes categories whose ID or description contains
 * any term from the input, resolved at the NPC's granted access level.
 *
 * @param definition - NPC definition with knowledge_access
 * @param knowledgeBase - Project knowledge base
 * @param text - Query text (e.g., player input)
 * @param tokenBudget - Maximum tokens for returned knowledge
 * @returns Formatted knowledge string, or empty if nothing matches
 */
export function recallKnowledgeFor(
  definition: NPCDefinition,
  knowledgeBase: KnowledgeBase | null,
  text: string,
  tokenBudget: number = RECALL_KNOWLEDGE_TOKEN_BUDGET,
): string {
  if (!knowledgeBase || !knowledgeBase.categories) {
    return '';
  }

  const terms = text
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  if (terms.length === 0) {
    return '';
  }

  const sections: string[] = [];
  let totalChars = 0;

  for (const [catId, category] of Object.entries(knowledgeBase.categories)) {
    const accessLevel = definition.knowledge_access?.[catId] ?? 0;
    if (accessLevel <= 0) {
      continue;
    }

    const idMatch = terms.some((term) => catId.toLowerCase().includes(term));
    const descMatch = terms.some(
      (term) => category.description?.toLowerCase().includes(term) ?? false,
    );

    if (idMatch || descMatch) {
      const resolved = resolveCategoryKnowledge(category, accessLevel, tokenBudget);
      if (resolved) {
        const description = category.description ? ` - ${category.description}` : '';
        const section = `- Category: ${catId}${description} (depth 1-${accessLevel})\n${resolved}`;

        const sectionChars = section.length;
        if (totalChars + sectionChars > tokenBudget * 4) {
          sections.push('[truncated]');
          break;
        }

        sections.push(section);
        totalChars += sectionChars;
      }
    }
  }

  return sections.join('\n');
}

/**
 * Recall a specific NPC from the network by exact name match.
 * Used by the recall_npc tool.
 *
 * @param definition - NPC definition with network
 * @param name - NPC name to look up (case-insensitive exact match)
 * @param storage - Storage instance for loading NPC definitions
 * @returns Formatted NPC info, or empty string if not found
 */
export async function recallNpcByName(
  definition: NPCDefinition,
  name: string,
  storage: StorageAdapter,
): Promise<string> {
  if (!definition.network || definition.network.length === 0) {
    return '';
  }

  const queryName = name.toLowerCase();

  for (const entry of definition.network) {
    try {
      const knownDef = await storage.getDefinition(definition.project_id, entry.npc_id);
      if (knownDef.name.toLowerCase() === queryName) {
        let formatted: string;
        switch (entry.familiarity_tier) {
          case 3:
            formatted = formatTier3Npc(knownDef);
            break;
          case 2:
            formatted = formatTier2Npc(knownDef);
            break;
          default:
            formatted = formatTier1Npc(knownDef);
            break;
        }
        return formatted;
      }
    } catch (err) {
      logger.warn(
        { npcId: entry.npc_id, error: err instanceof Error ? err.message : 'Unknown' },
        'Failed to load network NPC during recall',
      );
    }
  }

  return '';
}

/**
 * Recall NPCs from the network whose name appears in the text.
 * Used by single-call runtime for pre-fetching based on player input.
 *
 * @param definition - NPC definition with network
 * @param text - Query text (e.g., player input)
 * @param storage - Storage instance for loading NPC definitions
 * @returns Formatted NPC info, or empty string if no match
 */
export async function recallNpcsFor(
  definition: NPCDefinition,
  text: string,
  storage: StorageAdapter,
): Promise<string> {
  if (!definition.network || definition.network.length === 0) {
    return '';
  }

  const lowerText = text.toLowerCase();

  for (const entry of definition.network) {
    try {
      const knownDef = await storage.getDefinition(definition.project_id, entry.npc_id);
      const knownName = knownDef.name.toLowerCase();

      if (lowerText.includes(knownName)) {
        let formatted: string;
        switch (entry.familiarity_tier) {
          case 3:
            formatted = formatTier3Npc(knownDef);
            break;
          case 2:
            formatted = formatTier2Npc(knownDef);
            break;
          default:
            formatted = formatTier1Npc(knownDef);
            break;
        }
        return formatted;
      }
    } catch (err) {
      logger.warn(
        { npcId: entry.npc_id, error: err instanceof Error ? err.message : 'Unknown' },
        'Failed to load network NPC during recall prefetch',
      );
    }
  }

  return '';
}
