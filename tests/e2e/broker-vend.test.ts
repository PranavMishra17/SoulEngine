/**
 * E2E tests for POST /broker/vend.
 *
 * The broker exchanges the developer's stored voice-provider key for a
 * short-lived credential the game client can hold, so no provider key ships in
 * a build. These tests stub the outbound provider call; nothing touches the
 * network.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'crypto';

const TEST_API_KEY = 'vend-test-game-client-key-12345';
const TEST_API_KEY_HASH = createHash('sha256').update(TEST_API_KEY).digest('hex');
const PROVIDER_SECRET = 'stored-provider-secret-do-not-leak';

let app: Hono;
let projectId: string;

/** Stub globalThis.fetch so vendCredential never reaches a provider. */
function stubProviderFetch(status: number, payload: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  });
  return calls;
}

async function mintToken(scopes: string[]): Promise<string> {
  const res = await app.fetch(
    new Request('http://localhost/broker/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
      body: JSON.stringify({ project_id: projectId, scopes }),
    })
  );
  const body = (await res.json()) as { token: string };
  return body.token;
}

function vendRequest(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request('http://localhost/broker/vend', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /broker/vend', () => {
  beforeAll(async () => {
    const { createProject, updateProject, getProject } = await import('../../src/storage/index.js');

    const project = await createProject('Broker Vend Test Project', null);
    projectId = project.id;

    const projectData = await getProject(projectId);
    await updateProject(
      projectId,
      {
        ...projectData,
        settings: { ...projectData.settings, game_client_api_key_hash: TEST_API_KEY_HASH },
      },
      null
    );

    // Store provider keys the broker will exchange.
    const storage = (await import('../../src/storage/factory.js')).getStorage(null);
    await storage.saveApiKeys(projectId, {
      deepgram: PROVIDER_SECRET,
      cartesia: PROVIDER_SECRET,
      elevenlabs: PROVIDER_SECRET,
    });

    const { default: brokerRoutes } = await import('../../src/routes/broker.js');
    app = new Hono();
    app.route('/broker', brokerRoutes);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    try {
      const { deleteProject } = await import('../../src/storage/index.js');
      await deleteProject(projectId);
    } catch {
      // Cleanup is best effort.
    }
  });

  it('401 without an Authorization header', async () => {
    const res = await app.fetch(vendRequest(null, { provider: 'deepgram' }));
    expect(res.status).toBe(401);
  });

  it('403 when the broker token lacks the voice scope', async () => {
    const llmOnly = await mintToken(['llm']);
    const res = await app.fetch(vendRequest(llmOnly, { provider: 'deepgram' }));
    expect(res.status).toBe(403);
  });

  it('400 for an unknown provider', async () => {
    const token = await mintToken(['voice']);
    const res = await app.fetch(vendRequest(token, { provider: 'openai' }));
    expect(res.status).toBe(400);
  });

  it('vends a Deepgram credential and marks it reusable', async () => {
    stubProviderFetch(200, { access_token: 'dg-jwt-value', expires_in: 30 });
    const token = await mintToken(['voice']);

    const res = await app.fetch(vendRequest(token, { provider: 'deepgram', ttl_seconds: 30 }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toBe('deepgram');
    expect(body.credential).toBe('dg-jwt-value');
    expect(body.single_use).toBe(false);
    expect(body.expires_at).toBeTruthy();
  });

  it('vends a Cartesia credential', async () => {
    stubProviderFetch(200, { token: 'ct-token-value' });
    const token = await mintToken(['voice']);

    const res = await app.fetch(vendRequest(token, { provider: 'cartesia' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.credential).toBe('ct-token-value');
    expect(body.single_use).toBe(false);
  });

  it('marks an ElevenLabs credential single-use', async () => {
    stubProviderFetch(200, { token: 'sutkn_value' });
    const token = await mintToken(['voice']);

    const res = await app.fetch(vendRequest(token, { provider: 'elevenlabs' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    // Consumed on first use — a client caching it would fail on its next connection.
    expect(body.single_use).toBe(true);
  });

  it('never returns the stored provider key', async () => {
    stubProviderFetch(200, { access_token: 'dg-jwt-value', expires_in: 30 });
    const token = await mintToken(['voice']);

    const res = await app.fetch(vendRequest(token, { provider: 'deepgram' }));
    const raw = await res.text();

    expect(raw).not.toContain(PROVIDER_SECRET);
  });

  it('maps a provider refusal to a clean error envelope', async () => {
    stubProviderFetch(401, { error: 'unauthorized' });
    const token = await mintToken(['voice']);

    const res = await app.fetch(vendRequest(token, { provider: 'deepgram' }));
    expect(res.status).toBe(502);

    const raw = await res.text();
    expect(raw).not.toContain(PROVIDER_SECRET);
  });
});
