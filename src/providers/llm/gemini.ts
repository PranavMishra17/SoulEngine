import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Part,
  SchemaType,
  FunctionCallingMode,
} from '@google/generative-ai';
import { createLogger } from '../../logger.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMStreamChunk,
  LLMMessage,
} from './interface.js';

const logger = createLogger('gemini-provider');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Map JSON schema type string to Gemini SchemaType
 */
function mapToSchemaType(typeStr: string | undefined): SchemaType {
  switch (typeStr?.toLowerCase()) {
    case 'string':
      return SchemaType.STRING;
    case 'number':
    case 'integer':
      return SchemaType.NUMBER;
    case 'boolean':
      return SchemaType.BOOLEAN;
    case 'array':
      return SchemaType.ARRAY;
    case 'object':
      return SchemaType.OBJECT;
    default:
      return SchemaType.STRING;
  }
}

/**
 * Build function declaration for Gemini from our Tool type
 * Returns a plain object that matches Gemini's expected structure
 */
function toolToFunctionDeclaration(tool: Tool): {
  name: string;
  description: string;
  parameters?: {
    type: SchemaType;
    properties: Record<string, { type: SchemaType; description?: string }>;
    required?: string[];
  };
} {
  const properties: Record<string, { type: SchemaType; description?: string }> = {};
  const required: string[] = [];

  if (tool.parameters && typeof tool.parameters === 'object') {
    const params = tool.parameters as Record<string, unknown>;
    const propsObj = params.properties as Record<string, unknown> | undefined;
    const requiredArr = params.required as string[] | undefined;

    if (propsObj) {
      for (const [key, value] of Object.entries(propsObj)) {
        const propDef = value as { type?: string; description?: string };
        properties[key] = {
          type: mapToSchemaType(propDef.type),
          description: propDef.description,
        };
      }
    }

    if (requiredArr) {
      required.push(...requiredArr);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties,
      required,
    },
  };
}

/**
 * Convert internal message format to Gemini Content format
 */
function messageToContent(message: LLMMessage): Content {
  const parts: Part[] = [];

  // Add text content if present
  if (message.content) {
    parts.push({ text: message.content });
  }

  // Add tool calls if present (for model messages)
  if (message.toolCalls && message.toolCalls.length > 0) {
    for (const toolCall of message.toolCalls) {
      parts.push({
        functionCall: {
          name: toolCall.name,
          args: toolCall.arguments as Record<string, unknown>,
        },
      });
    }
  }

  // Add tool results if present (for user messages responding to tool calls)
  if (message.toolResults && message.toolResults.length > 0) {
    for (const toolResult of message.toolResults) {
      parts.push({
        functionResponse: {
          name: toolResult.name,
          response: { result: toolResult.result },
        },
      });
    }
  }

  return {
    role: message.role === 'model' ? 'model' : 'user',
    parts,
  };
}

/**
 * Gemini LLM Provider implementation
 */
export class GeminiLlmProvider implements LLMProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.client = new GoogleGenerativeAI(config.apiKey);
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;

    this.model = this.client.getGenerativeModel({
      model: config.model ?? DEFAULT_MODEL,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
    });

    logger.info({ model: config.model ?? DEFAULT_MODEL }, 'Gemini provider initialized');
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    const startTime = Date.now();
    logger.debug({ messageCount: request.messages.length, hasTools: !!request.tools?.length }, 'Starting stream chat');

    try {
      // Build contents array from messages
      const contents: Content[] = request.messages.map(messageToContent);

      // Build chat session config using inline type
      const chatConfig: {
        history: Content[];
        tools?: Array<{ functionDeclarations: ReturnType<typeof toolToFunctionDeclaration>[] }>;
        toolConfig?: { functionCallingConfig: { mode: FunctionCallingMode } };
        systemInstruction?: string | Part | Content;
      } = {
        history: contents.slice(0, -1), // All but the last message
      };

      // Add system instruction as a string (simplest format)
      if (request.systemPrompt) {
        chatConfig.systemInstruction = request.systemPrompt;
      }

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        chatConfig.tools = [{
          functionDeclarations: request.tools.map(toolToFunctionDeclaration),
        }];
        chatConfig.toolConfig = {
          functionCallingConfig: { mode: FunctionCallingMode.AUTO },
        };
      }

      // Create chat session with streaming
      // Using type assertion since SDK types are complex and our config matches the expected structure
      const chat = this.model.startChat(chatConfig as Parameters<GenerativeModel['startChat']>[0]);

      // Get the last message content for the current turn
      const lastMessage = contents[contents.length - 1];
      const lastMessageParts = lastMessage?.parts ?? [{ text: '' }];

      // Stream the response
      const result = await chat.sendMessageStream(lastMessageParts);

      let accumulatedText = '';
      const accumulatedToolCalls: ToolCall[] = [];

      for await (const chunk of result.stream) {
        // Check for abort
        if (request.signal?.aborted) {
          logger.info('Stream aborted by signal');
          break;
        }

        const candidates = chunk.candidates;
        if (!candidates || candidates.length === 0) {
          continue;
        }

        const candidate = candidates[0];
        const parts = candidate.content?.parts ?? [];

        let chunkText = '';
        const chunkToolCalls: ToolCall[] = [];

        for (const part of parts) {
          if ('text' in part && part.text) {
            chunkText += part.text;
            accumulatedText += part.text;
          }

          if ('functionCall' in part && part.functionCall) {
            const toolCall: ToolCall = {
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
              id: `tc_${Date.now()}_${accumulatedToolCalls.length}`,
            };
            chunkToolCalls.push(toolCall);
            accumulatedToolCalls.push(toolCall);
          }
        }

        // Yield chunk if there's content
        if (chunkText || chunkToolCalls.length > 0) {
          yield {
            text: chunkText,
            toolCalls: chunkToolCalls,
            done: false,
          };
        }
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
        'Stream chat completed'
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        logger.info({ duration }, 'Stream chat aborted');
        throw error;
      }

      // Handle specific Gemini error types
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorObj = error as { status?: number };

      if (errorObj.status === 429) {
        logger.warn({ duration, error: errorMessage }, 'Gemini rate limit exceeded');
        throw new GeminiRateLimitError(errorMessage);
      }

      if (errorObj.status === 503) {
        logger.error({ duration, error: errorMessage }, 'Gemini service unavailable');
        throw new GeminiServiceError(errorMessage);
      }

      logger.error({ duration, error: errorMessage }, 'Gemini stream chat failed');
      throw new GeminiError(errorMessage);
    }
  }
}

/**
 * Base Gemini error class
 */
export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Gemini rate limit error
 */
export class GeminiRateLimitError extends GeminiError {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiRateLimitError';
  }
}

/**
 * Gemini service error (503, etc)
 */
export class GeminiServiceError extends GeminiError {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiServiceError';
  }
}

/**
 * Factory function to create a Gemini provider
 */
export function createGeminiProvider(config: LLMProviderConfig): LLMProvider {
  return new GeminiLlmProvider(config);
}
