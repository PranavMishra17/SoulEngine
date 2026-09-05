/**
 * Broker routes for token vending and request proxying
 *
 * Endpoints:
 * - POST /token - Mint a broker token
 * - POST /llm - Proxy LLM request
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { mintBrokerToken } from '../broker/token.js';
import { requireBrokerToken, type BrokerTokenContext } from '../broker/middleware.js';
import { errorResponse, ApiErrorCode } from '../http/envelope.js';
import { getStorage } from '../storage/factory.js';
import { verifyGameClientKey } from '../session/manager.js';
import { createLlmProvider } from '../providers/llm/factory.js';
import type { LLMMessage } from '../providers/llm/interface.js';
import type { Tool } from '../types/mcp.js';
import { rateLimiter } from '../security/rate-limiter.js';
import { createLogger } from '../logger.js';

const logger = createLogger('broker-routes');

const brokerApp = new Hono();

// Request schemas
const MintTokenSchema = z.object({
  project_id: z.string().min(1),
  scopes: z.array(z.string()).optional().default(['llm']),
  ttl_seconds: z.number().int().positive().max(3600).optional(),
});

const LLMProxySchema = z.object({
  system_prompt: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'model']),
      content: z.string(),
    })
  ),
  tools: z.array(z.any()).optional(),
  stream: z.boolean().optional().default(false),
});

/**
 * POST /token - Mint a broker token
 *
 * Authenticates with x-api-key header and returns a signed broker token.
 */
brokerApp.post('/token', async (c) => {
  try {
    const bodyRaw = await c.req.json();
    const parsed = MintTokenSchema.safeParse(bodyRaw);

    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, 'Invalid mint token request');
      return errorResponse(c, 400, ApiErrorCode.VALIDATION_FAILED, 'Invalid request', parsed.error.issues);
    }

    const { project_id, scopes, ttl_seconds } = parsed.data;

    // Load project
    const storage = getStorage(null);
    let project;
    try {
      project = await storage.getProject(project_id);
    } catch (error) {
      logger.warn({ projectId: project_id, error: error instanceof Error ? error.message : 'Unknown' }, 'Project not found');
      return errorResponse(c, 404, ApiErrorCode.NOT_FOUND, 'Project not found');
    }

    // Authenticate with game client API key
    const clientApiKey = c.req.header('x-api-key');
    const settings = project.settings;

    // Check whether any key is configured (legacy single-hash or named-keys array)
    const hasLegacyKey = !!settings?.game_client_api_key_hash;
    const hasNamedKeys = !!(settings?.game_client_api_keys?.length);

    // FAIL CLOSED: if no keys configured, reject
    if (!hasLegacyKey && !hasNamedKeys) {
      logger.warn({ projectId: project_id }, 'Project has no game client API keys configured (fail-closed)');
      return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'Project has no game client API keys configured');
    }

    if (!clientApiKey) {
      logger.warn({ projectId: project_id }, 'Missing x-api-key header');
      return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'x-api-key header required');
    }

    let keyAccepted = false;

    // Check legacy single-key hash
    if (hasLegacyKey) {
      keyAccepted = verifyGameClientKey(clientApiKey, settings!.game_client_api_key_hash!);
    }

    // Check named keys array (supports multiple revocable keys)
    if (!keyAccepted && hasNamedKeys) {
      for (const entry of settings!.game_client_api_keys!) {
        if (verifyGameClientKey(clientApiKey, entry.hash)) {
          keyAccepted = true;
          break;
        }
      }
    }

    if (!keyAccepted) {
      logger.warn({ projectId: project_id }, 'Invalid x-api-key');
      return errorResponse(c, 401, ApiErrorCode.UNAUTHORIZED, 'Invalid x-api-key');
    }

    // Mint broker token
    const token = mintBrokerToken({
      projectId: project_id,
      scopes,
      ttlSeconds: ttl_seconds,
    });

    // Decode token to get expiry for response
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
    const expiresAt = new Date(payload.exp * 1000).toISOString();

    logger.info({ projectId: project_id, scopes, jti: payload.jti }, 'Broker token minted');

    return c.json({
      token,
      expires_at: expiresAt,
      scopes,
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown' }, 'Failed to mint broker token');
    return errorResponse(c, 500, ApiErrorCode.INTERNAL, 'Internal server error');
  }
});

/**
 * POST /llm - Proxy LLM request
 *
 * Requires a valid broker token with 'llm' scope.
 * Loads project LLM key server-side and calls the provider.
 */
brokerApp.post('/llm', requireBrokerToken(['llm']), async (c) => {
  try {
    const bodyRaw = await c.req.json();
    const parsed = LLMProxySchema.safeParse(bodyRaw);

    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, 'Invalid LLM proxy request');
      return errorResponse(c, 400, ApiErrorCode.VALIDATION_FAILED, 'Invalid request', parsed.error.issues);
    }

    const { system_prompt, messages, tools, stream } = parsed.data;

    // Get broker token context from middleware
    const tokenContext = c.get('brokerToken') as BrokerTokenContext;
    const { tokenId, projectId } = tokenContext;

    // Rate limiting keyed on token ID (not IP, not player)
    const rateLimitResult = rateLimiter.checkLimit(
      projectId,
      tokenId, // player_id slot (unused)
      'broker-llm', // npc_id slot (unused)
      tokenId // principal (the token ID itself)
    );

    if (!rateLimitResult.allowed) {
      logger.warn({ tokenId, projectId }, 'Rate limit exceeded for broker token');
      return errorResponse(c, 429, ApiErrorCode.RATE_LIMITED, 'Rate limit exceeded', {
        resetAt: new Date(rateLimitResult.resetAt).toISOString(),
      });
    }

    // Load project and API keys
    const storage = getStorage(null);
    let project, apiKeys;
    try {
      [project, apiKeys] = await Promise.all([
        storage.getProject(projectId),
        storage.loadApiKeys(projectId),
      ]);
    } catch (error) {
      logger.error(
        { projectId, error: error instanceof Error ? error.message : 'Unknown' },
        'Failed to load project or API keys'
      );
      return errorResponse(c, 404, ApiErrorCode.NOT_FOUND, 'Project not found');
    }

    // Check if project has LLM key configured
    const llmProvider = project.settings.llm_provider;
    const llmKey = apiKeys[llmProvider as keyof typeof apiKeys];

    if (!llmKey) {
      logger.warn({ projectId, llmProvider }, 'Project has no LLM API key configured');
      return errorResponse(c, 503, ApiErrorCode.LLM_NOT_CONFIGURED, 'Project has no LLM API key configured');
    }

    // Create LLM provider
    let provider;
    try {
      provider = createLlmProvider({
        provider: llmProvider as 'gemini' | 'openai' | 'anthropic' | 'grok',
        apiKey: llmKey,
        model: project.settings.llm_model,
      });
    } catch (error) {
      logger.error(
        { projectId, llmProvider, error: error instanceof Error ? error.message : 'Unknown' },
        'Failed to create LLM provider'
      );
      return errorResponse(c, 500, ApiErrorCode.INTERNAL, 'Failed to create LLM provider');
    }

    // Streaming deferred to future item
    if (stream) {
      return errorResponse(c, 400, ApiErrorCode.VALIDATION_FAILED, 'Streaming not yet supported');
    }

    // Call LLM provider (proxy)
    try {
      const llmMessages: LLMMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Collect the full response from the stream
      let fullText = '';
      let finalToolCalls: Array<{ name: string; arguments: Record<string, unknown>; id?: string }> = [];
      let finalUsage: { input_tokens: number; output_tokens: number } | undefined;

      for await (const chunk of provider.streamChat({
        systemPrompt: system_prompt,
        messages: llmMessages,
        tools: tools as Tool[] | undefined,
      })) {
        fullText += chunk.text;

        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          finalToolCalls = chunk.toolCalls;
        }

        if (chunk.done && chunk.usage) {
          finalUsage = chunk.usage;
        }

        if (chunk.done) {
          break;
        }
      }

      logger.info(
        {
          projectId,
          tokenId,
          inputTokens: finalUsage?.input_tokens,
          outputTokens: finalUsage?.output_tokens,
        },
        'LLM proxy request completed'
      );

      return c.json({
        text: fullText,
        tool_calls: finalToolCalls,
        usage: finalUsage,
      });
    } catch (error) {
      logger.error(
        { projectId, tokenId, error: error instanceof Error ? error.message : 'Unknown' },
        'LLM provider call failed'
      );
      return errorResponse(c, 500, ApiErrorCode.INTERNAL, 'LLM provider call failed');
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown' }, 'LLM proxy failed');
    return errorResponse(c, 500, ApiErrorCode.INTERNAL, 'Internal server error');
  }
});

export default brokerApp;
