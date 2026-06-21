import 'dotenv/config';
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
import { mcpToolsRoutes } from './routes/mcp-tools.js';
import { createSessionRoutes } from './routes/session.js';
import { createConversationRoutes } from './routes/conversation.js';
import { createCycleRoutes } from './routes/cycles.js';
import { historyRoutes } from './routes/history.js';
import { waitlistRoutes } from './routes/waitlist.js';
import { handleVoiceWebSocket, type VoiceWebSocketDependencies } from './ws/handler.js';
import { getStarterPackMetaList } from './data/starter-packs.js';

// HTTP helpers
import { applyVersioning } from './http/versioning.js';

// Providers
import { createLlmProvider, getDefaultModel } from './providers/llm/factory.js';
import type { LLMProvider, LLMProviderType } from './providers/llm/interface.js';

// MCP
import { mcpToolRegistry } from './mcp/registry.js';

// Session cleanup
import { sessionStore } from './session/store.js';
import { storageMode } from './storage/index.js';
import { optionalAuthMiddleware, isAuthEnabled } from './middleware/auth.js';

const logger = createLogger('server');
const config = getConfig();

/**
 * Get API key for the specified LLM provider
 */
function getLlmApiKey(providerType: LLMProviderType): string | undefined {
  switch (providerType) {
    case 'gemini':
      return config.providers.geminiApiKey;
    case 'openai':
      return config.providers.openaiApiKey;
    case 'anthropic':
      return config.providers.anthropicApiKey;
    case 'grok':
      return config.providers.grokApiKey;
    default:
      return undefined;
  }
}

// Initialize LLM provider using factory
const defaultLlmType = config.defaultLlmProvider;
const llmApiKey = getLlmApiKey(defaultLlmType);
const llmProvider: LLMProvider | null = llmApiKey
  ? createLlmProvider({
    provider: defaultLlmType,
    apiKey: llmApiKey,
    model: getDefaultModel(defaultLlmType),
  })
  : null;

if (!llmProvider) {
  logger.warn({ provider: defaultLlmType }, 'No API key configured for default LLM provider - LLM/conversation features will not work');
} else {
  logger.info({ provider: defaultLlmType, model: getDefaultModel(defaultLlmType) }, 'LLM provider initialized');
}

/**
 * Build the versioned API sub-app.
 *
 * This factory produces the Hono sub-app that holds all resource routes.
 * It is mounted under BOTH the canonical path (/api/v1) and the legacy path
 * (/api) via applyVersioning() below.
 *
 * The legacy mount wraps every response with Deprecation / Link headers so
 * existing clients receive a migration signal while canonical clients get
 * clean responses.
 */
function buildApiRoutes(llmProviderArg: LLMProvider | null): Hono {
  const api = new Hono();

  // Optional auth for project/session/instances routes
  api.use('/projects/*', optionalAuthMiddleware);
  api.use('/session/*', optionalAuthMiddleware);
  api.use('/instances/*', optionalAuthMiddleware);

  // Project routes
  api.route('/projects', projectRoutes);

  // Starter pack catalog
  api.get('/starter-packs', (c) => {
    return c.json(getStarterPackMetaList());
  });

  // Unity waitlist (public, no auth required)
  api.route('/waitlist', waitlistRoutes);

  // Project-scoped routes: knowledge, NPCs, MCP tools
  const projectScoped = new Hono();
  projectScoped.route('/knowledge', knowledgeRoutes);
  projectScoped.route('/npcs', npcRoutes);
  projectScoped.route('/mcp-tools', mcpToolsRoutes);
  api.route('/projects/:projectId', projectScoped);

  // Session + conversation routes (LLM-dependent)
  if (llmProviderArg) {
    const sessionRoutes = createSessionRoutes(llmProviderArg);
    api.route('/session', sessionRoutes);

    api.post('/session/:sessionId/message', async (c) => {
      const sessionId = c.req.param('sessionId');
      const conversationApp = createConversationRoutes(llmProviderArg, mcpToolRegistry);
      const url = new URL(c.req.url);
      url.pathname = `/${sessionId}/message`;
      const newRequest = new Request(url.toString(), c.req.raw);
      return conversationApp.fetch(newRequest, c.env);
    });

    api.get('/session/:sessionId/history', async (c) => {
      const sessionId = c.req.param('sessionId');
      const conversationApp = createConversationRoutes(llmProviderArg, mcpToolRegistry);
      const url = new URL(c.req.url);
      url.pathname = `/${sessionId}/history`;
      const newRequest = new Request(url.toString(), c.req.raw);
      return conversationApp.fetch(newRequest, c.env);
    });

    const cycleRoutes = createCycleRoutes(llmProviderArg);
    api.route('/instances', cycleRoutes);
  } else {
    // Return 503 for session/conversation endpoints when LLM is not configured
    api.all('/session/*', (c) => {
      return c.json({ error: { code: 'LLM_NOT_CONFIGURED', message: `LLM provider not configured. Set ${config.defaultLlmProvider.toUpperCase()}_API_KEY environment variable.` } }, 503);
    });
    api.all('/instances/*', (c) => {
      return c.json({ error: { code: 'LLM_NOT_CONFIGURED', message: `LLM provider not configured. Set ${config.defaultLlmProvider.toUpperCase()}_API_KEY environment variable.` } }, 503);
    });
  }

  // History routes (don't require LLM)
  api.route('/instances', historyRoutes);

  return api;
}

/**
 * Main application setup
 */
const app = new Hono();

// Security Headers Middleware
app.use('*', async (c, next) => {
  c.header('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss: https:; img-src 'self' data: https: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; media-src 'self' blob: data:;");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  await next();
});

// CORS middleware
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*'; // Allow non-browser clients (Unity Standalone/Mobile)
    const allowedStr = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
    const allowedOrigins = allowedStr.split(',').map(s => s.trim());

    // Check if wildcard is explicitly set by user, or if origin matches
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return origin;
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));

// Health check endpoint (not versioned — infrastructure)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    storage: storageMode,
    auth: isAuthEnabled() ? 'enabled' : 'disabled',
    sessions: sessionStore.getTotalSessionCount(),
  });
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    storage: storageMode,
    auth: isAuthEnabled() ? 'enabled' : 'disabled',
  });
});

// Public configuration endpoint (not versioned — returns non-sensitive config for frontend)
app.get('/api/config', (c) => {
  return c.json({
    auth: {
      enabled: isAuthEnabled(),
      // Only expose the public anon key (safe to expose to frontend)
      supabaseUrl: config.supabase.url || null,
      supabaseAnonKey: config.supabase.anonKey || null,
    },
    version: '2.0.0',
  });
});

if (isAuthEnabled()) {
  logger.info('Authentication enabled - hybrid storage active (logged-in→Supabase, logged-out→local)');
} else {
  logger.info('Authentication disabled - running in development mode');
}

// Build the shared API sub-app once and mount it under both paths.
const sharedApiRoutes = buildApiRoutes(llmProvider);

// Mount API routes under both /api/v1 (canonical) and /api (legacy with deprecation headers).
// /api/health and /api/config are infrastructure endpoints registered above and are
// intentionally excluded from the versioned API surface.
applyVersioning(app, '/api/v1', '/api', (v1) => {
  v1.route('/', sharedApiRoutes);
});

// Static file serving - check for file first
app.get('/*', async (c) => {
  const path = c.req.path;

  // Skip API routes
  if (path.startsWith('/api/') || path.startsWith('/ws/')) {
    return c.notFound();
  }

  try {
    // Serve template files from data/templates
    if (path.startsWith('/data/templates/')) {
      const templatePath = join(process.cwd(), path);
      if (existsSync(templatePath)) {
        const content = await readFile(templatePath);
        return new Response(content, {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return c.text('Template not found', 404);
    }

    // Try to serve static file from web directory
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

// Create WebSocket server with noServer: true (no separate port)
const wss = new WebSocketServer({ noServer: true });

logger.info({ port }, 'WebSocket server configured on same port as HTTP');

// Wire the upgrade event to handle WebSocket connections on the SAME port
server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || `localhost:${port}`}`);

    logger.info({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: {
        origin: req.headers.origin,
        host: req.headers.host,
      }
    }, 'WebSocket upgrade request received');

    // Only handle /ws/voice connections
    if (url.pathname !== '/ws/voice') {
      logger.warn({ path: url.pathname }, 'Unsupported WebSocket path, destroying socket');
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get('session_id');
    logger.info({ sessionId }, 'Voice WebSocket: checking session');

    if (!sessionId) {
      logger.warn('Voice WebSocket: missing session_id, destroying socket');
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify session exists
    const stored = sessionStore.get(sessionId);
    if (!stored) {
      logger.warn({ sessionId }, 'Voice WebSocket: session not found');
      // Complete the upgrade but close immediately with proper close code
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(1008, 'Session not found');
      });
      return;
    }

    logger.info({ sessionId }, 'Voice WebSocket: session verified');

    // Get API keys from config (synchronous)
    const deepgramKey = config.providers.deepgramApiKey;
    const cartesiaKey = config.providers.cartesiaApiKey;
    const llmProviderType = config.defaultLlmProvider;
    const llmKey = getLlmApiKey(llmProviderType);

    logger.info({
      hasDeepgram: !!deepgramKey,
      hasCartesia: !!cartesiaKey,
      hasLlm: !!llmKey,
      llmProvider: llmProviderType,
    }, 'Voice WebSocket: API key status');

    // Check required keys (Cartesia is default; ElevenLabs checked lazily in handler)
    if (!deepgramKey || !llmKey) {
      logger.error({
        sessionId,
        missingKeys: {
          deepgram: !deepgramKey,
          llm: !llmKey,
          llmProvider: llmProviderType,
        }
      }, 'Voice WebSocket: missing required API keys');
      // Complete the upgrade but close immediately with proper close code
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(1008, `Voice providers not configured. Set DEEPGRAM_API_KEY and ${llmProviderType.toUpperCase()}_API_KEY.`);
      });
      return;
    }

    // Build deps with API key config — providers created lazily in handleInitMessage
    const deps: VoiceWebSocketDependencies = {
      deepgramApiKey: deepgramKey,
      cartesiaApiKey: cartesiaKey || '',
      elevenLabsApiKey: config.providers.elevenLabsApiKey,
      llmProviderType,
      llmApiKey: llmKey,
      defaultLlmModel: getDefaultModel(llmProviderType),
    };

    // Complete the WebSocket upgrade and hand off to handler
    logger.info({ sessionId }, 'Voice WebSocket: upgrading connection');
    wss.handleUpgrade(req, socket, head, (ws) => {
      logger.info({ sessionId }, 'Voice WebSocket: handing off to handler (sync)');
      handleVoiceWebSocket(ws as unknown as WebSocket, sessionId, deps);
    });
  } catch (error) {
    logger.error({ error: String(error) }, 'Error handling WebSocket upgrade');
    socket.destroy();
  }
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
