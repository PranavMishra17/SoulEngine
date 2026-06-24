/**
 * 2.9 — WS lifecycle auth primitives + resume-token minting.
 *
 * The WS handler verifies a session token (when supplied) using verifySessionToken,
 * and resumeSession must mint a fresh token so resumed sessions are authable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { createHash } from 'crypto';
import { generateSessionToken, verifySessionToken, resumeSession } from '../../src/session/manager.js';
import { persistSession } from '../../src/storage/local/index.js';

describe('session token primitives', () => {
  it('verifies a correct token and rejects wrong/forged tokens', () => {
    const token = generateSessionToken();
    const hash = createHash('sha256').update(token).digest('hex');
    expect(verifySessionToken(token, hash)).toBe(true);
    expect(verifySessionToken('not-the-token', hash)).toBe(false);
    expect(verifySessionToken(generateSessionToken(), hash)).toBe(false);
  });

  it('mints unique, high-entropy tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('resumeSession mints a session token', () => {
  const projectId = 'proj_resume_test01';
  const npcId = 'npc_resume_npc001';
  const sessionId = 'sess_resume_test_0001';
  let tempDir: string;
  let originalDataDir: string | undefined;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soulengine-resume-test-'));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
    process.env.ENCRYPTION_KEY = 'test-resume-encryption-key-32chars!!';

    const projectDir = path.join(tempDir, 'projects', projectId);
    await fs.mkdir(path.join(projectDir, 'definitions'), { recursive: true });

    await fs.writeFile(
      path.join(projectDir, 'project.yaml'),
      yaml.dump({
        id: projectId,
        name: 'Resume Test',
        created_at: '2025-01-01T00:00:00.000Z',
        settings: {
          llm_provider: 'gemini', stt_provider: 'deepgram', tts_provider: 'cartesia',
          default_voice_id: '', timeouts: { session: 1800000, llm: 30000, stt: 10000, tts: 10000 },
        },
        limits: { max_npcs: 10, max_categories: 20, max_concurrent_sessions: 5 },
        user_id: null,
      }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(projectDir, 'definitions', `${npcId}.yaml`),
      yaml.dump({
        id: npcId, project_id: projectId, name: 'Echo', description: 'test npc',
        core_anchor: { backstory: 'x', principles: ['p'], trauma_flags: [] },
        personality_baseline: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
        voice: { provider: 'cartesia', voice_id: 'v', speed: 1.0 },
        schedule: [], mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
        knowledge_access: {}, network: [],
      }),
      'utf-8'
    );

    // Persist a minimal session so resumeSession has something to load.
    await persistSession({
      session_id: sessionId,
      project_id: projectId,
      definition_id: npcId,
      player_id: 'p1',
      user_id: null,
      mode: 'text-text',
      messages: [],
      instance: { current_mood: { valence: 0.5, arousal: 0.5, dominance: 0.5 } },
      started_at: '2025-01-01T00:00:00.000Z',
      last_activity: '2025-01-01T00:00:00.000Z',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterAll(async () => {
    if (originalDataDir !== undefined) process.env.DATA_DIR = originalDataDir;
    else delete process.env.DATA_DIR;
    delete process.env.ENCRYPTION_KEY;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns a non-empty session_token on resume', async () => {
    const result = await resumeSession(sessionId, null);
    expect(typeof result.session_token).toBe('string');
    expect((result.session_token as string).length).toBeGreaterThan(0);
  });
});
