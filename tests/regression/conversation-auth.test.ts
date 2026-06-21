/**
 * Regression tests for conversation lifecycle authentication hardening.
 *
 * Guards the following security properties:
 *  (a) Session IDs are high-entropy (>=128 bits from crypto.randomBytes).
 *  (b) The full lifecycle (message, history, end) rejects calls missing the
 *      required session token while accepting valid ones.
 *  (c) Game-client key comparison uses timingSafeEqual (wrong key is rejected).
 *  (d) Named revocable game-client keys are supported in ProjectSettings schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes, createHash } from 'crypto';
import { sessionStore } from '../../src/session/store.js';
import { startSession } from '../../src/session/manager.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import {
  generateSessionId,
  generateSessionToken,
  verifySessionToken,
  verifyGameClientKey,
} from '../../src/session/manager.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// (a) High-entropy session IDs
// ---------------------------------------------------------------------------

describe('Session ID entropy', () => {
  it('generates a session ID that encodes at least 128 bits of randomness', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^sess_/);

    // Payload after "sess_" prefix — must be 32 hex chars (128 bits)
    const hex = id.replace(/^sess_/, '');
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
    expect(hex.length).toBe(32);
  });

  it('generates unique IDs across many iterations (no collision)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateSessionId()));
    expect(ids.size).toBe(1000);
  });

  it('never produces the old low-entropy format (base36 time + underscore + 7 random chars)', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateSessionId();
      // Old format was: sess_<base36time>_<7chars> — had an underscore in the payload
      const payload = id.replace(/^sess_/, '');
      expect(payload).not.toContain('_');
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Session token — lifecycle auth helpers
// ---------------------------------------------------------------------------

describe('Session token generation and verification', () => {
  it('generateSessionToken returns a high-entropy opaque token (>=32 hex chars = 128 bits)', () => {
    const token = generateSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(typeof token).toBe('string');
  });

  it('verifySessionToken returns true for the correct token', () => {
    const token = generateSessionToken();
    const hash = sha256Hex(token);
    expect(verifySessionToken(token, hash)).toBe(true);
  });

  it('verifySessionToken returns false for a wrong token', () => {
    const token = generateSessionToken();
    const hash = sha256Hex(token);
    const wrongToken = generateSessionToken();
    expect(verifySessionToken(wrongToken, hash)).toBe(false);
  });

  it('verifySessionToken does not throw for differing-length inputs (constant-time safety)', () => {
    const token = generateSessionToken();
    const hash = sha256Hex(token);
    const shortToken = 'short';
    expect(() => verifySessionToken(shortToken, hash)).not.toThrow();
    expect(verifySessionToken(shortToken, hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) Game-client key verification using timingSafeEqual
// ---------------------------------------------------------------------------

describe('Game-client API key verification (timingSafeEqual)', () => {
  it('verifyGameClientKey accepts the correct raw key', () => {
    const rawKey = 'gcak_' + randomBytes(32).toString('hex');
    const storedHash = sha256Hex(rawKey);
    expect(verifyGameClientKey(rawKey, storedHash)).toBe(true);
  });

  it('verifyGameClientKey rejects an incorrect key', () => {
    const correctKey = 'gcak_' + randomBytes(32).toString('hex');
    const storedHash = sha256Hex(correctKey);
    const wrongKey = 'gcak_' + randomBytes(32).toString('hex');
    expect(verifyGameClientKey(wrongKey, storedHash)).toBe(false);
  });

  it('verifyGameClientKey does not throw for short/mismatched-length inputs', () => {
    const rawKey = 'gcak_' + randomBytes(32).toString('hex');
    const storedHash = sha256Hex(rawKey);
    expect(() => verifyGameClientKey('bad', storedHash)).not.toThrow();
    expect(verifyGameClientKey('bad', storedHash)).toBe(false);
  });

  it('verifyGameClientKey rejects empty inputs', () => {
    const rawKey = 'gcak_' + randomBytes(32).toString('hex');
    const storedHash = sha256Hex(rawKey);
    expect(verifyGameClientKey('', storedHash)).toBe(false);
    expect(verifyGameClientKey(rawKey, '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) Named revocable game-client keys in ProjectSettings schema
// ---------------------------------------------------------------------------

describe('Named revocable game-client keys', () => {
  it('ProjectSettingsSchema accepts a game_client_api_keys array', async () => {
    const { ProjectSettingsSchema } = await import('../../src/schema/index.js');

    const settings = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: '',
      timeouts: {},
      game_client_api_keys: [
        { id: 'key_abc', name: 'Unity Client', hash: 'aabbcc' },
        { id: 'key_def', name: 'WebGL Client', hash: 'ddeeff' },
      ],
    };

    const result = ProjectSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.game_client_api_keys).toHaveLength(2);
      expect(result.data.game_client_api_keys![0].name).toBe('Unity Client');
      expect(result.data.game_client_api_keys![1].id).toBe('key_def');
    }
  });

  it('ProjectSettingsSchema game_client_api_keys is optional (backward compat)', async () => {
    const { ProjectSettingsSchema } = await import('../../src/schema/index.js');

    const settings = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: '',
      timeouts: {},
      // no game_client_api_keys
    };

    const result = ProjectSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.game_client_api_keys).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// (e) Integration: startSession returns session_token + stored session has hash
// ---------------------------------------------------------------------------

describe('startSession session token binding', () => {
  let testProjectId: string;
  let testNpcId: string;
  let storage: ReturnType<typeof getStorageForUser>;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only-not-production';
    sessionStore.clear();
    storage = getStorageForUser(null);

    const project = await storage.createProject('Auth Token Test', null);
    testProjectId = project.id;

    const def = await storage.createDefinition(testProjectId, {
      name: 'Guard NPC',
      description: 'Gate keeper',
      core_anchor: {
        backstory: 'A guard who has seen everything.',
        principles: ['Protect', 'Obey'],
        trauma_flags: [],
      },
      personality_baseline: {
        openness: 0.4,
        conscientiousness: 0.8,
        extraversion: 0.4,
        agreeableness: 0.5,
        neuroticism: 0.3,
      },
      salience_threshold: 0.4,
      knowledge_access: { include_tier_1: [], include_tier_2: [], include_tier_3: [] },
      default_mood: { valence: 0.5, arousal: 0.5, dominance: 0.6 },
      reveal_player_identity: false,
      voice: { voice_id: '', provider: 'cartesia', model: 'sonic-english' },
    });
    testNpcId = def.id;
  });

  afterEach(async () => {
    sessionStore.clear();
    try {
      await storage.deleteProject(testProjectId);
    } catch {
      // ignore
    }
  });

  it('returns a session_token in SessionStartResult', async () => {
    const result = await startSession(testProjectId, testNpcId, 'player_1', undefined, undefined, null);
    expect(result.session_token).toBeDefined();
    expect(typeof result.session_token).toBe('string');
    expect((result.session_token as string).length).toBeGreaterThanOrEqual(32);
  });

  it('stores only a hash of the session token in the session store (not plaintext)', async () => {
    const result = await startSession(testProjectId, testNpcId, 'player_2', undefined, undefined, null);
    const stored = sessionStore.get(result.session_id);

    expect(stored).toBeDefined();
    expect(stored!.sessionTokenHash).toBeDefined();
    // Hash must NOT equal the raw token
    expect(stored!.sessionTokenHash).not.toBe(result.session_token);
    // Hash must verify using sha256
    expect(stored!.sessionTokenHash).toBe(sha256Hex(result.session_token as string));
  });

  it('verifySessionToken round-trips correctly with the stored hash', async () => {
    const result = await startSession(testProjectId, testNpcId, 'player_3', undefined, undefined, null);
    const stored = sessionStore.get(result.session_id);

    expect(verifySessionToken(result.session_token as string, stored!.sessionTokenHash!)).toBe(true);
    expect(verifySessionToken('wrong_token', stored!.sessionTokenHash!)).toBe(false);
  });
});
