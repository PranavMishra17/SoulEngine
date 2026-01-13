import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import type { NPCDefinition } from '../../types/npc.js';
import { StorageError, StorageNotFoundError, StorageValidationError, StorageLimitError } from '../interface.js';
import { getConfig } from '../../config.js';

const logger = createLogger('supabase-definitions');

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

  // Validate network (optional field)
  if (def.network) {
    if (!Array.isArray(def.network)) {
      throw new StorageValidationError('NPC network must be an array');
    }
    if (def.network.length > 5) {
      throw new StorageValidationError('NPC network cannot exceed 5 entries');
    }
  }

  // Validate salience threshold
  if (def.salience_threshold !== undefined) {
    if (typeof def.salience_threshold !== 'number' || def.salience_threshold < 0 || def.salience_threshold > 1) {
      throw new StorageValidationError('salience_threshold must be a number between 0 and 1');
    }
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
  const supabase = getSupabaseAdmin();

  try {
    // Check limit
    const config = getConfig();
    const { count, error: countError } = await supabase
      .from('npc_definitions')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (countError) {
      throw new StorageError(`Database error: ${countError.message}`);
    }

    if ((count || 0) >= config.limits.maxNpcsPerProject) {
      throw new StorageLimitError(
        `Cannot create NPC: limit of ${config.limits.maxNpcsPerProject} NPCs per project reached`
      );
    }

    const { data, error } = await supabase
      .from('npc_definitions')
      .insert({
        project_id: projectId,
        name: definition.name,
        description: definition.description || '',
        core_anchor: definition.core_anchor,
        personality_baseline: definition.personality_baseline,
        voice: definition.voice,
        schedule: definition.schedule || [],
        mcp_permissions: definition.mcp_permissions,
        knowledge_access: definition.knowledge_access || {},
        network: definition.network || [],
        player_recognition: definition.player_recognition || { can_know_player: true, reveal_player_identity: true },
        salience_threshold: definition.salience_threshold ?? 0.7,
        profile_image: definition.profile_image,
      })
      .select()
      .single();

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const fullDefinition = mapRowToDefinition(data);

    // Validate before returning
    validateDefinition(fullDefinition);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId: fullDefinition.id, name: definition.name, duration }, 'NPC definition created');

    return fullDefinition;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageValidationError || error instanceof StorageLimitError || error instanceof StorageError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to create NPC definition');
    throw new StorageError(`Failed to create NPC definition: ${errorMessage}`);
  }
}

/**
 * Map a database row to NPCDefinition
 */
function mapRowToDefinition(row: Record<string, unknown>): NPCDefinition {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    description: (row.description as string) || '',
    core_anchor: row.core_anchor as NPCDefinition['core_anchor'],
    personality_baseline: row.personality_baseline as NPCDefinition['personality_baseline'],
    voice: row.voice as NPCDefinition['voice'],
    schedule: (row.schedule as NPCDefinition['schedule']) || [],
    mcp_permissions: row.mcp_permissions as NPCDefinition['mcp_permissions'],
    knowledge_access: (row.knowledge_access as NPCDefinition['knowledge_access']) || {},
    network: (row.network as NPCDefinition['network']) || [],
    player_recognition: (row.player_recognition as NPCDefinition['player_recognition']) || {
      can_know_player: true,
      reveal_player_identity: true,
    },
    salience_threshold: (row.salience_threshold as number) ?? 0.7,
    profile_image: row.profile_image as string | undefined,
  };
}

/**
 * Get an NPC definition by ID
 */
export async function getDefinition(projectId: string, npcId: string): Promise<NPCDefinition> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('npc_definitions')
      .select('*')
      .eq('id', npcId)
      .eq('project_id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new StorageNotFoundError('NPC Definition', npcId);
      }
      throw new StorageError(`Database error: ${error.message}`);
    }

    const definition = mapRowToDefinition(data);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, npcId, duration }, 'NPC definition loaded');

    return definition;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    // Get existing to merge
    const existing = await getDefinition(projectId, npcId);

    const updateData: Record<string, unknown> = {};
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.core_anchor) updateData.core_anchor = { ...existing.core_anchor, ...updates.core_anchor };
    if (updates.personality_baseline) updateData.personality_baseline = { ...existing.personality_baseline, ...updates.personality_baseline };
    if (updates.voice) updateData.voice = { ...existing.voice, ...updates.voice };
    if (updates.schedule !== undefined) updateData.schedule = updates.schedule;
    if (updates.mcp_permissions) updateData.mcp_permissions = { ...existing.mcp_permissions, ...updates.mcp_permissions };
    if (updates.knowledge_access !== undefined) updateData.knowledge_access = updates.knowledge_access;
    if (updates.network !== undefined) updateData.network = updates.network;
    if (updates.player_recognition !== undefined) updateData.player_recognition = updates.player_recognition;
    if (updates.salience_threshold !== undefined) updateData.salience_threshold = updates.salience_threshold;
    if (updates.profile_image !== undefined) updateData.profile_image = updates.profile_image;

    const { data, error } = await supabase
      .from('npc_definitions')
      .update(updateData)
      .eq('id', npcId)
      .eq('project_id', projectId)
      .select()
      .single();

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const definition = mapRowToDefinition(data);

    // Validate before returning
    validateDefinition(definition);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, duration }, 'NPC definition updated');

    return definition;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageValidationError || error instanceof StorageError) {
      throw error;
    }
    
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
  const supabase = getSupabaseAdmin();

  try {
    // Verify it exists first
    await getDefinition(projectId, npcId);

    const { error } = await supabase
      .from('npc_definitions')
      .delete()
      .eq('id', npcId)
      .eq('project_id', projectId);

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, duration }, 'NPC definition deleted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('npc_definitions')
      .select('*')
      .eq('project_id', projectId)
      .order('name', { ascending: true });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const definitions = (data || []).map(mapRowToDefinition);

    const duration = Date.now() - startTime;
    logger.debug({ projectId, count: definitions.length, duration }, 'NPC definitions listed');

    return definitions;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
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
  return /^npc_[a-z0-9]+/.test(npcId);
}
