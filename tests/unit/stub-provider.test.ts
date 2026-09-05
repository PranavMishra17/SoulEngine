import { describe, it, expect } from 'vitest';
import { StubLLMProvider } from '../../src/providers/llm/stub.js';
import type { LLMChatRequest } from '../../src/providers/llm/interface.js';

describe('StubLLMProvider', () => {
  it('returns scripted text responses in order', async () => {
    const provider = new StubLLMProvider({
      responses: [
        { text: 'Hello' },
        { text: 'World' },
      ],
    });

    const request: LLMChatRequest = {
      systemPrompt: 'Test',
      messages: [],
    };

    const chunks1 = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks1.push(chunk);
    }
    expect(chunks1).toHaveLength(1);
    expect(chunks1[0].text).toBe('Hello');
    expect(chunks1[0].done).toBe(true);

    const chunks2 = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks2.push(chunk);
    }
    expect(chunks2).toHaveLength(1);
    expect(chunks2[0].text).toBe('World');
    expect(chunks2[0].done).toBe(true);
  });

  it('returns scripted tool calls', async () => {
    const provider = new StubLLMProvider({
      responses: [
        {
          text: '',
          toolCalls: [
            { name: 'recall_npc', arguments: { name: 'Alice' } },
          ],
        },
      ],
    });

    const request: LLMChatRequest = {
      systemPrompt: 'Test',
      messages: [],
      tools: [
        { name: 'recall_npc', description: 'Test tool', parameters: { type: 'object', properties: {} } },
      ],
    };

    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].toolCalls).toHaveLength(1);
    expect(chunks[0].toolCalls[0].name).toBe('recall_npc');
    expect(chunks[0].toolCalls[0].arguments).toEqual({ name: 'Alice' });
    expect(chunks[0].done).toBe(true);
  });

  it('simulates configurable latency', async () => {
    const provider = new StubLLMProvider({
      responses: [{ text: 'Slow response', latencyMs: 50 }],
    });

    const request: LLMChatRequest = {
      systemPrompt: 'Test',
      messages: [],
    };

    const start = Date.now();
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45);
    // No upper bound: wall-clock under a loaded test runner is not a property
    // of the stub. The lower bound above is the assertion that matters.
    expect(chunks[0].text).toBe('Slow response');
  });

  it('uses default latency when per-response latency is not specified', async () => {
    const provider = new StubLLMProvider({
      responses: [{ text: 'Default latency' }],
      defaultLatencyMs: 30,
    });

    const request: LLMChatRequest = {
      systemPrompt: 'Test',
      messages: [],
    };

    const start = Date.now();
    const chunks = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks.push(chunk);
    }
    const elapsed = Date.now() - start;

    // Tolerate timer granularity; the point is that the default latency applied.
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(chunks[0].text).toBe('Default latency');
  });

  it('cycles back to first response when exhausted', async () => {
    const provider = new StubLLMProvider({
      responses: [{ text: 'A' }, { text: 'B' }],
    });

    const request: LLMChatRequest = {
      systemPrompt: 'Test',
      messages: [],
    };

    const chunks1 = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks1.push(chunk);
    }
    expect(chunks1[0].text).toBe('A');

    const chunks2 = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks2.push(chunk);
    }
    expect(chunks2[0].text).toBe('B');

    // Cycle back
    const chunks3 = [];
    for await (const chunk of provider.streamChat(request)) {
      chunks3.push(chunk);
    }
    expect(chunks3[0].text).toBe('A');
  });

  it('has a name property', () => {
    const provider = new StubLLMProvider({ responses: [] });
    expect(provider.name).toBe('stub');
  });
});
