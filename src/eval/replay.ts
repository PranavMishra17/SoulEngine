/**
 * Conversation replay runner for offline evaluation of NPC cognition.
 *
 * Runs fixtures end-to-end through the turn loop that ships, with scripted
 * providers standing in for the models, and measures timing, recall correctness
 * and tool accuracy.
 *
 * This file used to run its own copy of the turn. The copy drifted: no
 * `- Retrieved (<tool>): ` prefix on deferred recall, no follow-up utterance
 * after an action, no narration stripping, no Mind timeout, no mood blending.
 * An evaluator that reimplements the thing it evaluates reports on the
 * reimplementation. It now opens a real session and calls
 * `runConversationTurn`, the same function the HTTP route and the text harness
 * use. See specs/5.19.md.
 */

import { createLogger } from '../logger.js';
import { StubLLMProvider } from '../providers/llm/stub.js';
import { runConversationTurn } from '../conversation/turn.js';
import { startSession, endSession } from '../session/manager.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import * as storage from '../storage/index.js';
import type { ConversationFixture } from '../schema/eval.js';
import type { NPCDefinition, NPCInstance } from '../types/npc.js';

const logger = createLogger('eval-replay');

/**
 * Report for a single conversation turn.
 */
export interface TurnReport {
  turn: number;
  playerInput: string;
  speakerResponse: string;
  /**
   * The system prompt the Speaker was actually given, including any recall
   * deferred from the previous turn. This is what makes a miss diagnosable: a
   * fact absent from the reply but present here is a Speaker problem, absent
   * from both is a recall problem.
   */
  speakerPrompt: string;
  timings: {
    mindDurationMs: number;
    speakerDurationMs: number;
    /** Follow-up speech after an action, when the turn produced one. */
    followUpMs: number | null;
    totalMs: number;
  };
  recall: {
    expectedFacts: string[];
    factsInReply: string[];
    factsInPrompt: string[];
    hitRate: number;
  };
  tools: {
    expectedCalls: string[];
    actualCalls: string[];
    unexpectedCalls: string[];
    accuracy: number;
  };
}

/**
 * Aggregate report for an entire conversation fixture.
 */
export interface ReplayReport {
  fixture: string;
  /** The scratch project the fixture ran in. Deleted by the time this returns. */
  projectId: string;
  /** Session id, so the run can be found in the session log. */
  sessionId: string;
  turns: TurnReport[];
  aggregate: {
    avgMindLatencyMs: number;
    avgSpeakerLatencyMs: number;
    avgTotalLatencyMs: number;
    recallHitRate: number;
    toolAccuracy: number;
  };
}

interface ScratchWorld {
  projectId: string;
  npcId: string;
  playerId: string;
}

/**
 * Write the fixture into storage so a real session can be opened against it.
 *
 * Storage assigns the project, NPC and instance ids; the fixture's own
 * `test-npc-1` style ids are treated as documentation and discarded. A fixture
 * therefore cannot disagree with the id scheme, which is how instances came to
 * collide in the first place (ERR-024).
 */
async function materialiseFixture(fixture: ConversationFixture): Promise<ScratchWorld> {
  const source = fixture.npc;
  const playerId = source.instance.player_id;

  const project = await storage.createProject(`eval: ${fixture.name}`);

  const { id: _ignoredNpcId, project_id: _ignoredProjectId, ...definitionFields } = source.definition;
  const definition = await storage.createDefinition(
    project.id,
    definitionFields as Omit<NPCDefinition, 'id' | 'project_id'>
  );

  if (source.knowledgeBase) {
    await storage.updateKnowledgeBase(project.id, source.knowledgeBase);
  }

  // getOrCreateInstance owns identity; the fixture owns the mind's contents.
  const created = await storage.getOrCreateInstance(project.id, definition.id, playerId);
  const seeded: NPCInstance = {
    ...created,
    current_mood: source.instance.current_mood,
    trait_modifiers: source.instance.trait_modifiers,
    short_term_memory: source.instance.short_term_memory,
    long_term_memory: source.instance.long_term_memory,
    relationships: source.instance.relationships,
    daily_pulse: source.instance.daily_pulse,
    cycle_metadata: source.instance.cycle_metadata,
  };
  await storage.saveInstance(seeded);

  return { projectId: project.id, npcId: definition.id, playerId };
}

/**
 * Run a conversation fixture through the cognition path and return a report.
 *
 * @param fixture - The conversation fixture to replay
 * @returns Detailed report with per-turn and aggregate metrics
 */
export async function runReplay(fixture: ConversationFixture): Promise<ReplayReport> {
  logger.info({ fixture: fixture.name }, 'Starting replay');

  const world = await materialiseFixture(fixture);
  const turnReports: TurnReport[] = [];
  let sessionId = '';

  try {
    const session = await startSession(
      world.projectId,
      world.npcId,
      world.playerId,
      fixture.playerInfo ?? undefined
    );
    sessionId = session.session_id;

    for (let i = 0; i < fixture.turns.length; i++) {
      const turn = fixture.turns[i];
      logger.debug({ turn: i + 1, playerInput: turn.playerInput }, 'Processing turn');

      // Fresh scripted providers per turn: the fixture scripts the Mind and the
      // Speaker separately, which is the one thing project settings cannot say.
      const result = await runConversationTurn({
        sessionId,
        content: turn.playerInput,
        fallbackProvider: null,
        providers: {
          speaker: new StubLLMProvider({ responses: turn.speakerResponses }),
          mind: new StubLLMProvider({ responses: turn.mindResponses }),
        },
        toolRegistry: mcpToolRegistry,
        channel: 'eval',
      });

      const speakerResponse = result.responseText;
      const speakerPrompt = result.speakerPrompt;

      // Recall correctness. A fact can reach the reply, or only the prompt, or
      // neither -- the three cases need different fixes, so all three are kept.
      const expectedFacts = turn.expectations?.recallFacts ?? [];
      const factsInReply = expectedFacts.filter((f) =>
        speakerResponse.toLowerCase().includes(f.toLowerCase())
      );
      const factsInPrompt = expectedFacts.filter((f) =>
        speakerPrompt.toLowerCase().includes(f.toLowerCase())
      );
      const recallHitRate =
        expectedFacts.length > 0 ? factsInReply.length / expectedFacts.length : 1.0;

      // Tool correctness
      const expectedCalls = turn.expectations?.toolsCalled ?? [];
      const notExpectedCalls = turn.expectations?.toolsNotCalled ?? [];
      const actualCalls = result.mindResult?.tools_called.map((tc) => tc.tool_name) ?? [];

      const unexpectedCalls = actualCalls.filter(
        (name) =>
          notExpectedCalls.includes(name) ||
          (!expectedCalls.includes(name) && expectedCalls.length > 0)
      );

      const toolAccuracy =
        expectedCalls.length > 0
          ? expectedCalls.filter((name) => actualCalls.includes(name)).length / expectedCalls.length
          : 1.0;

      turnReports.push({
        turn: i + 1,
        playerInput: turn.playerInput,
        speakerResponse,
        speakerPrompt,
        timings: {
          mindDurationMs: result.timings.mindMs ?? 0,
          speakerDurationMs: result.timings.speakerMs,
          followUpMs: result.timings.followUpMs,
          totalMs: result.timings.wallMs,
        },
        recall: { expectedFacts, factsInReply, factsInPrompt, hitRate: recallHitRate },
        tools: { expectedCalls, actualCalls, unexpectedCalls, accuracy: toolAccuracy },
      });

      logger.debug(
        {
          turn: i + 1,
          mindDurationMs: result.timings.mindMs,
          speakerDurationMs: result.timings.speakerMs,
          recallHitRate,
          toolAccuracy,
        },
        'Turn complete'
      );
    }

    // Ending the session is part of what is being evaluated: it is where the
    // conversation becomes a memory.
    await endSession(
      sessionId,
      new StubLLMProvider({ responses: [{ text: `Replay of ${fixture.name}.` }] })
    );
  } finally {
    await storage.deleteProject(world.projectId).catch((err) => {
      logger.warn(
        { projectId: world.projectId, error: err instanceof Error ? err.message : 'Unknown error' },
        'Could not remove the scratch project'
      );
    });
  }

  const turnCount = turnReports.length || 1;
  const avgMindLatency = turnReports.reduce((s, r) => s + r.timings.mindDurationMs, 0) / turnCount;
  const avgSpeakerLatency = turnReports.reduce((s, r) => s + r.timings.speakerDurationMs, 0) / turnCount;
  const avgTotalLatency = turnReports.reduce((s, r) => s + r.timings.totalMs, 0) / turnCount;

  const totalRecallFacts = turnReports.reduce((s, r) => s + r.recall.expectedFacts.length, 0);
  const totalRecallHits = turnReports.reduce((s, r) => s + r.recall.factsInReply.length, 0);
  const overallRecallHitRate = totalRecallFacts > 0 ? totalRecallHits / totalRecallFacts : 1.0;

  const totalToolExpectations = turnReports.reduce((s, r) => s + r.tools.expectedCalls.length, 0);
  const totalToolHits = turnReports.reduce(
    (s, r) => s + r.tools.expectedCalls.filter((name) => r.tools.actualCalls.includes(name)).length,
    0
  );
  const overallToolAccuracy =
    totalToolExpectations > 0 ? totalToolHits / totalToolExpectations : 1.0;

  logger.info(
    {
      fixture: fixture.name,
      sessionId,
      turns: turnReports.length,
      avgMindLatency,
      avgSpeakerLatency,
      recallHitRate: overallRecallHitRate,
      toolAccuracy: overallToolAccuracy,
    },
    'Replay complete'
  );

  return {
    fixture: fixture.name,
    projectId: world.projectId,
    sessionId,
    turns: turnReports,
    aggregate: {
      avgMindLatencyMs: avgMindLatency,
      avgSpeakerLatencyMs: avgSpeakerLatency,
      avgTotalLatencyMs: avgTotalLatency,
      recallHitRate: overallRecallHitRate,
      toolAccuracy: overallToolAccuracy,
    },
  };
}
