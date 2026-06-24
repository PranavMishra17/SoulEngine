import type { Tool } from '../types/mcp.js';
import type { ToolHandler } from './registry.js';

/**
 * Registry store interface
 *
 * This abstraction allows MCP tool registry state to be backed by different
 * storage implementations for horizontal scaling.
 *
 * The default implementation is in-memory (see InMemoryRegistryStore below).
 * To use an external store (e.g., Redis):
 *
 * 1. Implement this interface with your store client
 * 2. Pass your implementation to MCPToolRegistry constructor
 * 3. Ensure the store is shared across all server instances
 *
 * Note: External stores need to serialize tool definitions and handlers.
 * Since handlers are functions, they cannot be serialized directly - you'll
 * need a handler resolution strategy (e.g., named handlers registered locally,
 * with only the handler name stored externally).
 */

export interface RegisteredTool {
  tool: Tool;
  handler?: ToolHandler;
}

export interface RegistryStore {
  /**
   * Get all tools for a project
   * Returns empty map if project has no tools
   */
  getProjectTools(projectId: string): Promise<Map<string, RegisteredTool>> | Map<string, RegisteredTool>;

  /**
   * Get a specific tool for a project
   * Returns undefined if not found
   */
  getTool(projectId: string, toolName: string): Promise<RegisteredTool | undefined> | RegisteredTool | undefined;

  /**
   * Set a tool for a project
   */
  setTool(projectId: string, toolName: string, registeredTool: RegisteredTool): Promise<void> | void;

  /**
   * Delete a tool from a project
   * Returns true if deleted, false if not found
   */
  deleteTool(projectId: string, toolName: string): Promise<boolean> | boolean;

  /**
   * Delete all tools for a project
   */
  deleteProject(projectId: string): Promise<void> | void;

  /**
   * Clear all tools from all projects
   */
  clearAll?(): Promise<void> | void;
}

/**
 * Default in-memory registry store
 *
 * Simple nested Map implementation. State is lost on restart
 * and not shared across multiple server instances.
 */
export class InMemoryRegistryStore implements RegistryStore {
  private store: Map<string, Map<string, RegisteredTool>> = new Map();

  getProjectTools(projectId: string): Map<string, RegisteredTool> {
    return this.store.get(projectId) || new Map();
  }

  getTool(projectId: string, toolName: string): RegisteredTool | undefined {
    return this.store.get(projectId)?.get(toolName);
  }

  setTool(projectId: string, toolName: string, registeredTool: RegisteredTool): void {
    let projectTools = this.store.get(projectId);
    if (!projectTools) {
      projectTools = new Map();
      this.store.set(projectId, projectTools);
    }
    projectTools.set(toolName, registeredTool);
  }

  deleteTool(projectId: string, toolName: string): boolean {
    const projectTools = this.store.get(projectId);
    if (!projectTools) {
      return false;
    }
    return projectTools.delete(toolName);
  }

  deleteProject(projectId: string): void {
    this.store.delete(projectId);
  }

  clearAll(): void {
    this.store.clear();
  }
}
