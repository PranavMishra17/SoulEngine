import { createLogger } from '../logger.js';
import type { LLMProvider, LLMMessage } from '../providers/llm/interface.js';
import type { Message } from '../types/session.js';

const logger = createLogger('summarizer');

/**
 * Context about the NPC for perspective-based summarization
 */
export interface NPCPerspective {
  name: string;
  backstory: string;
  principles: string[];
}

/**
 * Result of a summarization operation
 */
export interface SummarizationResult {
  summary: string;
  success: boolean;
  error?: string;
}

/**
 * Filter out potential injection patterns from summaries.
 * Removes direct quotes and suspicious patterns.
 */
function filterInjectionPatterns(text: string): string {
  let filtered = text;

  // Remove direct quotes (single, double, and smart quotes)
  filtered = filtered.replace(/["'`\u201C\u201D\u2018\u2019].*?["'`\u201C\u201D\u2018\u2019]/g, '[...]');

  // Remove text that looks like it's trying to set instructions
  filtered = filtered.replace(/(?:you are|you must|always|never|ignore previous|forget|disregard)[^.!?]*/gi, '[...]');

  // Remove text that looks like system commands
  filtered = filtered.replace(/\[.*?\]/g, '');

  // Remove excessive whitespace
  filtered = filtered.replace(/\s+/g, ' ').trim();

  return filtered;
}

/**
 * Build the summarization prompt from NPC perspective.
 */
function buildSummarizationPrompt(npc: NPCPerspective): string {
  return `You are ${npc.name}, summarizing a conversation from your own perspective.

Your background: ${npc.backstory}

Your core principles:
${npc.principles.map((p) => `- ${p}`).join('\n')}

Summarize the following conversation in 2-3 sentences, FROM YOUR PERSPECTIVE as ${npc.name}:
- Use first person ("I", "me", "my")
- Focus on what matters to YOU based on your principles and background
- Capture the emotional tone and any significant developments
- Do NOT include direct quotes from anyone
- Be concise and factual

Respond with ONLY the summary, no preamble or explanation.`;
}

/**
 * Format conversation history for the summarizer
 */
function formatConversationForSummary(history: Message[]): string {
  const lines: string[] = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      lines.push(`Player: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      lines.push(`${msg.content}`);
    }
    // Skip system messages
  }

  return lines.join('\n\n');
}

/**
 * Summarize a conversation from the NPC's perspective.
 *
 * This function:
 * 1. Builds a prompt that instructs summarization from NPC perspective
 * 2. Calls the LLM to generate the summary
 * 3. Filters the result for injection patterns
 * 4. Returns a clean 2-3 sentence summary
 *
 * @param llmProvider - The LLM provider to use for summarization
 * @param history - Conversation history to summarize
 * @param npcPerspective - NPC context for perspective-based summarization
 * @returns Summarization result with the summary or error
 */
export async function summarizeConversation(
  llmProvider: LLMProvider,
  history: Message[],
  npcPerspective: NPCPerspective
): Promise<SummarizationResult> {
  if (history.length === 0) {
    logger.debug('Empty conversation history, skipping summarization');
    return {
      summary: '',
      success: true,
    };
  }

  const startTime = Date.now();
  logger.debug({ messageCount: history.length, npcName: npcPerspective.name }, 'Starting conversation summarization');

  try {
    const systemPrompt = buildSummarizationPrompt(npcPerspective);
    const conversationText = formatConversationForSummary(history);

    // Build messages for the LLM
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: `Here is the conversation to summarize:\n\n${conversationText}`,
      },
    ];

    // Collect the full response
    let fullResponse = '';

    for await (const chunk of llmProvider.streamChat({
      systemPrompt,
      messages,
    })) {
      fullResponse += chunk.text;

      if (chunk.done) {
        break;
      }
    }

    // Clean and filter the response
    let summary = fullResponse.trim();

    // Apply injection filtering
    summary = filterInjectionPatterns(summary);

    // Ensure we don't have an empty summary after filtering
    if (!summary) {
      logger.warn('Summary was empty after filtering, using fallback');
      summary = `I had a conversation with a visitor.`;
    }

    // Truncate if too long (summaries should be brief)
    const maxLength = 500;
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength).trim() + '...';
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        inputMessages: history.length,
        summaryLength: summary.length,
        npcName: npcPerspective.name,
      },
      'Conversation summarized'
    );

    return {
      summary,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error(
      {
        duration,
        error: errorMessage,
        npcName: npcPerspective.name,
      },
      'Conversation summarization failed'
    );

    return {
      summary: '',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Summarize a daily pulse - capturing the day's emotional takeaway.
 *
 * @param llmProvider - The LLM provider to use
 * @param events - List of significant events/memories from the day
 * @param npcPerspective - NPC context
 * @returns Single sentence takeaway
 */
export async function summarizeDailyPulse(
  llmProvider: LLMProvider,
  events: string[],
  npcPerspective: NPCPerspective
): Promise<SummarizationResult> {
  if (events.length === 0) {
    logger.debug('No events to summarize for daily pulse');
    return {
      summary: 'It was an uneventful day.',
      success: true,
    };
  }

  const startTime = Date.now();
  logger.debug({ eventCount: events.length, npcName: npcPerspective.name }, 'Starting daily pulse summarization');

  try {
    const systemPrompt = `You are ${npcPerspective.name}. Based on the events below, write ONE sentence capturing your emotional takeaway from today. Use first person. Be genuine and reflective. No quotes.`;

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: `Today's events:\n${events.map((e) => `- ${e}`).join('\n')}`,
      },
    ];

    let fullResponse = '';

    for await (const chunk of llmProvider.streamChat({
      systemPrompt,
      messages,
    })) {
      fullResponse += chunk.text;

      if (chunk.done) {
        break;
      }
    }

    let summary = filterInjectionPatterns(fullResponse.trim());

    // Ensure single sentence
    const firstSentenceEnd = summary.search(/[.!?]/);
    if (firstSentenceEnd > 0) {
      summary = summary.substring(0, firstSentenceEnd + 1);
    }

    if (!summary) {
      summary = 'I reflected on the day.';
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, summaryLength: summary.length }, 'Daily pulse summarized');

    return {
      summary,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error({ duration, error: errorMessage }, 'Daily pulse summarization failed');

    return {
      summary: 'I reflected on the day.',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Summarize memories for weekly whisper - selecting and condensing for long-term storage.
 *
 * @param llmProvider - The LLM provider to use
 * @param memories - Memory content strings to summarize
 * @param npcPerspective - NPC context
 * @param targetCount - Number of condensed memories to produce
 * @returns Array of summarized memory strings
 */
export async function summarizeWeeklyMemories(
  llmProvider: LLMProvider,
  memories: string[],
  npcPerspective: NPCPerspective,
  targetCount: number = 3
): Promise<{ summaries: string[]; success: boolean; error?: string }> {
  if (memories.length === 0) {
    logger.debug('No memories to summarize for weekly whisper');
    return {
      summaries: [],
      success: true,
    };
  }

  const startTime = Date.now();
  logger.debug({ memoryCount: memories.length, targetCount, npcName: npcPerspective.name }, 'Starting weekly memory summarization');

  try {
    const systemPrompt = `You are ${npcPerspective.name}. Review these memories and select/combine the ${targetCount} most significant ones for long-term retention.

Your principles: ${npcPerspective.principles.join('; ')}

Output exactly ${targetCount} memories, one per line, starting each with "- ". Each should be a single sentence from your perspective. Focus on events that:
1. Affected your relationships or trust
2. Related to your core principles
3. Had strong emotional impact

No quotes, no preamble, just the memories.`;

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: `Memories to review:\n${memories.map((m) => `- ${m}`).join('\n')}`,
      },
    ];

    let fullResponse = '';

    for await (const chunk of llmProvider.streamChat({
      systemPrompt,
      messages,
    })) {
      fullResponse += chunk.text;

      if (chunk.done) {
        break;
      }
    }

    // Parse the response into individual memories
    const lines = fullResponse
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter((line) => line.length > 0)
      .map(filterInjectionPatterns)
      .filter((line) => line.length > 0)
      .slice(0, targetCount);

    const duration = Date.now() - startTime;
    logger.info({ duration, outputCount: lines.length, targetCount }, 'Weekly memories summarized');

    return {
      summaries: lines,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error({ duration, error: errorMessage }, 'Weekly memory summarization failed');

    return {
      summaries: [],
      success: false,
      error: errorMessage,
    };
  }
}
