# V2 Feature: Provider Infrastructure & NPC Images

## Overview

This cluster implements two features:
1. **LLM Factory Pattern**: Refactor LLM provider to use a factory pattern (like TTS), enabling easy addition of Claude, OpenAI, Grok, and other providers
2. **NPC Profile Pictures**: Upload and store images for NPCs to display in the UI

---

## Part A: LLM Factory Pattern

### Current State

Currently, the LLM provider is hardcoded in `src/index.ts`:

```typescript
// Current hardcoded implementation
import { createGeminiProvider } from './providers/llm/gemini.js';
const llmProvider = createGeminiProvider({ apiKey: config.geminiApiKey });
```

### Goal

Create a factory pattern similar to `src/providers/tts/factory.ts` that allows:
- Easy switching between providers via configuration
- Adding new providers with minimal code changes
- Per-project provider selection

---

### Implementation Steps

#### Step 1: Update LLM Interface

**File: `src/providers/llm/interface.ts`**

Add provider type enum:

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

/**
 * LLM Provider interface - all LLM implementations must conform to this
 */
export interface LLMProvider {
  /**
   * Stream a chat completion response
   */
  streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk>;

  /**
   * Get the provider name for logging
   */
  readonly name: string;
}
```

#### Step 2: Create LLM Factory

**File: `src/providers/llm/factory.ts`** (New File)

```typescript
import { createLogger } from '../../logger.js';
import type { LLMProvider, LLMProviderConfig, LLMProviderType, LLMFactoryConfig } from './interface.js';
import { createGeminiProvider } from './gemini.js';

const logger = createLogger('llm-factory');

/**
 * Create an LLM provider based on the specified type
 * @param config Factory configuration including provider type
 * @returns The created LLM provider
 * @throws Error if provider type is unknown or API key missing
 */
export function createLlmProvider(config: LLMFactoryConfig): LLMProvider {
  const { provider, ...providerConfig } = config;

  logger.info({ provider, model: providerConfig.model }, 'Creating LLM provider');

  switch (provider) {
    case 'gemini':
      return createGeminiProvider(providerConfig);

    case 'openai':
      // Placeholder - to be implemented
      throw new Error('OpenAI provider not yet implemented. See ADD_PROVIDERS.md');

    case 'anthropic':
      // Placeholder - to be implemented
      throw new Error('Anthropic (Claude) provider not yet implemented. See ADD_PROVIDERS.md');

    case 'grok':
      // Placeholder - to be implemented
      throw new Error('Grok provider not yet implemented. See ADD_PROVIDERS.md');

    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown LLM provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get the default LLM provider type
 */
export function getDefaultLlmProviderType(): LLMProviderType {
  return 'gemini';
}

/**
 * Check if an LLM provider type is supported
 */
export function isLlmProviderSupported(provider: string): provider is LLMProviderType {
  return ['gemini', 'openai', 'anthropic', 'grok'].includes(provider);
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
```

#### Step 3: Create OpenAI Provider Template

**File: `src/providers/llm/openai.ts`** (New File - Template)

```typescript
import { createLogger } from '../../logger.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMStreamChunk,
  LLMMessage,
} from './interface.js';

const logger = createLogger('openai-provider');

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * OpenAI LLM Provider implementation
 * 
 * To enable this provider:
 * 1. npm install openai
 * 2. Add OPENAI_API_KEY to .env
 * 3. Add openaiApiKey to src/config.ts
 * 4. Update the factory.ts switch case
 */
export class OpenAILlmProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;

    logger.info({ model: this.model }, 'OpenAI provider initialized');
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    // TODO: Implement OpenAI streaming
    // Reference: https://platform.openai.com/docs/api-reference/chat/create
    //
    // Implementation pattern:
    // 1. Import OpenAI SDK: import OpenAI from 'openai';
    // 2. Create client: const openai = new OpenAI({ apiKey: this.apiKey });
    // 3. Convert messages to OpenAI format
    // 4. Stream response:
    //    const stream = await openai.chat.completions.create({
    //      model: this.model,
    //      messages: convertedMessages,
    //      stream: true,
    //      tools: request.tools ? convertTools(request.tools) : undefined,
    //    });
    // 5. Yield chunks as LLMStreamChunk
    
    throw new Error('OpenAI provider not yet implemented');
  }
}

/**
 * Factory function to create an OpenAI provider
 */
export function createOpenAIProvider(config: LLMProviderConfig): LLMProvider {
  return new OpenAILlmProvider(config);
}
```

#### Step 4: Create Anthropic Provider Template

**File: `src/providers/llm/anthropic.ts`** (New File - Template)

```typescript
import { createLogger } from '../../logger.js';
import type { Tool, ToolCall } from '../../types/mcp.js';
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMChatRequest,
  LLMStreamChunk,
  LLMMessage,
} from './interface.js';

const logger = createLogger('anthropic-provider');

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Anthropic (Claude) LLM Provider implementation
 * 
 * To enable this provider:
 * 1. npm install @anthropic-ai/sdk
 * 2. Add ANTHROPIC_API_KEY to .env
 * 3. Add anthropicApiKey to src/config.ts
 * 4. Update the factory.ts switch case
 */
export class AnthropicLlmProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;

    logger.info({ model: this.model }, 'Anthropic provider initialized');
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    // TODO: Implement Anthropic streaming
    // Reference: https://docs.anthropic.com/claude/reference/messages_post
    //
    // Implementation pattern:
    // 1. Import Anthropic SDK: import Anthropic from '@anthropic-ai/sdk';
    // 2. Create client: const anthropic = new Anthropic({ apiKey: this.apiKey });
    // 3. Convert messages to Anthropic format (note: system prompt is separate)
    // 4. Stream response:
    //    const stream = await anthropic.messages.create({
    //      model: this.model,
    //      max_tokens: this.maxTokens,
    //      system: request.systemPrompt,
    //      messages: convertedMessages,
    //      stream: true,
    //      tools: request.tools ? convertTools(request.tools) : undefined,
    //    });
    // 5. Yield chunks as LLMStreamChunk
    
    throw new Error('Anthropic provider not yet implemented');
  }
}

/**
 * Factory function to create an Anthropic provider
 */
export function createAnthropicProvider(config: LLMProviderConfig): LLMProvider {
  return new AnthropicLlmProvider(config);
}
```

#### Step 5: Update Config Schema

**File: `src/config.ts`**

Add new API key configurations:

```typescript
import { z } from 'zod';

const configSchema = z.object({
  // ... existing config ...
  
  // LLM API Keys
  geminiApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  grokApiKey: z.string().optional(),
  
  // Default LLM provider (can be overridden per-project)
  defaultLlmProvider: z.enum(['gemini', 'openai', 'anthropic', 'grok']).default('gemini'),
});

export function loadConfig(): Config {
  return {
    // ... existing config ...
    
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    grokApiKey: process.env.GROK_API_KEY,
    defaultLlmProvider: (process.env.DEFAULT_LLM_PROVIDER as LLMProviderType) || 'gemini',
  };
}
```

#### Step 6: Update Server Initialization

**File: `src/index.ts`**

Use factory to create LLM provider:

```typescript
import { createLlmProvider, getDefaultLlmProviderType } from './providers/llm/factory.js';
import type { LLMProviderType } from './providers/llm/interface.js';

// Get API key for configured provider
function getLlmApiKey(provider: LLMProviderType, config: Config): string {
  switch (provider) {
    case 'gemini':
      return config.geminiApiKey || '';
    case 'openai':
      return config.openaiApiKey || '';
    case 'anthropic':
      return config.anthropicApiKey || '';
    case 'grok':
      return config.grokApiKey || '';
    default:
      return '';
  }
}

// Initialize LLM provider via factory
const llmProviderType = config.defaultLlmProvider || getDefaultLlmProviderType();
const llmApiKey = getLlmApiKey(llmProviderType, config);

if (!llmApiKey) {
  throw new Error(`API key required for LLM provider: ${llmProviderType}`);
}

const llmProvider = createLlmProvider({
  provider: llmProviderType,
  apiKey: llmApiKey,
});

logger.info({ provider: llmProviderType }, 'LLM provider initialized');
```

#### Step 7: Update Project Settings

**File: `src/types/project.ts`**

Add LLM provider to project settings:

```typescript
export interface ProjectSettings {
  llm_provider: string;  // Already exists, ensure type is correct
  llm_model?: string;    // Optional model override
  stt_provider: string;
  tts_provider: string;
  default_voice_id: string;
  timeouts: {
    session?: number;
    llm?: number;
    stt?: number;
    tts?: number;
  };
}
```

#### Step 8: Update Project Settings UI

**File: `web/js/pages/project-settings.js`**

Add OpenAI/Anthropic/Grok options:

```javascript
// In the LLM provider dropdown
const llmProviderSelect = `
  <select id="llm-provider" class="input">
    <option value="gemini">Google Gemini (Default)</option>
    <option value="openai">OpenAI GPT-4</option>
    <option value="anthropic">Anthropic Claude</option>
    <option value="grok">xAI Grok</option>
  </select>
`;

// Model selector that changes based on provider
const LLM_MODELS = {
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Smart)' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o (Recommended)' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Recommended)' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (Smart)' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Fast)' },
  ],
  grok: [
    { id: 'grok-beta', name: 'Grok Beta' },
  ],
};

function updateModelOptions(provider) {
  const modelSelect = document.getElementById('llm-model');
  const models = LLM_MODELS[provider] || [];
  
  modelSelect.innerHTML = models.map(m => 
    `<option value="${m.id}">${m.name}</option>`
  ).join('');
}
```

---

## Part B: NPC Profile Pictures

### Goal

Allow users to upload profile pictures for NPCs that are displayed in the UI for easy identification.

---

### Implementation Steps

#### Step 1: Create Image Storage Module

**File: `src/storage/images.ts`** (New File)

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import { StorageError, StorageNotFoundError } from './interface.js';

const logger = createLogger('image-storage');

// Supported image types
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Get the images directory for a project
 */
function getImagesDir(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId, 'images');
}

/**
 * Get the path to an NPC's profile image
 */
function getImagePath(projectId: string, npcId: string, ext: string): string {
  return path.join(getImagesDir(projectId), `${npcId}.${ext}`);
}

/**
 * Save an NPC profile image
 * @param projectId Project ID
 * @param npcId NPC ID
 * @param imageData Base64 encoded image data
 * @param mimeType Image MIME type
 * @returns The saved image filename
 */
export async function saveNpcImage(
  projectId: string,
  npcId: string,
  imageData: string,
  mimeType: string
): Promise<string> {
  const startTime = Date.now();

  // Validate MIME type
  if (!SUPPORTED_TYPES.includes(mimeType)) {
    throw new StorageError(`Unsupported image type: ${mimeType}. Supported: ${SUPPORTED_TYPES.join(', ')}`);
  }

  // Decode base64
  const buffer = Buffer.from(imageData, 'base64');

  // Validate size
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new StorageError(`Image too large: ${buffer.length} bytes. Max: ${MAX_IMAGE_SIZE} bytes`);
  }

  // Determine extension
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const imagesDir = getImagesDir(projectId);
  const imagePath = getImagePath(projectId, npcId, ext);

  try {
    // Ensure directory exists
    await fs.mkdir(imagesDir, { recursive: true });

    // Delete any existing image for this NPC (different extension)
    await deleteNpcImage(projectId, npcId).catch(() => {});

    // Write the new image
    await fs.writeFile(imagePath, buffer);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, size: buffer.length, ext, duration }, 'NPC image saved');

    return `${npcId}.${ext}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage }, 'Failed to save NPC image');
    throw new StorageError(`Failed to save image: ${errorMessage}`);
  }
}

/**
 * Get an NPC's profile image
 * @param projectId Project ID
 * @param npcId NPC ID
 * @returns Image buffer and MIME type, or null if not found
 */
export async function getNpcImage(
  projectId: string,
  npcId: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  const imagesDir = getImagesDir(projectId);

  // Try each supported extension
  const extensions = ['jpg', 'png', 'webp', 'gif'];
  
  for (const ext of extensions) {
    const imagePath = path.join(imagesDir, `${npcId}.${ext}`);
    try {
      const buffer = await fs.readFile(imagePath);
      const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { buffer, mimeType, filename: `${npcId}.${ext}` };
    } catch {
      // Try next extension
    }
  }

  return null;
}

/**
 * Delete an NPC's profile image
 * @param projectId Project ID
 * @param npcId NPC ID
 */
export async function deleteNpcImage(projectId: string, npcId: string): Promise<void> {
  const imagesDir = getImagesDir(projectId);
  const extensions = ['jpg', 'png', 'webp', 'gif'];

  for (const ext of extensions) {
    const imagePath = path.join(imagesDir, `${npcId}.${ext}`);
    try {
      await fs.unlink(imagePath);
      logger.info({ projectId, npcId, ext }, 'NPC image deleted');
      return;
    } catch {
      // Try next extension
    }
  }
}

/**
 * Check if an NPC has a profile image
 */
export async function hasNpcImage(projectId: string, npcId: string): Promise<boolean> {
  const image = await getNpcImage(projectId, npcId);
  return image !== null;
}
```

#### Step 2: Create Image Routes

**File: `src/routes/images.ts`** (New File)

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { saveNpcImage, getNpcImage, deleteNpcImage } from '../storage/images.js';
import { StorageError } from '../storage/interface.js';

const logger = createLogger('routes-images');

const UploadImageSchema = z.object({
  image: z.string().min(1),  // Base64 encoded
  mime_type: z.string().min(1),
});

export function createImageRoutes(): Hono {
  const imageRoutes = new Hono();

  /**
   * POST /api/projects/:projectId/npcs/:npcId/image
   * Upload or replace NPC profile image
   */
  imageRoutes.post('/:projectId/npcs/:npcId/image', async (c) => {
    const projectId = c.req.param('projectId');
    const npcId = c.req.param('npcId');

    try {
      const body = await c.req.json();
      const parsed = UploadImageSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
      }

      const { image, mime_type } = parsed.data;
      const filename = await saveNpcImage(projectId, npcId, image, mime_type);

      logger.info({ projectId, npcId, filename }, 'NPC image uploaded');

      return c.json({ success: true, filename });
    } catch (error) {
      if (error instanceof StorageError) {
        return c.json({ error: error.message }, 400);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ projectId, npcId, error: errorMessage }, 'Failed to upload image');
      return c.json({ error: 'Failed to upload image' }, 500);
    }
  });

  /**
   * GET /api/projects/:projectId/npcs/:npcId/image
   * Get NPC profile image
   */
  imageRoutes.get('/:projectId/npcs/:npcId/image', async (c) => {
    const projectId = c.req.param('projectId');
    const npcId = c.req.param('npcId');

    const image = await getNpcImage(projectId, npcId);

    if (!image) {
      return c.json({ error: 'No image found' }, 404);
    }

    c.header('Content-Type', image.mimeType);
    c.header('Content-Disposition', `inline; filename="${image.filename}"`);
    c.header('Cache-Control', 'public, max-age=86400');  // Cache for 1 day

    return c.body(image.buffer);
  });

  /**
   * DELETE /api/projects/:projectId/npcs/:npcId/image
   * Delete NPC profile image
   */
  imageRoutes.delete('/:projectId/npcs/:npcId/image', async (c) => {
    const projectId = c.req.param('projectId');
    const npcId = c.req.param('npcId');

    try {
      await deleteNpcImage(projectId, npcId);
      return c.json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ projectId, npcId, error: errorMessage }, 'Failed to delete image');
      return c.json({ error: 'Failed to delete image' }, 500);
    }
  });

  return imageRoutes;
}
```

#### Step 3: Register Image Routes

**File: `src/index.ts`**

Add image routes to the server:

```typescript
import { createImageRoutes } from './routes/images.js';

// In route setup
const imageRoutes = createImageRoutes();
app.route('/api/projects', imageRoutes);
```

#### Step 4: Update NPC Editor UI

**File: `web/js/pages/npc-editor.js`**

Add image upload to NPC editor:

```javascript
let currentImageData = null;

// Image upload handler
async function handleImageUpload(file) {
  if (!file) return;

  // Validate type
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    toast.error('Invalid Image', 'Please upload a JPG, PNG, WebP, or GIF image.');
    return;
  }

  // Validate size (2MB max)
  if (file.size > 2 * 1024 * 1024) {
    toast.error('Image Too Large', 'Maximum image size is 2MB.');
    return;
  }

  // Read as base64
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1];  // Remove data URL prefix
    currentImageData = {
      data: base64,
      type: file.type,
    };
    
    // Show preview
    const preview = document.getElementById('image-preview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    
    document.getElementById('btn-remove-image').style.display = 'inline-flex';
  };
  reader.readAsDataURL(file);
}

// Save image when NPC is saved
async function saveNpcImage() {
  if (!currentImageData || !currentNpcId) return;

  try {
    await fetch(`/api/projects/${currentProjectId}/npcs/${currentNpcId}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: currentImageData.data,
        mime_type: currentImageData.type,
      }),
    });
  } catch (error) {
    console.error('Failed to save image:', error);
  }
}

// Load existing image
async function loadNpcImage(projectId, npcId) {
  const preview = document.getElementById('image-preview');
  const removeBtn = document.getElementById('btn-remove-image');
  
  try {
    const response = await fetch(`/api/projects/${projectId}/npcs/${npcId}/image`);
    if (response.ok) {
      const blob = await response.blob();
      preview.src = URL.createObjectURL(blob);
      preview.style.display = 'block';
      removeBtn.style.display = 'inline-flex';
    } else {
      preview.style.display = 'none';
      removeBtn.style.display = 'none';
    }
  } catch {
    preview.style.display = 'none';
    removeBtn.style.display = 'none';
  }
}

// Bind handlers
document.getElementById('image-input')?.addEventListener('change', (e) => {
  handleImageUpload(e.target.files[0]);
});

document.getElementById('btn-upload-image')?.addEventListener('click', () => {
  document.getElementById('image-input').click();
});

document.getElementById('btn-remove-image')?.addEventListener('click', async () => {
  if (currentNpcId) {
    await fetch(`/api/projects/${currentProjectId}/npcs/${currentNpcId}/image`, {
      method: 'DELETE',
    });
  }
  
  currentImageData = null;
  document.getElementById('image-preview').style.display = 'none';
  document.getElementById('btn-remove-image').style.display = 'none';
});

// Update handleSaveNpc to save image
const originalSaveNpc = handleSaveNpc;
handleSaveNpc = async function() {
  await originalSaveNpc();
  await saveNpcImage();
};
```

**File: `web/index.html`**

Add image upload section to NPC editor template:

```html
<!-- In template-npc-editor, section-basic -->
<div class="form-group image-upload-group">
  <label>Profile Image</label>
  <div class="image-upload-container">
    <div class="image-preview-container">
      <img id="image-preview" src="" alt="NPC Preview" style="display: none;">
      <div class="image-placeholder" id="image-placeholder">
        <span class="placeholder-icon">◇</span>
        <span class="placeholder-text">No image</span>
      </div>
    </div>
    <div class="image-upload-actions">
      <input type="file" id="image-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
      <button type="button" id="btn-upload-image" class="btn btn-secondary">
        <span class="icon">📷</span> Upload Image
      </button>
      <button type="button" id="btn-remove-image" class="btn btn-ghost" style="display: none;">
        <span class="icon">✕</span> Remove
      </button>
    </div>
  </div>
  <p class="hint">Max 2MB. Displayed in NPC list and playground.</p>
</div>
```

#### Step 5: Update NPC List to Show Images

**File: `web/js/pages/npc-editor.js`**

Update NPC card rendering:

```javascript
async function loadNpcList(projectId) {
  const grid = document.getElementById('npc-grid');
  
  // ... existing code ...

  grid.innerHTML = npcList.map(npc => `
    <div class="npc-card" data-id="${npc.id}">
      <div class="npc-card-avatar">
        <img src="/api/projects/${projectId}/npcs/${npc.id}/image" 
             alt="${escapeHtml(npc.name)}"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <span class="avatar-fallback" style="display: none;">◇</span>
      </div>
      <h3>${escapeHtml(npc.name)}</h3>
      <p>${escapeHtml(npc.description || 'No description')}</p>
    </div>
  `).join('');

  // ... rest of function ...
}
```

#### Step 6: Add Image Styles

**File: `web/css/components.css`**

Add styles for image upload:

```css
/* Image Upload */
.image-upload-container {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}

.image-preview-container {
  width: 120px;
  height: 120px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  flex-shrink: 0;
}

.image-preview-container img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.image-placeholder .placeholder-icon {
  font-size: var(--text-2xl);
  margin-bottom: var(--space-1);
}

.image-placeholder .placeholder-text {
  font-size: var(--text-xs);
}

.image-upload-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* NPC Card Avatar */
.npc-card-avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-tertiary);
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.npc-card-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.npc-card-avatar .avatar-fallback {
  font-size: var(--text-2xl);
  color: var(--text-muted);
}
```

---

## Testing Checklist

### LLM Factory
1. [ ] Verify Gemini provider still works via factory
2. [ ] Test provider type validation
3. [ ] Test error messages for unimplemented providers
4. [ ] Test per-project provider selection in settings
5. [ ] Verify model selection updates based on provider

### NPC Images
1. [ ] Upload JPG image - verify saves correctly
2. [ ] Upload PNG image - verify saves correctly
3. [ ] Upload oversized image - verify error message
4. [ ] Upload invalid type - verify error message
5. [ ] Load NPC with image - verify displays
6. [ ] Load NPC without image - verify fallback
7. [ ] Delete image - verify removes from storage
8. [ ] Replace image - verify old image deleted

---

## API Changes Summary

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects/:pid/npcs/:nid/image` | POST | Upload NPC image |
| `/api/projects/:pid/npcs/:nid/image` | GET | Get NPC image |
| `/api/projects/:pid/npcs/:nid/image` | DELETE | Delete NPC image |

### New Files

| File | Purpose |
|------|---------|
| `src/providers/llm/factory.ts` | LLM provider factory |
| `src/providers/llm/openai.ts` | OpenAI provider template |
| `src/providers/llm/anthropic.ts` | Anthropic provider template |
| `src/storage/images.ts` | Image storage module |
| `src/routes/images.ts` | Image API routes |

---

## Future Enhancements

### LLM
1. **Provider health checks**: Test API connectivity before use
2. **Automatic fallback**: Switch to backup provider on failure
3. **Cost tracking**: Log token usage per provider
4. **Model aliases**: Map friendly names to provider-specific models

### Images
1. **Image optimization**: Auto-resize and compress uploads
2. **Multiple images**: Support gallery of NPC images
3. **AI generation**: Generate NPC portraits via DALL-E/Midjourney
4. **CDN integration**: Serve images via CDN for better performance

