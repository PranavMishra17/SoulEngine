import { createLogger } from '../../logger.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMStreamChunk,
  LLMMessage,
} from './interface.js';

const logger = createLogger('anthropic-provider');

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Convert our Tool type to Anthropic tool format
 */
function toolToAnthropicTool(tool: Tool): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters || { type: 'object', properties: {} },
  };
}

/**
 * Convert internal message format to Anthropic message format
 */
function messageToAnthropic(message: LLMMessage): {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string;
  }>;
} {
  // Handle tool results
  if (message.toolResults && message.toolResults.length > 0) {
    return {
      role: 'user',
      content: message.toolResults.map((result, idx) => ({
        type: 'tool_result' as const,
        tool_use_id: `tool_${idx}`,
        content: JSON.stringify(result.result),
      })),
    };
  }

  // Handle tool calls from assistant
  if (message.toolCalls && message.toolCalls.length > 0) {
    const content: Array<{
      type: 'text' | 'tool_use';
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }> = [];

    if (message.content) {
      content.push({ type: 'text', text: message.content });
    }

    for (const tc of message.toolCalls) {
      content.push({
        type: 'tool_use',
        id: tc.id || `tool_${Date.now()}`,
        name: tc.name,
        input: tc.arguments as Record<string, unknown>,
      });
    }

    return {
      role: 'assistant',
      content,
    };
  }

  // Regular message
  return {
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.content || '',
  };
}

/**
 * Anthropic (Claude) LLM Provider implementation
 * Uses the Anthropic Messages API with streaming
 */
export class AnthropicLlmProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly baseUrl: string;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.baseUrl = 'https://api.anthropic.com/v1';

    logger.info({ model: this.model }, 'Anthropic provider initialized');
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    const startTime = Date.now();
    logger.debug(
      { messageCount: request.messages.length, hasTools: !!request.tools?.length },
      'Starting Anthropic stream chat'
    );

    try {
      // Convert messages
      const messages = request.messages.map(messageToAnthropic);

      // Build request body
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages,
        stream: true,
      };

      // Add system prompt
      if (request.systemPrompt) {
        body.system = request.systemPrompt;
      }

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map(toolToAnthropicTool);
      }

      // Make streaming request
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new AnthropicError(`Anthropic API error: ${response.status} - ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AnthropicError('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      const accumulatedToolCalls: ToolCall[] = [];
      let currentToolUse: { id: string; name: string; input: string } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const eventType = json.type;

            if (eventType === 'content_block_start') {
              const block = json.content_block;
              if (block?.type === 'tool_use') {
                currentToolUse = {
                  id: block.id || `tc_${Date.now()}`,
                  name: block.name || '',
                  input: '',
                };
              }
            } else if (eventType === 'content_block_delta') {
              const delta = json.delta;

              // Handle text delta
              if (delta?.type === 'text_delta' && delta.text) {
                accumulatedText += delta.text;
                yield {
                  text: delta.text,
                  toolCalls: [],
                  done: false,
                };
              }

              // Handle tool input delta
              if (delta?.type === 'input_json_delta' && delta.partial_json && currentToolUse) {
                currentToolUse.input += delta.partial_json;
              }
            } else if (eventType === 'content_block_stop' && currentToolUse) {
              // Finalize tool call
              try {
                const toolCall: ToolCall = {
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  arguments: JSON.parse(currentToolUse.input || '{}'),
                };
                accumulatedToolCalls.push(toolCall);
              } catch {
                accumulatedToolCalls.push({
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  arguments: {},
                });
              }
              currentToolUse = null;
            } else if (eventType === 'message_stop') {
              // Message complete
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Yield any accumulated tool calls
      if (accumulatedToolCalls.length > 0) {
        yield {
          text: '',
          toolCalls: accumulatedToolCalls,
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
          toolCallCount: accumulatedToolCalls.length,
        },
        'Anthropic stream chat completed'
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        logger.info({ duration }, 'Anthropic stream chat aborted');
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ duration, error: errorMessage }, 'Anthropic stream chat failed');
      throw error instanceof AnthropicError ? error : new AnthropicError(errorMessage);
    }
  }
}

/**
 * Base Anthropic error class
 */
export class AnthropicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicError';
  }
}

/**
 * Factory function to create an Anthropic provider
 */
export function createAnthropicProvider(config: LLMProviderConfig): LLMProvider {
  return new AnthropicLlmProvider(config);
}

