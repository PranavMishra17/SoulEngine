/**
 * SSE event stream endpoint for text/HTTP clients.
 *
 * GET /events?session_id=<id>
 *
 * Streams server-to-client game events in the standard SSE format for a given
 * session. The event envelope is the same shape used over the voice WebSocket
 * (see src/http/events.ts).
 *
 * Clients receive a keep-alive comment every 15 seconds. The stream remains
 * open until the client disconnects or the session ends.
 *
 * In-process event delivery is managed via EventEmitter stored in the session
 * event bus (src/session/event-bus.ts). If the session does not exist, we
 * still open a stream — the client may connect before the session is created
 * (race-free). Events will start arriving once the session is active.
 */

import { Hono } from 'hono';
import { createLogger } from '../logger.js';

const logger = createLogger('routes-events');

const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * Create the events SSE route handler.
 *
 * Returns a Hono sub-app mounted at /events in the caller's router.
 */
export function createEventsRoute(): Hono {
  const routes = new Hono();

  /**
   * GET /events?session_id=<id>
   *
   * Opens a Server-Sent Events stream for the given session.
   * Returns 400 if session_id is missing.
   */
  routes.get('/', (c) => {
    const sessionId = c.req.query('session_id');

    if (!sessionId) {
      return c.json({ error: 'session_id query parameter is required' }, 400);
    }

    logger.info({ sessionId }, 'SSE event stream opened');

    // Build a TransformStream for SSE — passes Uint8Array chunks through unchanged
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Track whether the stream is still live
    let closed = false;

    function write(data: string): void {
      if (closed) return;
      writer.write(encoder.encode(data)).catch(() => {
        closed = true;
      });
    }

    // Emit an SSE comment (keep-alive ping)
    function sendKeepAlive(): void {
      write(': ping\n\n');
    }

    // Emit a named event in SSE wire format
    function sendEvent(eventName: string, data: object): void {
      const json = JSON.stringify(data);
      write(`event: ${eventName}\ndata: ${json}\n\n`);
    }

    // Start keep-alive timer
    const keepAliveTimer = setInterval(sendKeepAlive, KEEPALIVE_INTERVAL_MS);

    // Try to attach to the session event bus if available.
    // This import is done dynamically so the route file does not create a
    // circular dependency with the session module at module load time.
    let unsubscribe: (() => void) | null = null;
    import('../session/event-bus.js').then(({ sessionEventBus }) => {
      if (closed) return;

      unsubscribe = sessionEventBus.subscribe(sessionId, (event) => {
        sendEvent(event.type, event);
      });
    }).catch((err) => {
      // event-bus is optional — log and continue without it
      logger.debug({ sessionId, error: String(err) }, 'SSE: session event bus not available');
    });

    // Clean up on client disconnect
    c.req.raw.signal?.addEventListener('abort', () => {
      if (!closed) {
        closed = true;
        clearInterval(keepAliveTimer);
        if (unsubscribe) unsubscribe();
        writer.close().catch(() => {/* ignore */});
        logger.info({ sessionId }, 'SSE event stream closed by client');
      }
    });

    return new Response(readable as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  return routes;
}

// Export sendEvent as a utility type for callers that wish to manually push
// events (e.g. integration tests using a local emitter).
export type { GameEvent, GameEventTypeLiteral } from '../http/events.js';
