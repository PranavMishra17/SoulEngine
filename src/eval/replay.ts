/**
 * Conversation replay runner for offline evaluation of NPC cognition.
 *
 * Runs fixtures end-to-end through the real cognition path with stub providers,
 * measuring timing, recall correctness, and tool accuracy.
 */

import { createLogger } from '../logger.js';
import { StageTimer } from './timer.js';
import { StubLLMProvider } from '../providers/llm/stub.js';
import { runMindAgentLoop } from '../core/mind.js';
import { assembleSlimSystemPrompt, augmentPromptWithMindContext, assembleConversationHistory } from '../core/context.js';
import { isRecallTool } from '../core/tools.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import type { ConversationFixture } from '../schema/eval.js';
import type { Message } from '../types/session.js';
import type { SecurityContext } from '../types/security.js';
import type { Tool } from '../types/mcp.js';

const logger = createLogger('eval-replay');

/**
 * Report for a single conversation turn.
 */
export interface TurnReport {
  turn: number;
  playerInput: string;
  speakerResponse: string;
  timings: {
    mindDurationMs: number;
    speakerDurationMs: number;
    totalMs: number;
    stages: Record<string, number>;
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
  turns: TurnReport[];
  aggregate: {
    avgMindLatencyMs: number;
    avgSpeakerLatencyMs: number;
    avgTotalLatencyMs: number;
    recallHitRate: number;
    toolAccuracy: number;
  };
}

/**
 * Run a conversation fixture through the cognition path and return a report.
 *
 * @param fixture - The conversation fixture to replay
 * @returns Detailed report with per-turn and aggregate metrics
 */
export async function runReplay(fixture: ConversationFixture): Promise<ReplayReport> {
  logger.info({ fixture: fixture.name }, 'Starting replay');

  const { definition, instance, knowledgeBase } = fixture.npc;
  const conversationHistory: Message[] = [];
  const turnReports: TurnReport[] = [];
  let deferredMindContext: string | undefined;

  // Security context (permissive for testing)
  const securityContext: SecurityContext = {
    sanitized: true,
    moderated: true,
    rateLimited: false,
    exitRequested: false,
    moderationFlags: [],
    inputViolations: [],
  };

  // Project tools (empty for now - can be extended for fixtures that need them)
  const projectTools: Record<string, Tool> = {};

  for (let i = 0; i < fixture.turns.length; i++) {
    const turn = fixture.turns[i];
    const timer = new StageTimer();
    timer.markStart();

    logger.debug({ turn: i + 1, playerInput: turn.playerInput }, 'Processing turn');

    // Create stub providers for this turn
    const mindProvider = new StubLLMProvider({
      responses: turn.mindResponses,
    });

    const speakerProvider = new StubLLMProvider({
      responses: turn.speakerResponses,
    });

    // Add player message to history
    conversationHistory.push({
      role: 'user',
      content: turn.playerInput,
    });

    timer.mark('player_input_added');

    // Build conversation history for LLM
    const llmHistory = assembleConversationHistory(conversationHistory, 20);

    // Run Mind agent (in parallel with Speaker in real system, but sequential here for measurement)
    timer.mark('mind_start');
    const mindResult = await runMindAgentLoop(
      definition,
      instance,
      turn.playerInput,
      llmHistory,
      mindProvider,
      definition.project_id,
      knowledgeBase ?? null,
      mcpToolRegistry,
      securityContext,
      projectTools,
      new AbortController().signal,
      null, // userId
    );
    timer.mark('mind_end');

    // Assemble Speaker prompt (slim, no knowledge)
    let speakerPrompt = await assembleSlimSystemPrompt(
      definition,
      instance,
      securityContext,
      {},
      fixture.playerInfo ?? null,
      null, // userId
    );

    // Augment with deferred mind context from previous turn
    if (deferredMindContext) {
      speakerPrompt = augmentPromptWithMindContext(speakerPrompt, deferredMindContext);
      timer.mark('deferred_context_injected');
    }

    timer.mark('speaker_start');

    // Run Speaker
    let speakerResponse = '';
    for await (const chunk of speakerProvider.streamChat({
      systemPrompt: speakerPrompt,
      messages: llmHistory,
    })) {
      if (chunk.text) speakerResponse += chunk.text;
    }

    timer.mark('speaker_end');

    // Add assistant message to history
    conversationHistory.push({
      role: 'assistant',
      content: speakerResponse,
    });

    // Process Mind results - separate recall vs MCP tools
    const recallResults: string[] = [];
    const mcpResults: string[] = [];

    for (const tr of mindResult.tools_called) {
      if (tr.status === 'error') continue;

      if (isRecallTool(tr.tool_name)) {
        if (tr.result_content) {
          recallResults.push(tr.result_content);
        }
      } else {
        mcpResults.push(tr.result_content || 'executed successfully');
      }
    }

    // Defer recall results to next turn
    deferredMindContext = recallResults.length > 0 ? recallResults.join('\n') : undefined;

    timer.mark('turn_complete');

    // Analyze recall correctness
    const expectedFacts = turn.expectations?.recallFacts ?? [];
    const factsInReply: string[] = [];
    const factsInPrompt: string[] = [];

    for (const fact of expectedFacts) {
      const factLower = fact.toLowerCase();
      if (speakerResponse.toLowerCase().includes(factLower)) {
        factsInReply.push(fact);
      }
      if (speakerPrompt.toLowerCase().includes(factLower)) {
        factsInPrompt.push(fact);
      }
    }

    const recallHitRate = expectedFacts.length > 0
      ? factsInReply.length / expectedFacts.length
      : 1.0;

    // Analyze tool correctness
    const expectedCalls = turn.expectations?.toolsCalled ?? [];
    const notExpectedCalls = turn.expectations?.toolsNotCalled ?? [];
    const actualCalls = mindResult.tools_called.map(tc => tc.tool_name);

    const unexpectedCalls = actualCalls.filter(name =>
      notExpectedCalls.includes(name) || (!expectedCalls.includes(name) && expectedCalls.length > 0)
    );

    const toolAccuracy = expectedCalls.length > 0
      ? expectedCalls.filter(name => actualCalls.includes(name)).length / expectedCalls.length
      : 1.0;

    // Build turn report
    const mindDuration = mindResult.duration_ms;
    const speakerDuration = timer.elapsed('speaker_start', 'speaker_end') ?? 0;
    const totalDuration = timer.elapsed('player_input_added', 'turn_complete') ?? 0;

    turnReports.push({
      turn: i + 1,
      playerInput: turn.playerInput,
      speakerResponse,
      timings: {
        mindDurationMs: mindDuration,
        speakerDurationMs: speakerDuration,
        totalMs: totalDuration,
        stages: timer.getStages(),
      },
      recall: {
        expectedFacts,
        factsInReply,
        factsInPrompt,
        hitRate: recallHitRate,
      },
      tools: {
        expectedCalls,
        actualCalls,
        unexpectedCalls,
        accuracy: toolAccuracy,
      },
    });

    logger.debug({
      turn: i + 1,
      mindDurationMs: mindDuration,
      speakerDurationMs: speakerDuration,
      recallHitRate,
      toolAccuracy,
    }, 'Turn complete');
  }

  // Calculate aggregate metrics
  const avgMindLatency = turnReports.reduce((sum, r) => sum + r.timings.mindDurationMs, 0) / turnReports.length;
  const avgSpeakerLatency = turnReports.reduce((sum, r) => sum + r.timings.speakerDurationMs, 0) / turnReports.length;
  const avgTotalLatency = turnReports.reduce((sum, r) => sum + r.timings.totalMs, 0) / turnReports.length;

  const totalRecallFacts = turnReports.reduce((sum, r) => sum + r.recall.expectedFacts.length, 0);
  const totalRecallHits = turnReports.reduce((sum, r) => sum + r.recall.factsInReply.length, 0);
  const overallRecallHitRate = totalRecallFacts > 0 ? totalRecallHits / totalRecallFacts : 1.0;

  const totalToolExpectations = turnReports.reduce((sum, r) => sum + r.tools.expectedCalls.length, 0);
  const totalToolHits = turnReports.reduce((sum, r) => {
    return sum + r.tools.expectedCalls.filter(name => r.tools.actualCalls.includes(name)).length;
  }, 0);
  const overallToolAccuracy = totalToolExpectations > 0 ? totalToolHits / totalToolExpectations : 1.0;

  logger.info({
    fixture: fixture.name,
    turns: turnReports.length,
    avgMindLatency,
    avgSpeakerLatency,
    recallHitRate: overallRecallHitRate,
    toolAccuracy: overallToolAccuracy,
  }, 'Replay complete');

  return {
    fixture: fixture.name,
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
