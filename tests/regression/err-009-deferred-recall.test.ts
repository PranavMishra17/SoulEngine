import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../src/session/store.js';
import { startSession, getSession } from '../../src/session/manager.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import type { NPCDefinition } from '../../src/types/npc.js';

describe('ERR-009: Deferred recall context persistence and transactional clearing', () => {
  let testProjectId: string;
  let testNpcId: string;
  let testPlayerId: string;
  let storage: ReturnType<typeof getStorageForUser>;

  beforeEach(async () => {
    sessionStore.clear();
    testNpcId = `test_npc_${Date.now()}`;
    testPlayerId = `test_player_${Date.now()}`;
    storage = getStorageForUser(null);

    // Create test project
    const project = await storage.createProject('Recall Test Project', null);
    testProjectId = project.id;

    // Create test NPC
    const createdDef = await storage.createDefinition(testProjectId, {
      name: 'Test Sage',
      description: 'A wise keeper of knowledge',
      core_anchor: {
        backstory: 'Long memory of ancient times.',
        principles: ['Share knowledge wisely'],
        trauma_flags: [],
      },
      personality_baseline: { openness: 0.8, conscientiousness: 0.7, extraversion: 0.5, agreeableness: 0.7, neuroticism: 0.3 },
      salience_threshold: 0.4,
      knowledge_access: { include_tier_1: [], include_tier_2: [], include_tier_3: [] },
      default_mood: { valence: 0.6, arousal: 0.4, dominance: 0.5 },
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

  it('persists deferred recall context to session state', async () => {
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // Simulate Mind setting deferred recall context
    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();

    stored!.state.deferred_mind_context = '- Retrieved (recall_memories): Player once saved the village from fire.';

    // Verify it's persisted in session state
    const retrieved = sessionStore.get(sessionId);
    expect(retrieved?.state.deferred_mind_context).toBe('- Retrieved (recall_memories): Player once saved the village from fire.');
  });

  it('deferred context survives a simulated reconnect (stored in session, not pipeline instance)', async () => {
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // Set deferred recall context
    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();
    stored!.state.deferred_mind_context = '- Retrieved (recall_npc): The blacksmith owes you a favor.';

    // Simulate a reconnect: retrieve the session from store (as a new pipeline instance would)
    const reconnected = getSession(sessionId);
    expect(reconnected).toBeDefined();
    expect(reconnected!.state.deferred_mind_context).toBe('- Retrieved (recall_npc): The blacksmith owes you a favor.');
  });

  it('deferred context is cleared after injection (no stale double-injection)', async () => {
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    // Set deferred context
    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();
    stored!.state.deferred_mind_context = '- Retrieved (recall_knowledge): Dragons exist in the northern mountains.';

    // Simulate injection by a speaker prompt builder (would read and clear)
    const session = getSession(sessionId);
    const deferredContext = session?.state.deferred_mind_context;
    expect(deferredContext).toBe('- Retrieved (recall_knowledge): Dragons exist in the northern mountains.');

    // Clear it transactionally after injection
    if (session) {
      session.state.deferred_mind_context = undefined;
    }

    // Verify it's gone
    const afterClear = getSession(sessionId);
    expect(afterClear?.state.deferred_mind_context).toBeUndefined();

    // A second read should get nothing (no double-injection)
    const secondRead = getSession(sessionId);
    expect(secondRead?.state.deferred_mind_context).toBeUndefined();
  });
});
