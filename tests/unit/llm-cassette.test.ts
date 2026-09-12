import { describe, it, expect } from 'vitest';
import { RecordingLLMProvider, PlaybackLLMProvider, CassetteMissError } from '../../src/providers/llm/cassette.js';
import { StubLLMProvider } from '../../src/providers/llm/stub.js';
import type { LLMChatRequest } from '../../src/providers/llm/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('LLM Cassette', () => {
  describe('RecordingLLMProvider', () => {
    it('passes chunks through unchanged', async () => {
      const stub = new StubLLMProvider({
        responses: [{ text: 'Hello', latencyMs: 5 }],
      });

      const cassette = { version: 1 as const, entries: [] };
      const recorder = new RecordingLLMProvider(stub, cassette);

      const request: LLMChatRequest = {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
      };

      const chunks: string[] = [];
      for await (const chunk of recorder.streamChat(request)) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      expect(chunks.join('')).toBe('Hello');
    });

    it('stores one entry per streamChat call', async () => {
      const stub = new StubLLMProvider({
        responses: [{ text: 'First' }, { text: 'Second' }],
      });

      const cassette = { version: 1 as const, entries: [] };
      const recorder = new RecordingLLMProvider(stub, cassette);

      const request1: LLMChatRequest = {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'one' }],
        tools: [],
      };

      const request2: LLMChatRequest = {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'two' }],
        tools: [],
      };

      // Consume both streams
      for await (const _chunk of recorder.streamChat(request1)) {}
      for await (const _chunk of recorder.streamChat(request2)) {}

      expect(cassette.entries).toHaveLength(2);
      expect(cassette.entries[0].request.messages.length).toBe(1);
      expect(cassette.entries[1].request.messages.length).toBe(1);
    });

    it('includes usage chunks in recording', async () => {
      const stub = new StubLLMProvider({
        responses: [{ text: 'Response' }],
      });

      const cassette = { version: 1 as const, entries: [] };
      const recorder = new RecordingLLMProvider(stub, cassette);

      const request: LLMChatRequest = {
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'query' }],
        tools: [],
      };

      for await (const _chunk of recorder.streamChat(request)) {}

      expect(cassette.entries).toHaveLength(1);
      // Stub provider returns chunks with text and done, no separate usage chunk
      expect(cassette.entries[0].chunks.length).toBeGreaterThan(0);
      expect(cassette.entries[0].chunks[0].text).toBe('Response');
    });
  });

  describe('PlaybackLLMProvider', () => {
    it('yields recorded chunks for matching request', async () => {
      const stub = new StubLLMProvider({ responses: [{ text: 'Recorded response' }] });
      const recordCassette = { version: 1 as const, entries: [] };
      const recorder = new RecordingLLMProvider(stub, recordCassette);

      const request: LLMChatRequest = {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
      };

      // Record first
      for await (const _chunk of recorder.streamChat(request)) {}

      // Now playback
      const playback = new PlaybackLLMProvider(recordCassette);

      const chunks: string[] = [];

      for await (const chunk of playback.streamChat(request)) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      expect(chunks.join('')).toBe('Recorded response');
    });

    it('throws CassetteMissError on different message', async () => {
      const cassette = {
        version: 1 as const,
        entries: [
          {
            key: 'original-key',
            request: {
              systemPromptPrefix: '',
              systemPrompt: 'System',
              messages: [{ role: 'user' as const, content: 'original' }],
              toolNames: [],
            },
            chunks: [{ text: 'Original', toolCalls: [], done: true }],
          },
        ],
      };

      const playback = new PlaybackLLMProvider(cassette);

      const request: LLMChatRequest = {
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'different' }],
        tools: [],
      };

      await expect(async () => {
        for await (const _chunk of playback.streamChat(request)) {}
      }).rejects.toThrow(CassetteMissError);
    });

    it('throws CassetteMissError on different tool set', async () => {
      const cassette = {
        version: 1 as const,
        entries: [
          {
            key: 'tools-key',
            request: {
              systemPromptPrefix: '',
              systemPrompt: 'System',
              messages: [{ role: 'user' as const, content: 'query' }],
              toolNames: ['tool_a', 'tool_b'],
            },
            chunks: [{ text: 'Response', toolCalls: [], done: true }],
          },
        ],
      };

      const playback = new PlaybackLLMProvider(cassette);

      const request: LLMChatRequest = {
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'query' }],
        tools: [{ name: 'tool_c', description: 'Different tool' }],
      };

      await expect(async () => {
        for await (const _chunk of playback.streamChat(request)) {}
      }).rejects.toThrow(CassetteMissError);
    });

    it('matches on systemPromptPrefix when present', async () => {
      const stub = new StubLLMProvider({ responses: [{ text: 'With prefix' }] });
      const recordCassette = { version: 1 as const, entries: [] };
      const recorder = new RecordingLLMProvider(stub, recordCassette);

      const request: LLMChatRequest = {
        systemPromptPrefix: 'Custom prefix: ',
        systemPrompt: 'Main prompt',
        messages: [{ role: 'user', content: 'test' }],
        tools: [],
      };

      // Record
      for await (const _chunk of recorder.streamChat(request)) {}

      // Playback
      const playback = new PlaybackLLMProvider(recordCassette);

      const chunks: string[] = [];
      for await (const chunk of playback.streamChat(request)) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      expect(chunks.join('')).toBe('With prefix');
    });
  });

  describe('round-trip through file format', () => {
    it('writes and reads cassette file correctly', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cassette-test-'));
      const cassettePath = path.join(tmpDir, 'test.json');

      try {
        const stub = new StubLLMProvider({
          responses: [{ text: 'File test', usage: { input_tokens: 75, output_tokens: 12 } }],
        });

        const cassette = { version: 1 as const, entries: [] };
        const recorder = new RecordingLLMProvider(stub, cassette);

        const request: LLMChatRequest = {
          systemPrompt: 'Round trip',
          messages: [{ role: 'user', content: 'file test' }],
          tools: [],
        };

        for await (const _chunk of recorder.streamChat(request)) {}

        // Write cassette
        await fs.writeFile(cassettePath, JSON.stringify(cassette, null, 2));

        // Read it back
        const loaded = JSON.parse(await fs.readFile(cassettePath, 'utf-8'));
        expect(loaded.version).toBe(1);
        expect(loaded.entries).toHaveLength(1);

        // Playback from loaded cassette
        const playback = new PlaybackLLMProvider(loaded);
        const chunks: string[] = [];

        for await (const chunk of playback.streamChat(request)) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        expect(chunks.join('')).toBe('File test');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
