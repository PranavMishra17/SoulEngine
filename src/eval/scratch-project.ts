import { getStorage } from '../storage/factory.js';
import { createLogger } from '../logger.js';
import type { NPCDefinition, NPCInstance } from '../types/npc.js';
import type { KnowledgeBase } from '../types/knowledge.js';

const logger = createLogger('scratch-project');

export interface ScratchWorld {
  projectId: string;
  npcId: string;
  playerId: string;
}

export interface ScenarioNPC {
  definition: NPCDefinition;
  instance: NPCInstance;
  knowledgeBase?: KnowledgeBase;
}

/**
 * Write an NPC definition and instance into storage so a real session can be opened against it.
 *
 * Storage assigns the project, NPC and instance ids; the scenario's own
 * `test-npc-1` style ids are treated as documentation and discarded. A scenario
 * therefore cannot disagree with the id scheme, which is how instances came to
 * collide in the first place (ERR-024).
 */
export async function materialiseScenario(
  name: string,
  npc: ScenarioNPC,
  userId?: string | null
): Promise<ScratchWorld> {
  const store = getStorage(userId ?? null);
  const playerId = npc.instance.player_id;

  const project = await store.createProject(`scratch: ${name}`);

  const { id: _ignoredNpcId, project_id: _ignoredProjectId, ...definitionFields } = npc.definition;
  const definition = await store.createDefinition(
    project.id,
    definitionFields as Omit<NPCDefinition, 'id' | 'project_id'>
  );

  if (npc.knowledgeBase) {
    await store.updateKnowledgeBase(project.id, npc.knowledgeBase);
  }

  const created = await store.getOrCreateInstance(project.id, definition.id, playerId);
  const seeded: NPCInstance = {
    ...created,
    current_mood: npc.instance.current_mood,
    trait_modifiers: npc.instance.trait_modifiers,
    short_term_memory: npc.instance.short_term_memory,
    long_term_memory: npc.instance.long_term_memory,
    relationships: npc.instance.relationships,
    daily_pulse: npc.instance.daily_pulse,
    cycle_metadata: npc.instance.cycle_metadata,
  };
  await store.saveInstance(seeded);

  logger.info({ projectId: project.id, npcId: definition.id, name }, 'Scratch project materialised');

  return { projectId: project.id, npcId: definition.id, playerId };
}

/**
 * Clean up a scratch project after a scenario run.
 */
export async function teardownProject(projectId: string, userId?: string | null): Promise<void> {
  const store = getStorage(userId ?? null);
  try {
    await store.deleteProject(projectId);
    logger.info({ projectId }, 'Scratch project torn down');
  } catch (error) {
    logger.warn(
      { projectId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Could not remove scratch project'
    );
  }
}
