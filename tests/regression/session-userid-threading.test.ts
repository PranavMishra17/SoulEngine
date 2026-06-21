import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../src/session/store.js';
import { startSession } from '../../src/session/manager.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import type { NPCDefinition } from '../../src/types/npc.js';

describe('Session userId threading', () => {
  let testProjectId: string;
  let testNpcId: string;
  let testPlayerId: string;
  let storage: ReturnType<typeof getStorageForUser>;

  beforeEach(async () => {
    sessionStore.clear();
    testNpcId = `test_npc_${Date.now()}`;
    testPlayerId = `test_player_${Date.now()}`;
    storage = getStorageForUser(null);

    const project = await storage.createProject('UserId Threading Test', null);
    testProjectId = project.id;

    const createdDef = await storage.createDefinition(testProjectId, {
      name: 'Test Clerk',
      description: 'A diligent record keeper',
      core_anchor: {
        backstory: 'Organized and precise.',
        principles: ['Accuracy above all'],
        trauma_flags: [],
      },
      personality_baseline: { openness: 0.4, conscientiousness: 0.9, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.2 },
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
    try {
      await storage.deleteProject(testProjectId);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('threads userId=null (local storage) through session state', async () => {
    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, null);
    const sessionId = startResult.session_id;

    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();
    expect(stored!.userId).toBeNull();
    expect(stored!.state.user_id).toBeNull();
  });

  it('threads userId (authenticated user) through session state', async () => {
    const authenticatedUserId = 'user_auth_12345';

    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, authenticatedUserId);
    const sessionId = startResult.session_id;

    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();
    expect(stored!.userId).toBe(authenticatedUserId);
    expect(stored!.state.user_id).toBe(authenticatedUserId);
  });

  it('session state includes userId for correct storage backend selection', async () => {
    const userId = 'user_cloud_99999';

    const startResult = await startSession(testProjectId, testNpcId, testPlayerId, undefined, undefined, userId);
    const sessionId = startResult.session_id;

    const stored = sessionStore.get(sessionId);
    expect(stored).toBeDefined();

    // Verify userId is available in session state for downstream core/storage calls
    expect(stored!.state.user_id).toBe(userId);
  });
});
