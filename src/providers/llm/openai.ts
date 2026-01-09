import { createLogger } from '../../logger.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMStreamChunk,
  LLMMessage,
} from './interface.js';

const logger = createLogger('openai-provider');

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Convert our Tool type to OpenAI function format
 */
function toolToOpenAIFunction(tool: Tool): {
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
 * Convert internal message format to OpenAI message format
 */
function messageToOpenAI(message: LLMMessage): {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
} | Array<{
  role: 'tool';
  content: string;
  tool_call_id: string;
}> {
  // Handle tool results - return multiple messages
  if (message.toolResults && message.toolResults.length > 0) {
    return message.toolResults.map((result, idx) => ({
      role: 'tool' as const,
      content: JSON.stringify(result.result),
      tool_call_id: `call_${idx}`,
    }));
  }

  // Handle regular message
  const openAIMessage: {
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
    openAIMessage.tool_calls = message.toolCalls.map((tc, idx) => ({
      id: tc.id || `call_${idx}`,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
  }

  return openAIMessage;
}

/**
 * OpenAI LLM Provider implementation
 * Uses the OpenAI Chat Completions API with streaming
 */
export class OpenAILlmProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly baseUrl: string;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.baseUrl = 'https://api.openai.com/v1';

    logger.info({ model: this.model }, 'OpenAI provider initialized');
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    const startTime = Date.now();
    logger.debug(
      { messageCount: request.messages.length, hasTools: !!request.tools?.length },
      'Starting OpenAI stream chat'
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
        const converted = messageToOpenAI(msg);
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
        body.tools = request.tools.map(toolToOpenAIFunction);
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
        throw new OpenAIError(`OpenAI API error: ${response.status} - ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new OpenAIError('No response body');
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
        'OpenAI stream chat completed'
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        logger.info({ duration }, 'OpenAI stream chat aborted');
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'OpenAI stream chat failed');
      throw error instanceof OpenAIError ? error : new OpenAIError(errorMessage);
    }
  }
}

/**
 * Base OpenAI error class
 */
export class OpenAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIError';
  }
}

/**
 * Factory function to create an OpenAI provider
 */
export function createOpenAIProvider(config: LLMProviderConfig): LLMProvider {
  return new OpenAILlmProvider(config);
}

