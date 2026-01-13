import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import { StorageError, StorageValidationError } from '../interface.js';

const logger = createLogger('supabase-mcp-tools');

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
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('mcp_tools')
      .select('*')
      .eq('project_id', projectId);

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const conversation_tools: MCPToolDefinition[] = [];
    const game_event_tools: MCPToolDefinition[] = [];

    for (const row of data || []) {
      const tool: MCPToolDefinition = {
        id: row.tool_id,
        name: row.name,
        description: row.description || '',
        parameters: row.parameters,
      };

      if (row.tool_type === 'conversation') {
        conversation_tools.push(tool);
      } else {
        game_event_tools.push(tool);
      }
    }

    logger.debug({ projectId }, 'Loaded MCP tools');
    return { conversation_tools, game_event_tools };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new StorageError(`Failed to read MCP tools for project ${projectId}: ${errorMessage}`);
  }
}

/**
 * Save the MCP tools for a project
 */
export async function saveMCPTools(projectId: string, tools: ProjectMCPTools): Promise<void> {
  const supabase = getSupabaseAdmin();

  try {
    validateMCPTools(tools);

    // Delete all existing tools for this project
    const { error: deleteError } = await supabase
      .from('mcp_tools')
      .delete()
      .eq('project_id', projectId);

    if (deleteError) {
      throw new StorageError(`Database error: ${deleteError.message}`);
    }

    // Insert all tools
    const inserts: Array<{
      project_id: string;
      tool_id: string;
      tool_type: string;
      name: string;
      description: string;
      parameters: unknown;
    }> = [];

    for (const tool of tools.conversation_tools) {
      inserts.push({
        project_id: projectId,
        tool_id: tool.id,
        tool_type: 'conversation',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {},
      });
    }

    for (const tool of tools.game_event_tools) {
      inserts.push({
        project_id: projectId,
        tool_id: tool.id,
        tool_type: 'game_event',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {},
      });
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from('mcp_tools')
        .insert(inserts);

      if (insertError) {
        throw new StorageError(`Database error: ${insertError.message}`);
      }
    }

    logger.info(
      {
        projectId,
        conversationCount: tools.conversation_tools.length,
        gameEventCount: tools.game_event_tools.length,
      },
      'Saved MCP tools'
    );
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new StorageError(`Failed to save MCP tools for project ${projectId}: ${errorMessage}`);
  }
}
