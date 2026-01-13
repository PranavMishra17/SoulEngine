/**
 * Storage Module Switcher
 * 
 * This module dynamically exports storage functions based on the environment.
 * - Production (NODE_ENV=production with Supabase configured): Uses Supabase
 * - Development/Local: Uses local file system
 */

import { createLogger } from '../logger.js';

const logger = createLogger('storage');

// Check if Supabase is configured
const isProduction = process.env.NODE_ENV === 'production';
const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Determine which storage backend to use
const useSupabase = isProduction && hasSupabase;

logger.info({ 
  mode: useSupabase ? 'supabase' : 'local',
  isProduction,
  hasSupabase,
}, 'Storage backend initialized');

// Dynamic re-exports based on environment
// We use conditional exports to avoid loading unnecessary modules

// Projects
export const createProject = useSupabase
  ? (await import('./supabase/projects.js')).createProject
  : (await import('./local/projects.js')).createProject;

export const getProject = useSupabase
  ? (await import('./supabase/projects.js')).getProject
  : (await import('./local/projects.js')).getProject;

export const updateProject = useSupabase
  ? (await import('./supabase/projects.js')).updateProject
  : (await import('./local/projects.js')).updateProject;

export const deleteProject = useSupabase
  ? (await import('./supabase/projects.js')).deleteProject
  : (await import('./local/projects.js')).deleteProject;

export const listProjects = useSupabase
  ? (await import('./supabase/projects.js')).listProjects
  : (await import('./local/projects.js')).listProjects;

export const projectExists = useSupabase
  ? (await import('./supabase/projects.js')).projectExists
  : (await import('./local/projects.js')).projectExists;

export const isValidProjectId = useSupabase
  ? (await import('./supabase/projects.js')).isValidProjectId
  : (await import('./local/projects.js')).isValidProjectId;

// Definitions
export const createDefinition = useSupabase
  ? (await import('./supabase/definitions.js')).createDefinition
  : (await import('./local/definitions.js')).createDefinition;

export const getDefinition = useSupabase
  ? (await import('./supabase/definitions.js')).getDefinition
  : (await import('./local/definitions.js')).getDefinition;

export const updateDefinition = useSupabase
  ? (await import('./supabase/definitions.js')).updateDefinition
  : (await import('./local/definitions.js')).updateDefinition;

export const deleteDefinition = useSupabase
  ? (await import('./supabase/definitions.js')).deleteDefinition
  : (await import('./local/definitions.js')).deleteDefinition;

export const listDefinitions = useSupabase
  ? (await import('./supabase/definitions.js')).listDefinitions
  : (await import('./local/definitions.js')).listDefinitions;

export const definitionExists = useSupabase
  ? (await import('./supabase/definitions.js')).definitionExists
  : (await import('./local/definitions.js')).definitionExists;

export const isValidNpcId = useSupabase
  ? (await import('./supabase/definitions.js')).isValidNpcId
  : (await import('./local/definitions.js')).isValidNpcId;

// Instances
export const getInstance = useSupabase
  ? (await import('./supabase/instances.js')).getInstance
  : (await import('./local/instances.js')).getInstance;

export const getOrCreateInstance = useSupabase
  ? (await import('./supabase/instances.js')).getOrCreateInstance
  : (await import('./local/instances.js')).getOrCreateInstance;

export const saveInstance = useSupabase
  ? (await import('./supabase/instances.js')).saveInstance
  : (await import('./local/instances.js')).saveInstance;

export const getInstanceHistory = useSupabase
  ? (await import('./supabase/instances.js')).getInstanceHistory
  : (await import('./local/instances.js')).getInstanceHistory;

export const rollbackInstance = useSupabase
  ? (await import('./supabase/instances.js')).rollbackInstance
  : (await import('./local/instances.js')).rollbackInstance;

export const deleteInstance = useSupabase
  ? (await import('./supabase/instances.js')).deleteInstance
  : (await import('./local/instances.js')).deleteInstance;

export const listInstances = useSupabase
  ? (await import('./supabase/instances.js')).listInstances
  : (await import('./local/instances.js')).listInstances;

export const listInstancesForNpc = useSupabase
  ? (await import('./supabase/instances.js')).listInstancesForNpc
  : (await import('./local/instances.js')).listInstancesForNpc;

export const listInstancesForPlayer = useSupabase
  ? (await import('./supabase/instances.js')).listInstancesForPlayer
  : (await import('./local/instances.js')).listInstancesForPlayer;

export const instanceExists = useSupabase
  ? (await import('./supabase/instances.js')).instanceExists
  : (await import('./local/instances.js')).instanceExists;

// Knowledge
export const getKnowledgeBase = useSupabase
  ? (await import('./supabase/knowledge.js')).getKnowledgeBase
  : (await import('./local/knowledge.js')).getKnowledgeBase;

export const updateKnowledgeBase = useSupabase
  ? (await import('./supabase/knowledge.js')).updateKnowledgeBase
  : (await import('./local/knowledge.js')).updateKnowledgeBase;

export const upsertCategory = useSupabase
  ? (await import('./supabase/knowledge.js')).upsertCategory
  : (await import('./local/knowledge.js')).upsertCategory;

export const deleteCategory = useSupabase
  ? (await import('./supabase/knowledge.js')).deleteCategory
  : (await import('./local/knowledge.js')).deleteCategory;

export const getCategory = useSupabase
  ? (await import('./supabase/knowledge.js')).getCategory
  : (await import('./local/knowledge.js')).getCategory;

export const listCategoryIds = useSupabase
  ? (await import('./supabase/knowledge.js')).listCategoryIds
  : (await import('./local/knowledge.js')).listCategoryIds;

// MCP Tools
export const getMCPTools = useSupabase
  ? (await import('./supabase/mcp-tools.js')).getMCPTools
  : (await import('./local/mcp-tools.js')).getMCPTools;

export const saveMCPTools = useSupabase
  ? (await import('./supabase/mcp-tools.js')).saveMCPTools
  : (await import('./local/mcp-tools.js')).saveMCPTools;

// Secrets
export const saveApiKeys = useSupabase
  ? (await import('./supabase/secrets.js')).saveApiKeys
  : (await import('./local/secrets.js')).saveApiKeys;

export const loadApiKeys = useSupabase
  ? (await import('./supabase/secrets.js')).loadApiKeys
  : (await import('./local/secrets.js')).loadApiKeys;

export const updateApiKeys = useSupabase
  ? (await import('./supabase/secrets.js')).updateApiKeys
  : (await import('./local/secrets.js')).updateApiKeys;

export const deleteApiKeys = useSupabase
  ? (await import('./supabase/secrets.js')).deleteApiKeys
  : (await import('./local/secrets.js')).deleteApiKeys;

export const hasApiKeys = useSupabase
  ? (await import('./supabase/secrets.js')).hasApiKeys
  : (await import('./local/secrets.js')).hasApiKeys;

// Images (only available in Supabase mode)
export const uploadNpcImage = useSupabase
  ? (await import('./supabase/images.js')).uploadNpcImage
  : (await import('./local/index.js')).uploadNpcImage;

export const deleteNpcImage = useSupabase
  ? (await import('./supabase/images.js')).deleteNpcImage
  : (await import('./local/index.js')).deleteNpcImage;

export const getNpcImageUrl = useSupabase
  ? (await import('./supabase/images.js')).getNpcImageUrl
  : (await import('./local/index.js')).getNpcImageUrl;

export const deleteProjectImages = useSupabase
  ? (await import('./supabase/images.js')).deleteProjectImages
  : (await import('./local/index.js')).deleteProjectImages;

// Client utilities
export const isSupabaseEnabled = useSupabase
  ? (await import('./supabase/client.js')).isSupabaseEnabled
  : (await import('./local/index.js')).isSupabaseEnabled;

export const verifyToken = useSupabase
  ? (await import('./supabase/client.js')).verifyToken
  : (await import('./local/index.js')).verifyToken;

// Re-export types and errors
export * from './interface.js';

// Type exports from MCP tools (both local and supabase have the same types)
export type { MCPToolDefinition, ProjectMCPTools } from './supabase/mcp-tools.js';
export type { ApiKeys } from './supabase/secrets.js';

// Export storage mode flag
export const storageMode = useSupabase ? 'supabase' : 'local';
