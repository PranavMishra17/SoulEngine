import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import { StorageError, StorageValidationError } from './interface.js';

const logger = createLogger('mcp-tools-storage');

/**
 * MCP Tool definition
 */
export interface MCPToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

/**
 * Project-level MCP tools configuration
 */
export interface ProjectMCPTools {
  conversation_tools: MCPToolDefinition[];
  game_event_tools: MCPToolDefinition[];
}

/**
 * Get the path to a project's MCP tools file
 */
function getMCPToolsPath(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId, 'mcp_tools.yaml');
}

/**
 * Validate MCP tool definition
 */
function validateTool(tool: MCPToolDefinition): void {
  if (!tool.id || typeof tool.id !== 'string') {
    throw new StorageValidationError('MCP tool must have an id');
  }

  if (!tool.name || typeof tool.name !== 'string') {
    throw new StorageValidationError(`MCP tool ${tool.id} must have a name`);
  }

  if (!tool.description || typeof tool.description !== 'string') {
    throw new StorageValidationError(`MCP tool ${tool.id} must have a description`);
  }
}

/**
 * Validate MCP tools structure
 */
function validateMCPTools(tools: ProjectMCPTools): void {
  if (!Array.isArray(tools.conversation_tools)) {
    throw new StorageValidationError('MCP tools must have conversation_tools array');
  }

  if (!Array.isArray(tools.game_event_tools)) {
    throw new StorageValidationError('MCP tools must have game_event_tools array');
  }

  for (const tool of tools.conversation_tools) {
    validateTool(tool);
  }

  for (const tool of tools.game_event_tools) {
    validateTool(tool);
  }
}

/**
 * Get the MCP tools for a project
 */
export async function getMCPTools(projectId: string): Promise<ProjectMCPTools> {
  const filePath = getMCPToolsPath(projectId);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const tools = yaml.load(content) as ProjectMCPTools;

    logger.debug({ projectId }, 'Loaded MCP tools');
    return tools;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Return empty tools if file doesn't exist
      logger.debug({ projectId }, 'MCP tools file not found, returning empty');
      return { conversation_tools: [], game_event_tools: [] };
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new StorageError(`Failed to read MCP tools for project ${projectId}: ${errorMessage}`);
  }
}

/**
 * Save the MCP tools for a project
 */
export async function saveMCPTools(projectId: string, tools: ProjectMCPTools): Promise<void> {
  const filePath = getMCPToolsPath(projectId);

  try {
    // Validate
    validateMCPTools(tools);

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Save as YAML
    const content = yaml.dump(tools, { indent: 2, lineWidth: -1 });
    await fs.writeFile(filePath, content, 'utf-8');

    logger.info(
      {
        projectId,
        conversationCount: tools.conversation_tools.length,
        gameEventCount: tools.game_event_tools.length,
      },
      'Saved MCP tools'
    );
  } catch (error) {
    if (error instanceof StorageValidationError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new StorageError(`Failed to save MCP tools for project ${projectId}: ${errorMessage}`);
  }
}
