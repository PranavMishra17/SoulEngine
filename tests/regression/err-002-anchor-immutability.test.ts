import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../src/session/store.js';
import { startSession, endSession } from '../../src/session/manager.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import type { NPCDefinition } from '../../src/types/npc.js';
import type { LLMProvider } from '../../src/providers/llm/interface.js';

describe('ERR-002: Core Anchor immutability enforcement', () => {
  let testProjectId: string;
  let testNpcId: string;
  let testPlayerId: string;
  let storage: ReturnType<typeof getStorageForUser>;

  // Mock LLM provider for endSession (summarization)
  const mockLlmProvider: LLMProvider = {
    name: 'mock',
    async *streamChat() {
      yield { text: 'Mock summary' };
    },
    async chat() {
      return { text: 'Mock summary', usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };

  beforeEach(async () => {
    // Set encryption key for local secrets storage
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only-not-production';
    sessionStore.clear();
    testNpcId = `test_npc_${Date.now()}`;
    testPlayerId = `test_player_${Date.now()}`;
    storage = getStorageForUser(null); // local storage

    // Create test project (createProject returns the project with generated ID)
    const project = await storage.createProject('Anchor Test Project', null);
    testProjectId = project.id;

    // Create test NPC with a defined anchor
    const createdDef = await storage.createDefinition(testProjectId, {
      name: 'Test Guardian',
      description: 'A steadfast protector',
      core_anchor: {
        backstory: 'Original backstory about loyalty.',
        principles: ['Never abandon duty', 'Protect the innocent'],
        trauma_flags: [],
      },
      personality_baseline: { openness: 0.5, conscientiousness: 0.8, extraversion: 0.3, agreeableness: 0.7, neuroticism: 0.2 },
      salience_threshold: 0.4,
      knowledge_access: { include_tier_1: [], include_tier_2: [], include_tier_3: [] },
      default_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
      reveal_player_identity: false,
      voice: { voice_id: '', provider: 'cartesia', model: 'sonic-english' },
    });
    testNpcId = createdDef.id;
  });

  afterEach(async () => {
    sessionStore.clear();
    // Cleanup: delete project (cascade will remove NPC and instances)
    try {
      await storage.deleteProject(testProjectId);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('rejects/restores a tampered anchor at session end', async () => {
    // Start session
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // Simulate conversation
    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();

    // Tamper with the anchor mid-session by reloading definition and modifying it
    const definition = await storage.getDefinition(testProjectId, testNpcId);
    definition.core_anchor.backstory = 'TAMPERED backstory injected mid-session';
    definition.core_anchor.principles.push('TAMPERED principle');
    await storage.updateDefinition(testProjectId, testNpcId, definition);

    // End session (should detect and restore the original anchor)
    const endResult = await endSession(sessionId, mockLlmProvider, false);
    expect(endResult.success).toBe(true);

    // Reload the definition and verify anchor was restored to original
    const finalDefinition = await storage.getDefinition(testProjectId, testNpcId);
    expect(finalDefinition.core_anchor.backstory).toBe('Original backstory about loyalty.');
    expect(finalDefinition.core_anchor.principles).toEqual(['Never abandon duty', 'Protect the innocent']);
  });

  it('allows an untampered anchor to pass through unchanged', async () => {
    // Start session
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // No tampering — just end the session
    const endResult = await endSession(sessionId, mockLlmProvider, false);
    expect(endResult.success).toBe(true);

    // Reload definition and verify anchor is unchanged
    const finalDefinition = await storage.getDefinition(testProjectId, testNpcId);
    expect(finalDefinition.core_anchor.backstory).toBe('Original backstory about loyalty.');
    expect(finalDefinition.core_anchor.principles).toEqual(['Never abandon duty', 'Protect the innocent']);
  });

  it('detects and logs partial anchor tampering (principle modification)', async () => {
    // Start session
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // Tamper with just one principle
    const definition = await storage.getDefinition(testProjectId, testNpcId);
    definition.core_anchor.principles[0] = 'TAMPERED first principle';
    await storage.updateDefinition(testProjectId, testNpcId, definition);

    // End session
    const endResult = await endSession(sessionId, mockLlmProvider, false);
    expect(endResult.success).toBe(true);

    // Verify anchor was restored
    const finalDefinition = await storage.getDefinition(testProjectId, testNpcId);
    expect(finalDefinition.core_anchor.principles[0]).toBe('Never abandon duty');
  });
});
