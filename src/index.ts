import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createLogger } from './logger.js';
import { getConfig } from './config.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, statSync } from 'fs';
import { WebSocketServer } from 'ws';

// Routes
import { projectRoutes } from './routes/projects.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { npcRoutes } from './routes/npcs.js';
import { createSessionRoutes } from './routes/session.js';
import { createConversationRoutes } from './routes/conversation.js';
import { createCycleRoutes } from './routes/cycles.js';
import { historyRoutes } from './routes/history.js';
import { handleVoiceWebSocket, type VoiceWebSocketDependencies } from './ws/handler.js';

// Providers
import { GeminiLlmProvider } from './providers/llm/gemini.js';
import { DeepgramSttProvider } from './providers/stt/deepgram.js';
import { createTtsProvider } from './providers/tts/factory.js';

// MCP
import { mcpToolRegistry } from './mcp/registry.js';

// Session cleanup
import { sessionStore } from './session/store.js';

const logger = createLogger('server');
const config = getConfig();

/**
 * Main application setup
 */
const app = new Hono();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sessions: sessionStore.getTotalSessionCount(),
  });
});

// API routes
app.route('/api/projects', projectRoutes);

// Create a sub-app for project-scoped routes
const projectScoped = new Hono();

// Mount knowledge and NPC routes under project scope
projectScoped.route('/knowledge', knowledgeRoutes);
projectScoped.route('/npcs', npcRoutes);

// Mount the project-scoped routes
app.route('/api/projects/:projectId', projectScoped);

// Initialize LLM provider if API key is available
const geminiApiKey = config.providers.geminiApiKey;
const llmProvider = geminiApiKey ? new GeminiLlmProvider({ apiKey: geminiApiKey }) : null;

if (!llmProvider) {
  logger.warn('No GEMINI_API_KEY configured - LLM/conversation features will not work');
}

// Session routes - only fully functional with LLM provider
if (llmProvider) {
  const sessionRoutes = createSessionRoutes(llmProvider);
  app.route('/api/session', sessionRoutes);

  // Mount conversation routes under session
  app.post('/api/session/:sessionId/message', async (c) => {
    const sessionId = c.req.param('sessionId');
    const conversationApp = createConversationRoutes(llmProvider, mcpToolRegistry);
    const url = new URL(c.req.url);
    url.pathname = `/${sessionId}/message`;
    const newRequest = new Request(url.toString(), c.req.raw);
    return conversationApp.fetch(newRequest, c.env);
  });

  app.get('/api/session/:sessionId/history', async (c) => {
    const sessionId = c.req.param('sessionId');
    const conversationApp = createConversationRoutes(llmProvider, mcpToolRegistry);
    const url = new URL(c.req.url);
    url.pathname = `/${sessionId}/history`;
    const newRequest = new Request(url.toString(), c.req.raw);
    return conversationApp.fetch(newRequest, c.env);
  });

  // Cycle routes for instances
  const cycleRoutes = createCycleRoutes(llmProvider);
  app.route('/api/instances', cycleRoutes);
} else {
  // Return 503 for session/conversation endpoints when LLM is not configured
  app.all('/api/session/*', (c) => {
    return c.json({ error: 'LLM provider not configured. Set GEMINI_API_KEY environment variable.' }, 503);
  });
  app.all('/api/instances/*', (c) => {
    return c.json({ error: 'LLM provider not configured. Set GEMINI_API_KEY environment variable.' }, 503);
  });
}

// History routes (don't require LLM)
app.route('/api/instances', historyRoutes);

// Static file serving - check for file first
app.get('/*', async (c) => {
  const path = c.req.path;

  // Skip API routes
  if (path.startsWith('/api/') || path.startsWith('/ws/')) {
    return c.notFound();
  }

  try {
    // Try to serve static file
    const webDir = join(process.cwd(), 'web');
    const filePath = join(webDir, path);

    // Check if file exists and is a file (not directory)
    if (existsSync(filePath)) {
      try {
        const stats = statSync(filePath);
        if (stats.isFile()) {
          const content = await readFile(filePath);
          const ext = path.split('.').pop() || '';
          const contentTypes: Record<string, string> = {
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            json: 'application/json',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            svg: 'image/svg+xml',
            ico: 'image/x-icon',
            woff: 'font/woff',
            woff2: 'font/woff2',
            ttf: 'font/ttf',
          };

          return new Response(content, {
            headers: {
              'Content-Type': contentTypes[ext] || 'application/octet-stream',
            },
          });
        }
      } catch {
        // Not a file, continue to fallback
      }
    }

    // Fallback to index.html for SPA routing
    const indexPath = join(webDir, 'index.html');
    if (existsSync(indexPath)) {
      const content = await readFile(indexPath);
      return new Response(content, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return c.text('Not found', 404);
  } catch (error) {
    logger.error({ error: String(error), path }, 'Error serving static file');
    return c.text('Not found', 404);
  }
});

/**
 * Start server with WebSocket support
 */
const port = config.port || 3000;

logger.info({ port }, 'Starting Evolve.NPC server');

// Start the Hono server with Node.js adapter
const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  logger.info({ port: info.port, dataDir: config.dataDir }, 'Evolve.NPC HTTP server started');
});

// Create WebSocket server on a separate port (or use the same server with ws upgrade)
const wss = new WebSocketServer({ port: port + 1 });

logger.info({ wsPort: port + 1 }, 'WebSocket server started');

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://localhost:${port + 1}`);

  // Only handle /ws/voice connections
  if (url.pathname !== '/ws/voice') {
    ws.close(1003, 'Unsupported path');
    return;
  }

  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    ws.close(1008, 'session_id query parameter required');
    return;
  }

  // Verify session exists
  const stored = sessionStore.get(sessionId);
  if (!stored) {
    ws.close(1008, 'Session not found');
    return;
  }

  logger.info({ sessionId }, 'Voice WebSocket connected');

  // Get API keys from config
  const deepgramKey = config.providers.deepgramApiKey;
  const cartesiaKey = config.providers.cartesiaApiKey;
  const geminiKey = config.providers.geminiApiKey;

  // Check if all required keys are available
  if (!deepgramKey || !cartesiaKey || !geminiKey) {
    logger.warn({ sessionId }, 'Voice WebSocket closed - missing API keys');
    ws.close(1008, 'Voice providers not configured. Set DEEPGRAM_API_KEY, CARTESIA_API_KEY, and GEMINI_API_KEY.');
    return;
  }

  // Create providers with configured API keys
  const deps: VoiceWebSocketDependencies = {
    sttProvider: new DeepgramSttProvider({ apiKey: deepgramKey }),
    ttsProvider: createTtsProvider({ provider: 'cartesia', apiKey: cartesiaKey }),
    llmProvider: new GeminiLlmProvider({ apiKey: geminiKey }),
  };

  // Handle the voice WebSocket connection
  handleVoiceWebSocket(ws as unknown as WebSocket, sessionId, deps);
});

wss.on('error', (error) => {
  logger.error({ error: String(error) }, 'WebSocket server error');
});

// Session timeout cleanup interval
const cleanupInterval = setInterval(() => {
  const timedOut = sessionStore.findTimedOutSessions(config.sessionTimeoutMs);
  for (const sessionId of timedOut) {
    logger.info({ sessionId }, 'Session timed out, removing');
    sessionStore.delete(sessionId);
  }
}, 60000); // Check every minute

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down server');
  clearInterval(cleanupInterval);
  wss.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down server');
  clearInterval(cleanupInterval);
  wss.close();
  server.close();
  process.exit(0);
});

export default app;
