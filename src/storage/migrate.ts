/**
 * Local-to-Supabase project migration.
 *
 * Reads each persisted entity from the local filesystem backend, validates it
 * against the versioned zod schemas (src/schema/index.ts), re-encrypts secrets
 * via the shared crypto module, then writes to the Supabase backend.
 *
 * No route is mounted here — callers import migrateLocalToSupabase directly.
 */

import { createLogger } from '../logger.js';
import {
  NPCDefinitionSchema,
  ProjectSchema,
  KnowledgeBaseSchema,
  NPCInstanceSchema,
  ProjectMCPToolsSchema,
} from '../schema/index.js';

// Local storage readers
import { getProject } from './local/projects.js';
import { listDefinitions } from './local/definitions.js';
import { listInstances } from './local/instances.js';
import { getKnowledgeBase } from './local/knowledge.js';
import { getMCPTools } from './local/mcp-tools.js';
import { loadApiKeys } from './local/secrets.js';

// Supabase storage writers
import { updateProject } from './supabase/projects.js';
import { createDefinition } from './supabase/definitions.js';
import { saveInstance } from './supabase/instances.js';
import { updateKnowledgeBase } from './supabase/knowledge.js';
import { saveMCPTools } from './supabase/mcp-tools.js';
import { saveApiKeys } from './supabase/secrets.js';

const logger = createLogger('migrate');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationSummary {
  /** "ok" | "<error message>" */
  project: string;
  /** "ok" | "<error message>" */
  knowledgeBase: string;
  /** Number of definitions successfully migrated */
  definitions: number;
  /** Number of instances successfully migrated */
  instances: number;
  /** "ok" | "skipped" | "<error message>" */
  mcpTools: string;
  /** "ok" | "skipped" | "<error message>" */
  secrets: string;
  /** Accumulated list of error descriptions for partial failures */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Migrate all entities belonging to a project from local filesystem storage to
 * Supabase.  Validates each entity against the versioned schema before writing.
 * Partial failures are logged and included in the returned summary rather than
 * thrown, so a single bad record does not abort the entire migration.
 *
 * @param projectId - The project to migrate.
 * @param userId    - The Supabase user ID to associate with the project.
 * @returns A summary describing what was migrated and any errors encountered.
 */
export async function migrateLocalToSupabase(
  projectId: string,
  userId: string
): Promise<MigrationSummary> {
  const startTime = Date.now();
  const summary: MigrationSummary = {
    project: 'pending',
    knowledgeBase: 'pending',
    definitions: 0,
    instances: 0,
    mcpTools: 'pending',
    secrets: 'pending',
    errors: [],
  };

  logger.info({ projectId, userId }, 'Starting local-to-Supabase migration');

  // -------------------------------------------------------------------------
  // 1. Project
  // -------------------------------------------------------------------------
  try {
    const rawProject = await getProject(projectId);
    const parsed = ProjectSchema.safeParse(rawProject);
    if (!parsed.success) {
      const msg = `Project schema validation failed: ${parsed.error.message}`;
      logger.warn({ projectId, issues: parsed.error.issues }, msg);
      summary.errors.push(msg);
      summary.project = msg;
    } else {
      await updateProject(projectId, {
        name: parsed.data.name,
        settings: parsed.data.settings,
        limits: parsed.data.limits,
        user_id: userId,
      });
      summary.project = 'ok';
      logger.info({ projectId }, 'Project migrated');
    }
  } catch (error) {
    const msg = `Project migration error: ${error instanceof Error ? error.message : String(error)}`;
    logger.error({ projectId, error: msg }, 'Failed to migrate project');
    summary.errors.push(msg);
    summary.project = msg;
  }

  // -------------------------------------------------------------------------
  // 2. Knowledge base
  // -------------------------------------------------------------------------
  try {
    const rawKB = await getKnowledgeBase(projectId);
    const parsed = KnowledgeBaseSchema.safeParse(rawKB);
    if (!parsed.success) {
      const msg = `Knowledge base schema validation failed: ${parsed.error.message}`;
      logger.warn({ projectId, issues: parsed.error.issues }, msg);
      summary.errors.push(msg);
      summary.knowledgeBase = msg;
    } else {
      await updateKnowledgeBase(projectId, parsed.data);
      summary.knowledgeBase = 'ok';
      logger.info({ projectId }, 'Knowledge base migrated');
    }
  } catch (error) {
    const msg = `Knowledge base migration error: ${error instanceof Error ? error.message : String(error)}`;
    logger.error({ projectId, error: msg }, 'Failed to migrate knowledge base');
    summary.errors.push(msg);
    summary.knowledgeBase = msg;
  }

  // -------------------------------------------------------------------------
  // 3. NPC Definitions
  // -------------------------------------------------------------------------
  try {
    const rawDefinitions = await listDefinitions(projectId);

    for (const rawDef of rawDefinitions) {
      try {
        const parsed = NPCDefinitionSchema.safeParse(rawDef);
        if (!parsed.success) {
          const msg = `Definition "${rawDef.id ?? rawDef.name}" schema validation failed: ${parsed.error.message}`;
          logger.warn({ projectId, defId: rawDef.id, issues: parsed.error.issues }, msg);
          summary.errors.push(msg);
          continue;
        }

        // createDefinition expects Omit<NPCDefinition, 'id' | 'project_id'>
        const { id: _id, project_id: _pid, ...defWithoutId } = parsed.data;
        await createDefinition(projectId, defWithoutId);
        summary.definitions += 1;
        logger.info({ projectId, defId: rawDef.id }, 'Definition migrated');
      } catch (error) {
        const msg = `Definition "${rawDef.id ?? rawDef.name}" migration error: ${error instanceof Error ? error.message : String(error)}`;
        logger.error({ projectId, defId: rawDef.id, error: msg }, 'Failed to migrate definition');
        summary.errors.push(msg);
      }
    }
  } catch (error) {
    const msg = `Failed to list definitions: ${error instanceof Error ? error.message : String(error)}`;
    logger.error({ projectId, error: msg }, 'Cannot list local definitions');
    summary.errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // 4. NPC Instances
  // -------------------------------------------------------------------------
  try {
    const rawInstances = await listInstances(projectId);

    for (const rawInst of rawInstances) {
      try {
        const parsed = NPCInstanceSchema.safeParse(rawInst);
        if (!parsed.success) {
          const msg = `Instance "${rawInst.id}" schema validation failed: ${parsed.error.message}`;
          logger.warn({ projectId, instanceId: rawInst.id, issues: parsed.error.issues }, msg);
          summary.errors.push(msg);
          continue;
        }

        await saveInstance(parsed.data);
        summary.instances += 1;
        logger.info({ projectId, instanceId: rawInst.id }, 'Instance migrated');
      } catch (error) {
        const msg = `Instance "${rawInst.id}" migration error: ${error instanceof Error ? error.message : String(error)}`;
        logger.error({ projectId, instanceId: rawInst.id, error: msg }, 'Failed to migrate instance');
        summary.errors.push(msg);
      }
    }
  } catch (error) {
    const msg = `Failed to list instances: ${error instanceof Error ? error.message : String(error)}`;
    logger.error({ projectId, error: msg }, 'Cannot list local instances');
    summary.errors.push(msg);
  }

  // -------------------------------------------------------------------------
  // 5. MCP Tools
  // -------------------------------------------------------------------------
  try {
    const rawTools = await getMCPTools(projectId);
    const parsed = ProjectMCPToolsSchema.safeParse(rawTools);
    if (!parsed.success) {
      const msg = `MCP tools schema validation failed: ${parsed.error.message}`;
      logger.warn({ projectId, issues: parsed.error.issues }, msg);
      summary.errors.push(msg);
      summary.mcpTools = msg;
    } else {
      await saveMCPTools(projectId, parsed.data);
      summary.mcpTools = 'ok';
      logger.info({ projectId }, 'MCP tools migrated');
    }
  } catch (error) {
    const msg = `MCP tools migration error: ${error instanceof Error ? error.message : String(error)}`;
    logger.error({ projectId, error: msg }, 'Failed to migrate MCP tools');
    summary.errors.push(msg);
    summary.mcpTools = msg;
  }

  // -------------------------------------------------------------------------
  // 6. Secrets (API keys) — decrypt from local, re-encrypt to Supabase
  // -------------------------------------------------------------------------
  try {
    const apiKeys = await loadApiKeys(projectId);
    const hasKeys = Object.values(apiKeys).some(v => typeof v === 'string' && v.length > 0);

    if (!hasKeys) {
      summary.secrets = 'skipped';
      logger.info({ projectId }, 'No API keys to migrate');
    } else {
      // loadApiKeys returns plaintext; saveApiKeys (supabase) will re-encrypt
      // with the same ENCRYPTION_KEY using the supabase envelope format.
      await saveApiKeys(projectId, apiKeys);
      summary.secrets = 'ok';
      logger.info({ projectId }, 'API keys migrated (re-encrypted)');
    }
  } catch (error) {
    const msg = `Secrets migration error: ${error instanceof Error ? error.message : String(error)}`;
    logger.error({ projectId, error: msg }, 'Failed to migrate API keys');
    summary.errors.push(msg);
    summary.secrets = msg;
  }

  const duration = Date.now() - startTime;
  logger.info(
    {
      projectId,
      userId,
      definitions: summary.definitions,
      instances: summary.instances,
      errorCount: summary.errors.length,
      duration,
    },
    'Migration complete'
  );

  return summary;
}
