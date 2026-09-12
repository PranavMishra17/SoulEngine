/**
 * Stub LLM provider for deterministic offline testing.
 *
 * Returns scripted responses from a fixture, supports tool calls, and
 * simulates configurable artificial latency. Useful for measuring cognition
 * behavior without real API calls.
 */

import type { LLMProvider, LLMChatRequest, LLMStreamChunk } from './interface.js';
import type { ToolCall } from '../../types/mcp.js';

/**
 * A single scripted response for the stub provider.
 */
export interface StubResponse {
  /** Text content to return */
  text?: string;
  /** Tool calls to return */
  toolCalls?: ToolCall[];
  /** Artificial latency in milliseconds (overrides default) */
  latencyMs?: number;
}

/**
 * Configuration for the stub LLM provider.
 */
export interface StubLLMConfig {
  /** Scripted responses to return in order */
  responses: StubResponse[];
  /** Default latency for all responses (can be overridden per response) */
  defaultLatencyMs?: number;
}

/**
 * Deterministic stub LLM provider for offline testing.
 *
 * Returns scripted responses in order, cycling back to the beginning when
 * exhausted. Simulates artificial latency to make timing behavior reproducible.
 */
export class StubLLMProvider implements LLMProvider {
  readonly name = 'stub';
  private responses: StubResponse[];
  private defaultLatencyMs: number;
  private currentIndex = 0;

  constructor(config: StubLLMConfig) {
    this.responses = config.responses;
    this.defaultLatencyMs = config.defaultLatencyMs ?? 0;
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    // Get next response (cycle if exhausted)
    const response = this.responses[this.currentIndex % this.responses.length];
    this.currentIndex++;

    // Simulate latency
    const latency = response.latencyMs ?? this.defaultLatencyMs;
    if (latency > 0) {
      // A real provider stops when the caller aborts; the stub must too, or a
      // timeout test cannot tell an abandoned Mind from a finished one.
      const aborted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), latency);
        request.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(true); }, { once: true });
      });
      if (aborted) return;
    }

    // Return single chunk with full response
    yield {
      text: response.text ?? '',
      toolCalls: response.toolCalls ?? [],
      done: true,
    };
  }
}
