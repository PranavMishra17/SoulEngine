import { executeMindTool } from '../mind.js';
import { isRecallTool, isExitConvoTool, getMindAvailableTools } from '../tools.js';
import { stripNarration } from '../../conversation/turn.js';
import { formatSingleCallTask } from '../context.js';
import { recallMemoriesFor, recallKnowledgeFor, recallNpcsFor, RECALL_KNOWLEDGE_TOKEN_BUDGET } from '../recall.js';
import { formatMemoriesForPrompt } from '../memory.js';
import { getStorage } from '../../storage/factory.js';
import type {
  CognitionRuntime,
  CognitionInput,
  CognitionEvent,
  CognitionSummary,
} from '../runtime.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type { MindToolResult } from '../../types/mind.js';

/**
 * SingleCallRuntime: one streamed LLM call produces speech and tool calls together.
 *
 * Recall is fetched before the call (deterministic, no second model).
 * Action tools execute after the stream ends.
 * No follow-up call.
 */
import { createLogger } from '../../logger.js';

const logger = createLogger('single-call-runtime');

/** Spoken when the model exits without saying anything; a line, not a stage direction, so it survives TTS. */
const SILENT_EXIT_LINE = "We're done here.";

export class SingleCallRuntime implements CognitionRuntime {
  readonly name = 'single' as const;

  async *generate(input: CognitionInput): AsyncIterable<CognitionEvent> {
    const {
      prompt,
      history,
      playerInput,
      tools,
      toolRegistry,
      providers,
      cacheKey,
      context,
    } = input;

    const { definition, instance, knowledgeBase, projectId, userId } = context;
    const { speaker: activeProvider } = providers;

    // --- Pre-fetch recall ---
    const recallSections: string[] = [];

    // Recall memories
    const matchedMemories = recallMemoriesFor(instance, playerInput, 5);
    if (matchedMemories.length > 0) {
      const formatted = formatMemoriesForPrompt(matchedMemories, 5);
      recallSections.push(`Memories:\n${formatted}`);
    }

    // Recall knowledge
    const knowledgeRecall = recallKnowledgeFor(
      definition,
      knowledgeBase,
      playerInput,
      RECALL_KNOWLEDGE_TOKEN_BUDGET,
    );
    if (knowledgeRecall) {
      recallSections.push(`Knowledge:\n${knowledgeRecall}`);
    }

    // Recall NPCs
    const storage = getStorage(userId);
    const npcRecall = await recallNpcsFor(definition, playerInput, storage);
    if (npcRecall) {
      recallSections.push(`Known NPCs:\n${npcRecall}`);
    }

    // Build recall section
    let recallSection = '';
    if (recallSections.length > 0) {
      recallSection = `\n\n[RELEVANT TO WHAT WAS JUST SAID]\n${recallSections.join('\n\n')}`;
    }

    // --- Offer the same tool set the Mind would, minus recall (pre-fetched above) ---
    // `tools` from the host is the project registry only; the built-ins
    // (exit_convo, and the recall tools we drop) come from getMindAvailableTools,
    // exactly as the parallel Mind assembles them. Without this the prompt
    // names exit_convo and the model can only write the word.
    const actionToolsList: Tool[] = getMindAvailableTools(definition, context.securityContext, tools).filter(
      (tool) => !isRecallTool(tool.name)
    );

    // --- Build task section ---
    const hasActionTools = actionToolsList.length > 0;
    const taskSection = formatSingleCallTask(definition, false, hasActionTools);

    // --- Make the single streamChat call ---
    const speakerStart = Date.now();
    let responseText = '';
    let speakerTtftMs: number | null = null;
    let providerUsage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number } | undefined;
    const collectedToolCalls: ToolCall[] = [];

    for await (const chunk of activeProvider.streamChat({
      systemPromptPrefix: prompt.stable,
      systemPrompt: prompt.dynamic + recallSection + '\n\n' + taskSection,
      cacheKey,
      messages: history,
      tools: hasActionTools ? actionToolsList : undefined,
      // Deliberately no signal: the host's budget is the Mind's, and here this
      // call is the speech. Cutting it mid-sentence would throw out of the turn.
      // A whole-turn budget with a graceful cut arrives with the voice work (7.14).
    })) {
      if (chunk.text) {
        if (speakerTtftMs === null) {
          speakerTtftMs = Date.now() - speakerStart;
        }
        responseText += chunk.text;
        yield { type: 'text', delta: chunk.text };
      }

      if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          collectedToolCalls.push(tc);
        }
      }

      if (chunk.done && chunk.usage) {
        providerUsage = chunk.usage;
      }
    }
    const speakerMs = Date.now() - speakerStart;

    responseText = stripNarration(responseText);
    if (!responseText.trim() && collectedToolCalls.some((tc) => isExitConvoTool(tc.name))) {
      // The model ended the conversation without a word. Silence reads as a
      // crash to a player, so say the least that still sounds like a person.
      logger.warn({ sessionId: context.sessionId }, 'Single-call runtime: exit_convo without speech; using the silent-exit line');
      responseText = SILENT_EXIT_LINE;
    }

    // --- Execute tool calls after stream ends ---
    const toolResults: MindToolResult[] = [];
    let exitRequested = false;
    let exitReason: string | null = null;

    for (const toolCall of collectedToolCalls) {
      yield { type: 'tool_call', call: toolCall };

      if (isExitConvoTool(toolCall.name)) {
        exitRequested = true;
        exitReason = String(toolCall.arguments.reason ?? 'Exit requested');
        const result: MindToolResult = {
          tool_name: toolCall.name,
          arguments: toolCall.arguments,
          result_content: exitReason,
          status: 'success',
        };
        toolResults.push(result);
        yield { type: 'tool_result', result };
        continue;
      }

      const result = await executeMindTool(
        toolCall,
        definition,
        instance,
        projectId,
        knowledgeBase,
        toolRegistry,
        userId,
      );

      toolResults.push(result);
      yield { type: 'tool_result', result };
    }

    // --- Build deferred context for next turn (action results only) ---
    let deferredForNextTurn: string | null = null;
    const actionResults = toolResults.filter((tr) => !isRecallTool(tr.tool_name) && tr.status === 'success' && tr.result_content);

    if (actionResults.length > 0) {
      const lines = actionResults.map((tr) => {
        const argsStr = Object.entries(tr.arguments)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(', ');
        return `- Action taken (${tr.tool_name}): ${tr.result_content}. Params: ${argsStr}`;
      });
      deferredForNextTurn = lines.join('\n');
    }

    // --- Build summary ---
    const usageEstimated = !providerUsage;

    const summary: CognitionSummary = {
      speech: responseText,
      followUp: null,
      toolCalls: collectedToolCalls,
      toolResults,
      exit: exitRequested ? { requested: true, reason: exitReason } : null,
      deferredForNextTurn,
      timings: {
        mindMs: null,
        speakerMs,
        speakerTtftMs,
        followUpMs: null,
        followUpTtftMs: null,
        wallMs: 0, // Host computes this
      },
      usage: {
        speaker: providerUsage,
      },
      usageEstimated,
      mindResult: null,
    };

    yield { type: 'done', summary };
  }
}
