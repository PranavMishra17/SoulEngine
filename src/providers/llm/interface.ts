import type { Tool, ToolCall } from '../../types/mcp.js';

/**
 * Supported LLM provider types
 */
export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'grok';

/**
 * A single chunk from an LLM streaming response
 */
export interface LLMStreamChunk {
  /** Text content in this chunk (may be empty if only tool calls) */
  text: string;
  /** Tool calls detected in this chunk (may be empty) */
  toolCalls: ToolCall[];
  /** Whether this is the final chunk in the stream */
  done: boolean;
}

/**
 * Message in conversation history
 */
export interface LLMMessage {
  role: 'user' | 'model';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: LLMToolResult[];
}

/**
 * Tool result to send back to the LLM
 */
export interface LLMToolResult {
  name: string;
  result: unknown;
}

/**
 * Request for LLM chat completion
 */
export interface LLMChatRequest {
  /** System prompt / instructions */
  systemPrompt: string;
  /** Conversation history */
  messages: LLMMessage[];
  /** Available tools for function calling */
  tools?: Tool[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Configuration for LLM provider
 */
export interface LLMProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Extended config for factory - includes provider type
 */
export interface LLMFactoryConfig extends LLMProviderConfig {
  provider: LLMProviderType;
}

/**
 * LLM Provider interface - all LLM implementations must conform to this
 */
export interface LLMProvider {
  /**
   * Stream a chat completion response
   * @param request The chat request with system prompt, messages, and optional tools
   * @returns AsyncIterable of stream chunks
   */
  streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk>;

  /**
   * Get the provider name for logging
   */
  readonly name: string;
}
