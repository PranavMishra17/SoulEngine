import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runConversationTurn } from '../../src/conversation/turn.js';
import { startSession, endSession } from '../../src/session/manager.js';
import { mcpToolRegistry } from '../../src/mcp/registry.js';
import * as storage from '../../src/storage/index.js';
import type { LLMProvider, LLMChatRequest, LLMStreamChunk } from '../../src/providers/llm/interface.js';
import type { NPCDefinition } from '../../src/types/npc.js';

/**
 * Stub provider that yields configurable chunks with controllable delay.
 */
class DelayedStubProvider implements LLMProvider {
  readonly name = 'delayed-stub';
  private responses: Array<{ text: string; delayMs: number }>;

  constructor(responses: Array<{ text: string; delayMs: number }>) {
    this.responses = responses;
  }

  async *streamChat(_request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    for (const response of this.responses) {
      if (response.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, response.delayMs));
      }
      if (response.text) {
        yield { text: response.text, toolCalls: [], done: false };
      }
    }
    yield { text: '', toolCalls: [], done: true };
  }
}

/**
 * Stub provider that yields usage with cache tokens.
 */
class CacheTokenStubProvider implements LLMProvider {
  readonly name = 'cache-stub';
  private cacheTokens?: number;

  constructor(cacheTokens?: number) {
    this.cacheTokens = cacheTokens;
  }

  async *streamChat(_request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    yield { text: 'Cached response', toolCalls: [], done: false };
    yield {
      text: '',
      toolCalls: [],
      done: true,
      usage: this.cacheTokens !== undefined
        ? { input_tokens: 100, output_tokens: 50, cached_input_tokens: this.cacheTokens }
        : { input_tokens: 100, output_tokens: 50 },
    };
  }
}

describe('Turn Latency Visibility', () => {
  let sessionId: string;
  let projectId: string;
  const toolRegistry = mcpToolRegistry;

  beforeEach(async () => {
    // Create scratch project and NPC for testing
    const project = await storage.createProject('turn-latency-test');
    projectId = project.id;

    const definitionFields: Omit<NPCDefinition, 'id' | 'project_id'> = {
      name: 'TestNPC',
      description: 'Test NPC for latency tests',
      core_anchor: {
        backstory: 'Test backstory',
        principles: [],
        trauma_flags: [],
      },
      personality_baseline: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      },
      voice: { provider: 'elevenlabs', voice_id: 'test', speed: 1.0 },
      schedule: [],
      mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
      knowledge_access: {},
      network: [],
    };
    const definition = await storage.createDefinition(projectId, definitionFields);

    const session = await startSession(projectId, definition.id, 'test-player');
    sessionId = session.session_id;
  });

  afterEach(async () => {
    if (sessionId) {
      await endSession(sessionId, 'test ended');
    }
    if (projectId) {
      await storage.deleteProject(projectId);
    }
  });

  it('measures speakerTtftMs when first text arrives after delay', async () => {
    // Speaker stub yields empty chunk, waits ~40ms, then yields text
    const speakerProvider = new DelayedStubProvider([
      { text: '', delayMs: 0 },
      { text: 'Hello', delayMs: 40 },
    ]);
    const mindProvider = new DelayedStubProvider([{ text: '', delayMs: 0 }]);

    const result = await runConversationTurn({
      sessionId,
      content: 'Hi',
      fallbackProvider: null,
      toolRegistry,
      channel: 'harness',
      providers: { speaker: speakerProvider, mind: mindProvider },
    });

    // speakerTtftMs should be >= 40ms (the delay before first text)
    expect(result.timings.speakerTtftMs).toBeGreaterThanOrEqual(40);
    // speakerTtftMs should be <= speakerMs (total speaker time)
    expect(result.timings.speakerTtftMs).toBeLessThanOrEqual(result.timings.speakerMs);
  });

  it('sets speakerTtftMs to null when stream yields no text', async () => {
    // Speaker stub yields only empty chunks and done
    const speakerProvider = new DelayedStubProvider([
      { text: '', delayMs: 0 },
    ]);
    const mindProvider = new DelayedStubProvider([{ text: '', delayMs: 0 }]);

    const result = await runConversationTurn({
      sessionId,
      content: 'Hi',
      fallbackProvider: null,
      toolRegistry,
      channel: 'harness',
      providers: { speaker: speakerProvider, mind: mindProvider },
    });

    // speakerTtftMs should be null (no text ever yielded)
    expect(result.timings.speakerTtftMs).toBeNull();
  });

  it('includes cached_input_tokens in result.usage.speaker', async () => {
    const speakerProvider = new CacheTokenStubProvider(1234);
    const mindProvider = new DelayedStubProvider([{ text: '', delayMs: 0 }]);

    const result = await runConversationTurn({
      sessionId,
      content: 'Hi',
      fallbackProvider: null,
      toolRegistry,
      channel: 'harness',
      providers: { speaker: speakerProvider, mind: mindProvider },
    });

    // result.usage.speaker should include cached_input_tokens
    expect(result.usage).toBeDefined();
    expect(result.usage.speaker).toBeDefined();
    expect(result.usage.speaker?.cached_input_tokens).toBe(1234);
  });

  it('enforces orchestration overhead bound: wallMs - max(mindMs, speakerMs) <= 250', async () => {
    // Zero-delay stubs make provider time near zero
    const speakerProvider = new DelayedStubProvider([{ text: 'Quick', delayMs: 0 }]);
    const mindProvider = new DelayedStubProvider([{ text: '', delayMs: 0 }]);

    const result = await runConversationTurn({
      sessionId,
      content: 'Hi',
      fallbackProvider: null,
      toolRegistry,
      channel: 'harness',
      providers: { speaker: speakerProvider, mind: mindProvider },
    });

    const overhead = result.timings.wallMs - Math.max(result.timings.mindMs ?? 0, result.timings.speakerMs);
    // Orchestration overhead should be <= 250ms
    expect(overhead).toBeLessThanOrEqual(250);
  });
});
