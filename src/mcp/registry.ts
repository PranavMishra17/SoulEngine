import { createLogger } from '../logger.js';
import type { Tool } from '../types/mcp.js';

const logger = createLogger('mcp-registry');

/**
 * Tool execution handler type
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Registered tool with handler
 */
export interface RegisteredTool {
  tool: Tool;
  handler?: ToolHandler;
}

/**
 * MCP Tool Registry
 *
 * Manages tool definitions and handlers per project.
 * Tools are defined by the project/game developer and registered here.
 * The NPC system uses this registry to:
 * 1. Get available tools for LLM function calling
 * 2. Validate tool calls
 * 3. Execute tool handlers (if provided)
 */
export class MCPToolRegistry {
  /**
   * Map of project ID -> tool name -> registered tool
   */
  private registry: Map<string, Map<string, RegisteredTool>> = new Map();

  /**
   * Register a tool for a project
   */
  registerTool(projectId: string, tool: Tool, handler?: ToolHandler): void {
    let projectTools = this.registry.get(projectId);
    if (!projectTools) {
      projectTools = new Map();
      this.registry.set(projectId, projectTools);
    }

    projectTools.set(tool.name, { tool, handler });
    logger.info({ projectId, toolName: tool.name, hasHandler: !!handler }, 'Tool registered');
  }

  /**
   * Register multiple tools for a project
   */
  registerTools(projectId: string, tools: Tool[], handlers?: Record<string, ToolHandler>): void {
    for (const tool of tools) {
      const handler = handlers?.[tool.name];
      this.registerTool(projectId, tool, handler);
    }
  }

  /**
   * Unregister a tool from a project
   */
  unregisterTool(projectId: string, toolName: string): boolean {
    const projectTools = this.registry.get(projectId);
    if (!projectTools) {
      return false;
    }

    const deleted = projectTools.delete(toolName);
    if (deleted) {
      logger.info({ projectId, toolName }, 'Tool unregistered');
    }
    return deleted;
  }

  /**
   * Get all tools for a project (as a Record for easy lookup)
   */
  getProjectTools(projectId: string): Record<string, Tool> {
    const projectTools = this.registry.get(projectId);
    if (!projectTools) {
      return {};
    }

    const tools: Record<string, Tool> = {};
    for (const [name, registered] of projectTools) {
      tools[name] = registered.tool;
    }
    return tools;
  }

  /**
   * Get a specific tool for a project
   */
  getTool(projectId: string, toolName: string): Tool | undefined {
    return this.registry.get(projectId)?.get(toolName)?.tool;
  }

  /**
   * Check if a tool exists in a project
   */
  hasTool(projectId: string, toolName: string): boolean {
    return this.registry.get(projectId)?.has(toolName) ?? false;
  }

  /**
   * Execute a tool with the provided arguments
   *
   * If the tool has a registered handler, it will be executed.
   * If no handler is registered, returns a placeholder result indicating
   * the tool call should be handled by the game/client.
   */
  async executeTool(
    projectId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const registered = this.registry.get(projectId)?.get(toolName);

    if (!registered) {
      logger.warn({ projectId, toolName }, 'Tool not found in registry');
      throw new Error(`Tool not found: ${toolName}`);
    }

    if (!registered.handler) {
      // No handler - return a placeholder indicating the call should be
      // forwarded to the game client
      logger.debug({ projectId, toolName, args }, 'Tool has no handler, forwarding to client');
      return {
        status: 'pending',
        message: 'Tool call pending game client execution',
        tool: toolName,
        arguments: args,
      };
    }

    try {
      const result = await registered.handler(args);
      logger.debug({ projectId, toolName }, 'Tool executed successfully');
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ projectId, toolName, error: errorMessage }, 'Tool execution failed');
      throw error;
    }
  }

  /**
   * Get all tool names for a project
   */
  getToolNames(projectId: string): string[] {
    const projectTools = this.registry.get(projectId);
    if (!projectTools) {
      return [];
    }
    return Array.from(projectTools.keys());
  }

  /**
   * Clear all tools for a project
   */
  clearProject(projectId: string): void {
    this.registry.delete(projectId);
    logger.info({ projectId }, 'Project tools cleared');
  }

  /**
   * Clear all tools from all projects
   */
  clearAll(): void {
    this.registry.clear();
    logger.info('All tools cleared');
  }

  /**
   * Get statistics about the registry
   */
  getStats(): { projectCount: number; totalTools: number; toolsByProject: Record<string, number> } {
    const toolsByProject: Record<string, number> = {};
    let totalTools = 0;

    for (const [projectId, projectTools] of this.registry) {
      const count = projectTools.size;
      toolsByProject[projectId] = count;
      totalTools += count;
    }

    return {
      projectCount: this.registry.size,
      totalTools,
      toolsByProject,
    };
  }
}

/**
 * Create default game tools that projects commonly use
 */
export function createDefaultGameTools(): Tool[] {
  return [
    {
      name: 'call_guards',
      description: 'Alert the guards or security personnel. Use when you feel threatened or witness wrongdoing.',
      parameters: {
        type: 'object',
        properties: {
          urgency: {
            type: 'number',
            description: 'Urgency level from 1 (low) to 10 (emergency)',
          },
          reason: {
            type: 'string',
            description: 'Brief reason for calling guards',
          },
        },
        required: ['urgency', 'reason'],
      },
    },
    {
      name: 'refuse_service',
      description: 'Refuse to serve or help the player. Use when they have behaved badly.',
      parameters: {
        type: 'object',
        properties: {
          duration: {
            type: 'string',
            description: 'How long to refuse service (e.g., "today", "forever", "until apology")',
          },
          reason: {
            type: 'string',
            description: 'Brief reason for refusing',
          },
        },
        required: ['reason'],
      },
    },
    {
      name: 'lock_door',
      description: 'Lock a door or entrance. Use to prevent entry or escape.',
      parameters: {
        type: 'object',
        properties: {
          door_id: {
            type: 'string',
            description: 'Identifier of the door to lock',
          },
        },
        required: ['door_id'],
      },
    },
    {
      name: 'flee_to',
      description: 'Flee to a safe location. Use when in danger.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'Where to flee to',
          },
        },
        required: ['location'],
      },
    },
    {
      name: 'give_item',
      description: 'Give an item to the player.',
      parameters: {
        type: 'object',
        properties: {
          item_id: {
            type: 'string',
            description: 'Identifier of the item to give',
          },
          quantity: {
            type: 'number',
            description: 'How many to give (default 1)',
          },
        },
        required: ['item_id'],
      },
    },
    {
      name: 'update_quest',
      description: 'Update a quest or task progress.',
      parameters: {
        type: 'object',
        properties: {
          quest_id: {
            type: 'string',
            description: 'Identifier of the quest',
          },
          action: {
            type: 'string',
            description: 'Action to take: "start", "progress", "complete", "fail"',
          },
          details: {
            type: 'string',
            description: 'Additional details about the update',
          },
        },
        required: ['quest_id', 'action'],
      },
    },
  ];
}

// Singleton instance for global registry
export const mcpToolRegistry = new MCPToolRegistry();
