import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import type { Project, ProjectSettings, ProjectLimits } from '../../types/project.js';
import { StorageError, StorageNotFoundError } from '../interface.js';
import { getConfig } from '../../config.js';

const logger = createLogger('supabase-projects');

/**
 * Get default project settings
 */
function getDefaultSettings(): ProjectSettings {
  return {
    llm_provider: 'gemini',
    stt_provider: 'deepgram',
    tts_provider: 'cartesia',
    default_voice_id: '',
    timeouts: {
      session: 1800000,
      llm: 30000,
      stt: 10000,
      tts: 10000,
    },
  };
}

/**
 * Get default project limits
 */
function getDefaultLimits(): ProjectLimits {
  const config = getConfig();
  return {
    max_npcs: config.limits.maxNpcsPerProject,
    max_categories: config.limits.maxCategories,
    max_concurrent_sessions: config.limits.maxConcurrentSessions,
  };
}

/**
 * Create a new project
 */
export async function createProject(name: string, userId?: string): Promise<Project> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    const settings = getDefaultSettings();
    const limits = getDefaultLimits();

    const insertData: Record<string, unknown> = {
      name,
      settings,
      limits,
    };

    // Only include user_id if provided (for authenticated mode)
    if (userId) {
      insertData.user_id = userId;
    }

    const { data, error } = await supabase
      .from('projects')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const project: Project = {
      id: data.id,
      name: data.name,
      created_at: data.created_at,
      settings: data.settings as ProjectSettings,
      limits: data.limits as ProjectLimits,
    };

    const duration = Date.now() - startTime;
    logger.info({ projectId: project.id, name, duration }, 'Project created');

    return project;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, duration }, 'Failed to create project');
    throw new StorageError(`Failed to create project: ${errorMessage}`);
  }
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<Project> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new StorageNotFoundError('Project', projectId);
      }
      throw new StorageError(`Database error: ${error.message}`);
    }

    const project: Project = {
      id: data.id,
      name: data.name,
      created_at: data.created_at,
      settings: data.settings as ProjectSettings,
      limits: data.limits as ProjectLimits,
    };

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'Project loaded');

    return project;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to load project');
    throw new StorageError(`Failed to load project: ${errorMessage}`);
  }
}

/**
 * Update a project
 */
export async function updateProject(
  projectId: string,
  updates: Partial<Omit<Project, 'id' | 'created_at'>>
): Promise<Project> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    // First get existing to merge settings/limits
    const existing = await getProject(projectId);

    const updateData: Record<string, unknown> = {};
    
    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    
    if (updates.settings) {
      updateData.settings = { ...existing.settings, ...updates.settings };
    }
    
    if (updates.limits) {
      updateData.limits = { ...existing.limits, ...updates.limits };
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .select()
      .single();

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const project: Project = {
      id: data.id,
      name: data.name,
      created_at: data.created_at,
      settings: data.settings as ProjectSettings,
      limits: data.limits as ProjectLimits,
    };

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Project updated');

    return project;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update project');
    throw new StorageError(`Failed to update project: ${errorMessage}`);
  }
}

/**
 * Delete a project and all its contents
 */
export async function deleteProject(projectId: string): Promise<void> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    // Verify project exists first
    await getProject(projectId);

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Project deleted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageNotFoundError || error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to delete project');
    throw new StorageError(`Failed to delete project: ${errorMessage}`);
  }
}

/**
 * List all projects (optionally filtered by user)
 */
export async function listProjects(userId?: string): Promise<Project[]> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    let query = supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const projects: Project[] = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      settings: row.settings as ProjectSettings,
      limits: row.limits as ProjectLimits,
    }));

    const duration = Date.now() - startTime;
    logger.debug({ count: projects.length, duration }, 'Projects listed');

    return projects;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, duration }, 'Failed to list projects');
    throw new StorageError(`Failed to list projects: ${errorMessage}`);
  }
}

/**
 * Check if a project exists
 */
export async function projectExists(projectId: string): Promise<boolean> {
  try {
    await getProject(projectId);
    return true;
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return false;
    }
    throw error;
  }
}

/**
 * Validate project ID format
 */
export function isValidProjectId(projectId: string): boolean {
  return /^proj_[a-z0-9]+/.test(projectId);
}
