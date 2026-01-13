import { z } from 'zod';
import { createLogger } from './logger.js';

const logger = createLogger('config');

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  dataDir: z.string().default('./data'),
  encryptionKey: z.string().min(32).optional(),
  sessionTimeoutMs: z.coerce.number().int().positive().default(1800000),
  stateHistoryEnabled: z.coerce.boolean().default(true),
  stateHistoryMaxVersions: z.coerce.number().int().positive().default(10),
  security: z.object({
    maxInputLength: z.coerce.number().int().positive().default(500),
    rateLimitPerMinute: z.coerce.number().int().positive().default(10),
  }),
  limits: z.object({
    maxNpcsPerProject: z.coerce.number().int().positive().default(10),
    maxCategories: z.coerce.number().int().positive().default(20),
    maxDepthTiers: z.coerce.number().int().positive().default(5),
    maxConcurrentSessions: z.coerce.number().int().positive().default(100),
    maxStmMemories: z.coerce.number().int().positive().default(20),
    maxLtmMemories: z.coerce.number().int().positive().default(50),
  }),
  // Supabase configuration (production)
  supabase: z.object({
    url: z.string().optional(),
    anonKey: z.string().optional(),
    serviceRoleKey: z.string().optional(),
  }).default({}),
  // Provider API keys - can be overridden per-project in storage
  providers: z.object({
    // LLM providers
    geminiApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    grokApiKey: z.string().optional(),
    // STT providers
    deepgramApiKey: z.string().optional(),
    // TTS providers
    cartesiaApiKey: z.string().optional(),
    elevenLabsApiKey: z.string().optional(),
  }).default({}),
  // Default LLM provider type
  defaultLlmProvider: z.enum(['gemini', 'openai', 'anthropic', 'grok']).default('gemini'),
});

export type Config = z.infer<typeof ConfigSchema>;

let config: Config | null = null;

export function loadConfig(): Config {
  if (config) {
    return config;
  }

  try {
    const rawConfig = {
      port: process.env.PORT,
      logLevel: process.env.LOG_LEVEL,
      dataDir: process.env.DATA_DIR,
      encryptionKey: process.env.ENCRYPTION_KEY,
      sessionTimeoutMs: process.env.SESSION_TIMEOUT_MS,
      stateHistoryEnabled: process.env.STATE_HISTORY_ENABLED,
      stateHistoryMaxVersions: process.env.STATE_HISTORY_MAX_VERSIONS,
      security: {
        maxInputLength: process.env.MAX_INPUT_LENGTH,
        rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE,
      },
      limits: {
        maxNpcsPerProject: process.env.MAX_NPCS_PER_PROJECT,
        maxCategories: process.env.MAX_CATEGORIES,
        maxDepthTiers: process.env.MAX_DEPTH_TIERS,
        maxConcurrentSessions: process.env.MAX_CONCURRENT_SESSIONS,
        maxStmMemories: process.env.MAX_STM_MEMORIES,
        maxLtmMemories: process.env.MAX_LTM_MEMORIES,
      },
      supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      providers: {
        // LLM providers
        geminiApiKey: process.env.GEMINI_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        grokApiKey: process.env.GROK_API_KEY,
        // STT providers
        deepgramApiKey: process.env.DEEPGRAM_API_KEY,
        // TTS providers
        cartesiaApiKey: process.env.CARTESIA_API_KEY,
        elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
      },
      defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER,
    };

    config = ConfigSchema.parse(rawConfig);
    
    // Log config with all sensitive fields redacted
    const safeConfig = {
      port: config.port,
      logLevel: config.logLevel,
      dataDir: config.dataDir,
      encryptionKey: config.encryptionKey ? '[REDACTED]' : undefined,
      sessionTimeoutMs: config.sessionTimeoutMs,
      stateHistoryEnabled: config.stateHistoryEnabled,
      stateHistoryMaxVersions: config.stateHistoryMaxVersions,
      security: config.security,
      limits: config.limits,
      supabase: {
        url: config.supabase.url,
        anonKey: config.supabase.anonKey ? '[REDACTED]' : undefined,
        serviceRoleKey: config.supabase.serviceRoleKey ? '[REDACTED]' : undefined,
      },
      providers: {
        geminiApiKey: config.providers.geminiApiKey ? '[REDACTED]' : undefined,
        openaiApiKey: config.providers.openaiApiKey ? '[REDACTED]' : undefined,
        anthropicApiKey: config.providers.anthropicApiKey ? '[REDACTED]' : undefined,
        grokApiKey: config.providers.grokApiKey ? '[REDACTED]' : undefined,
        deepgramApiKey: config.providers.deepgramApiKey ? '[REDACTED]' : undefined,
        cartesiaApiKey: config.providers.cartesiaApiKey ? '[REDACTED]' : undefined,
        elevenLabsApiKey: config.providers.elevenLabsApiKey ? '[REDACTED]' : undefined,
      },
      defaultLlmProvider: config.defaultLlmProvider,
    };
    logger.info({ config: safeConfig }, 'Configuration loaded');
    return config;
  } catch (error) {
    logger.error({ error }, 'Failed to load configuration');
    throw new Error(`Configuration validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function getConfig(): Config {
  if (!config) {
    return loadConfig();
  }
  return config;
}

