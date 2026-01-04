# Adding New Providers

Quick reference for adding LLM, STT, or TTS providers.

---

## LLM Provider (e.g., OpenAI, Claude)

### Backend
| File | Action |
|------|--------|
| `src/providers/llm/[name].ts` | **Create** - implement `LLMProvider` interface |
| `src/config.ts` | Add API key to schema + env mapping |
| `src/index.ts` | Instantiate provider, pass to routes & WebSocket |
| `src/storage/projects.ts` | Update default `llm_provider` (optional) |

### Frontend
| File | Action |
|------|--------|
| `web/js/pages/project-settings.js` | Add option to LLM provider dropdown |

### Interface to Implement
```typescript
interface LLMProvider {
  readonly name: string;
  streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk>;
}
```

---

## STT Provider (e.g., Google Cloud, Azure, Whisper)

### Backend
| File | Action |
|------|--------|
| `src/providers/stt/[name].ts` | **Create** - implement `STTProvider` + `STTSession` |
| `src/config.ts` | Add API key to schema + env mapping |
| `src/index.ts` | Instantiate in WebSocket handler (~line 309) |
| `src/storage/projects.ts` | Update default `stt_provider` (optional) |

### Frontend
| File | Action |
|------|--------|
| `web/js/pages/project-settings.js` | Add option to STT provider dropdown |

### Interface to Implement
```typescript
interface STTProvider {
  readonly name: string;
  createSession(config: STTSessionConfig, events: STTSessionEvents): Promise<STTSession>;
}

interface STTSession {
  readonly isConnected: boolean;
  sendAudio(audioChunk: Buffer): void;
  finalize(): void;
  close(): void;
}
```

---

## TTS Provider (e.g., Azure, Google, PlayHT)

### Backend
| File | Action |
|------|--------|
| `src/providers/tts/[name].ts` | **Create** - implement `TTSProvider` + `TTSSession` |
| `src/providers/tts/interface.ts` | Add to `TTSProviderType` union |
| `src/providers/tts/factory.ts` | Add case to switch statement |
| `src/config.ts` | Add API key to schema + env mapping |
| `src/storage/projects.ts` | Update default `tts_provider` (optional) |

### Frontend
| File | Action |
|------|--------|
| `web/js/pages/project-settings.js` | Add option to TTS provider dropdown |
| `web/js/pages/npc-editor.js` | Add option to voice provider dropdown (per-NPC) |

### Interface to Implement
```typescript
interface TTSProvider {
  readonly name: string;
  createSession(config: TTSSessionConfig, events: TTSSessionEvents): Promise<TTSSession>;
}

interface TTSSession {
  synthesize(text: string, isContinuation: boolean): Promise<void>;
  flush(): Promise<void>;
  abort(): void;
  close(): void;
}
```

---

## Config Pattern

All providers follow the same config structure:

```typescript
// src/config.ts
const configSchema = z.object({
  // ... existing
  newProviderApiKey: z.string().optional(),
});

// Environment mapping
newProviderApiKey: process.env.NEW_PROVIDER_API_KEY,
```

---

## Recommendation

**TTS uses a factory pattern** - cleanest for adding providers.

**LLM and STT are hardcoded** in `index.ts`. Consider refactoring to factory pattern if adding multiple providers.

Example factory for STT:
```typescript
// src/providers/stt/factory.ts
export function createSttProvider(type: string, apiKey: string): STTProvider {
  switch (type) {
    case 'deepgram': return createDeepgramProvider({ apiKey });
    case 'google': return createGoogleProvider({ apiKey });
    default: throw new Error(`Unknown STT provider: ${type}`);
  }
}
```
