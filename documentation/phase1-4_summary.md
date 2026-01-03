# Evolve.NPC - Phases 1-4 Implementation Summary

Quick reference for devs. All files use strict TypeScript, Pino logging, and proper error handling.

---

## Core Infrastructure (Phase 1-2)

### Configuration & Logging

| File | Role |
|------|------|
| `src/config.ts` | Centralized config from env vars. `getConfig()` returns validated settings (data dirs, limits, timeouts, encryption key). |
| `src/logger.ts` | Pino logger factory. `createLogger(name)` returns child logger with context. |

### Type Definitions

| File | Role |
|------|------|
| `src/types/project.ts` | `Project`, `ProjectSettings`, `ProjectLimits` - project-level config types |
| `src/types/npc.ts` | `NPCDefinition`, `NPCInstance`, `MoodVector`, `PersonalityBaseline`, `Memory` - NPC data structures |
| `src/types/knowledge.ts` | `KnowledgeBase`, `KnowledgeCategory` - tiered knowledge system types |
| `src/types/mcp.ts` | `McpTool`, `McpToolResult`, `McpPermissions` - MCP tool definitions |

---

## Provider Layer (Phase 3)

### LLM Providers

| File | Role |
|------|------|
| `src/providers/llm/interface.ts` | `LLMProvider` interface. Key method: `streamChat(req): AsyncIterable<LLMStreamChunk>`. Supports function calling via `tools` array. |
| `src/providers/llm/gemini.ts` | Gemini 2.0 Flash implementation. Converts MCP tools to Gemini function declarations. Streams responses with `textDelta` and `toolCall` chunks. |

### STT Providers

| File | Role |
|------|------|
| `src/providers/stt/interface.ts` | `STTProvider` + `STTSession` interfaces. Session emits `transcript`/`error` events. Methods: `sendAudio()`, `finalize()`, `close()`. |
| `src/providers/stt/deepgram.ts` | Deepgram Nova-2 WebSocket implementation. Auto-reconnect on disconnect. Emits interim + final transcripts. |

### TTS Providers

| File | Role |
|------|------|
| `src/providers/tts/interface.ts` | `TTSProvider` + `TTSSession` interfaces. Session emits `audio`/`done`/`error` events. Methods: `synthesize()`, `flush()`, `abort()`. |
| `src/providers/tts/cartesia.ts` | Cartesia Sonic WebSocket streaming. Context IDs for prosody continuity. Handles incremental text with `continue` flag. |
| `src/providers/tts/elevenlabs.ts` | ElevenLabs WebSocket streaming. Voice settings support. Raw WS implementation (no SDK for streaming). |
| `src/providers/tts/factory.ts` | `createTtsProvider(type, apiKey)` - factory function. Defaults to Cartesia. |

---

## Storage Layer (Phase 4)

### Core

| File | Role |
|------|------|
| `src/storage/interface.ts` | Error classes: `StorageError`, `StorageNotFoundError`, `StorageValidationError`, `StorageLimitError`. Version tracking types. |

### Project Storage

| File | Role |
|------|------|
| `src/storage/projects.ts` | CRUD for projects. Creates dir structure (`definitions/`, `instances/`). YAML config at `project.yaml`. IDs: `proj_{timestamp}_{random}`. |

### Secrets Storage

| File | Role |
|------|------|
| `src/storage/secrets.ts` | Encrypted API key storage. AES-256-GCM + PBKDF2 (100k iterations). Stores `secrets.enc` per project. Requires `ENCRYPTION_KEY` env var. |

### Knowledge Storage

| File | Role |
|------|------|
| `src/storage/knowledge.ts` | Knowledge base CRUD. YAML at `knowledge_base.yaml`. Validates category/depth limits. Tiered depth system (0-N). |

### NPC Definition Storage

| File | Role |
|------|------|
| `src/storage/definitions.ts` | NPC definition CRUD. YAML files in `definitions/{npc_id}.yaml`. Validates Big Five traits (0-1), core anchor, voice config. Enforces NPC limit per project. |

### Instance Storage

| File | Role |
|------|------|
| `src/storage/instances.ts` | Per-player NPC instances. JSON at `instances/{inst_id}/current.json`. Git-like history in `history/` dir. Supports rollback to previous versions. Auto-prunes old versions. |

---

## Directory Structure

```
{dataDir}/
└── projects/
    └── {project_id}/
        ├── project.yaml          # Project config
        ├── secrets.enc           # Encrypted API keys
        ├── knowledge_base.yaml   # Tiered knowledge
        ├── definitions/
        │   └── {npc_id}.yaml     # NPC definitions
        └── instances/
            └── {instance_id}/
                ├── current.json  # Current state
                └── history/
                    └── {timestamp}.json  # Version history
```

---

## Key Patterns

- **Streaming**: All providers use `AsyncIterable` or event emitters for real-time data
- **Cancellation**: `AbortSignal` support throughout
- **Error hierarchy**: Base `StorageError` with specific subclasses
- **ID generation**: `{type}_{base36_timestamp}_{random}` format
- **Logging**: Structured with duration tracking on all operations
- **Validation**: Upfront validation before any writes
