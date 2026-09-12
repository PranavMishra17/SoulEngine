import { describe, it, expect } from 'vitest';

/**
 * Tests for cache token mapping in LLM providers.
 *
 * Each provider has its own cache field name in the response; the provider
 * implementation maps it to the unified `cached_input_tokens` field.
 */
describe('LLM Provider Cache Token Mapping', () => {
  describe('Anthropic Provider', () => {
    it('maps cache_read_input_tokens to cached_input_tokens in final chunk', async () => {
      // We'll mock the fetch to return a stream with a message_delta event
      // that contains usage.cache_read_input_tokens = 700
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                const events = [
                  'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":700}}}\n',
                  'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n',
                  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n',
                  'data: {"type":"content_block_stop"}\n',
                  'data: {"type":"message_delta","usage":{"output_tokens":50}}\n',
                  'data: {"type":"message_stop"}\n',
                ].join('');
                return { done: false, value: new TextEncoder().encode(events) };
              },
            };
          },
        },
      };

      global.fetch = async () => mockResponse as any;

      // Import after setting up mock
      const { AnthropicLlmProvider } = await import('../../src/providers/llm/anthropic.js');
      const provider = new AnthropicLlmProvider({ apiKey: 'test-key' });

      const chunks: any[] = [];
      for await (const chunk of provider.streamChat({
        systemPrompt: 'Test',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }

      // Find the final chunk
      const finalChunk = chunks.find(c => c.done);
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toBeDefined();
      // Should have cached_input_tokens mapped from cache_read_input_tokens
      expect(finalChunk.usage.cached_input_tokens).toBe(700);
      // Total input_tokens should include cache_read_input_tokens
      expect(finalChunk.usage.input_tokens).toBe(800); // 100 + 0 + 700
    });

    it('leaves cached_input_tokens undefined when no cache fields present', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                const events = [
                  'data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n',
                  'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n',
                  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n',
                  'data: {"type":"content_block_stop"}\n',
                  'data: {"type":"message_delta","usage":{"output_tokens":50}}\n',
                  'data: {"type":"message_stop"}\n',
                ].join('');
                return { done: false, value: new TextEncoder().encode(events) };
              },
            };
          },
        },
      };

      global.fetch = async () => mockResponse as any;

      const { AnthropicLlmProvider } = await import('../../src/providers/llm/anthropic.js');
      const provider = new AnthropicLlmProvider({ apiKey: 'test-key' });

      const chunks: any[] = [];
      for await (const chunk of provider.streamChat({
        systemPrompt: 'Test',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find(c => c.done);
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toBeDefined();
      // Should be undefined, not 0
      expect(finalChunk.usage.cached_input_tokens).toBeUndefined();
    });
  });

  describe('OpenAI Provider', () => {
    it('maps prompt_tokens_details.cached_tokens to cached_input_tokens', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                const events = [
                  'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
                  'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"prompt_tokens_details":{"cached_tokens":512}}}\n',
                  'data: [DONE]\n',
                ].join('');
                return { done: false, value: new TextEncoder().encode(events) };
              },
            };
          },
        },
      };

      global.fetch = async () => mockResponse as any;

      const { OpenAILlmProvider } = await import('../../src/providers/llm/openai.js');
      const provider = new OpenAILlmProvider({ apiKey: 'test-key' });

      const chunks: any[] = [];
      for await (const chunk of provider.streamChat({
        systemPrompt: 'Test',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find(c => c.done);
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toBeDefined();
      // Should have cached_input_tokens mapped from prompt_tokens_details.cached_tokens
      expect(finalChunk.usage.cached_input_tokens).toBe(512);
    });

    it('leaves cached_input_tokens undefined when no cache fields present', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                const events = [
                  'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
                  'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50}}\n',
                  'data: [DONE]\n',
                ].join('');
                return { done: false, value: new TextEncoder().encode(events) };
              },
            };
          },
        },
      };

      global.fetch = async () => mockResponse as any;

      const { OpenAILlmProvider } = await import('../../src/providers/llm/openai.js');
      const provider = new OpenAILlmProvider({ apiKey: 'test-key' });

      const chunks: any[] = [];
      for await (const chunk of provider.streamChat({
        systemPrompt: 'Test',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find(c => c.done);
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toBeDefined();
      // Should be undefined, not 0
      expect(finalChunk.usage.cached_input_tokens).toBeUndefined();
    });
  });
});
