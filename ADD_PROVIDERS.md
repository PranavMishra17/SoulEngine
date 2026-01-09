# Adding New Providers

Quick reference for adding LLM, STT, or TTS providers.

---

## LLM Provider (Gemini, OpenAI, Claude, Grok)

**Uses factory pattern** - see `src/providers/llm/factory.ts`

### Backend
| File | Action |
|------|--------|
| `src/providers/llm/[name].ts` | **Create** - implement `LLMProvider` interface |
| `src/providers/llm/interface.ts` | Add to `LLMProviderType` union |
| `src/providers/llm/factory.ts` | Add case to switch + `getDefaultModel()` |
| `src/config.ts` | Add API key to `providers` schema |

### Frontend
| File | Action |
|------|--------|
| `web/js/pages/project-settings.js` | Add to `LLM_MODELS` object + dropdown |

### Interface
```typescript
interface LLMProvider {
  readonly name: string;
  streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk>;
}
```

### Example: Adding a new LLM
```typescript
// 1. src/providers/llm/interface.ts
export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'grok' | 'newprovider';

// 2. src/providers/llm/factory.ts
case 'newprovider':
  return createNewProvider(providerConfig);

// 3. getDefaultModel()
case 'newprovider':
  return 'newprovider-model-v1';
```

---

## STT Provider (Deepgram)

### Backend
| File | Action |
|------|--------|
| `src/providers/stt/[name].ts` | **Create** - implement `STTProvider` + `STTSession` |
| `src/config.ts` | Add API key to `providers` schema |
| `src/index.ts` | Instantiate in WebSocket handler |

### Interface
```typescript
interface STTProvider {
  readonly name: string;
  createSession(config: STTSessionConfig, events: STTSessionEvents): Promise<STTSession>;
}
```

---

## TTS Provider (Cartesia, ElevenLabs)

**Uses factory pattern** - see `src/providers/tts/factory.ts`

### Backend
| File | Action |
|------|--------|
| `src/providers/tts/[name].ts` | **Create** - implement `TTSProvider` + `TTSSession` |
| `src/providers/tts/interface.ts` | Add to `TTSProviderType` union |
| `src/providers/tts/factory.ts` | Add case to switch |
| `src/config.ts` | Add API key to `providers` schema |

### Frontend
| File | Action |
|------|--------|
| `web/js/pages/project-settings.js` | Add to TTS dropdown |
| `web/js/pages/npc-editor.js` | Add to voice provider dropdown |

### Interface
```typescript
interface TTSProvider {
  readonly name: string;
  createSession(config: TTSSessionConfig, events: TTSSessionEvents): Promise<TTSSession>;
}
```

---

## Config Pattern

```typescript
// src/config.ts - providers schema
providers: z.object({
  geminiApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  grokApiKey: z.string().optional(),
  deepgramApiKey: z.string().optional(),
  cartesiaApiKey: z.string().optional(),
  elevenLabsApiKey: z.string().optional(),
  newProviderApiKey: z.string().optional(),  // Add here
}).default({}),
```

---

## Environment Variables

```bash
GEMINI_API_KEY=xxx
OPENAI_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
GROK_API_KEY=xxx
DEEPGRAM_API_KEY=xxx
CARTESIA_API_KEY=xxx
ELEVENLABS_API_KEY=xxx
DEFAULT_LLM_PROVIDER=gemini  # gemini|openai|anthropic|grok
```
