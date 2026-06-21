/**
 * Event channel: server-to-client event envelope
 *
 * Verifies:
 * 1. buildGameEvent produces well-formed events for all defined event types
 * 2. The event envelope has required fields: type, ts (ISO timestamp), payload
 * 3. The SSE endpoint is reachable under /api/v1/events and returns text/event-stream
 * 4. The SSE endpoint returns 400 when session_id is missing
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { buildGameEvent, GameEventType } from '../../src/http/events.js';
import { createEventsRoute } from '../../src/routes/events.js';
import { applyVersioning } from '../../src/http/versioning.js';

// ---------------------------------------------------------------------------
// Envelope builder tests (pure, no network)
// ---------------------------------------------------------------------------

describe('Game event envelope builder', () => {
  it('buildGameEvent: tool_call produces well-formed event', () => {
    const evt = buildGameEvent('tool_call', { name: 'lock_door', args: { door_id: 'd1' } });

    expect(evt.type).toBe('tool_call');
    expect(typeof evt.ts).toBe('string');
    expect(() => new Date(evt.ts)).not.toThrow();
    expect(new Date(evt.ts).toISOString()).toBe(evt.ts);
    expect(evt.payload).toMatchObject({ name: 'lock_door', args: { door_id: 'd1' } });
  });

  it('buildGameEvent: npc_follow_up produces well-formed event', () => {
    const evt = buildGameEvent('npc_follow_up', { text: 'I just locked the door.' });

    expect(evt.type).toBe('npc_follow_up');
    expect(typeof evt.ts).toBe('string');
    expect(evt.payload).toMatchObject({ text: 'I just locked the door.' });
  });

  it('buildGameEvent: mind_activity produces well-formed event', () => {
    const evt = buildGameEvent('mind_activity', {
      tools_called: [{ name: 'recall_knowledge', args: {}, status: 'success' as const }],
      duration_ms: 420,
      completed: true,
    });

    expect(evt.type).toBe('mind_activity');
    expect(evt.payload.tools_called).toHaveLength(1);
    expect(evt.payload.duration_ms).toBe(420);
    expect(evt.payload.completed).toBe(true);
  });

  it('buildGameEvent: mood_change produces well-formed event', () => {
    const evt = buildGameEvent('mood_change', {
      valence: 0.8,
      arousal: 0.5,
      dominance: 0.6,
    });

    expect(evt.type).toBe('mood_change');
    expect(evt.payload.valence).toBe(0.8);
  });

  it('buildGameEvent: ts is always a valid ISO-8601 string', () => {
    const evt = buildGameEvent('tool_call', { name: 'test', args: {} });
    const parsed = new Date(evt.ts);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it('GameEventType enum contains all four required event types', () => {
    expect(GameEventType).toHaveProperty('TOOL_CALL', 'tool_call');
    expect(GameEventType).toHaveProperty('NPC_FOLLOW_UP', 'npc_follow_up');
    expect(GameEventType).toHaveProperty('MIND_ACTIVITY', 'mind_activity');
    expect(GameEventType).toHaveProperty('MOOD_CHANGE', 'mood_change');
  });
});

// ---------------------------------------------------------------------------
// SSE route tests (HTTP, no live session)
// ---------------------------------------------------------------------------

describe('SSE events endpoint', () => {
  function buildTestApp(): Hono {
    const app = new Hono();
    const eventsRoute = createEventsRoute();

    applyVersioning(app, '/api/v1', '/api', (v1) => {
      v1.route('/events', eventsRoute);
    });

    return app;
  }

  const app = buildTestApp();

  it('GET /api/v1/events?session_id=x returns 200 with text/event-stream content type', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/events?session_id=sess_test_evt_001')
    );
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/text\/event-stream/);
  });

  it('GET /api/v1/events without session_id returns 400', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/events')
    );
    expect(res.status).toBe(400);
  });

  it('SSE response includes cache-control: no-cache', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/events?session_id=sess_test_evt_002')
    );
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/no-cache/);
  });
});
