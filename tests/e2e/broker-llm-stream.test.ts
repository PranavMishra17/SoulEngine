/**
 * E2E tests for streaming through POST /broker/llm.
 *
 * Every completion for a shipped game goes through the broker, because the
 * developer's provider key must not be in the build. Without streaming, an NPC's
 * reply arrives in one lump and time-to-first-word — the latency a player
 * actually perceives — is the whole reply's latency.
 *
 * The LLM provider is stubbed; nothing touches the network.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'crypto';

const TEST_API_KEY = 'stream-test-game-client-key-12345';
const TEST_API_KEY_HASH = createHash('sha256').update(TEST_API_KEY).digest('hex');

const CHUNKS = ['Hello', ', ', 'traveller', '.'];

let failMidStream = false;

// The route builds its provider through this factory; stub the whole module so
// the handler runs unmodified against a deterministic stream.
vi.mock('../../src/providers/llm/factory.js', () => ({
  createLlmProvider: () => ({
    async *streamChat() {
      for (let i = 0; i < CHUNKS.length; i++) {
        if (failMidStream && i === 2) {
          throw new Error('provider exploded mid-stream');
        }
        yield { text: CHUNKS[i], toolCalls: [], done: false };
      }
      yield {
        text: '',
        toolCalls: [],
        done: true,
        usage: { input_tokens: 11, output_tokens: 4 },
      };
    },
  }),
}));

let app: Hono;
let projectId: string;

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

function llmRequest(token: string | null, stream: boolean): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request('http://localhost/broker/llm', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      system_prompt: 'You are a guard.',
      messages: [{ role: 'user', content: 'Hi' }],
      stream,
    }),
  });
}

/** Parse an SSE body into (event, data) pairs. */
function parseSse(raw: string): Array<{ event: string; data: any }> {
  const out: Array<{ event: string; data: any }> = [];
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event: '));
    const dataLine = lines.find((l) => l.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    out.push({
      event: eventLine.slice('event: '.length),
      data: JSON.parse(dataLine.slice('data: '.length)),
    });
  }
  return out;
}

describe('POST /broker/llm streaming', () => {
  beforeAll(async () => {
    const { createProject, updateProject, getProject } = await import('../../src/storage/index.js');

    const project = await createProject('Broker Stream Test Project', null);
    projectId = project.id;

    const projectData = await getProject(projectId);
    await updateProject(
      projectId,
      {
        ...projectData,
        settings: {
          ...projectData.settings,
          game_client_api_key_hash: TEST_API_KEY_HASH,
          llm_provider: 'gemini',
        },
      },
      null
    );

    const storage = (await import('../../src/storage/factory.js')).getStorage(null);
    await storage.saveApiKeys(projectId, { gemini: 'stored-llm-key' });

    const { default: brokerRoutes } = await import('../../src/routes/broker.js');
    app = new Hono();
    app.route('/broker', brokerRoutes);
  });

  afterAll(async () => {
    failMidStream = false;
    try {
      const { deleteProject } = await import('../../src/storage/index.js');
      await deleteProject(projectId);
    } catch {
      // best effort
    }
  });

  it('401 without an Authorization header', async () => {
    const res = await app.fetch(llmRequest(null, true));
    expect(res.status).toBe(401);
  });

  it('403 when the token lacks the llm scope', async () => {
    const voiceOnly = await mintToken(['voice']);
    const res = await app.fetch(llmRequest(voiceOnly, true));
    expect(res.status).toBe(403);
  });

  it('still returns the non-streaming JSON shape when stream is false', async () => {
    const token = await mintToken(['llm']);
    const res = await app.fetch(llmRequest(token, false));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.text).toBe(CHUNKS.join(''));
    expect(body.usage).toEqual({ input_tokens: 11, output_tokens: 4 });
  });

  it('streams as server-sent events and emits a terminal event', async () => {
    const token = await mintToken(['llm']);
    const res = await app.fetch(llmRequest(token, true));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = parseSse(await res.text());
    const chunks = events.filter((e) => e.event === 'chunk');
    const done = events.filter((e) => e.event === 'done');

    // More than one chunk is what distinguishes real streaming from one
    // buffered response relabelled as a stream.
    expect(chunks.length).toBeGreaterThan(1);
    expect(done).toHaveLength(1);
    expect(done[0].data.usage).toEqual({ input_tokens: 11, output_tokens: 4 });
  });

  it('streamed text concatenates to exactly the non-streaming result', async () => {
    const token = await mintToken(['llm']);

    const streamed = parseSse(await (await app.fetch(llmRequest(token, true))).text())
      .filter((e) => e.event === 'chunk')
      .map((e) => e.data.text as string)
      .join('');

    const whole = (await (await app.fetch(llmRequest(token, false))).json()) as { text: string };

    expect(streamed).toBe(whole.text);
  });

  it('reports a mid-stream provider failure as a terminal error event', async () => {
    failMidStream = true;
    try {
      const token = await mintToken(['llm']);
      const res = await app.fetch(llmRequest(token, true));

      // Headers are already sent, so an error envelope is impossible here.
      expect(res.status).toBe(200);

      const events = parseSse(await res.text());
      const errors = events.filter((e) => e.event === 'error');

      expect(errors).toHaveLength(1);
      expect(String(errors[0].data.message ?? '')).not.toContain('stored-llm-key');
    } finally {
      failMidStream = false;
    }
  });
});
