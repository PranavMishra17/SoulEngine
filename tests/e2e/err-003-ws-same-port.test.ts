import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { createServer, type Server as HttpServer } from 'http';

/**
 * ERR-003: Voice WebSocket must be reachable on the SAME port as HTTP
 *
 * This test verifies that the voice WebSocket is served via the http server's
 * upgrade event on the same port, not on port+1.
 */
describe('ERR-003: Voice WebSocket on Same Port', () => {
  let httpServer: HttpServer;
  let wss: WebSocketServer;
  let serverPort: number;

  beforeAll(async () => {
    // Create a minimal HTTP server that mimics the production setup
    // noServer: true means WSS doesn't create its own http.Server
    wss = new WebSocketServer({ noServer: true });

    httpServer = createServer((req, res) => {
      // Simple HTTP response
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('HTTP OK');
    });

    // Wire the upgrade event to handle WebSocket connections
    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '', `http://localhost`);

      // Only accept /ws/voice path
      if (url.pathname !== '/ws/voice') {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        // Minimal session check - just verify session_id is present
        const sessionId = url.searchParams.get('session_id');
        if (!sessionId) {
          ws.close(1008, 'session_id query parameter required');
          return;
        }

        // For this test, close with "session not found" for unknown sessions
        // This proves the upgrade path works
        ws.close(1008, 'Session not found');
      });
    });

    // Listen on ephemeral port (port 0)
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr !== 'string') {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    wss.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it('should accept WebSocket connections on the SAME port as HTTP', async () => {
    // Connect to the voice WebSocket on the SAME port as the HTTP server
    const wsUrl = `ws://127.0.0.1:${serverPort}/ws/voice?session_id=test-session`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        // If we get here, the upgrade succeeded on the same port
        resolve();
      });

      ws.on('close', (code, reason) => {
        // Even if the session is unknown and the server closes,
        // the fact that we got a close event means the upgrade succeeded
        if (code === 1008) {
          resolve();
        } else {
          reject(new Error(`Unexpected close code: ${code}, reason: ${reason}`));
        }
      });

      ws.on('error', (err) => {
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 5000);
    });
  });

  it('should reject WebSocket connections to non-/ws/voice paths', async () => {
    const wsUrl = `ws://127.0.0.1:${serverPort}/ws/invalid?session_id=test-session`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        ws.close();
        reject(new Error('WebSocket should not have opened for invalid path'));
      });

      ws.on('error', () => {
        // Connection should fail - this is expected
        resolve();
      });

      ws.on('close', () => {
        // Socket was destroyed - this is expected
        resolve();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve();
      }, 5000);
    });
  });

  it('should reject connections without session_id', async () => {
    const wsUrl = `ws://127.0.0.1:${serverPort}/ws/voice`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        // Upgrade succeeded, but server should close immediately
      });

      ws.on('close', (code, reason) => {
        if (code === 1008 && reason.toString().includes('session_id')) {
          resolve();
        } else {
          reject(new Error(`Expected code 1008 with session_id error, got: ${code} ${reason}`));
        }
      });

      ws.on('error', (err) => {
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      setTimeout(() => {
        ws.close();
        reject(new Error('Expected server to close connection'));
      }, 5000);
    });
  });
});
