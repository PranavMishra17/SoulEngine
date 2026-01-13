import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import type { NPCInstance, NPCDefinition, MoodVector } from '../../types/npc.js';
import { StorageError, StorageNotFoundError, StorageVersion, StorageVersionResult } from '../interface.js';
import { getDefinition } from './definitions.js';
import { getConfig } from '../../config.js';

const logger = createLogger('supabase-instances');

/**
 * Generate a unique instance ID
 */
function generateInstanceId(npcId: string, playerId: string): string {
  // Instance ID is deterministic based on NPC and player
  const hash = Buffer.from(`${npcId}:${playerId}`).toString('base64url').substring(0, 12);
  return `inst_${hash}`;
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
 * Get an instance by ID
 */
export async function getInstance(
  projectId: string,
  instanceId: string
): Promise<NPCInstance> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('npc_instances')
      .select('*')
      .eq('id', instanceId)
      .eq('project_id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new StorageNotFoundError('Instance', instanceId);
      }
      throw new StorageError(`Database error: ${error.message}`);
    }

    const instance = data.state as NPCInstance;

    const duration = Date.now() - startTime;
    logger.debug({ projectId, instanceId, duration }, 'Instance loaded');

    return instance;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();
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

    const { error } = await supabase
      .from('npc_instances')
      .insert({
        id: instanceId,
        project_id: projectId,
        definition_id: npcId,
        player_id: playerId,
        state: instance,
        version: 1,
      });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, npcId, playerId, duration }, 'New instance created');

    return instance;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();
  const { project_id: projectId, id: instanceId } = instance;
  const config = getConfig();

  try {
    // Get current version
    const { data: currentData, error: fetchError } = await supabase
      .from('npc_instances')
      .select('version')
      .eq('id', instanceId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw new StorageError(`Database error: ${fetchError.message}`);
    }

    const currentVersion = currentData?.version || 0;
    const newVersion = currentVersion + 1;

    // Archive current state if history is enabled
    if (config.stateHistoryEnabled && currentData) {
      const { data: existingState } = await supabase
        .from('npc_instances')
        .select('state')
        .eq('id', instanceId)
        .single();

      if (existingState) {
        await supabase
          .from('npc_instance_history')
          .insert({
            instance_id: instanceId,
            version: currentVersion,
            state: existingState.state,
          });

        // Prune old history
        const { data: historyCount } = await supabase
          .from('npc_instance_history')
          .select('id', { count: 'exact' })
          .eq('instance_id', instanceId);

        if (historyCount && historyCount.length > config.stateHistoryMaxVersions) {
          const toDelete = historyCount.length - config.stateHistoryMaxVersions;
          const { data: oldEntries } = await supabase
            .from('npc_instance_history')
            .select('id')
            .eq('instance_id', instanceId)
            .order('created_at', { ascending: true })
            .limit(toDelete);

          if (oldEntries && oldEntries.length > 0) {
            await supabase
              .from('npc_instance_history')
              .delete()
              .in('id', oldEntries.map(e => e.id));
          }
        }
      }
    }

    // Upsert the instance
    const { error } = await supabase
      .from('npc_instances')
      .upsert({
        id: instanceId,
        project_id: projectId,
        definition_id: instance.definition_id,
        player_id: instance.player_id,
        state: instance,
        version: newVersion,
      });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const timestamp = new Date().toISOString();
    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, version: newVersion, duration }, 'Instance saved');

    return {
      version: String(newVersion),
      timestamp,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('npc_instance_history')
      .select('*')
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const versions: StorageVersion[] = (data || []).map(row => ({
      version: String(row.version),
      timestamp: row.created_at,
      filename: `v${row.version}.json`,
    }));

    const duration = Date.now() - startTime;
    logger.debug({ projectId, instanceId, count: versions.length, duration }, 'Instance history loaded');

    return versions;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('npc_instance_history')
      .select('state')
      .eq('instance_id', instanceId)
      .eq('version', parseInt(version, 10))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new StorageNotFoundError('Instance version', version);
      }
      throw new StorageError(`Database error: ${error.message}`);
    }

    const historicalInstance = data.state as NPCInstance;

    // Save it as the current state
    await saveInstance(historicalInstance);

    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, version, duration }, 'Instance rolled back');

    return historicalInstance;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    // Verify it exists first
    await getInstance(projectId, instanceId);

    const { error } = await supabase
      .from('npc_instances')
      .delete()
      .eq('id', instanceId)
      .eq('project_id', projectId);

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, instanceId, duration }, 'Instance deleted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('npc_instances')
      .select('state')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const instances = (data || []).map(row => row.state as NPCInstance);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, count: instances.length, duration }, 'Instances listed');

    return instances;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from('npc_instances')
    .select('state')
    .eq('project_id', projectId)
    .eq('definition_id', npcId);

  if (error) {
    throw new StorageError(`Database error: ${error.message}`);
  }

  return (data || []).map(row => row.state as NPCInstance);
}

/**
 * List instances for a specific player
 */
export async function listInstancesForPlayer(
  projectId: string,
  playerId: string
): Promise<NPCInstance[]> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from('npc_instances')
    .select('state')
    .eq('project_id', projectId)
    .eq('player_id', playerId);

  if (error) {
    throw new StorageError(`Database error: ${error.message}`);
  }

  return (data || []).map(row => row.state as NPCInstance);
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
