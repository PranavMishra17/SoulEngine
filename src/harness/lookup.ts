/**
 * Shared lookups for the harness commands and the playground: which project
 * holds an NPC, which LLM provider a project resolves to (stored key, then
 * environment, then --stub), and the project's registered tools. Lives apart
 * from cli.ts because that module runs main() on import.
 */
import { createLogger } from '../logger.js';
import { getStorage } from '../storage/factory.js';
import { getConfig } from '../config.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { createLlmProvider, getDefaultLlmProviderType, getDefaultModel } from '../providers/llm/factory.js';
import { StubLLMProvider } from '../providers/llm/stub.js';
import type { LLMProvider, LLMProviderType } from '../providers/llm/interface.js';
import type { NPCDefinition } from '../types/npc.js';

const logger = createLogger('harness-lookup');

/** Locate which project holds a definition, so the caller only needs an npc id. */
export async function findNpc(npcId: string): Promise<{ projectId: string; definition: NPCDefinition }> {
  const storage = getStorage(null);
  const projects = await storage.listProjects(undefined);
  for (const project of projects) {
    try {
      const definition = await storage.getDefinition(project.id, npcId);
      return { projectId: project.id, definition };
    } catch {
      // Not in this project.
    }
  }
  throw new Error(`NPC ${npcId} was not found in any local project`);
}

/**
 * The encryption key is required even in stub mode: opening a project calls
 * loadApiKeys, which throws without it. Say so plainly rather than surfacing a
 * storage stack trace.
 */
export function explainStorageFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENCRYPTION_KEY') || message.includes('Encryption key')) {
    return (
      'ENCRYPTION_KEY is not set. It is required even with --stub, because opening a project ' +
      'reads its stored provider keys. Set it to the value this data directory was written with.'
    );
  }
  if (message.includes('Decryption failed')) {
    return (
      'The project secrets could not be decrypted with the current ENCRYPTION_KEY. This usually means ' +
      'the key was rotated. Re-enter the provider keys in the web UI, or use "seed" to make a fresh ' +
      'project this harness can talk to.'
    );
  }
  return message;
}

export async function resolveProvider(
  projectId: string,
  stub: boolean,
  note: (message: string) => void = () => {}
): Promise<LLMProvider> {
  if (stub) {
    return new StubLLMProvider({
      defaultLatencyMs: 5,
      responses: [{ text: '[stub speaker reply]' }],
    });
  }
  const storage = getStorage(null);
  const project = await storage.getProject(projectId);
  const providerType = (project.settings.llm_provider || getDefaultLlmProviderType()) as LLMProviderType;
  const model = project.settings.llm_model || getDefaultModel(providerType);

  // Prefer the project's own stored key, as the route does.
  let apiKey: string | undefined;
  try {
    const keys = await storage.loadApiKeys(projectId);
    apiKey = keys[providerType as keyof typeof keys];
  } catch (error) {
    note(`(project keys unreadable: ${explainStorageFailure(error)})`);
  }

  // Fall back to the environment, which is what the route does when a project
  // has no usable key of its own.
  if (!apiKey) {
    const envKey = getConfig().providers?.[`${providerType}ApiKey` as keyof ReturnType<typeof getConfig>['providers']];
    if (typeof envKey === 'string' && envKey.length > 0) {
      note(`(using ${providerType} key from the environment, not the project)`);
      apiKey = envKey;
    }
  }

  if (!apiKey) {
    throw new Error(
      `No ${providerType} API key available for project ${projectId}: the project's key could not be read ` +
      `and none is set in the environment. Add one in the web UI, export ${providerType.toUpperCase()}_API_KEY, or run with --stub.`
    );
  }

  return createLlmProvider({ provider: providerType, apiKey, model });
}

export async function registerProjectTools(projectId: string): Promise<void> {
  try {
    const storage = getStorage(null);
    const mcpTools = await storage.getMCPTools(projectId);
    const allTools = [
      ...mcpTools.conversation_tools.map((t: { id: string; description: string; parameters?: unknown }) => ({
        name: t.id,
        description: t.description,
        parameters: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
      })),
      ...mcpTools.game_event_tools.map((t: { id: string; description: string; parameters?: unknown }) => ({
        name: t.id,
        description: t.description,
        parameters: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
      })),
    ];
    if (allTools.length > 0) mcpToolRegistry.registerTools(projectId, allTools);
  } catch (error) {
    logger.warn(
      { projectId, error: error instanceof Error ? error.message : 'Unknown' },
      'Could not load project MCP tools'
    );
  }
}
