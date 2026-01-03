# Evolve.NPC - Phases 5-8 Implementation Summary

Quick reference for devs. Builds on Phase 1-4 infrastructure.

---

## Core NPC Logic (Phase 5)

### Memory & Personality

| File | Role |
|------|------|
| `src/core/memory.ts` | `createMemory()`, `calculateSalience()`, `pruneSTM()`. Salience = weighted sum of emotional intensity, novelty, player involvement, mood. STM limit: 20, LTM limit: 50. |
| `src/core/personality.ts` | `applyTraitModifiers()` (clamps ±0.3), `blendMoods()` (linear interpolation), `describePersonality()` for prompt injection. |
| `src/core/summarizer.ts` | `summarizeConversation(llmProvider, history, npcPerspective)` - LLM-powered 2-3 sentence summary from NPC POV. No raw quotes. |

### Context Assembly

| File | Role |
|------|------|
| `src/core/context.ts` | `assembleSystemPrompt()` - builds full NPC system prompt (anchor, personality, mood, knowledge, memories, relationships, security rules). `assembleConversationHistory()` - converts session history to LLM format. |
| `src/core/knowledge.ts` | `resolveKnowledge(kb, access)` - flattens tiered knowledge based on NPC's access levels per category. |
| `src/core/tools.ts` | `getAvailableTools()` - filters project tools by NPC permissions + adds `exit_convo` if security flagged. `EXIT_CONVO_TOOL` constant. |

---

## Session Management (Phase 6)

| File | Role |
|------|------|
| `src/session/store.ts` | In-memory `Map<SessionID, StoredSession>`. Tracks session count per project. `findTimedOutSessions()` for cleanup. Singleton export. |
| `src/session/manager.ts` | `startSession()` - loads project/definition/instance, caches anchor, creates session. `endSession()` - summarizes, creates memory, saves instance. `getSessionContext()` - loads full context for conversation processing. |

### Session Lifecycle

```
startSession(projectId, npcId, playerId)
  → Load project, definition, instance
  → Cache original anchor
  → Store in RAM → Return session_id

endSession(sessionId, llmProvider, exitConvoUsed?)
  → Summarize conversation → Create memory
  → Update mood (drift toward neutral)
  → Validate anchor integrity
  → Save instance with history → Remove from RAM
```

---

## API Routes (Phase 7)

| File | Role |
|------|------|
| `src/routes/projects.ts` | CRUD `/api/projects/*`. Includes `/keys` for encrypted API key updates. |
| `src/routes/knowledge.ts` | GET/PUT `/api/projects/:id/knowledge` - knowledge base CRUD. |
| `src/routes/npcs.ts` | CRUD `/api/projects/:id/npcs/*` - NPC definition management. |
| `src/routes/session.ts` | `POST /start`, `POST /:id/end`, `GET /:id` (debug), `GET /stats`. |
| `src/routes/conversation.ts` | `POST /api/session/:id/message` - security pipeline → context → LLM → tools → response. |
| `src/routes/cycles.ts` | `POST /api/instances/:id/{daily-pulse,weekly-whisper,persona-shift}` - memory cycle triggers. |
| `src/routes/history.ts` | `GET /api/instances/:id/history`, `POST /api/instances/:id/rollback` - state versioning. |

### MCP Tool System

| File | Role |
|------|------|
| `src/mcp/registry.ts` | `MCPToolRegistry` - per-project tool registration. `executeTool()` runs handler or returns pending for client execution. Singleton export. |
| `src/mcp/validator.ts` | `validateToolCall()` - schema validation. `validateToolPermission()` - NPC permission check. `sanitizeToolArguments()` - limits string/array lengths. |
| `src/mcp/exit-handler.ts` | `handleExitConvo()` - processes exit tool. `CooldownTracker` - per player/NPC cooldowns. `canStartConversation()` check. |

---

## Voice Pipeline (Phase 8)

### Audio Utilities

| File | Role |
|------|------|
| `src/voice/audio.ts` | `decodeClientAudio()` / `encodeTtsAudio()` - base64 ↔ Buffer. `validateAudioBuffer()`, `trimSilence()`, `resampleLinear()`, `float32ToInt16()`. Constants: 16kHz STT input, 44.1kHz TTS output. |

### Sentence Detection

| File | Role |
|------|------|
| `src/voice/sentence-detector.ts` | `SentenceDetector` class. `addChunk()` buffers text, returns complete sentences. `flush()` returns remainder. Handles abbreviations (Dr., Mr., etc.) and decimals. Max buffer: 500 chars. |

### Interruption Handling

| File | Role |
|------|------|
| `src/voice/interruption.ts` | `InterruptionHandler` - manages AbortController lifecycle. States: idle → processing → interrupted/completed. `onInterrupt()` registers cleanup callbacks. |

### Voice Pipeline Core

| File | Role |
|------|------|
| `src/voice/pipeline.ts` | `VoicePipeline` class - orchestrates full voice loop. Owns STT/TTS sessions. Methods: `pushAudio()`, `handleTextInput()`, `handleInterruption()`, `end()`. Integrates security pipeline, context assembly, tool handling. |

### WebSocket Handler

| File | Role |
|------|------|
| `src/ws/handler.ts` | `createVoiceWebSocketHandler()` - Hono route for `/ws/voice`. `handleVoiceWebSocket()` - connection lifecycle. Message types below. |

---

## WebSocket Protocol

### Inbound (Client → Server)

| Type | Payload | Action |
|------|---------|--------|
| `init` | `session_id` | Initialize pipeline, return `ready` |
| `audio` | `data` (base64) | Push to STT |
| `commit` | - | Finalize current utterance |
| `text` | `content` | Process text input (skip STT) |
| `interrupt` | - | Abort LLM + TTS |
| `end` | - | End session, persist state |

### Outbound (Server → Client)

| Type | Payload | When |
|------|---------|------|
| `ready` | `session_id`, `npc_name`, `voice_config` | After init |
| `transcript` | `text`, `is_final` | STT result |
| `text_chunk` | `text` | LLM streaming token |
| `audio_chunk` | `data` (base64) | TTS audio |
| `tool_call` | `name`, `args` | MCP tool invoked |
| `generation_end` | - | NPC turn complete |
| `exit_convo` | `reason`, `cooldown_seconds?` | NPC exits |
| `sync` | `success`, `version?` | Session persisted |
| `error` | `code`, `message` | Any error |

---

## Data Flow

```
Audio In ──► STT ──► Security ──► Context ──► LLM ──► Sentences ──► TTS ──► Audio Out
              │                      │          │
              │                      │          └─► Tool Calls ──► MCP Registry
              │                      │
              │                      └─► assembleSystemPrompt()
              │                          assembleConversationHistory()
              │
              └─► Deepgram WebSocket (interim + final)
```

---

## Key Patterns

- **Session-scoped pipeline**: One VoicePipeline per active voice session
- **Event-driven TTS/STT**: Callbacks, not polling
- **Streaming everywhere**: LLM tokens → sentence detector → TTS (no buffering full response)
- **Graceful degradation**: TTS failure → text-only response
- **Anchor immutability**: Validated at session end, never modified
- **Tool forwarding**: No handler → returns `pending` for client execution
