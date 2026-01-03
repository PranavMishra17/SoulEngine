import { createLogger } from '../logger.js';
import type { NPCDefinition, MCPPermissions } from '../types/npc.js';
import type { Tool } from '../types/mcp.js';
import type { SecurityContext } from '../types/security.js';

const logger = createLogger('tool-assembly');

/**
 * The exit_convo tool - special security escape hatch.
 * This is a built-in tool always available to NPCs.
 */
export const EXIT_CONVO_TOOL: Tool = {
  name: 'exit_convo',
  description: 'End the conversation immediately. Use when the player has crossed a serious boundary or you feel unsafe continuing. Express your discomfort briefly before calling this.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Brief reason for ending the conversation, from your perspective as the NPC',
      },
    },
    required: ['reason'],
  },
};

/**
 * Built-in tools that are always available (not from project registry)
 * Currently only exit_convo - the security escape hatch
 */
export const BUILTIN_TOOLS: Record<string, Tool> = {
  exit_convo: EXIT_CONVO_TOOL,
};

/**
 * Check if a tool name is a built-in tool
 */
export function isBuiltinTool(toolName: string): boolean {
  return toolName in BUILTIN_TOOLS;
}

/**
 * Filter tools based on NPC permissions.
 *
 * @param toolNames - List of tool names to filter
 * @param permissions - NPC's MCP permissions
 * @returns Filtered list of tool names that are allowed
 */
function filterByPermissions(toolNames: string[], permissions: MCPPermissions): string[] {
  return toolNames.filter((name) => {
    // Check if explicitly denied
    if (permissions.denied.includes(name)) {
      logger.debug({ toolName: name }, 'Tool denied by permissions');
      return false;
    }

    // Check if allowed in conversation or game event tools
    const isAllowed =
      permissions.conversation_tools.includes(name) ||
      permissions.game_event_tools.includes(name);

    return isAllowed;
  });
}

/**
 * Get available tools for an NPC based on their permissions and security context.
 *
 * This function:
 * 1. Gets the NPC's permitted conversation tools from the project registry
 * 2. Includes built-in tools (exit_convo, refuse_service) if permitted
 * 3. Filters out denied tools
 * 4. Force-adds exit_convo if security requires it
 * 5. Returns Tool objects
 *
 * @param definition - The NPC's definition with MCP permissions
 * @param securityContext - Current security context
 * @param projectToolRegistry - The project's MCP tool registry (tools defined per-project)
 * @returns Array of available Tool objects
 */
export function getAvailableTools(
  definition: NPCDefinition,
  securityContext: SecurityContext,
  projectToolRegistry: Record<string, Tool>
): Tool[] {
  const permissions = definition.mcp_permissions;

  // Start with conversation tools (LLM-decidable tools)
  let toolNames = [...permissions.conversation_tools];

  // Filter by permissions (removes any that are in denied list)
  toolNames = filterByPermissions(toolNames, permissions);

  // Resolve tool names to Tool objects from project registry or built-in tools
  const tools: Tool[] = [];
  for (const name of toolNames) {
    // Check built-in tools first
    if (isBuiltinTool(name)) {
      tools.push(BUILTIN_TOOLS[name]);
      continue;
    }

    // Look up in project registry
    const tool = projectToolRegistry[name];
    if (tool) {
      tools.push(tool);
    } else {
      logger.warn({ toolName: name, npcId: definition.id }, 'Tool not found in project registry');
    }
  }

  // Force-add exit_convo if security context requests it (security escape hatch)
  if (securityContext.exitRequested) {
    // Only add if not already present
    if (!tools.some((t) => t.name === 'exit_convo')) {
      tools.push(EXIT_CONVO_TOOL);
    }
    logger.debug({ npcId: definition.id }, 'exit_convo tool force-added due to security context');
  }

  logger.debug(
    {
      npcId: definition.id,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      exitRequested: securityContext.exitRequested,
    },
    'Available tools assembled'
  );

  return tools;
}

/**
 * Check if an NPC has permission to use a specific tool.
 *
 * @param toolName - Name of the tool to check
 * @param permissions - NPC's MCP permissions
 * @returns True if the NPC can use the tool
 */
export function hasToolPermission(toolName: string, permissions: MCPPermissions): boolean {
  // exit_convo is always allowed (security escape hatch) - cannot be denied
  if (toolName === 'exit_convo') {
    return true;
  }

  // Check if explicitly denied
  if (permissions.denied.includes(toolName)) {
    return false;
  }

  // Built-in tools are allowed if in any allowed category
  if (isBuiltinTool(toolName)) {
    return (
      permissions.conversation_tools.includes(toolName) ||
      permissions.game_event_tools.includes(toolName)
    );
  }

  // Check if in any allowed category
  return (
    permissions.conversation_tools.includes(toolName) ||
    permissions.game_event_tools.includes(toolName)
  );
}

/**
 * Get game-event tools for an NPC (tools invoked by game logic, not LLM).
 *
 * @param definition - The NPC's definition
 * @param projectToolRegistry - The project's MCP tool registry
 * @returns Array of game-event Tool objects
 */
export function getGameEventTools(
  definition: NPCDefinition,
  projectToolRegistry: Record<string, Tool>
): Tool[] {
  const permissions = definition.mcp_permissions;

  const toolNames = permissions.game_event_tools.filter(
    (name) => !permissions.denied.includes(name)
  );

  const tools: Tool[] = [];
  for (const name of toolNames) {
    // Check built-in tools first
    if (isBuiltinTool(name)) {
      tools.push(BUILTIN_TOOLS[name]);
      continue;
    }

    const tool = projectToolRegistry[name];
    if (tool) {
      tools.push(tool);
    }
  }

  return tools;
}

/**
 * Check if a tool is the exit_convo tool
 */
export function isExitConvoTool(toolName: string): boolean {
  return toolName === 'exit_convo';
}

/**
 * Get the exit_convo tool
 */
export function getExitConvoTool(): Tool {
  return EXIT_CONVO_TOOL;
}

/**
 * Validate tool call arguments against the tool's parameter schema.
 * Returns validation result with any errors.
 *
 * @param tool - The tool definition
 * @param args - Arguments to validate
 * @returns Validation result
 */
export function validateToolArguments(
  tool: Tool,
  args: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const params = tool.parameters as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  // Check required parameters
  const required = params.required ?? [];
  for (const param of required) {
    if (!(param in args) || args[param] === undefined || args[param] === null) {
      errors.push(`Missing required parameter: ${param}`);
    }
  }

  // Check for unknown parameters
  const properties = params.properties ?? {};
  for (const key of Object.keys(args)) {
    if (!(key in properties)) {
      errors.push(`Unknown parameter: ${key}`);
    }
  }

  if (errors.length > 0) {
    logger.debug({ toolName: tool.name, errors }, 'Tool argument validation failed');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
