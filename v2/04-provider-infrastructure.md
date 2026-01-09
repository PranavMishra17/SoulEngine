# V2 Feature: Provider Infrastructure & NPC Images

## Overview

This cluster implements two features:
1. **LLM Factory Pattern**: Refactored LLM provider to use a factory pattern (like TTS), enabling easy addition of Claude, OpenAI, Grok, and other providers
2. **NPC Profile Pictures**: Upload and store images for NPCs to display in the UI

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| LLM Factory Pattern | ✅ Complete | All 4 providers implemented |
| OpenAI Provider | ✅ Complete | Full streaming support |
| Anthropic Provider | ✅ Complete | Full streaming support |
| Grok Provider | ✅ Complete | Full streaming support |
| Config Updates | ✅ Complete | Multi-provider API keys |
| Server Integration | ✅ Complete | Factory-based initialization |
| NPC Profile Pictures | ✅ Complete | Upload, storage, and UI |

---

## Part A: LLM Factory Pattern

### Implementation Details

The LLM provider system has been refactored to use a factory pattern, similar to the TTS provider system. This allows:
- Easy switching between providers via configuration
- Adding new providers with minimal code changes
- Per-project provider selection (future enhancement)

### Files Modified/Created

#### 1. Interface Updates (`src/providers/llm/interface.ts`)

Added provider type and factory configuration:

```typescript
/**
 * Supported LLM provider types
 */
export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'grok';

/**
 * Configuration for LLM provider
 */
export interface LLMProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Extended config for factory
 */
export interface LLMFactoryConfig extends LLMProviderConfig {
  provider: LLMProviderType;
}
```

#### 2. Factory Implementation (`src/providers/llm/factory.ts`)

Created a new factory module:

```typescript
import { createLogger } from '../../logger.js';
import type { LLMProvider, LLMProviderType, LLMFactoryConfig } from './interface.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAIProvider } from './openai.js';
import { createAnthropicProvider } from './anthropic.js';
import { createGrokProvider } from './grok.js';

const logger = createLogger('llm-factory');

/**
 * Create an LLM provider based on the specified type
 */
export function createLlmProvider(config: LLMFactoryConfig): LLMProvider {
  const { provider, ...providerConfig } = config;

  logger.info({ provider, model: providerConfig.model }, 'Creating LLM provider');

  switch (provider) {
    case 'gemini':
      return createGeminiProvider(providerConfig);
    case 'openai':
      return createOpenAIProvider(providerConfig);
    case 'anthropic':
      return createAnthropicProvider(providerConfig);
    case 'grok':
      return createGrokProvider(providerConfig);
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown LLM provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get default model for a provider type
 */
export function getDefaultModel(provider: LLMProviderType): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.5-flash';
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-3-5-sonnet-20241022';
    case 'grok':
      return 'grok-beta';
    default:
      return 'gemini-2.5-flash';
  }
}

/**
 * Check if an LLM provider type is supported
 */
export function isLlmProviderSupported(provider: string): provider is LLMProviderType {
  return ['gemini', 'openai', 'anthropic', 'grok'].includes(provider);
}
```

#### 3. OpenAI Provider (`src/providers/llm/openai.ts`)

Fully implemented OpenAI provider with streaming support:

- Uses native fetch API (no external SDK dependency)
- Supports streaming chat completions
- Handles tool calls for function calling
- Converts between internal message format and OpenAI format

Key features:
- Default model: `gpt-4o`
- Supports: GPT-4o, GPT-4o-mini, GPT-4-turbo, etc.
- Full streaming with delta content and tool calls

#### 4. Anthropic Provider (`src/providers/llm/anthropic.ts`)

Fully implemented Anthropic (Claude) provider with streaming support:

- Uses native fetch API (no external SDK dependency)
- Supports streaming messages API
- Handles tool use for function calling
- Converts between internal message format and Anthropic format

Key features:
- Default model: `claude-3-5-sonnet-20241022`
- Supports: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
- System prompt handled separately (Anthropic requirement)
- Full streaming with content blocks and tool use

#### 5. Grok Provider (`src/providers/llm/grok.ts`)

Fully implemented Grok (xAI) provider with streaming support:

- Uses native fetch API against xAI API
- Follows OpenAI-compatible API format
- Supports streaming chat completions
- Handles tool calls for function calling

Key features:
- Default model: `grok-beta`
- API endpoint: `https://api.x.ai/v1/chat/completions`
- OpenAI-compatible request/response format

#### 6. Configuration Updates (`src/config.ts`)

Added support for multiple LLM API keys:

```typescript
const ConfigSchema = z.object({
  // ... existing config ...
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
```

Environment variables:
- `GEMINI_API_KEY` - Google AI Studio API key
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GROK_API_KEY` - xAI Grok API key
- `DEFAULT_LLM_PROVIDER` - Default provider (gemini/openai/anthropic/grok)

#### 7. Server Integration (`src/index.ts`)

Updated server to use factory pattern:

```typescript
import { createLlmProvider, getDefaultModel } from './providers/llm/factory.js';
import type { LLMProviderType } from './providers/llm/interface.js';

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
const llmProvider = llmApiKey
  ? createLlmProvider({
      provider: defaultLlmType,
      apiKey: llmApiKey,
      model: getDefaultModel(defaultLlmType),
    })
  : null;
```

---

## Part B: NPC Profile Pictures

### Implementation Status: ✅ Complete

NPC profile picture functionality has been fully implemented in a previous session. See the NPC Editor UI for the implementation.

### Key Features

1. **Image Upload**: Upload JPG, PNG, WebP, or GIF images (max 2MB)
2. **Local Storage**: Images stored in `data/projects/{projectId}/images/{npcId}.{ext}`
3. **NPC YAML Reference**: Only filename stored in NPC definition (`profile_image` field)
4. **UI Display**: Profile pictures shown in NPC editor and NPC list

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects/:pid/npcs/:nid/avatar` | POST | Upload NPC image |
| `/api/projects/:pid/npcs/:nid/avatar` | GET | Get NPC image |
| `/api/projects/:pid/npcs/:nid/avatar` | DELETE | Delete NPC image |

### Files Implemented

| File | Purpose |
|------|---------|
| `src/storage/images.ts` | Image storage module |
| `src/routes/npcs.ts` | Avatar routes (POST/GET/DELETE) |
| `web/js/pages/npc-editor.js` | UI for image upload |
| `web/index.html` | Image upload section in Basic Info tab |

---

## Usage Guide

### Switching LLM Providers

1. Set the appropriate API key in your `.env` file:

```bash
# Choose one or more:
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GROK_API_KEY=your_grok_key

# Set default provider:
DEFAULT_LLM_PROVIDER=gemini  # or openai, anthropic, grok
```

2. Restart the server - it will automatically use the configured provider.

### Available Models

| Provider | Default Model | Other Options |
|----------|---------------|---------------|
| Gemini | gemini-2.5-flash | gemini-2.5-pro, gemini-1.5-pro |
| OpenAI | gpt-4o | gpt-4o-mini, gpt-4-turbo |
| Anthropic | claude-3-5-sonnet-20241022 | claude-3-opus, claude-3-haiku |
| Grok | grok-beta | - |

---

## Future Enhancements

### LLM
1. **Per-project provider selection**: Allow different NPCs to use different providers
2. **Provider health checks**: Test API connectivity before use
3. **Automatic fallback**: Switch to backup provider on failure
4. **Cost tracking**: Log token usage per provider
5. **Model aliases**: Map friendly names to provider-specific models

### Images
1. **Image optimization**: Auto-resize and compress uploads
2. **Multiple images**: Support gallery of NPC images
3. **AI generation**: Generate NPC portraits via DALL-E/Midjourney
4. **CDN integration**: Serve images via CDN for better performance

---

## Testing Checklist

### LLM Factory
- [x] Gemini provider works via factory
- [x] OpenAI provider streaming works
- [x] Anthropic provider streaming works
- [x] Grok provider streaming works
- [x] Provider type validation
- [x] Error messages for missing API keys
- [x] Default model selection per provider

### NPC Images
- [x] Upload JPG image - saves correctly
- [x] Upload PNG image - saves correctly
- [x] Upload oversized image - shows error
- [x] Upload invalid type - shows error
- [x] Load NPC with image - displays correctly
- [x] Load NPC without image - shows fallback
- [x] Delete image - removes from storage
- [x] Replace image - old image deleted
