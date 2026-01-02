import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import type { Project, ProjectSettings, ProjectLimits } from '../types/project.js';
import { StorageError, StorageNotFoundError } from './interface.js';

const logger = createLogger('project-storage');

/**
 * Generate a unique project ID
 */
function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `proj_${timestamp}_${random}`;
}

/**
 * Get the path to a project's directory
 */
function getProjectPath(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId);
}

/**
 * Get the path to a project's config file
 */
function getProjectConfigPath(projectId: string): string {
  return path.join(getProjectPath(projectId), 'project.yaml');
}

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
export async function createProject(name: string): Promise<Project> {
  const startTime = Date.now();
  const projectId = generateProjectId();
  const projectPath = getProjectPath(projectId);

  try {
    // Create project directory structure
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.join(projectPath, 'definitions'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'instances'), { recursive: true });

    const project: Project = {
      id: projectId,
      name,
      created_at: new Date().toISOString(),
      settings: getDefaultSettings(),
      limits: getDefaultLimits(),
    };

    // Write project config
    const configPath = getProjectConfigPath(projectId);
    await fs.writeFile(configPath, yaml.dump(project), 'utf-8');

    // Create empty knowledge base file
    const knowledgePath = path.join(projectPath, 'knowledge_base.yaml');
    await fs.writeFile(knowledgePath, yaml.dump({ categories: {} }), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ projectId, name, duration }, 'Project created');

    return project;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to create project');

    // Cleanup on failure
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    throw new StorageError(`Failed to create project: ${errorMessage}`);
  }
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<Project> {
  const startTime = Date.now();
  const configPath = getProjectConfigPath(projectId);

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const project = yaml.load(content) as Project;

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'Project loaded');

    return project;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn({ projectId, duration }, 'Project not found');
      throw new StorageNotFoundError('Project', projectId);
    }

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

  try {
    const existing = await getProject(projectId);

    const updated: Project = {
      ...existing,
      ...updates,
      id: existing.id,
      created_at: existing.created_at,
      settings: updates.settings
        ? { ...existing.settings, ...updates.settings }
        : existing.settings,
      limits: updates.limits
        ? { ...existing.limits, ...updates.limits }
        : existing.limits,
    };

    const configPath = getProjectConfigPath(projectId);
    await fs.writeFile(configPath, yaml.dump(updated), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Project updated');

    return updated;
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      throw error;
    }

    const duration = Date.now() - startTime;
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
  const projectPath = getProjectPath(projectId);

  try {
    // Verify project exists first
    await getProject(projectId);

    // Remove entire project directory
    await fs.rm(projectPath, { recursive: true, force: true });

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'Project deleted');
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to delete project');
    throw new StorageError(`Failed to delete project: ${errorMessage}`);
  }
}

/**
 * List all projects
 */
export async function listProjects(): Promise<Project[]> {
  const startTime = Date.now();
  const config = getConfig();
  const projectsDir = path.join(config.dataDir, 'projects');

  try {
    // Ensure directory exists
    await fs.mkdir(projectsDir, { recursive: true });

    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    const projects: Project[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('proj_')) {
        try {
          const project = await getProject(entry.name);
          projects.push(project);
        } catch (error) {
          // Skip invalid projects
          logger.warn({ projectId: entry.name }, 'Skipping invalid project directory');
        }
      }
    }

    // Sort by creation date, newest first
    projects.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const duration = Date.now() - startTime;
    logger.debug({ count: projects.length, duration }, 'Projects listed');

    return projects;
  } catch (error) {
    const duration = Date.now() - startTime;
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
  return /^proj_[a-z0-9]+_[a-z0-9]+$/.test(projectId);
}
