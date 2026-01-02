import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import type { Memory, MoodVector } from '../types/npc.js';

const logger = createLogger('memory-system');

/**
 * Generate a unique memory ID
 */
export function generateMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new memory with generated ID and current timestamp
 */
export function createMemory(
  content: string,
  type: 'short_term' | 'long_term',
  salience: number = 0.5
): Memory {
  const memory: Memory = {
    id: generateMemoryId(),
    content,
    timestamp: new Date().toISOString(),
    salience: Math.max(0, Math.min(1, salience)), // Clamp to [0, 1]
    type,
  };

  logger.debug({ memoryId: memory.id, type, salience: memory.salience }, 'Memory created');

  return memory;
}

/**
 * Factors that influence salience scoring
 */
export interface SalienceFactors {
  /** Emotional intensity of the interaction (0-1) */
  emotionalIntensity: number;
  /** How directly the player was involved (0-1) */
  playerInvolvement: number;
  /** Novelty of the event compared to past experiences (0-1) */
  novelty: number;
  /** Whether a tool/action was invoked (0-1) */
  actionTaken: number;
  /** Current mood influences what we remember */
  currentMood?: MoodVector;
}

/**
 * Calculate salience score for a memory based on various factors.
 * High salience memories are more likely to be retained during pruning.
 *
 * Scoring weights:
 * - Emotional intensity: 35%
 * - Player involvement: 30%
 * - Novelty: 20%
 * - Action taken: 15%
 *
 * Mood modulation:
 * - High arousal increases overall salience
 * - Extreme valence (positive or negative) increases salience
 */
export function calculateSalience(factors: SalienceFactors): number {
  // Base weighted calculation
  let salience =
    factors.emotionalIntensity * 0.35 +
    factors.playerInvolvement * 0.3 +
    factors.novelty * 0.2 +
    factors.actionTaken * 0.15;

  // Mood modulation
  if (factors.currentMood) {
    // High arousal amplifies memory formation
    const arousalBonus = factors.currentMood.arousal * 0.1;

    // Extreme emotions (positive or negative) are more memorable
    const valenceExtremity = Math.abs(factors.currentMood.valence);
    const valenceBonus = valenceExtremity * 0.05;

    salience = salience * (1 + arousalBonus + valenceBonus);
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, salience));
}

/**
 * Retrieve memories from a collection, optionally filtered by type and sorted by salience.
 */
export function retrieveMemories(
  memories: Memory[],
  options: {
    type?: 'short_term' | 'long_term';
    minSalience?: number;
    maxCount?: number;
    sortBy?: 'salience' | 'timestamp';
  } = {}
): Memory[] {
  let filtered = [...memories];

  // Filter by type
  if (options.type) {
    filtered = filtered.filter((m) => m.type === options.type);
  }

  // Filter by minimum salience
  if (options.minSalience !== undefined) {
    const minSalience = options.minSalience;
    filtered = filtered.filter((m) => m.salience >= minSalience);
  }

  // Sort
  const sortBy = options.sortBy ?? 'salience';
  if (sortBy === 'salience') {
    filtered.sort((a, b) => b.salience - a.salience);
  } else {
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // Limit count
  if (options.maxCount !== undefined && options.maxCount > 0) {
    filtered = filtered.slice(0, options.maxCount);
  }

  return filtered;
}

/**
 * Retrieve short-term memories (most recent and salient)
 */
export function retrieveSTM(memories: Memory[], maxCount?: number): Memory[] {
  const config = getConfig();
  const limit = maxCount ?? config.limits.maxStmMemories;

  return retrieveMemories(memories, {
    type: 'short_term',
    maxCount: limit,
    sortBy: 'salience',
  });
}

/**
 * Retrieve long-term memories (most salient)
 */
export function retrieveLTM(memories: Memory[], maxCount?: number): Memory[] {
  const config = getConfig();
  const limit = maxCount ?? config.limits.maxLtmMemories;

  return retrieveMemories(memories, {
    type: 'long_term',
    maxCount: limit,
    sortBy: 'salience',
  });
}

/**
 * Result of a memory pruning operation
 */
export interface PruneResult {
  kept: Memory[];
  removed: Memory[];
  keptCount: number;
  removedCount: number;
}

/**
 * Prune memories to stay within limits, keeping highest salience memories.
 *
 * @param memories - Array of memories to prune
 * @param maxCount - Maximum number of memories to keep
 * @returns Object with kept and removed memories
 */
export function pruneMemories(memories: Memory[], maxCount: number): PruneResult {
  if (memories.length <= maxCount) {
    return {
      kept: memories,
      removed: [],
      keptCount: memories.length,
      removedCount: 0,
    };
  }

  // Sort by salience descending
  const sorted = [...memories].sort((a, b) => b.salience - a.salience);

  const kept = sorted.slice(0, maxCount);
  const removed = sorted.slice(maxCount);

  logger.debug(
    {
      originalCount: memories.length,
      keptCount: kept.length,
      removedCount: removed.length,
      minKeptSalience: kept[kept.length - 1]?.salience,
      maxRemovedSalience: removed[0]?.salience,
    },
    'Memories pruned'
  );

  return {
    kept,
    removed,
    keptCount: kept.length,
    removedCount: removed.length,
  };
}

/**
 * Prune short-term memories using configured limit
 */
export function pruneSTM(memories: Memory[]): PruneResult {
  const config = getConfig();
  const stmMemories = memories.filter((m) => m.type === 'short_term');
  return pruneMemories(stmMemories, config.limits.maxStmMemories);
}

/**
 * Prune long-term memories using configured limit
 */
export function pruneLTM(memories: Memory[]): PruneResult {
  const config = getConfig();
  const ltmMemories = memories.filter((m) => m.type === 'long_term');
  return pruneMemories(ltmMemories, config.limits.maxLtmMemories);
}

/**
 * Promote a memory from short-term to long-term.
 * Typically done for high-salience memories during weekly whisper.
 */
export function promoteToLTM(memory: Memory): Memory {
  if (memory.type === 'long_term') {
    return memory;
  }

  const promoted: Memory = {
    ...memory,
    type: 'long_term',
  };

  logger.debug({ memoryId: memory.id, salience: memory.salience }, 'Memory promoted to LTM');

  return promoted;
}

/**
 * Decay memory salience over time (optional mechanic for gradual forgetting).
 * Can be called periodically to simulate natural memory decay.
 *
 * @param memory - The memory to decay
 * @param decayFactor - Factor to multiply salience by (0-1), e.g., 0.95 for 5% decay
 * @param minSalience - Minimum salience floor (memories below this are candidates for removal)
 */
export function decayMemorySalience(
  memory: Memory,
  decayFactor: number = 0.95,
  minSalience: number = 0.1
): Memory {
  const newSalience = Math.max(minSalience, memory.salience * decayFactor);

  if (newSalience !== memory.salience) {
    logger.debug(
      { memoryId: memory.id, oldSalience: memory.salience, newSalience },
      'Memory salience decayed'
    );
  }

  return {
    ...memory,
    salience: newSalience,
  };
}

/**
 * Format memories for inclusion in a prompt context.
 * Returns a bulleted list of memory summaries.
 */
export function formatMemoriesForPrompt(memories: Memory[], maxEntries: number = 10): string {
  const selected = memories.slice(0, maxEntries);

  if (selected.length === 0) {
    return '';
  }

  const lines = selected.map((m) => `- ${m.content}`);
  return lines.join('\n');
}
