import { createLogger } from '../logger.js';
import type { Tool, ToolCall } from '../types/mcp.js';
import type { MCPPermissions } from '../types/npc.js';

const logger = createLogger('mcp-validator');

/**
 * Result of tool call validation
 */
export interface ToolValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a tool call against a tool definition schema
 */
export function validateToolCall(tool: Tool, toolCall: ToolCall): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check tool name matches
  if (tool.name !== toolCall.name) {
    errors.push(`Tool name mismatch: expected ${tool.name}, got ${toolCall.name}`);
    return { valid: false, errors, warnings };
  }

  const params = tool.parameters as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  // Validate required parameters
  const required = params.required ?? [];
  const args = toolCall.arguments ?? {};

  for (const param of required) {
    if (!(param in args) || args[param] === undefined || args[param] === null) {
      errors.push(`Missing required parameter: ${param}`);
    }
  }

  // Validate against properties schema
  const properties = params.properties ?? {};

  for (const [key, value] of Object.entries(args)) {
    if (!(key in properties)) {
      warnings.push(`Unknown parameter: ${key}`);
      continue;
    }

    const propDef = properties[key] as { type?: string; description?: string };

    // Type validation (basic)
    if (propDef.type) {
      const actualType = typeof value;
      const expectedType = propDef.type.toLowerCase();

      const typeMatches = validateType(value, expectedType);
      if (!typeMatches) {
        errors.push(`Parameter ${key}: expected type ${expectedType}, got ${actualType}`);
      }
    }
  }

  const valid = errors.length === 0;

  if (!valid) {
    logger.debug({ toolName: tool.name, errors, warnings }, 'Tool call validation failed');
  } else if (warnings.length > 0) {
    logger.debug({ toolName: tool.name, warnings }, 'Tool call validation warnings');
  }

  return { valid, errors, warnings };
}

/**
 * Validate type of a value against expected type
 */
function validateType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number' && (expectedType !== 'integer' || Number.isInteger(value));
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true; // Unknown type, accept
  }
}

/**
 * Validate that an NPC has permission to use a tool
 */
export function validateToolPermission(
  toolName: string,
  permissions: MCPPermissions,
  context: 'conversation' | 'game_event'
): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if explicitly denied
  if (permissions.denied.includes(toolName)) {
    errors.push(`Tool ${toolName} is explicitly denied for this NPC`);
    return { valid: false, errors, warnings };
  }

  // Check if allowed for the context
  if (context === 'conversation') {
    if (!permissions.conversation_tools.includes(toolName)) {
      // Check if it's a game event tool (warning, not error)
      if (permissions.game_event_tools.includes(toolName)) {
        warnings.push(`Tool ${toolName} is a game-event tool, not a conversation tool`);
      } else {
        errors.push(`Tool ${toolName} is not permitted for this NPC in conversations`);
      }
    }
  } else if (context === 'game_event') {
    if (!permissions.game_event_tools.includes(toolName)) {
      if (permissions.conversation_tools.includes(toolName)) {
        warnings.push(`Tool ${toolName} is a conversation tool, not a game-event tool`);
      } else {
        errors.push(`Tool ${toolName} is not permitted for this NPC in game events`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate multiple tool calls at once
 */
export function validateToolCalls(
  tools: Record<string, Tool>,
  toolCalls: ToolCall[]
): { results: Record<string, ToolValidationResult>; allValid: boolean } {
  const results: Record<string, ToolValidationResult> = {};
  let allValid = true;

  for (const toolCall of toolCalls) {
    const tool = tools[toolCall.name];
    const callId = toolCall.id ?? toolCall.name;

    if (!tool) {
      results[callId] = {
        valid: false,
        errors: [`Tool not found: ${toolCall.name}`],
        warnings: [],
      };
      allValid = false;
      continue;
    }

    const result = validateToolCall(tool, toolCall);
    results[callId] = result;

    if (!result.valid) {
      allValid = false;
    }
  }

  return { results, allValid };
}

/**
 * Sanitize tool arguments (remove potentially dangerous values)
 */
export function sanitizeToolArguments(
  args: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) {
      continue;
    }

    // Recursively sanitize nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeToolArguments(value as Record<string, unknown>);
    } else if (typeof value === 'string') {
      // Basic string sanitization
      sanitized[key] = value.slice(0, 1000); // Limit string length
    } else if (Array.isArray(value)) {
      // Limit array length and sanitize elements
      sanitized[key] = value.slice(0, 100).map((item) => {
        if (typeof item === 'string') {
          return item.slice(0, 1000);
        }
        if (typeof item === 'object' && item !== null) {
          return sanitizeToolArguments(item as Record<string, unknown>);
        }
        return item;
      });
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
