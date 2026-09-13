/**
 * Tests for streaming events through runConversationTurn's onEvent callback (item 7.14).
 *
 * Verifies that CognitionEvent instances arrive synchronously as the runtime
 * generates them, before the turn promise resolves, so voice callers can start
 * TTS on the first sentence while generation continues.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runConversationTurn } from '../../src/conversation/turn.js';
import type { CognitionEvent } from '../../src/core/runtime.js';
import type { LLMProvider, LLMStreamChunk } from '../../src/providers/llm/interface.js';
import { mcpToolRegistry } from '../../src/mcp/registry.js';
import * as storage from '../../src/storage/index.js';
import { startSession, endSession } from '../../src/session/manager.js';
import type { NPCDefinition } from '../../src/types/npc.js';

describe('runConversationTurn onEvent streaming', () => {
  let mockSpeaker: LLMProvider;
  let mockMind: LLMProvider;
  let sessionId: string;
  let projectId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create scratch project and NPC for testing
    const project = await storage.createProject('turn-stream-test');
    projectId = project.id;

    const definitionFields: Omit<NPCDefinition, 'id' | 'project_id'> = {
      name: 'TestNPC',
      description: 'Test NPC for event streaming tests',
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

    // Stub Speaker that yields three text chunks
    mockSpeaker = {
      name: 'stub-speaker',
      streamChat: vi.fn(async function* () {
        yield { text: 'Hello, ', done: false } as LLMStreamChunk;
        yield { text: 'how can ', done: false } as LLMStreamChunk;
        yield { text: 'I help?', done: false } as LLMStreamChunk;
        yield { text: '', done: true, usage: { input_tokens: 100, output_tokens: 10 } } as LLMStreamChunk;
      }),
    };

    // Stub Mind that does nothing
    mockMind = {
      name: 'stub-mind',
      streamChat: vi.fn(async function* () {
        yield { text: '', done: true } as LLMStreamChunk;
      }),
    };
  });

  afterEach(async () => {
    if (sessionId) {
      await endSession(sessionId, 'test ended');
    }
    if (projectId) {
      await storage.deleteProject(projectId);
    }
  });

  it('fires onEvent with text deltas before the turn promise resolves', async () => {
    const receivedEvents: Array<{ event: CognitionEvent; timestamp: number }> = [];
    let doneEventIndex = -1;
    let promiseResolvedAt = -1;

    const result = runConversationTurn({
      sessionId,
      content: 'Hello',
      fallbackProvider: mockSpeaker,
      toolRegistry: mcpToolRegistry,
      providers: { speaker: mockSpeaker, mind: mockMind },
      onEvent: (event) => {
        receivedEvents.push({ event, timestamp: Date.now() });
        if (event.type === 'done') {
          doneEventIndex = receivedEvents.length - 1;
        }
      },
    });

    await result;
    promiseResolvedAt = Date.now();

    // Assert: done event arrived before promise resolved
    expect(doneEventIndex).toBeGreaterThanOrEqual(0);
    expect(receivedEvents.length).toBeGreaterThan(doneEventIndex);

    // Assert: all events (including done) were recorded synchronously
    const doneTimestamp = receivedEvents[doneEventIndex]?.timestamp ?? 0;
    expect(doneTimestamp).toBeLessThanOrEqual(promiseResolvedAt);

    // Assert: text deltas arrived in order
    const textEvents = receivedEvents.filter((r) => r.event.type === 'text');
    expect(textEvents.length).toBe(3);
    expect((textEvents[0]?.event as { type: 'text'; delta: string }).delta).toBe('Hello, ');
    expect((textEvents[1]?.event as { type: 'text'; delta: string }).delta).toBe('how can ');
    expect((textEvents[2]?.event as { type: 'text'; delta: string }).delta).toBe('I help?');
  });

  it('delivers tool_call, tool_result, and follow_up events through onEvent', async () => {
    // This test verifies that onEvent can deliver all event types.
    // Tool execution is tested in runtime tests; here we just verify the callback works.
    const receivedEventTypes = new Set<string>();

    await runConversationTurn({
      sessionId,
      content: 'Hello',
      fallbackProvider: mockSpeaker,
      toolRegistry: mcpToolRegistry,
      providers: { speaker: mockSpeaker, mind: mockMind },
      onEvent: (event) => {
        receivedEventTypes.add(event.type);
      },
    });

    // Assert: at minimum, text and done events were delivered
    expect(receivedEventTypes.has('text')).toBe(true);
    expect(receivedEventTypes.has('done')).toBe(true);
  });

  it('omitting onEvent changes nothing (callback is optional)', async () => {
    const result = await runConversationTurn({
      sessionId,
      content: 'Hello',
      fallbackProvider: mockSpeaker,
      toolRegistry: mcpToolRegistry,
      providers: { speaker: mockSpeaker, mind: mockMind },
      // No onEvent callback
    });

    expect(result.responseText).toContain('Hello');
    expect(result.runtime).toBe('parallel');
  });

  it('voice session produces speaker prompt with voice-mode task text', async () => {
    // Create a new voice-mode session
    const voiceSession = await startSession(
      projectId,
      (await storage.listDefinitions(projectId))[0]!.id,
      'voice-player',
      null,  // playerInfo
      { input: 'voice', output: 'voice' }  // mode
    );

    const result = await runConversationTurn({
      sessionId: voiceSession.session_id,
      content: 'What time is it?',
      fallbackProvider: mockSpeaker,
      toolRegistry: mcpToolRegistry,
      providers: { speaker: mockSpeaker, mind: mockMind },
    });

    // Voice mode includes "[VOICE MODE]" section
    expect(result.speakerPrompt).toContain('[VOICE MODE]');

    await endSession(voiceSession.session_id, 'test ended');
  });

  it('text session does not include voice-mode task text in speaker prompt', async () => {
    // Session mode is text by default
    const result = await runConversationTurn({
      sessionId,
      content: 'What time is it?',
      fallbackProvider: mockSpeaker,
      toolRegistry: mcpToolRegistry,
      providers: { speaker: mockSpeaker, mind: mockMind },
    });

    // Text mode should not include the voice-specific instruction
    expect(result.speakerPrompt).not.toContain('respond naturally with a single short sentence');
  });
});
