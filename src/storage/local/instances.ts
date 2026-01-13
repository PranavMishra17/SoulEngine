import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../logger.js';
import { getConfig } from '../../config.js';
import type { NPCInstance, NPCDefinition, MoodVector } from '../../types/npc.js';
import { StorageError, StorageNotFoundError, StorageVersion, StorageVersionResult } from '../interface.js';
import { getDefinition } from './definitions.js';

const logger = createLogger('instance-storage');

/**
 * Generate a unique instance ID
 */
function generateInstanceId(npcId: string, playerId: string): string {
  // Instance ID is deterministic based on NPC and player
  const hash = Buffer.from(`${npcId}:${playerId}`).toString('base64url').substring(0, 12);
  return `inst_${hash}`;
}

/**
 * Get the path to a project's instances directory
 */
function getInstancesDir(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId, 'instances');
}

/**
 * Get the path to a specific instance directory
 */
function getInstanceDir(projectId: string, instanceId: string): string {
  return path.join(getInstancesDir(projectId), instanceId);
}

/**
 * Get the path to the current instance state file
 */
function getCurrentStatePath(projectId: string, instanceId: string): string {
  return path.join(getInstanceDir(projectId, instanceId), 'current.json');
}

/**
 * Get the path to the history directory for an instance
 */
function getHistoryDir(projectId: string, instanceId: string): string {
  return path.join(getInstanceDir(projectId, instanceId), 'history');
}

/**
 * Create an initial instance from a definition
 */
function createInitialInstance(
  definition: NPCDefinition,
  playerId: string,
  instanceId: string
): NPCInstance {
  const neutralMood: MoodVector = {
    valence: 0.5,
    arousal: 0.5,
    dominance: 0.5,
  };

  return {
    id: instanceId,
    definition_id: definition.id,
    project_id: definition.project_id,
    player_id: playerId,
    created_at: new Date().toISOString(),
    current_mood: neutralMood,
    trait_modifiers: {},
    short_term_memory: [],
    long_term_memory: [],
    relationships: {},
    daily_pulse: null,
    cycle_metadata: {
      last_weekly: null,
      last_persona_shift: null,
    },
  };
}

/**
 * Generate a version timestamp for history
 */
function generateVersionTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Archive the current state to history
 */
async function archiveCurrentState(
  projectId: string,
  instanceId: string
): Promise<string | null> {
  const config = getConfig();

  if (!config.stateHistoryEnabled) {
    return null;
  }

  const currentPath = getCurrentStatePath(projectId, instanceId);
  const historyDir = getHistoryDir(projectId, instanceId);

  try {
    // Check if current state exists
    await fs.access(currentPath);

    // Ensure history directory exists
    await fs.mkdir(historyDir, { recursive: true });

    // Generate version filename
    const version = generateVersionTimestamp();
    const historyPath = path.join(historyDir, `${version}.json`);

    // Copy current to history
    await fs.copyFile(currentPath, historyPath);

    // Prune old history
    await pruneHistory(projectId, instanceId, config.stateHistoryMaxVersions);

    logger.debug({ projectId, instanceId, version }, 'State archived');
    return version;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // No current state to archive
      return null;
    }
    throw error;
  }
}

/**
 * Prune old history versions to stay within limit
 */
async function pruneHistory(
  projectId: string,
  instanceId: string,
  maxVersions: number
): Promise<void> {
  const historyDir = getHistoryDir(projectId, instanceId);

  try {
    const entries = await fs.readdir(historyDir);
    const jsonFiles = entries.filter(e => e.endsWith('.json')).sort();

    // Remove oldest files if over limit
    const toRemove = jsonFiles.slice(0, Math.max(0, jsonFiles.length - maxVersions));

    for (const file of toRemove) {
      await fs.unlink(path.join(historyDir, file));
      logger.debug({ projectId, instanceId, file }, 'Old history version removed');
    }
  } catch (error) {
    // Ignore errors during pruning
    logger.warn({ projectId, instanceId, error }, 'Error pruning history');
  }
}

/**
 * Get an instance by ID
 */
export async function getInstance(
  projectId: string,
  instanceId: string
): Promise<NPCInstance> {
  const startTime = Date.now();
  const currentPath = getCurrentStatePath(projectId, instanceId);

  try {
    const content = await fs.readFile(currentPath, 'utf-8');
    const instance = JSON.parse(content) as NPCInstance;

    const duration = Date.now() - startTime;
    logger.debug({ projectId, instanceId, duration }, 'Instance loaded');

    return instance;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn({ projectId, instanceId, duration }, 'Instance not found');
      throw new StorageNotFoundError('Instance', instanceId);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, instanceId, error: errorMessage, duration }, 'Failed to load instance');
    throw new StorageError(`Failed to load instance: ${errorMessage}`);
  }
}

/**
 * Get or create an instance for a player
 */
export async function getOrCreateInstance(
  projectId: string,
  npcId: string,
  playerId: string
): Promise<NPCInstance> {
  const startTime = Date.now();
  const instanceId = generateInstanceId(npcId, playerId);

  try {
    // Try to get existing instance
    const existing = await getInstance(projectId, instanceId);
    logger.debug({ projectId, instanceId, playerId, duration: Date.now() - startTime }, 'Existing instance found');
    return existing;
  } catch (error) {
    if (!(error instanceof StorageNotFoundError)) {
      throw error;
    }
  }

  // Create new instance from definition
  try {
    const definition = await getDefinition(projectId, npcId);
    const instance = createInitialInstance(definition, playerId, instanceId);

    // Save the new instance
    const instanceDir = getInstanceDir(projectId, instanceId);
    await fs.mkdir(instanceDir, { recursive: true });

    const currentPath = getCurrentStatePath(projectId, instanceId);
    await fs.writeFile(currentPath, JSON.stringify(instance, null, 2), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, npcId, playerId, duration }, 'New instance created');

    return instance;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, playerId, error: errorMessage, duration }, 'Failed to create instance');
    throw new StorageError(`Failed to create instance: ${errorMessage}`);
  }
}

/**
 * Save an instance state (with optional history archival)
 */
export async function saveInstance(
  instance: NPCInstance
): Promise<StorageVersionResult> {
  const startTime = Date.now();
  const { project_id: projectId, id: instanceId } = instance;

  try {
    // Archive current state before overwriting
    const archivedVersion = await archiveCurrentState(projectId, instanceId);

    // Ensure directory exists
    const instanceDir = getInstanceDir(projectId, instanceId);
    await fs.mkdir(instanceDir, { recursive: true });

    // Write new state
    const currentPath = getCurrentStatePath(projectId, instanceId);
    await fs.writeFile(currentPath, JSON.stringify(instance, null, 2), 'utf-8');

    const version = generateVersionTimestamp();
    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, version, archivedVersion, duration }, 'Instance saved');

    return {
      version,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, instanceId, error: errorMessage, duration }, 'Failed to save instance');
    throw new StorageError(`Failed to save instance: ${errorMessage}`);
  }
}

/**
 * Get version history for an instance
 */
export async function getInstanceHistory(
  projectId: string,
  instanceId: string
): Promise<StorageVersion[]> {
  const startTime = Date.now();
  const historyDir = getHistoryDir(projectId, instanceId);

  try {
    const entries = await fs.readdir(historyDir);
    const versions: StorageVersion[] = [];

    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        const version = entry.replace('.json', '');
        const stat = await fs.stat(path.join(historyDir, entry));

        versions.push({
          version,
          timestamp: stat.mtime.toISOString(),
          filename: entry,
        });
      }
    }

    // Sort by version (which is timestamp-based), newest first
    versions.sort((a, b) => b.version.localeCompare(a.version));

    const duration = Date.now() - startTime;
    logger.debug({ projectId, instanceId, count: versions.length, duration }, 'Instance history loaded');

    return versions;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug({ projectId, instanceId, duration }, 'No history directory found');
      return [];
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, instanceId, error: errorMessage, duration }, 'Failed to get instance history');
    throw new StorageError(`Failed to get instance history: ${errorMessage}`);
  }
}

/**
 * Rollback an instance to a previous version
 */
export async function rollbackInstance(
  projectId: string,
  instanceId: string,
  version: string
): Promise<NPCInstance> {
  const startTime = Date.now();
  const historyDir = getHistoryDir(projectId, instanceId);
  const historyPath = path.join(historyDir, `${version}.json`);

  try {
    // Read the historical version
    const content = await fs.readFile(historyPath, 'utf-8');
    const historicalInstance = JSON.parse(content) as NPCInstance;

    // Save it as the current state (this will archive the current state first)
    await saveInstance(historicalInstance);

    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, version, duration }, 'Instance rolled back');

    return historicalInstance;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn({ projectId, instanceId, version, duration }, 'History version not found');
      throw new StorageNotFoundError('Instance version', version);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, instanceId, version, error: errorMessage, duration }, 'Failed to rollback instance');
    throw new StorageError(`Failed to rollback instance: ${errorMessage}`);
  }
}

/**
 * Delete an instance and all its history
 */
export async function deleteInstance(projectId: string, instanceId: string): Promise<void> {
  const startTime = Date.now();
  const instanceDir = getInstanceDir(projectId, instanceId);

  try {
    // Verify it exists first
    await getInstance(projectId, instanceId);

    // Remove entire instance directory
    await fs.rm(instanceDir, { recursive: true, force: true });

    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, duration }, 'Instance deleted');
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, instanceId, error: errorMessage, duration }, 'Failed to delete instance');
    throw new StorageError(`Failed to delete instance: ${errorMessage}`);
  }
}

/**
 * List all instances for a project
 */
export async function listInstances(projectId: string): Promise<NPCInstance[]> {
  const startTime = Date.now();
  const instancesDir = getInstancesDir(projectId);

  try {
    // Ensure directory exists
    await fs.mkdir(instancesDir, { recursive: true });

    const entries = await fs.readdir(instancesDir, { withFileTypes: true });
    const instances: NPCInstance[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('inst_')) {
        try {
          const instance = await getInstance(projectId, entry.name);
          instances.push(instance);
        } catch (error) {
          // Skip invalid instances
          logger.warn({ projectId, instanceId: entry.name }, 'Skipping invalid instance directory');
        }
      }
    }

    // Sort by creation date, newest first
    instances.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const duration = Date.now() - startTime;
    logger.debug({ projectId, count: instances.length, duration }, 'Instances listed');

    return instances;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to list instances');
    throw new StorageError(`Failed to list instances: ${errorMessage}`);
  }
}

/**
 * List instances for a specific NPC definition
 */
export async function listInstancesForNpc(
  projectId: string,
  npcId: string
): Promise<NPCInstance[]> {
  const allInstances = await listInstances(projectId);
  return allInstances.filter(inst => inst.definition_id === npcId);
}

/**
 * List instances for a specific player
 */
export async function listInstancesForPlayer(
  projectId: string,
  playerId: string
): Promise<NPCInstance[]> {
  const allInstances = await listInstances(projectId);
  return allInstances.filter(inst => inst.player_id === playerId);
}

/**
 * Check if an instance exists
 */
export async function instanceExists(projectId: string, instanceId: string): Promise<boolean> {
  try {
    await getInstance(projectId, instanceId);
    return true;
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return false;
    }
    throw error;
  }
}
