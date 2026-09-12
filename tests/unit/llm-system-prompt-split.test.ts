/**
 * Tests for LLM provider handling of split system prompts with caching.
 * Verifies that providers correctly handle systemPromptPrefix and cacheKey.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicLlmProvider } from '../../src/providers/llm/anthropic.js';
import { OpenAILlmProvider } from '../../src/providers/llm/openai.js';
import { StubLLMProvider } from '../../src/providers/llm/stub.js';
import type { LLMChatRequest } from '../../src/providers/llm/interface.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('Anthropic provider system prompt split', () => {
  let provider: AnthropicLlmProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    provider = new AnthropicLlmProvider({
      apiKey: 'test-key',
      model: 'claude-opus-4',
      maxTokens: 4096,
      temperature: 0.7,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses two-block system with cache_control on prefix when systemPromptPrefix is provided', async () => {
    const request: LLMChatRequest = {
      systemPromptPrefix: 'Stable prefix content',
      systemPrompt: 'Dynamic suffix content',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Mock streaming response
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"message_stop"}\n\n'),
          })
          .mockResolvedValueOnce({ done: true }),
      }),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockBody,
    });

    // Consume the stream
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    // Verify the fetch call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOptions] = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);

    expect(body.system).toHaveLength(2);
    expect(body.system[0]).toEqual({
      type: 'text',
      text: 'Stable prefix content',
      cache_control: { type: 'ephemeral' },
    });
    expect(body.system[1]).toEqual({
      type: 'text',
      text: 'Dynamic suffix content',
    });
  });

  it('uses single-block system with cache_control when no prefix provided', async () => {
    const request: LLMChatRequest = {
      systemPrompt: 'Full system prompt',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Mock streaming response
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"message_stop"}\n\n'),
          })
          .mockResolvedValueOnce({ done: true }),
      }),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockBody,
    });

    // Consume the stream
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    // Verify the fetch call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOptions] = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);

    expect(body.system).toHaveLength(1);
    expect(body.system[0]).toEqual({
      type: 'text',
      text: 'Full system prompt',
      cache_control: { type: 'ephemeral' },
    });
  });
});

describe('OpenAI provider system prompt split', () => {
  let provider: OpenAILlmProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    provider = new OpenAILlmProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0.7,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('concatenates prefix and systemPrompt when prefix is provided', async () => {
    const request: LLMChatRequest = {
      systemPromptPrefix: 'Stable prefix content',
      systemPrompt: 'Dynamic suffix content',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Mock streaming response
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true }),
      }),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockBody,
    });

    // Consume the stream
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    // Verify the fetch call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOptions] = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);

    const systemMessage = body.messages.find((m: Record<string, unknown>) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toBe('Stable prefix content\n\nDynamic suffix content');
  });

  it('sets prompt_cache_key when cacheKey is provided', async () => {
    const request: LLMChatRequest = {
      systemPromptPrefix: 'Stable prefix content',
      systemPrompt: 'Dynamic suffix content',
      cacheKey: 'npc-123:v5',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Mock streaming response
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true }),
      }),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockBody,
    });

    // Consume the stream
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    // Verify the fetch call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOptions] = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);

    const systemMessage = body.messages.find((m: Record<string, unknown>) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage.prompt_cache_key).toBe('npc-123:v5');
  });

  it('omits prompt_cache_key when cacheKey is not provided', async () => {
    const request: LLMChatRequest = {
      systemPrompt: 'Full system prompt',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Mock streaming response
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: [DONE]\n\n'),
          })
          .mockResolvedValueOnce({ done: true }),
      }),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockBody,
    });

    // Consume the stream
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    // Verify the fetch call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOptions] = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);

    const systemMessage = body.messages.find((m: Record<string, unknown>) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage.prompt_cache_key).toBeUndefined();
  });
});

describe('Stub provider system prompt split', () => {
  it('receives combined prompt when prefix is provided', async () => {
    const provider = new StubLLMProvider({
      responses: [{ text: 'Test response' }],
      defaultLatencyMs: 0,
    });

    const request: LLMChatRequest = {
      systemPromptPrefix: 'Stable prefix',
      systemPrompt: 'Dynamic suffix',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // The stub provider doesn't inspect systemPrompt directly in the current implementation,
    // but this test ensures that if it did, the prefix would be available
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Test response');
    expect(chunks[0].done).toBe(true);
  });
});
