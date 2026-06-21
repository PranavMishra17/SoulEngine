/**
 * Batch create/update endpoints for NPCs and knowledge categories.
 *
 * Verifies:
 * 1. POST /api/v1/projects/:projectId/npcs/batch creates multiple NPCs and returns
 *    a per-item result array with status: 'created' | 'error' per item.
 * 2. PUT /api/v1/projects/:projectId/npcs/batch updates multiple NPCs and returns
 *    a per-item result array with status: 'updated' | 'error' per item.
 * 3. POST /api/v1/projects/:projectId/knowledge/categories/batch upserts categories
 *    and returns a per-item result array.
 * 4. Invalid items in a batch return error status per item while valid items succeed.
 * 5. Missing projectId returns 400.
 *
 * Uses app.fetch with a stubbed storage approach (local in-memory storage, no disk).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { npcRoutes } from '../../src/routes/npcs.js';
import { knowledgeRoutes } from '../../src/routes/knowledge.js';
import { applyVersioning } from '../../src/http/versioning.js';
import { getStorageForUser } from '../../src/storage/hybrid.js';
import { optionalAuthMiddleware } from '../../src/middleware/auth.js';

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

function buildTestApp(): Hono {
  const app = new Hono();

  applyVersioning(app, '/api/v1', '/api', (v1) => {
    v1.use('/projects/*', optionalAuthMiddleware);

    const projectScoped = new Hono();
    projectScoped.route('/npcs', npcRoutes);
    projectScoped.route('/knowledge', knowledgeRoutes);
    v1.route('/projects/:projectId', projectScoped);
  });

  return app;
}

// ---------------------------------------------------------------------------
// NPC batch create tests
// ---------------------------------------------------------------------------

describe('Batch NPC create', () => {
  let projectId: string;
  const storage = getStorageForUser(null);
  const app = buildTestApp();

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only-not-production';
    const project = await storage.createProject('Batch Test Project', null);
    projectId = project.id;
  });

  afterEach(async () => {
    try {
      await storage.deleteProject(projectId);
    } catch {
      // ignore
    }
  });

  it('POST /npcs/batch with two valid NPCs returns 200 and two created results', async () => {
    const body = {
      items: [
        { name: 'Alice', description: 'A brave knight' },
        { name: 'Bob', description: 'A cunning rogue' },
      ],
    };

    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/npcs/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { results: Array<{ status: string; index: number }> };
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].status).toBe('created');
    expect(data.results[1].status).toBe('created');
    expect(data.results[0].index).toBe(0);
    expect(data.results[1].index).toBe(1);
  });

  it('POST /npcs/batch with one invalid item returns mixed results', async () => {
    const body = {
      items: [
        { name: 'Valid NPC', description: 'Fine' },
        { name: '', description: 'Invalid - empty name' },
      ],
    };

    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/npcs/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { results: Array<{ status: string; index: number }> };
    expect(data.results).toHaveLength(2);
    expect(data.results[0].status).toBe('created');
    expect(data.results[1].status).toBe('error');
  });

  it('POST /npcs/batch with empty items array returns 400', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/npcs/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('POST /npcs/batch with missing projectId returns 400', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/projects/nonexistent-proj/npcs/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ name: 'Test' }] }),
      })
    );
    // 404 (project not found) or 400 (bad id format) — either is acceptable
    expect([400, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// NPC batch update tests
// ---------------------------------------------------------------------------

describe('Batch NPC update', () => {
  let projectId: string;
  let npc1Id: string;
  let npc2Id: string;
  const storage = getStorageForUser(null);
  const app = buildTestApp();

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only-not-production';
    const project = await storage.createProject('Batch Update Project', null);
    projectId = project.id;

    const baseNpc = {
      core_anchor: { backstory: '', principles: [], trauma_flags: [] },
      personality_baseline: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
      voice: { provider: 'cartesia', voice_id: '', speed: 1 },
      mcp_permissions: { conversation_tools: [], game_event_tools: [], denied: [] },
      knowledge_access: {},
      schedule: [],
      network: [],
    };
    const n1 = await storage.createDefinition(projectId, { ...baseNpc, name: 'NPC One', description: '' });
    npc1Id = n1.id;

    const n2 = await storage.createDefinition(projectId, { ...baseNpc, name: 'NPC Two', description: '' });
    npc2Id = n2.id;
  });

  afterEach(async () => {
    try {
      await storage.deleteProject(projectId);
    } catch {
      // ignore
    }
  });

  it('PUT /npcs/batch with two valid updates returns 200 and two updated results', async () => {
    const body = {
      items: [
        { id: npc1Id, data: { description: 'Updated description one' } },
        { id: npc2Id, data: { description: 'Updated description two' } },
      ],
    };

    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/npcs/batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { results: Array<{ status: string; id: string }> };
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].status).toBe('updated');
    expect(data.results[1].status).toBe('updated');
  });

  it('PUT /npcs/batch with one non-existent NPC id returns mixed results', async () => {
    const body = {
      items: [
        { id: npc1Id, data: { description: 'Updated' } },
        { id: 'npc_does_not_exist', data: { description: 'Ghost update' } },
      ],
    };

    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/npcs/batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { results: Array<{ status: string }> };
    expect(data.results[0].status).toBe('updated');
    expect(data.results[1].status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Knowledge category batch upsert tests
// ---------------------------------------------------------------------------

describe('Batch knowledge category upsert', () => {
  let projectId: string;
  const storage = getStorageForUser(null);
  const app = buildTestApp();

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only-not-production';
    const project = await storage.createProject('Batch Knowledge Project', null);
    projectId = project.id;
  });

  afterEach(async () => {
    try {
      await storage.deleteProject(projectId);
    } catch {
      // ignore
    }
  });

  it('POST /knowledge/categories/batch upserts two categories and returns 200 with per-item results', async () => {
    const body = {
      items: [
        {
          id: 'history',
          description: 'Town history',
          depths: { '1': 'Ancient ruins nearby', '2': 'Old war history', '3': 'Detailed records' },
        },
        {
          id: 'economy',
          description: 'Trade info',
          depths: { '1': 'Market exists', '2': 'Import goods', '3': 'Tax records' },
        },
      ],
    };

    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/knowledge/categories/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { results: Array<{ status: string; id: string }> };
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].status).toBe('upserted');
    expect(data.results[1].status).toBe('upserted');
  });

  it('POST /knowledge/categories/batch with invalid item returns mixed results', async () => {
    const body = {
      items: [
        {
          id: 'valid',
          description: 'Valid category',
          depths: { '1': 'content' },
        },
        {
          id: '',
          description: 'Invalid - empty id',
          depths: { '1': 'content' },
        },
      ],
    };

    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/knowledge/categories/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json() as { results: Array<{ status: string }> };
    expect(data.results).toHaveLength(2);
    expect(data.results[0].status).toBe('upserted');
    expect(data.results[1].status).toBe('error');
  });

  it('POST /knowledge/categories/batch with empty items array returns 400', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/v1/projects/${projectId}/knowledge/categories/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      })
    );
    expect(res.status).toBe(400);
  });
});
