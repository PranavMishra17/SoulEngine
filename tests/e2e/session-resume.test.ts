import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../src/session/store.js';
import { startSession, endSession, resumeSession } from '../../src/session/manager.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import type { NPCDefinition } from '../../src/types/npc.js';
import type { LLMProvider } from '../../src/providers/llm/interface.js';

describe('Session Resume (Durable Sessions)', () => {
  let testProjectId: string;
  let testNpcId: string;
  let testPlayerId: string;
  let storage: ReturnType<typeof getStorageForUser>;

  const mockLlmProvider: LLMProvider = {
    name: 'mock',
    async *streamChat() {
      yield { text: 'Mock response' };
    },
    async chat() {
      return { text: 'Mock response', usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only-not-production';
    sessionStore.clear();
    testNpcId = `test_npc_${Date.now()}`;
    testPlayerId = `test_player_${Date.now()}`;
    storage = getStorageForUser(null);

    const project = await storage.createProject('Resume Test Project', null);
    testProjectId = project.id;

    const createdDef = await storage.createDefinition(testProjectId, {
      name: 'Test Merchant',
      description: 'A friendly trader',
      core_anchor: {
        backstory: 'Years of trade experience.',
        principles: ['Fair deals only'],
        trauma_flags: [],
      },
      personality_baseline: { openness: 0.6, conscientiousness: 0.7, extraversion: 0.8, agreeableness: 0.8, neuroticism: 0.3 },
      salience_threshold: 0.4,
      knowledge_access: { include_tier_1: [], include_tier_2: [], include_tier_3: [] },
      default_mood: { valence: 0.7, arousal: 0.5, dominance: 0.5 },
      reveal_player_identity: false,
      voice: { voice_id: '', provider: 'cartesia', model: 'sonic-english' },
    });
    testNpcId = createdDef.id;
  });

  afterEach(async () => {
    sessionStore.clear();
    try {
      await storage.deleteProject(testProjectId);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates a session, simulates loss, and resumes by session_id with intact history', async () => {
    // Start a session
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // Simulate conversation history
    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();
    stored!.state.conversation_history.push(
      { role: 'user', content: 'Hello, merchant!' },
      { role: 'assistant', content: 'Greetings, traveler! What brings you here?' }
    );

    // End session gracefully (persists state)
    await endSession(sessionId, mockLlmProvider, false);

    // Simulate server restart: session store is now empty
    sessionStore.clear();
    expect(sessionStore.get(sessionId)).toBeUndefined();

    // Resume the session by session_id
    const resumeResult = await resumeSession(sessionId, null);
    expect(resumeResult.session_id).toBe(sessionId);
    expect(resumeResult.npc_name).toBe('Test Merchant');

    // Verify conversation history is intact
    const resumed = sessionStore.get(sessionId);
    expect(resumed).toBeDefined();
    expect(resumed!.state.conversation_history.length).toBe(2);
    expect(resumed!.state.conversation_history[0].content).toBe('Hello, merchant!');
    expect(resumed!.state.conversation_history[1].content).toBe('Greetings, traveler! What brings you here?');
  });

  it('fails to resume a session that was never started or has no persisted state', async () => {
    const fakeSessionId = 'sess_nonexistent_12345';

    await expect(resumeSession(fakeSessionId, null)).rejects.toThrow('Session not found or no persisted state available');
  });

  it('resumes a session and allows continuation (new messages append correctly)', async () => {
    // Start session
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    const stored = sessionStore.get(sessionId);
    stored!.state.conversation_history.push({ role: 'user', content: 'What do you sell?' });

    // End session
    await endSession(sessionId, mockLlmProvider, false);

    // Clear store (simulate restart)
    sessionStore.clear();

    // Resume
    await resumeSession(sessionId, null);

    // Add more messages
    const resumed = sessionStore.get(sessionId);
    expect(resumed).toBeDefined();
    resumed!.state.conversation_history.push({ role: 'assistant', content: 'I have swords and potions.' });

    expect(resumed!.state.conversation_history.length).toBe(2);
    expect(resumed!.state.conversation_history[1].content).toBe('I have swords and potions.');
  });
});
