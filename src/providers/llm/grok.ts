import { createLogger } from '../../logger.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMStreamChunk,
  LLMMessage,
} from './interface.js';

const logger = createLogger('grok-provider');

const DEFAULT_MODEL = 'grok-beta';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Convert our Tool type to OpenAI-compatible function format (xAI uses OpenAI format)
 */
function toolToGrokFunction(tool: Tool): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
} {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} },
    },
  };
}

/**
 * Convert internal message format to OpenAI-compatible message format
 */
function messageToGrok(message: LLMMessage): {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
} | Array<{
  role: 'tool';
  content: string;
  tool_call_id: string;
}> {
  // Handle tool results
  if (message.toolResults && message.toolResults.length > 0) {
    return message.toolResults.map((result, idx) => ({
      role: 'tool' as const,
      content: JSON.stringify(result.result),
      tool_call_id: `call_${idx}`,
    }));
  }

  // Handle regular message
  const grokMessage: {
    role: 'user' | 'assistant';
    content?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  } = {
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.content || undefined,
  };

  // Add tool calls if present
  if (message.toolCalls && message.toolCalls.length > 0) {
    grokMessage.tool_calls = message.toolCalls.map((tc, idx) => ({
      id: tc.id || `call_${idx}`,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
  }

  return grokMessage;
}

/**
 * Grok (xAI) LLM Provider implementation
 * Uses the xAI API which is OpenAI-compatible
 */
export class GrokLlmProvider implements LLMProvider {
  readonly name = 'grok';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly baseUrl: string;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Grok (xAI) API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.baseUrl = 'https://api.x.ai/v1';

    logger.info({ model: this.model }, 'Grok provider initialized');
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    const startTime = Date.now();
    logger.debug(
      { messageCount: request.messages.length, hasTools: !!request.tools?.length },
      'Starting Grok stream chat'
    );

    try {
      // Build messages array
      const messages: Array<Record<string, unknown>> = [];

      // Add system message
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt,
        });
      }

      // Convert and add conversation messages
      for (const msg of request.messages) {
        const converted = messageToGrok(msg);
        if (Array.isArray(converted)) {
          messages.push(...converted);
        } else {
          messages.push(converted);
        }
      }

      // Build request body
      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true,
      };

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map(toolToGrokFunction);
        body.tool_choice = 'auto';
      }

      // Make streaming request
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new GrokError(`Grok API error: ${response.status} - ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new GrokError('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const choice = json.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            let chunkText = '';

            // Handle text content
            if (delta?.content) {
              chunkText = delta.content;
              accumulatedText += chunkText;
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!accumulatedToolCalls.has(idx)) {
                  accumulatedToolCalls.set(idx, {
                    id: tc.id || `tc_${Date.now()}_${idx}`,
                    name: tc.function?.name || '',
                    arguments: '',
                  });
                }
                const accumulated = accumulatedToolCalls.get(idx)!;
                if (tc.function?.name) {
                  accumulated.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  accumulated.arguments += tc.function.arguments;
                }
              }
            }

            // Yield chunk if there's content
            if (chunkText) {
              yield {
                text: chunkText,
                toolCalls: [],
                done: false,
              };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // After stream ends, yield any accumulated tool calls
      if (accumulatedToolCalls.size > 0) {
        const toolCalls: ToolCall[] = [];
        for (const [, tc] of accumulatedToolCalls) {
          try {
            toolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: JSON.parse(tc.arguments || '{}'),
            });
          } catch {
            toolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: {},
            });
          }
        }

        yield {
          text: '',
          toolCalls,
          done: false,
        };
      }

      // Yield final chunk
      yield {
        text: '',
        toolCalls: [],
        done: true,
      };

      const duration = Date.now() - startTime;
      logger.info(
        {
          duration,
          textLength: accumulatedText.length,
          toolCallCount: accumulatedToolCalls.size,
        },
        'Grok stream chat completed'
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        logger.info({ duration }, 'Grok stream chat aborted');
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'Grok stream chat failed');
      throw error instanceof GrokError ? error : new GrokError(errorMessage);
    }
  }
}

/**
 * Base Grok error class
 */
export class GrokError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrokError';
  }
}

/**
 * Factory function to create a Grok provider
 */
export function createGrokProvider(config: LLMProviderConfig): LLMProvider {
  return new GrokLlmProvider(config);
}

