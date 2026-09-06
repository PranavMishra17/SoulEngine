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
 * Words too common to carry meaning. Matching on these would make every query
 * return every memory, which is the mirror image of matching on nothing.
 */
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'you', 'your', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'with', 'from', 'about', 'what', 'when', 'where',
  'who', 'whom', 'why', 'how', 'has', 'have', 'had', 'did', 'does', 'not', 'but',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
]);

/** Split free text into meaningful lowercase terms. */
function queryTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .map((t) => t.replace(/^'+|'+$/g, ''))
        .filter((t) => t.length >= 3 && !QUERY_STOPWORDS.has(t))
    )
  );
}

/**
 * Find memories relevant to a free-text query.
 *
 * The Mind emits natural-language queries, so the previous approach — using the
 * entire query as one substring needle — essentially never matched: a whole
 * sentence is not a substring of a stored memory. Scoring on shared terms and
 * ranking by overlap, then salience, is the smallest change that makes recall
 * work at all. Semantic retrieval is a separate, larger piece of work
 * (backlog 6.6); this is deliberately deterministic and dependency-free.
 *
 * Returns an empty array when nothing matches, so callers can tell "found
 * nothing" from "found something" without parsing a sentence.
 */
export function matchMemoriesByQuery(
  memories: Memory[],
  query: string,
  maxCount: number = 5
): Memory[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const scored = memories
    .map((memory) => {
      const content = memory.content.toLowerCase();
      const overlap = terms.filter((term) => content.includes(term)).length;
      return { memory, overlap };
    })
    .filter((entry) => entry.overlap > 0);

  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return b.memory.salience - a.memory.salience;
  });

  return scored.slice(0, Math.max(0, maxCount)).map((entry) => entry.memory);
}

/**
 * Slots reserved for the most recent memories, regardless of how strongly they
 * were felt.
 *
 * Selecting purely by salience meant a character could not recall something
 * said moments earlier if an older, more dramatic memory outscored it. That is
 * the opposite of how being remembered feels to a player, and it is what made
 * an NPC holding thirteen memories about someone greet them as a stranger.
 * See ERR-025.
 */
const RECENCY_SLOTS = 3;

/**
 * Choose which memories go into a prompt.
 *
 * Recency first, then significance, then no repeats:
 *
 *  1. Up to RECENCY_SLOTS of the newest memories are always included, so the
 *     last things that happened are never crowded out.
 *  2. Remaining slots go to the most salient of what is left, so a defining
 *     event still surfaces long after it happened.
 *  3. A memory occupies at most one slot. A promoted memory can exist in both
 *     the short- and long-term stores, and rendering it twice wasted a slot
 *     while making the character look like it had only one memory.
 *
 * Returns fewest-first by nothing in particular; callers format the list.
 */
export function selectMemoriesForPrompt(
  shortTerm: Memory[],
  longTerm: Memory[],
  maxMemories: number
): Memory[] {
  if (maxMemories <= 0) return [];

  // Deduplicate by id, preferring the short-term copy so its timestamp is used.
  const byId = new Map<string, Memory>();
  for (const memory of [...longTerm, ...shortTerm]) {
    byId.set(memory.id, memory);
  }
  const candidates = Array.from(byId.values());
  if (candidates.length <= maxMemories) return candidates;

  const chosen = new Map<string, Memory>();

  const newestFirst = [...candidates].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  for (const memory of newestFirst.slice(0, Math.min(RECENCY_SLOTS, maxMemories))) {
    chosen.set(memory.id, memory);
  }

  const mostSalientFirst = [...candidates].sort((a, b) => b.salience - a.salience);
  for (const memory of mostSalientFirst) {
    if (chosen.size >= maxMemories) break;
    chosen.set(memory.id, memory);
  }

  return Array.from(chosen.values());
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
