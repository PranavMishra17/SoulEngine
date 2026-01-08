import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import type { NPCDefinition } from '../types/npc.js';
import { StorageError, StorageNotFoundError, StorageValidationError, StorageLimitError } from './interface.js';

const logger = createLogger('definition-storage');

/**
 * Generate a unique NPC ID
 */
function generateNpcId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `npc_${timestamp}_${random}`;
}

/**
 * Get the path to a project's definitions directory
 */
function getDefinitionsDir(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId, 'definitions');
}

/**
 * Get the path to a specific NPC definition file
 */
function getDefinitionPath(projectId: string, npcId: string): string {
  return path.join(getDefinitionsDir(projectId), `${npcId}.yaml`);
}

/**
 * Validate NPC definition structure
 */
function validateDefinition(def: NPCDefinition): void {
  if (!def.name || typeof def.name !== 'string') {
    throw new StorageValidationError('NPC definition must have a name');
  }

  if (!def.core_anchor) {
    throw new StorageValidationError('NPC definition must have a core_anchor');
  }

  if (!def.core_anchor.backstory || typeof def.core_anchor.backstory !== 'string') {
    throw new StorageValidationError('NPC core_anchor must have a backstory');
  }

  if (!Array.isArray(def.core_anchor.principles)) {
    throw new StorageValidationError('NPC core_anchor.principles must be an array');
  }

  if (!def.personality_baseline) {
    throw new StorageValidationError('NPC definition must have a personality_baseline');
  }

  const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  for (const trait of traits) {
    const value = def.personality_baseline[trait as keyof typeof def.personality_baseline];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new StorageValidationError(
        `NPC personality_baseline.${trait} must be a number between 0 and 1`
      );
    }
  }

  if (!def.voice || !def.voice.voice_id) {
    throw new StorageValidationError('NPC definition must have voice configuration with voice_id');
  }

  // Validate network (optional field, but if present must be valid)
  if (def.network) {
    if (!Array.isArray(def.network)) {
      throw new StorageValidationError('NPC network must be an array');
    }

    if (def.network.length > 5) {
      throw new StorageValidationError('NPC network cannot exceed 5 entries');
    }

    const seenIds = new Set<string>();
    for (const entry of def.network) {
      if (!entry.npc_id || typeof entry.npc_id !== 'string') {
        throw new StorageValidationError('Network entry must have valid npc_id');
      }

      if (![1, 2, 3].includes(entry.familiarity_tier)) {
        throw new StorageValidationError('Familiarity tier must be 1, 2, or 3');
      }

      // Validate bidirectional fields
      if (entry.mutual_awareness !== undefined && typeof entry.mutual_awareness !== 'boolean') {
        throw new StorageValidationError('Network entry mutual_awareness must be boolean');
      }
      if (entry.reverse_context && entry.reverse_context.length > 200) {
        throw new StorageValidationError('Network entry reverse_context too long (max 200)');
      }

      // Prevent self-reference
      if (entry.npc_id === def.id) {
        throw new StorageValidationError('NPC cannot know itself');
      }

      // Prevent duplicates
      if (seenIds.has(entry.npc_id)) {
        throw new StorageValidationError('Duplicate NPC in network');
      }
      seenIds.add(entry.npc_id);
    }
  }

  // Validate player recognition (optional field)
  if (def.player_recognition) {
    if (typeof def.player_recognition.can_know_player !== 'boolean') {
      throw new StorageValidationError('player_recognition.can_know_player must be boolean');
    }
    if (![1, 2, 3].includes(def.player_recognition.default_player_tier)) {
      throw new StorageValidationError('player_recognition.default_player_tier must be 1, 2, or 3');
    }
    if (typeof def.player_recognition.reveal_player_identity !== 'boolean') {
      throw new StorageValidationError('player_recognition.reveal_player_identity must be boolean');
    }
  }
}

/**
 * Count existing definitions in a project
 */
async function countDefinitions(projectId: string): Promise<number> {
  const defsDir = getDefinitionsDir(projectId);
  try {
    const entries = await fs.readdir(defsDir);
    return entries.filter(e => e.endsWith('.yaml')).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/**
 * Create a new NPC definition
 */
export async function createDefinition(
  projectId: string,
  definition: Omit<NPCDefinition, 'id' | 'project_id'>
): Promise<NPCDefinition> {
  const startTime = Date.now();
  const npcId = generateNpcId();
  const defsDir = getDefinitionsDir(projectId);
  const defPath = getDefinitionPath(projectId, npcId);

  try {
    // Check limit
    const config = getConfig();
    const currentCount = await countDefinitions(projectId);
    if (currentCount >= config.limits.maxNpcsPerProject) {
      throw new StorageLimitError(
        `Cannot create NPC: limit of ${config.limits.maxNpcsPerProject} NPCs per project reached`
      );
    }

    const fullDefinition: NPCDefinition = {
      ...definition,
      id: npcId,
      project_id: projectId,
    };

    // Validate before saving
    validateDefinition(fullDefinition);

    // Ensure directory exists
    await fs.mkdir(defsDir, { recursive: true });

    // Write definition file
    await fs.writeFile(defPath, yaml.dump(fullDefinition), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, name: definition.name, duration }, 'NPC definition created');

    return fullDefinition;
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageLimitError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to create NPC definition');
    throw new StorageError(`Failed to create NPC definition: ${errorMessage}`);
  }
}

/**
 * Get an NPC definition by ID
 */
export async function getDefinition(projectId: string, npcId: string): Promise<NPCDefinition> {
  const startTime = Date.now();
  const defPath = getDefinitionPath(projectId, npcId);

  try {
    const content = await fs.readFile(defPath, 'utf-8');
    const definition = yaml.load(content) as NPCDefinition;

    const duration = Date.now() - startTime;
    logger.debug({ projectId, npcId, duration }, 'NPC definition loaded');

    return definition;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn({ projectId, npcId, duration }, 'NPC definition not found');
      throw new StorageNotFoundError('NPC Definition', npcId);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to load NPC definition');
    throw new StorageError(`Failed to load NPC definition: ${errorMessage}`);
  }
}

/**
 * Update an NPC definition
 */
export async function updateDefinition(
  projectId: string,
  npcId: string,
  updates: Partial<Omit<NPCDefinition, 'id' | 'project_id'>>
): Promise<NPCDefinition> {
  const startTime = Date.now();

  try {
    const existing = await getDefinition(projectId, npcId);

    const updated: NPCDefinition = {
      ...existing,
      ...updates,
      id: existing.id,
      project_id: existing.project_id,
      // Deep merge for nested objects
      core_anchor: updates.core_anchor
        ? { ...existing.core_anchor, ...updates.core_anchor }
        : existing.core_anchor,
      personality_baseline: updates.personality_baseline
        ? { ...existing.personality_baseline, ...updates.personality_baseline }
        : existing.personality_baseline,
      voice: updates.voice
        ? { ...existing.voice, ...updates.voice }
        : existing.voice,
      mcp_permissions: updates.mcp_permissions
        ? { ...existing.mcp_permissions, ...updates.mcp_permissions }
        : existing.mcp_permissions,
    };

    // Validate before saving
    validateDefinition(updated);

    const defPath = getDefinitionPath(projectId, npcId);
    await fs.writeFile(defPath, yaml.dump(updated), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, duration }, 'NPC definition updated');

    return updated;
  } catch (error) {
    if (
      error instanceof StorageNotFoundError ||
      error instanceof StorageValidationError
    ) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to update NPC definition');
    throw new StorageError(`Failed to update NPC definition: ${errorMessage}`);
  }
}

/**
 * Delete an NPC definition
 */
export async function deleteDefinition(projectId: string, npcId: string): Promise<void> {
  const startTime = Date.now();
  const defPath = getDefinitionPath(projectId, npcId);

  try {
    // Verify it exists first
    await getDefinition(projectId, npcId);

    await fs.unlink(defPath);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, duration }, 'NPC definition deleted');
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to delete NPC definition');
    throw new StorageError(`Failed to delete NPC definition: ${errorMessage}`);
  }
}

/**
 * List all NPC definitions in a project
 */
export async function listDefinitions(projectId: string): Promise<NPCDefinition[]> {
  const startTime = Date.now();
  const defsDir = getDefinitionsDir(projectId);

  try {
    // Ensure directory exists
    await fs.mkdir(defsDir, { recursive: true });

    const entries = await fs.readdir(defsDir);
    const definitions: NPCDefinition[] = [];

    for (const entry of entries) {
      if (entry.endsWith('.yaml')) {
        const npcId = entry.replace('.yaml', '');
        try {
          const def = await getDefinition(projectId, npcId);
          definitions.push(def);
        } catch (error) {
          // Skip invalid definitions
          logger.warn({ projectId, npcId }, 'Skipping invalid NPC definition file');
        }
      }
    }

    // Sort alphabetically by name
    definitions.sort((a, b) => a.name.localeCompare(b.name));

    const duration = Date.now() - startTime;
    logger.debug({ projectId, count: definitions.length, duration }, 'NPC definitions listed');

    return definitions;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to list NPC definitions');
    throw new StorageError(`Failed to list NPC definitions: ${errorMessage}`);
  }
}

/**
 * Check if an NPC definition exists
 */
export async function definitionExists(projectId: string, npcId: string): Promise<boolean> {
  try {
    await getDefinition(projectId, npcId);
    return true;
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return false;
    }
    throw error;
  }
}

/**
 * Validate NPC ID format
 */
export function isValidNpcId(npcId: string): boolean {
  return /^npc_[a-z0-9]+_[a-z0-9]+$/.test(npcId);
}
