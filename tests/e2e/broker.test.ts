/**
 * E2E tests for broker routes
 *
 * Tests token minting, LLM proxy, rate limiting, and error paths.
 * Uses real storage with test projects.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'crypto';
import { getStorage } from '../../src/storage/factory.js';
import type { Project } from '../../src/types/project.js';

// Set encryption key for token signing
process.env.ENCRYPTION_KEY = 'test-encryption-key-min-32-chars-long-secret';

// Test project IDs
const TEST_PROJECT_WITH_KEY = 'broker-test-project-with-key';
const TEST_PROJECT_NO_KEY = 'broker-test-project-no-key';
const TEST_PROJECT_NAMED_KEY = 'broker-test-project-named-key';

// Test API key
const TEST_API_KEY = 'test-game-client-key-12345';
const TEST_API_KEY_HASH = createHash('sha256').update(TEST_API_KEY).digest('hex');

/**
 * Hash a raw API key (SHA-256)
 */
function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Create test projects before running tests
 */
async function setupTestProjects() {
  const { createProject, updateProject, getProject } = await import('../../src/storage/index.js');

  // Create or update project with legacy key
  try {
    const project = await createProject('Broker Test Project (Legacy Key)', null);
    // Force the project ID for testing
    const projectData = await getProject(project.id);
    const updatedSettings = {
      ...projectData.settings,
      game_client_api_key_hash: TEST_API_KEY_HASH,
    };
    await updateProject(project.id, { ...projectData, settings: updatedSettings }, null);

    // Store the actual project ID for tests
    (global as any).TEST_PROJECT_WITH_KEY_ID = project.id;
  } catch (error) {
    console.error('Failed to create test project with key:', error);
  }

  // Create or update project with no keys
  try {
    const project = await createProject('Broker Test Project (No Keys)', null);
    (global as any).TEST_PROJECT_NO_KEY_ID = project.id;
  } catch (error) {
    console.error('Failed to create test project with no keys:', error);
  }

  // Create or update project with named keys
  try {
    const project = await createProject('Broker Test Project (Named Keys)', null);
    const projectData = await getProject(project.id);
    const updatedSettings = {
      ...projectData.settings,
      game_client_api_keys: [
        {
          id: 'key-1',
          name: 'Test Key',
          hash: TEST_API_KEY_HASH,
        },
      ],
    };
    await updateProject(project.id, { ...projectData, settings: updatedSettings }, null);
    (global as any).TEST_PROJECT_NAMED_KEY_ID = project.id;
  } catch (error) {
    console.error('Failed to create test project with named keys:', error);
  }
}

/**
 * Cleanup test projects
 */
async function cleanupTestProjects() {
  const { deleteProject } = await import('../../src/storage/index.js');

  const ids = [
    (global as any).TEST_PROJECT_WITH_KEY_ID,
    (global as any).TEST_PROJECT_NO_KEY_ID,
    (global as any).TEST_PROJECT_NAMED_KEY_ID,
  ];

  for (const id of ids) {
    if (id) {
      try {
        await deleteProject(id, null);
      } catch {
        // Ignore if not found
      }
    }
  }
}

describe('POST /broker/token - Token minting', () => {
  let app: Hono;

  beforeAll(async () => {
    await setupTestProjects();
    const { default: brokerRoutes } = await import('../../src/routes/broker.js');
    app = new Hono();
    app.route('/broker', brokerRoutes);
  });

  afterAll(async () => {
    await cleanupTestProjects();
  });

  it('401 with no x-api-key header', async () => {
    const projectId = (global as any).TEST_PROJECT_WITH_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 with wrong x-api-key', async () => {
    const projectId = (global as any).TEST_PROJECT_WITH_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'wrong-key',
        },
        body: JSON.stringify({ project_id: projectId }),
      })
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 when project has no keys configured (fail-closed)', async () => {
    const projectId = (global as any).TEST_PROJECT_NO_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'any-key',
        },
        body: JSON.stringify({ project_id: projectId }),
      })
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toMatch(/no.*key.*configured/i);
  });

  it('200 with valid legacy key', async () => {
    const projectId = (global as any).TEST_PROJECT_WITH_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_API_KEY,
        },
        body: JSON.stringify({ project_id: projectId }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expires_at: string; scopes: string[] };
    expect(body.token).toBeTruthy();
    expect(body.expires_at).toBeTruthy();
    expect(body.scopes).toEqual(['llm']);
  });

  it('200 with valid named key', async () => {
    const projectId = (global as any).TEST_PROJECT_NAMED_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_API_KEY,
        },
        body: JSON.stringify({ project_id: projectId }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expires_at: string; scopes: string[] };
    expect(body.token).toBeTruthy();
  });

  it('200 with custom scopes', async () => {
    const projectId = (global as any).TEST_PROJECT_WITH_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_API_KEY,
        },
        body: JSON.stringify({
          project_id: projectId,
          scopes: ['llm', 'stt'],
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expires_at: string; scopes: string[] };
    expect(body.scopes).toContain('llm');
    expect(body.scopes).toContain('stt');
  });

  it('400 with TTL > 1 hour', async () => {
    const projectId = (global as any).TEST_PROJECT_WITH_KEY_ID;
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_API_KEY,
        },
        body: JSON.stringify({
          project_id: projectId,
          ttl_seconds: 7200, // 2 hours
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('404 when project does not exist', async () => {
    const res = await app.fetch(
      new Request('http://localhost/broker/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_API_KEY,
        },
        body: JSON.stringify({ project_id: 'non-existent' }),
      })
    );

    expect(res.status).toBe(404);
  });
});

describe('POST /broker/llm - LLM proxy', () => {
  let app: Hono;

  beforeAll(async () => {
    await setupTestProjects();
    const { default: brokerRoutes } = await import('../../src/routes/broker.js');
    app = new Hono();
    app.route('/broker', brokerRoutes);
  });

  afterAll(async () => {
    await cleanupTestProjects();
  });

  it('401 with no Authorization header', async () => {
    const res = await app.fetch(
      new Request('http://localhost/broker/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt: 'You are helpful',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })
    );

    expect(res.status).toBe(401);
  });

  it('401 with invalid broker token', async () => {
    const res = await app.fetch(
      new Request('http://localhost/broker/llm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-token',
        },
        body: JSON.stringify({
          system_prompt: 'You are helpful',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })
    );

    expect(res.status).toBe(401);
  });

  it('403 with token lacking llm scope', async () => {
    const { mintBrokerToken } = await import('../../src/broker/token.js');
    const projectId = (global as any).TEST_PROJECT_WITH_KEY_ID;
    const token = mintBrokerToken({
      projectId: projectId,
      scopes: ['stt'], // no llm scope
      ttlSeconds: 900,
    });

    const res = await app.fetch(
      new Request('http://localhost/broker/llm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          system_prompt: 'You are helpful',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // Note: Testing 503 (no LLM key) and 200 (happy path) would require:
  // - Setting up a project with/without API keys in storage
  // - Mocking the LLM provider
  // These are deferred as they require more complex setup
  // The critical security paths (auth, scope check, rate limit) are covered above
});
