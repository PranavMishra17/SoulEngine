import { createLogger } from '../../logger.js';
import { runMindAgentLoop } from '../mind.js';
import { buildFollowUpPrompt } from '../context.js';
import { isRecallTool } from '../tools.js';
import { stripNarration } from '../../conversation/turn.js';
import type { CognitionRuntime, CognitionInput, CognitionEvent, CognitionSummary } from '../runtime.js';
import type { MindResult, MindToolResult } from '../../types/mind.js';
import type { ToolCall } from '../../types/mcp.js';
import type { LLMMessage } from '../../providers/llm/interface.js';

const logger = createLogger('parallel-runtime');

/**
 * Partition Mind tool results into recall (deferred) and MCP action (follow-up) results.
 */
function partitionMindToolResults(toolResults: MindToolResult[]): {
  recallLines: string[];
  mcpLines: string[];
} {
  const recallLines: string[] = [];
  const mcpLines: string[] = [];

  for (const tr of toolResults) {
    if (tr.status === 'error' || !tr.result_content) {
      continue;
    }

    const argsStr = Object.entries(tr.arguments)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');

    if (isRecallTool(tr.tool_name)) {
      recallLines.push(`- Retrieved (${tr.tool_name}): ${tr.result_content}`);
    } else {
      mcpLines.push(
        `- Action taken (${tr.tool_name}): ${tr.result_content || 'executed successfully'}. Params: ${argsStr}`
      );
    }
  }

  return { recallLines, mcpLines };
}

/**
 * ParallelRuntime: Mind and Speaker run in parallel, recall deferred, follow-up serial.
 *
 * This is the current production behavior extracted from runConversationTurn.
 * Behavior is byte-for-byte identical to the pre-refactor code.
 */
export class ParallelRuntime implements CognitionRuntime {
  readonly name = 'parallel' as const;

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

    const { definition, instance, knowledgeBase, projectId, sessionId, securityContext, userId } = context;
    const { speaker: activeProvider, mind: mindProvider } = providers;

    // The host arms the Mind timeout from the project's mind_timeout_ms and hands it in as `signal`.

    const mindPromise = runMindAgentLoop(
      definition,
      instance,
      playerInput,
      history,
      mindProvider,
      projectId,
      knowledgeBase,
      toolRegistry,
      securityContext,
      tools,
      input.signal,
      userId,
    ).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ sessionId, error: msg }, 'Mind agent loop failed');
      return null as MindResult | null;
    });

    // Speaker streams immediately; it does not wait for the Mind
    const speakerStart = Date.now();
    let responseText = '';
    let providerUsage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number } | undefined;
    let speakerTtftMs: number | null = null;

    for await (const chunk of activeProvider.streamChat({
      systemPromptPrefix: prompt.stable,
      systemPrompt: prompt.dynamic,
      cacheKey,
      messages: history,
    })) {
      if (chunk.text && speakerTtftMs === null) {
        speakerTtftMs = Date.now() - speakerStart;
      }
      if (chunk.text) {
        responseText += chunk.text;
        yield { type: 'text', delta: chunk.text };
      }
      if (chunk.done && chunk.usage) {
        providerUsage = chunk.usage;
      }
    }
    const speakerMs = Date.now() - speakerStart;

    responseText = stripNarration(responseText);

    // Await Mind result
    const mindResult = await mindPromise;

    const toolCalls: ToolCall[] = mindResult?.raw_tool_calls ?? [];
    const toolResults: MindToolResult[] = [];

    if (mindResult && mindResult.tools_called.length > 0) {
      for (const tr of mindResult.tools_called) {
        toolResults.push(tr);
        yield { type: 'tool_call', call: { id: tr.tool_name, name: tr.tool_name, arguments: tr.arguments } };
        yield { type: 'tool_result', result: tr };
      }
    }

    // Partition recall vs MCP results
    let deferredContextForNextTurn: string | null = null;
    let followUpMs: number | null = null;
    let followUpTtftMs: number | null = null;
    let followUpSpeech: string | null = null;
    let followUpUsage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number } | undefined;

    if (mindResult && mindResult.tools_called.length > 0) {
      const { recallLines, mcpLines } = partitionMindToolResults(mindResult.tools_called);

      if (recallLines.length > 0) {
        deferredContextForNextTurn = recallLines.join('\n');
        logger.info({ sessionId, recallCount: recallLines.length }, 'Recall results deferred to next turn');
      }

      if (mcpLines.length > 0) {
        const mcpContext = mcpLines.join('\n');
        const fullSystemPrompt = prompt.stable + '\n\n' + prompt.dynamic;
        const followUpPrompt = buildFollowUpPrompt(fullSystemPrompt, mcpContext, definition.name);

        // The follow-up call needs the primary speech in history
        const updatedHistory: LLMMessage[] = [
          ...history,
          { role: 'model' as const, content: responseText },
          { role: 'user' as const, content: '[System: You just took an action. Briefly address it.]' },
        ];

        const followUpStart = Date.now();
        let followUpText = '';
        for await (const chunk of activeProvider.streamChat({
          systemPrompt: followUpPrompt,
          messages: updatedHistory,
        })) {
          if (chunk.text && followUpTtftMs === null) {
            followUpTtftMs = Date.now() - followUpStart;
          }
          if (chunk.text) {
            followUpText += chunk.text;
            yield { type: 'follow_up', delta: chunk.text };
          }
          if (chunk.done && chunk.usage) {
            followUpUsage = chunk.usage;
          }
        }
        followUpMs = Date.now() - followUpStart;

        followUpText = stripNarration(followUpText);

        if (followUpText.trim()) {
          followUpSpeech = followUpText;
          // Note: The host will append this to the primary response and add to session
        }
      }
    }

    // Token accounting
    let usageEstimated = false;
    if (!providerUsage) {
      usageEstimated = true;
    }

    // Exit handling
    const exit = mindResult?.exit_convo_used
      ? { requested: true, reason: mindResult.exit_convo_reason ?? 'Mind decided to end conversation' }
      : null;

    const summary: CognitionSummary = {
      speech: responseText,
      followUp: followUpSpeech,
      toolCalls,
      toolResults,
      exit,
      deferredForNextTurn: deferredContextForNextTurn,
      timings: {
        mindMs: mindResult?.duration_ms ?? null,
        speakerMs,
        speakerTtftMs,
        followUpMs,
        followUpTtftMs,
        wallMs: 0, // Host computes this
      },
      usage: {
        speaker: providerUsage,
        mind: mindResult?.usage,
        followUp: followUpUsage,
      },
      usageEstimated,
      mindResult,
    };

    yield { type: 'done', summary };
  }
}
