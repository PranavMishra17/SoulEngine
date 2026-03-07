import { createLogger } from '../logger.js';
import type { NPCDefinition, NPCInstance, Memory } from '../types/npc.js';
import type { KnowledgeBase } from '../types/knowledge.js';
import type { Tool, ToolCall } from '../types/mcp.js';
import type { MindResult, MindToolResult } from '../types/mind.js';
import type { SecurityContext } from '../types/security.js';
import type {
  LLMProvider,
  LLMMessage,
  LLMStreamChunk,
} from '../providers/llm/interface.js';
import type { MCPToolRegistry } from '../mcp/registry.js';
import { getMindAvailableTools, isExitConvoTool } from './tools.js';
import { formatTier1Npc, formatTier2Npc, formatTier3Npc } from './context.js';
import { resolveCategoryKnowledge } from './knowledge.js';
import { retrieveSTM, retrieveLTM, formatMemoriesForPrompt } from './memory.js';
import { generatePersonalityDescription, formatMoodForPrompt } from './personality.js';
import { getDefinition } from '../storage/index.js';

const logger = createLogger('npc-mind');

// ---------------------------------------------------------------------------
// Narration stripping (duplicated from conversation.ts since it is not exported)
// ---------------------------------------------------------------------------

/**
 * Strips lines/paragraphs starting with (action descriptions) or *action* patterns.
 */
function stripNarration(text: string): string {
  const cleaned = text
    .replace(/^\s*\(.*?\)\s*/gm, '')
    .replace(/^\s*\*[^*]+\*\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || text;
}

// ---------------------------------------------------------------------------
// 1. buildMindSystemPrompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the Mind's cognitive background process.
 * This is intentionally much smaller than the full NPC Speaker prompt.
 */
export function buildMindSystemPrompt(
  definition: NPCDefinition,
  instance: NPCInstance,
  userMessage: string,
  speakerResponse: string,
  conversationHistory: LLMMessage[],
): string {
  const sections: string[] = [];

  // --- ROLE ---
  sections.push(
    `[ROLE]\nYou are the cognitive background process of ${definition.name}. You analyze the conversation and decide whether to take actions or retrieve information using the tools available to you.`
  );

  // --- NPC IDENTITY ---
  const personalityDesc = generatePersonalityDescription(
    definition.personality_baseline,
    instance.trait_modifiers,
  );
  const moodDesc = formatMoodForPrompt(instance.current_mood);
  const principles = definition.core_anchor.principles.join(', ');

  sections.push(
    `[NPC IDENTITY]\nName: ${definition.name}\nDescription: ${definition.description}\nPersonality: ${personalityDesc}\nCurrent mood: ${moodDesc}\nCore values: ${principles}`
  );

  // --- PEOPLE YOU KNOW ---
  if (definition.network && definition.network.length > 0) {
    const networkLines = definition.network.map((entry) => {
      const tierLabel =
        entry.familiarity_tier === 3
          ? 'close contact'
          : entry.familiarity_tier === 2
            ? 'familiar'
            : 'acquaintance';
      return `- ${entry.npc_id} (${tierLabel})`;
    });
    sections.push(`[PEOPLE YOU KNOW]\n${networkLines.join('\n')}`);
  }

  // --- KNOWLEDGE DOMAINS ---
  if (definition.knowledge_access) {
    const accessibleCategories = Object.entries(definition.knowledge_access)
      .filter(([, level]) => level > 0)
      .map(([id]) => id);
    if (accessibleCategories.length > 0) {
      sections.push(
        `[KNOWLEDGE DOMAINS YOU HAVE ACCESS TO]\n${accessibleCategories.join(', ')}`
      );
    }
  }

  // --- CURRENT CONVERSATION (last 3-5 messages) ---
  const recentHistory = conversationHistory.slice(-5);
  if (recentHistory.length > 0) {
    const historyLines = recentHistory.map((msg) => {
      const label = msg.role === 'user' ? 'Player' : 'NPC';
      return `${label}: ${msg.content}`;
    });
    sections.push(
      `[CURRENT CONVERSATION]\n${historyLines.join('\n')}\n\nPlayer: ${userMessage}\nNPC (already said): ${speakerResponse}`
    );
  } else {
    sections.push(
      `[CURRENT CONVERSATION]\nPlayer: ${userMessage}\nNPC (already said): ${speakerResponse}`
    );
  }

  // --- YOUR TASK ---
  sections.push(
    `[YOUR TASK]
Analyze this conversation and decide:
1. Should you recall information about any mentioned person? Use recall_npc.
2. Should you recall world knowledge about a topic discussed? Use recall_knowledge.
3. Should you recall past memories relevant to this conversation? Use recall_memories.
4. Should you take any game actions (warn player, call guards, etc.)? Use the appropriate tool.
5. Should you end this conversation for safety reasons? Use exit_convo.

If nothing is needed, respond with exactly: NO_ACTION

If you call tools, you will receive their results and should then generate a brief follow-up response (1-3 sentences) that the NPC will speak. This follow-up must:
- NOT repeat what the NPC already said
- Add depth, new information, or reflect the action taken
- Stay in character as ${definition.name}
- Be natural spoken dialogue only (no stage directions, no narration)`
  );

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// 2. executeMindTool
// ---------------------------------------------------------------------------

/**
 * Execute a single mind tool call.
 * Recall tools are handled internally; other tools are delegated to the registry.
 */
export async function executeMindTool(
  toolCall: ToolCall,
  definition: NPCDefinition,
  instance: NPCInstance,
  projectId: string,
  knowledgeBase: KnowledgeBase | null,
  toolRegistry: MCPToolRegistry,
): Promise<MindToolResult> {
  const baseResult: Pick<MindToolResult, 'tool_name' | 'arguments'> = {
    tool_name: toolCall.name,
    arguments: toolCall.arguments,
  };

  try {
    // ------ recall_npc ------
    if (toolCall.name === 'recall_npc') {
      const queryName = String(toolCall.arguments.name ?? '').toLowerCase();
      if (!queryName) {
        return { ...baseResult, result_content: '', status: 'error', error: 'No name provided' };
      }

      // Search network entries by loading each definition and checking name
      for (const entry of definition.network ?? []) {
        try {
          const knownDef = await getDefinition(projectId, entry.npc_id);
          if (knownDef.name.toLowerCase() === queryName) {
            let formatted: string;
            switch (entry.familiarity_tier) {
              case 3:
                formatted = formatTier3Npc(knownDef);
                break;
              case 2:
                formatted = formatTier2Npc(knownDef);
                break;
              default:
                formatted = formatTier1Npc(knownDef);
                break;
            }
            return { ...baseResult, result_content: formatted, status: 'success' };
          }
        } catch (err) {
          logger.warn(
            { npcId: entry.npc_id, error: err instanceof Error ? err.message : 'Unknown' },
            'Failed to load network NPC during recall_npc',
          );
        }
      }

      return { ...baseResult, result_content: '', status: 'error', error: 'NPC not known' };
    }

    // ------ recall_knowledge ------
    if (toolCall.name === 'recall_knowledge') {
      const queryCategory = String(toolCall.arguments.category ?? '').toLowerCase();
      if (!queryCategory) {
        return { ...baseResult, result_content: '', status: 'error', error: 'No category provided' };
      }

      if (!knowledgeBase || !knowledgeBase.categories) {
        return { ...baseResult, result_content: '', status: 'error', error: 'No knowledge base available' };
      }

      // Case-insensitive substring match on category ID and description
      for (const [catId, category] of Object.entries(knowledgeBase.categories)) {
        const idMatch = catId.toLowerCase().includes(queryCategory);
        const descMatch = category.description?.toLowerCase().includes(queryCategory) ?? false;

        if (idMatch || descMatch) {
          const accessLevel = definition.knowledge_access?.[catId] ?? 0;
          if (accessLevel <= 0) {
            return {
              ...baseResult,
              result_content: '',
              status: 'error',
              error: `No access to knowledge category: ${catId}`,
            };
          }
          const resolved = resolveCategoryKnowledge(category, accessLevel);
          if (!resolved) {
            return {
              ...baseResult,
              result_content: '',
              status: 'error',
              error: `No content available for category: ${catId}`,
            };
          }
          return { ...baseResult, result_content: resolved, status: 'success' };
        }
      }

      return { ...baseResult, result_content: '', status: 'error', error: 'Knowledge category not found' };
    }

    // ------ recall_memories ------
    if (toolCall.name === 'recall_memories') {
      const query = String(toolCall.arguments.query ?? '').toLowerCase();
      if (!query) {
        return { ...baseResult, result_content: '', status: 'error', error: 'No query provided' };
      }

      const stm = retrieveSTM(instance.short_term_memory);
      const ltm = retrieveLTM(instance.long_term_memory);
      const allMemories: Memory[] = [...stm, ...ltm];

      // Simple case-insensitive substring match on memory content
      const matched = allMemories
        .filter((m) => m.content.toLowerCase().includes(query))
        .sort((a, b) => b.salience - a.salience)
        .slice(0, 5);

      if (matched.length === 0) {
        return { ...baseResult, result_content: 'No matching memories found.', status: 'success' };
      }

      const formatted = formatMemoriesForPrompt(matched, 5);
      return { ...baseResult, result_content: formatted, status: 'success' };
    }

    // ------ Other tools (conversation / game tools) -> delegate to registry ------
    const result = await toolRegistry.executeTool(projectId, toolCall.name, toolCall.arguments);
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    return { ...baseResult, result_content: resultStr, status: 'success' };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    logger.error(
      { tool: toolCall.name, args: toolCall.arguments, error: errorMsg },
      'Mind tool execution failed',
    );
    return { ...baseResult, result_content: '', status: 'error', error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// 3. runMindAgentLoop
// ---------------------------------------------------------------------------

/**
 * The core Mind agent loop. Entry point for the NPC's cognitive background process.
 *
 * 1. Builds the mind system prompt
 * 2. Makes LLM call 1 to decide on tool calls
 * 3. Executes any tool calls
 * 4. Makes LLM call 2 to generate a follow-up based on tool results
 * 5. Returns a MindResult
 */
export async function runMindAgentLoop(
  definition: NPCDefinition,
  instance: NPCInstance,
  userMessage: string,
  speakerResponse: string,
  conversationHistory: LLMMessage[],
  llmProvider: LLMProvider,
  projectId: string,
  knowledgeBase: KnowledgeBase | null,
  toolRegistry: MCPToolRegistry,
  securityContext: SecurityContext,
  projectTools: Record<string, Tool>,
  signal: AbortSignal,
): Promise<MindResult> {
  const startTime = Date.now();
  const toolsCalled: MindToolResult[] = [];
  const rawToolCalls: ToolCall[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let exitConvoUsed = false;
  let exitConvoReason: string | undefined;

  try {
    // 1. Build mind system prompt
    const systemPrompt = buildMindSystemPrompt(
      definition,
      instance,
      userMessage,
      speakerResponse,
      conversationHistory,
    );

    // 2. Get available mind tools
    const mindTools = getMindAvailableTools(definition, securityContext, projectTools);

    logger.info({ npcId: definition.id, toolCount: mindTools.length }, 'Mind agent loop started');

    // 3. LLM call 1: Decide what to do
    let responseText = '';
    let call1ToolCalls: ToolCall[] = [];

    const stream1 = llmProvider.streamChat({
      systemPrompt,
      messages: [],
      tools: mindTools,
      signal,
    });

    for await (const chunk of stream1 as AsyncIterable<LLMStreamChunk>) {
      if (signal.aborted) {
        logger.info({ npcId: definition.id }, 'Mind agent loop aborted during LLM call 1');
        break;
      }

      if (chunk.text) {
        responseText += chunk.text;
      }
      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        call1ToolCalls = call1ToolCalls.concat(chunk.toolCalls);
      }
      if (chunk.done && chunk.usage) {
        totalInputTokens += chunk.usage.input_tokens;
        totalOutputTokens += chunk.usage.output_tokens;
      }
    }

    // 4. Check for NO_ACTION or no tool calls
    const trimmedResponse = responseText.trim();
    logger.info({ npcId: definition.id, toolCallCount: call1ToolCalls.length, noAction: trimmedResponse === 'NO_ACTION' }, 'Mind LLM call 1 complete');
    if (call1ToolCalls.length === 0 || trimmedResponse === 'NO_ACTION') {
      return {
        follow_up_text: '',
        tools_called: [],
        raw_tool_calls: [],
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
        completed: true,
        exit_convo_used: false,
        duration_ms: Date.now() - startTime,
      };
    }

    // Record raw tool calls
    rawToolCalls.push(...call1ToolCalls);

    // 5. Execute each tool call
    for (const tc of call1ToolCalls) {
      if (signal.aborted) {
        logger.info({ npcId: definition.id }, 'Mind agent loop aborted during tool execution');
        break;
      }

      // Check for exit_convo
      if (isExitConvoTool(tc.name)) {
        exitConvoUsed = true;
        exitConvoReason = String(tc.arguments.reason ?? 'No reason provided');
      }

      const toolStart = Date.now();
      const toolResult = await executeMindTool(
        tc,
        definition,
        instance,
        projectId,
        knowledgeBase,
        toolRegistry,
      );
      logger.info({ tool: tc.name, status: toolResult.status, durationMs: Date.now() - toolStart }, 'Mind tool executed');
      toolsCalled.push(toolResult);
    }

    // If signal was aborted during tool execution, return partial result
    if (signal.aborted) {
      return {
        follow_up_text: '',
        tools_called: toolsCalled,
        raw_tool_calls: rawToolCalls,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
        completed: false,
        exit_convo_used: exitConvoUsed,
        exit_convo_reason: exitConvoReason,
        duration_ms: Date.now() - startTime,
      };
    }

    // 6. Build tool result message for LLM call 2
    const toolResultLines = toolsCalled.map((tr) => {
      const argsStr = JSON.stringify(tr.arguments);
      if (tr.status === 'error') {
        return `- ${tr.tool_name}(${argsStr}): ERROR - ${tr.error}`;
      }
      return `- ${tr.tool_name}(${argsStr}): ${tr.result_content}`;
    });

    const toolResultMessage = `[Tool Results]\n${toolResultLines.join('\n')}\n\n[Instructions]\nBased on these results, generate a brief follow-up (1-3 sentences) that ${definition.name} will speak next. Do not repeat what was already said. Stay in character. Output ONLY spoken dialogue. If the results don't add value, respond with NO_FOLLOWUP.`;

    // 7. LLM call 2: Generate follow-up
    logger.info({ npcId: definition.id, toolResultCount: toolsCalled.length }, 'Mind generating follow-up');
    const assistantContent = responseText || '[Used tools]';
    const messages: LLMMessage[] = [
      { role: 'model', content: assistantContent, toolCalls: call1ToolCalls },
      { role: 'user', content: toolResultMessage },
    ];

    let followUpText = '';

    const stream2 = llmProvider.streamChat({
      systemPrompt,
      messages,
      signal,
    });

    for await (const chunk of stream2 as AsyncIterable<LLMStreamChunk>) {
      if (signal.aborted) {
        logger.info({ npcId: definition.id }, 'Mind agent loop aborted during LLM call 2');
        break;
      }

      if (chunk.text) {
        followUpText += chunk.text;
      }
      if (chunk.done && chunk.usage) {
        totalInputTokens += chunk.usage.input_tokens;
        totalOutputTokens += chunk.usage.output_tokens;
      }
    }

    // 8. Check for NO_FOLLOWUP
    const trimmedFollowUp = followUpText.trim();
    logger.info({ npcId: definition.id, textLength: followUpText.length, isNoFollowup: trimmedFollowUp === 'NO_FOLLOWUP' || !trimmedFollowUp }, 'Mind follow-up generated');
    if (trimmedFollowUp === 'NO_FOLLOWUP' || !trimmedFollowUp) {
      return {
        follow_up_text: '',
        tools_called: toolsCalled,
        raw_tool_calls: rawToolCalls,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
        completed: true,
        exit_convo_used: exitConvoUsed,
        exit_convo_reason: exitConvoReason,
        duration_ms: Date.now() - startTime,
      };
    }

    // 9. Strip narration from follow-up
    const cleanedFollowUp = stripNarration(trimmedFollowUp);

    // 10. Return full MindResult
    const duration_ms = Date.now() - startTime;
    logger.info({ npcId: definition.id, totalDurationMs: duration_ms, toolsCalled: toolsCalled.length, hasFollowup: !!cleanedFollowUp }, 'Mind agent loop complete');
    return {
      follow_up_text: cleanedFollowUp,
      tools_called: toolsCalled,
      raw_tool_calls: rawToolCalls,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
      completed: true,
      exit_convo_used: exitConvoUsed,
      exit_convo_reason: exitConvoReason,
      duration_ms,
    };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    logger.error(
      {
        npcId: definition.id,
        instanceId: instance.id,
        error: errorMsg,
      },
      'Mind agent loop failed',
    );

    return {
      follow_up_text: '',
      tools_called: toolsCalled,
      raw_tool_calls: rawToolCalls,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
      completed: false,
      exit_convo_used: exitConvoUsed,
      exit_convo_reason: exitConvoReason,
      duration_ms: Date.now() - startTime,
    };
  }
}
