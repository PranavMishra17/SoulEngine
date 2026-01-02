# Evolve.NPC Implementation Plan

TypeScript Web Application for NPC Testing

---

## Overview

Iterative implementation steps for building the Evolve.NPC web application. Complete phases in order. Test before proceeding. Mark completed items with [*].

### Target Stack

```
Runtime:    Bun (recommended) or Node.js 20+
Framework:  Hono
Language:   TypeScript (strict)
LLM:        Gemini Flash 2.5 via @google/generative-ai (streaming)
STT:        Deepgram Nova-2 via @deepgram/sdk (WebSocket live)
TTS:        Cartesia Sonic via @cartesia/cartesia-js (default, WebSocket)
            ElevenLabs via elevenlabs (alternative, WebSocket)
VAD:        Client-side (@ricky0123/vad-web for browser)
Validation: Zod
Logging:    Pino
Deploy:     Render (container)
```

### Data Hierarchy

```
Project (created on homepage, no auth required for MVP)
  ├── Settings & API Keys
  ├── MCP Tool Registry
  ├── Knowledge Base (categorical, depth-tiered)
  └── NPC Definitions (1-10 per project)
        └── NPC Instances (per player/session)
```

### Architecture Model: Transient Sessions

Backend is **stateful during conversations** but **stateless between conversations**.

```
Session Lifecycle:
1. START  -> Client sends project_id + npc_id + player_id
          -> Server loads/creates instance, caches in RAM
2. CHAT   -> WebSocket uses SessionID -> Server appends to RAM state
3. END    -> Server summarizes -> Writes to storage (with history) -> Dumps RAM
```

### Project Structure

```
evolve-npc/
  src/
    index.ts              # Entry point
    config.ts             # Environment and defaults
    logger.ts             # Pino setup
    types/
      project.ts          # Project, settings, API keys types
      knowledge.ts        # Knowledge base types
      npc.ts              # NPC definition and instance types
      mcp.ts              # MCP tool types
      session.ts          # Session management types
      security.ts         # Security and moderation types
      voice.ts            # Voice pipeline types
    providers/
      llm/
        interface.ts
        gemini.ts
      stt/
        interface.ts  
        deepgram.ts
      tts/
        interface.ts
        cartesia.ts       # Default
        elevenlabs.ts     # Alternative
        factory.ts
    security/
      sanitizer.ts
      moderator.ts
      rate-limiter.ts
      anchor-guard.ts
    core/
      memory.ts
      summarizer.ts
      personality.ts
      cycles.ts
      context.ts          # Includes knowledge injection
      knowledge.ts        # Knowledge access resolution
    session/
      manager.ts
      store.ts
    voice/
      pipeline.ts
      interruption.ts
      sentence-detector.ts
    mcp/
      registry.ts
      validator.ts
      exit-handler.ts
    storage/
      interface.ts
      projects.ts         # Project CRUD
      definitions.ts      # NPC definition CRUD
      instances.ts        # Instance storage with history
      knowledge.ts        # Knowledge base storage
      secrets.ts          # Encrypted API key storage
    routes/
      projects.ts         # Project management
      knowledge.ts        # Knowledge base CRUD
      npcs.ts             # NPC definition CRUD
      session.ts          # Session lifecycle
      conversation.ts     # Chat within session
      cycles.ts           # Update cycle endpoints
      history.ts          # Instance history/rollback
    ws/
      handler.ts
  web/                    # Frontend
  data/
    projects/
      {project_id}/
        project.yaml
        secrets.enc
        knowledge_base.yaml
        definitions/
          {npc_id}.yaml
        instances/
          {instance_id}/
            current.json
            history/
```

---

## Phase 1: Foundation

**Goal:** Project setup, types, config, logging. No functionality yet.

### 1.1 Project Initialization

- [*] Initialize project with `bun init` or `npm init`
- [*] Configure tsconfig.json with strict mode, ES2022 target
- [*] Install core dependencies: hono, zod, pino, pino-pretty, ws, yaml
- [*] Create folder structure as shown above
- [*] Add .env.example:

```
PORT=3000
LOG_LEVEL=info
DATA_DIR=./data
ENCRYPTION_KEY=...
SESSION_TIMEOUT_MS=1800000
STATE_HISTORY_ENABLED=true
STATE_HISTORY_MAX_VERSIONS=10
```

### 1.2 Logger Setup

Create `src/logger.ts`:

- [*] Initialize Pino with JSON output
- [*] Support LOG_LEVEL from env (default: info)
- [*] Export child logger factory: `createLogger(name: string)`
- [*] Include base fields: service name, version
- [*] Add request ID generation utility

### 1.3 Config Module

Create `src/config.ts`:

- [*] Load environment variables
- [*] Define config schema with Zod, validate on load
- [*] Export typed config object
- [*] Include security config: rate limits, max input length
- [*] Include session config: timeout duration
- [*] Include storage config: data dir, history settings
- [*] Include limits: max NPCs per project, max categories, etc.

### 1.4 Core Types

Create `src/types/project.ts`:

- [*] Define ProjectID type: string
- [*] Define ProjectSettings interface: llm_provider, stt_provider, tts_provider, default_voice_id, timeouts
- [*] Define ProjectLimits interface: max_npcs, max_categories, max_concurrent_sessions
- [*] Define Project interface: id, name, created_at, settings, limits

Create `src/types/knowledge.ts`:

- [*] Define KnowledgeCategory interface: id, description, depths (Record<number, string>)
- [*] Define KnowledgeBase interface: categories (Record<string, KnowledgeCategory>)
- [*] Define KnowledgeAccess type: Record<string, number> (category -> depth level)

Create `src/types/npc.ts`:

- [*] Define CoreAnchor interface: backstory, principles, trauma_flags
- [*] Define PersonalityBaseline interface: Big Five traits (0-1 scale)
- [*] Define MoodVector interface: valence, arousal, dominance
- [*] Define VoiceConfig interface: provider, voice_id, speed
- [*] Define ScheduleBlock interface: start, end, location_id, activity
- [*] Define MCPPermissions interface: conversation_tools, game_event_tools, denied
- [*] Define NPCDefinition interface: id, project_id, name, description, core_anchor, personality_baseline, voice, schedule, mcp_permissions, knowledge_access
- [*] Define Memory interface: id, content, timestamp, salience, type
- [*] Define RelationshipState interface: trust, familiarity, sentiment
- [*] Define DailyPulse interface: mood, takeaway, timestamp
- [*] Define CycleMetadata interface: last_weekly, last_persona_shift
- [*] Define NPCInstance interface: id, definition_id, project_id, player_id, created_at, current_mood, trait_modifiers, short_term_memory, long_term_memory, relationships, daily_pulse, cycle_metadata

Create `src/types/session.ts`:

- [*] Define SessionID type: string (UUID)
- [*] Define SessionState interface: session_id, project_id, definition_id, instance, conversation_history, created_at, last_activity, player_id
- [*] Define SessionInitRequest interface: project_id, npc_id, player_id
- [*] Define SessionEndResponse interface: success, version

Create `src/types/security.ts`:

- [*] Define SanitizationResult, ModerationResult, SecurityContext interfaces

Create `src/types/voice.ts`:

- [*] Define VoiceConfig, AudioChunk, TranscriptEvent, TTSChunk interfaces

Create `src/types/mcp.ts`:

- [*] Define Tool, ToolCall, ToolResult, ToolPermission interfaces

**Checkpoint:** Types compile without errors.

---

## Phase 2: Security Foundation

**Goal:** Security modules that will wrap all inputs.

### 2.1 Input Sanitizer

Create `src/security/sanitizer.ts`:

- [*] Implement `sanitize(input: string): SanitizationResult`
- [*] Enforce max length (default 500)
- [*] Strip injection patterns
- [*] Log violations at warn level

### 2.2 Rate Limiter

Create `src/security/rate-limiter.ts`:

- [*] Implement sliding window rate limiter
- [*] Key by `${project_id}:${player_id}:${npc_id}`
- [*] Configurable limit (default: 10/min)
- [*] In-memory store with TTL cleanup

### 2.3 Content Moderator

Create `src/security/moderator.ts`:

- [*] Implement `moderate(input: string): Promise<ModerationResult>`
- [*] Keyword-based check (expandable to LLM-based)
- [*] Return action: none, warn, exit
- [*] Log flagged content

### 2.4 Anchor Guard

Create `src/security/anchor-guard.ts`:

- [*] Implement `validateAnchorIntegrity(original, current): boolean`
- [*] Implement `enforceAnchorImmutability(state, originalAnchor): NPCState`

**Checkpoint:** Security modules work standalone.

---

## Phase 3: Provider Abstraction

**Goal:** Streaming wrappers for LLM, STT, TTS.

### 3.1 LLM Provider

Create `src/providers/llm/interface.ts` and `src/providers/llm/gemini.ts`:

- [*] Define LLMProvider interface with streamChat()
- [*] Implement Gemini streaming with function calling
- [*] Handle AbortSignal for cancellation

### 3.2 STT Provider

Create `src/providers/stt/interface.ts` and `src/providers/stt/deepgram.ts`:

- [*] Define STTProvider interface with createSession()
- [*] Implement Deepgram WebSocket live transcription
- [*] Handle reconnection with backoff

### 3.3 TTS Providers

Create `src/providers/tts/interface.ts`, `cartesia.ts`, `elevenlabs.ts`, `factory.ts`:

- [*] Define TTSProvider interface with createSession()
- [*] Implement Cartesia WebSocket streaming (default)
- [*] Implement ElevenLabs WebSocket streaming (alternative)
- [*] Factory to select provider based on project settings

**Checkpoint:** Providers connect and stream independently.

---

## Phase 4: Storage Layer

**Goal:** File-based storage for projects, definitions, instances, knowledge.

### 4.1 Project Storage

Create `src/storage/projects.ts`:

- [*] Implement `createProject(name: string): Promise<Project>`
  - [*] Generate project ID
  - [*] Create directory structure
  - [*] Write project.yaml with defaults
  - [*] Return project
- [*] Implement `getProject(projectId: string): Promise<Project>`
- [*] Implement `updateProject(projectId: string, updates: Partial<Project>): Promise<Project>`
- [*] Implement `deleteProject(projectId: string): Promise<void>`
- [*] Implement `listProjects(): Promise<Project[]>`

### 4.2 Secrets Storage

Create `src/storage/secrets.ts`:

- [*] Implement `saveApiKeys(projectId: string, keys: ApiKeys): Promise<void>`
  - [*] Encrypt with ENCRYPTION_KEY
  - [*] Write to secrets.enc
- [*] Implement `loadApiKeys(projectId: string): Promise<ApiKeys>`
  - [*] Decrypt and return

### 4.3 Knowledge Base Storage

Create `src/storage/knowledge.ts`:

- [*] Implement `getKnowledgeBase(projectId: string): Promise<KnowledgeBase>`
- [*] Implement `updateKnowledgeBase(projectId: string, kb: KnowledgeBase): Promise<void>`
- [*] Validate category and depth structure

### 4.4 NPC Definition Storage

Create `src/storage/definitions.ts`:

- [*] Implement `createDefinition(projectId: string, def: NPCDefinition): Promise<NPCDefinition>`
  - [*] Generate NPC ID
  - [*] Validate against project limits
  - [*] Write YAML file
- [*] Implement `getDefinition(projectId: string, npcId: string): Promise<NPCDefinition>`
- [*] Implement `updateDefinition(projectId: string, npcId: string, updates): Promise<NPCDefinition>`
- [*] Implement `deleteDefinition(projectId: string, npcId: string): Promise<void>`
- [*] Implement `listDefinitions(projectId: string): Promise<NPCDefinition[]>`

### 4.5 Instance Storage with History

Create `src/storage/instances.ts`:

- [*] Implement `getInstance(instanceId: string): Promise<NPCInstance>`
- [*] Implement `getOrCreateInstance(projectId, npcId, playerId): Promise<NPCInstance>`
  - [*] Check if instance exists for this player
  - [*] If not, create from definition
- [*] Implement `saveInstance(instance: NPCInstance): Promise<{ version: string }>`
  - [*] If history enabled, archive current.json
  - [*] Write new current.json
  - [*] Prune old history
- [*] Implement `getInstanceHistory(instanceId: string): Promise<StateVersion[]>`
- [*] Implement `rollbackInstance(instanceId: string, version: string): Promise<NPCInstance>`

**Checkpoint:** Full CRUD for projects, definitions, instances works.

---

## Phase 5: Core NPC Logic

**Goal:** Memory, personality, context assembly, knowledge injection.

### 5.1 Knowledge Resolver

Create `src/core/knowledge.ts`:

- [*] Implement `resolveKnowledge(knowledgeBase: KnowledgeBase, access: KnowledgeAccess): string`
  - [*] For each category in access
  - [*] Include all depths up to access level
  - [*] Concatenate into knowledge string

### 5.2 Memory System

Create `src/core/memory.ts`:

- [*] Implement Memory creation with ID and timestamp
- [*] Implement salience scoring
- [*] Implement STM/LTM retrieval
- [*] Implement memory pruning (STM: 20, LTM: 50)

### 5.3 Memory Summarizer

Create `src/core/summarizer.ts`:

- [*] Implement `summarizeConversation(history, npcPerspective): Promise<string>`
- [*] LLM prompt for 2-3 sentence summary from NPC perspective
- [*] No direct quotes (injection filtering)

### 5.4 Personality Engine

Create `src/core/personality.ts`:

- [*] Implement trait modifier application (bounds: -0.3 to +0.3)
- [*] Implement mood influence on behavior
- [*] Generate personality description for prompt

### 5.5 Context Assembly

Create `src/core/context.ts`:

- [*] Implement `assembleSystemPrompt(definition, instance, knowledge, securityContext): string`
  - [*] Core Anchor injection
  - [*] Active personality (baseline + modifiers)
  - [*] Current mood
  - [*] Knowledge (resolved from access)
  - [*] Relevant memories
  - [*] Relationship with player
  - [*] Exit instruction if security flagged
- [*] Implement `assembleConversationHistory(history, budget): Message[]`

### 5.6 Tool Assembly

Create `src/core/tools.ts`:

- [*] Implement `getAvailableTools(definition, securityContext): Tool[]`
- [*] Filter by NPC permissions
- [*] Add exit_convo if needed

**Checkpoint:** Core logic produces correct prompts with knowledge.

---

## Phase 6: Session Management

**Goal:** Session lifecycle with in-memory state.

### 6.1 Session Store

Create `src/session/store.ts`:

- [ ] In-memory Map<SessionID, SessionState>
- [ ] CRUD operations
- [ ] Track active session count per project

### 6.2 Session Manager

Create `src/session/manager.ts`:

- [ ] Implement `startSession(projectId, npcId, playerId): Promise<SessionStartResult>`
  - [ ] Load project and validate
  - [ ] Load definition
  - [ ] Load API keys
  - [ ] Get or create instance
  - [ ] Load knowledge base
  - [ ] Cache original anchor
  - [ ] Create session in store
  - [ ] Return session_id, npc_name, mood
- [ ] Implement `endSession(sessionId): Promise<SessionEndResult>`
  - [ ] Summarize conversation, create memory (unless exit_convo)
  - [ ] Update mood
  - [ ] Validate anchor integrity
  - [ ] Save instance (with history)
  - [ ] Delete from store
- [ ] Implement timeout cleanup

**Checkpoint:** Sessions can be created and ended. State persists.

---

## Phase 7: API Routes

**Goal:** REST endpoints for all operations.

### 7.1 Project Routes

Create `src/routes/projects.ts`:

- [ ] POST /api/projects - Create project (from homepage)
- [ ] GET /api/projects/:projectId
- [ ] PUT /api/projects/:projectId
- [ ] PUT /api/projects/:projectId/keys - Update API keys
- [ ] DELETE /api/projects/:projectId

### 7.2 Knowledge Routes

Create `src/routes/knowledge.ts`:

- [ ] GET /api/projects/:projectId/knowledge
- [ ] PUT /api/projects/:projectId/knowledge

### 7.3 NPC Definition Routes

Create `src/routes/npcs.ts`:

- [ ] POST /api/projects/:projectId/npcs
- [ ] GET /api/projects/:projectId/npcs
- [ ] GET /api/projects/:projectId/npcs/:npcId
- [ ] PUT /api/projects/:projectId/npcs/:npcId
- [ ] DELETE /api/projects/:projectId/npcs/:npcId

### 7.4 Session Routes

Create `src/routes/session.ts`:

- [ ] POST /api/session/start - { project_id, npc_id, player_id }
- [ ] POST /api/session/:sessionId/end
- [ ] GET /api/session/:sessionId (debug)

### 7.5 Conversation Routes

Create `src/routes/conversation.ts`:

- [ ] POST /api/session/:sessionId/message
  - [ ] Security pipeline
  - [ ] Context assembly with knowledge
  - [ ] LLM call
  - [ ] Tool handling
  - [ ] Update session state

### 7.6 Update Cycle Routes

Create `src/routes/cycles.ts`:

- [ ] POST /api/instances/:instanceId/daily-pulse
- [ ] POST /api/instances/:instanceId/weekly-whisper
- [ ] POST /api/instances/:instanceId/persona-shift

### 7.7 History Routes

Create `src/routes/history.ts`:

- [ ] GET /api/instances/:instanceId/history
- [ ] POST /api/instances/:instanceId/rollback

### 7.8 MCP Handling

Create `src/mcp/registry.ts`, `validator.ts`, `exit-handler.ts`:

- [ ] Tool registry with schemas
- [ ] Validation against schema
- [ ] exit_convo special handling

**Checkpoint:** Full REST API works. Text conversation functional.

---

## Phase 8: Voice Pipeline

**Goal:** Real-time voice over WebSocket.

### 8.1 Voice Pipeline Class

Create `src/voice/pipeline.ts`:

- [ ] VoicePipeline class with STT/TTS sessions
- [ ] pushAudio() -> STT
- [ ] onTranscript -> processTurn
- [ ] processTurn: security -> context (with knowledge) -> LLM -> TTS
- [ ] handleInterruption: abort LLM, flush TTS

### 8.2 Sentence Detector

Create `src/voice/sentence-detector.ts`:

- [ ] Accumulate tokens until sentence boundary
- [ ] Handle edge cases (Dr., Mr., decimals)

### 8.3 WebSocket Handler

Create `src/ws/handler.ts`:

- [ ] Handle /ws/voice?project_id=...
- [ ] Messages: init, audio, commit, interrupt, text, end
- [ ] Outbound: ready, transcript, text_chunk, audio_chunk, tool_call, generation_end, sync, error

### 8.4 Audio Utilities

Create `src/voice/audio.ts`:

- [ ] Base64 encode/decode
- [ ] PCM format handling
- [ ] Sample rate validation

**Checkpoint:** Voice conversation works end-to-end.

---

## Phase 9: Web Test UI

**Goal:** Browser-based interface.

### 9.1 Homepage

- [ ] "Create Project" button
- [ ] Project ID generated immediately
- [ ] Redirect to project dashboard

### 9.2 Project Dashboard

- [ ] Display project info
- [ ] API key configuration form
- [ ] Provider selection
- [ ] Link to NPC editor
- [ ] Link to Knowledge Base editor
- [ ] Link to Testing Playground

### 9.3 Knowledge Base Editor

- [ ] List categories
- [ ] Add/edit/delete categories
- [ ] Depth tier content editor
- [ ] NPC access overview (which NPC knows what)

### 9.4 NPC Editor

- [ ] List NPCs in project
- [ ] Create new NPC
- [ ] Edit NPC definition:
  - [ ] Name, description
  - [ ] Core Anchor (backstory, principles)
  - [ ] Personality sliders (Big Five)
  - [ ] Voice config with preview
  - [ ] Schedule builder
  - [ ] Tool permissions
  - [ ] Knowledge access (checkboxes per category with depth dropdown)

### 9.5 Testing Playground

- [ ] Select NPC to test
- [ ] Text chat interface
- [ ] Voice chat with @ricky0123/vad-web
- [ ] Mood indicator
- [ ] Tool call display
- [ ] Trigger update cycles
- [ ] View instance state

**Checkpoint:** Full web UI functional.

---

## Phase 10: Deployment

**Goal:** Production-ready on Render.

### 10.1 Docker Configuration

- [ ] Dockerfile (Bun base)
- [ ] Multi-stage build
- [ ] Health check endpoint
- [ ] Non-root user

### 10.2 Render Configuration

- [ ] render.yaml
- [ ] WebSocket support
- [ ] Environment variables
- [ ] Persistent disk for data/

### 10.3 Production Hardening

- [ ] CORS configuration
- [ ] Request logging
- [ ] Error tracking

### 10.4 Monitoring

- [ ] GET /health endpoint
- [ ] Log aggregation

**Checkpoint:** Application runs in production.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────────────┐  │
│  │   Browser   │  │   Unity     │  │  VAD: @ricky0123/vad-web (browser)  │  │
│  │   Web UI    │  │   (Future)  │  │       Silero+Sentis (Unity)         │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────────────────┘  │
│         └────────────────┴───────────────────────────────────────────────┐  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                          WebSocket (voice) / REST (text)
                                       │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EVOLVE.NPC SERVER                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        SECURITY PIPELINE                                │ │
│  │  Sanitizer -> Rate Limiter -> Moderator -> Anchor Guard                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       CONTEXT ASSEMBLY                                  │ │
│  │  Core Anchor + Personality + Mood + Knowledge + Memories               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         VOICE PIPELINE                                  │ │
│  │   Audio -> Deepgram STT -> LLM (Gemini) -> Cartesia TTS -> Audio       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────────┐   │
│  │  SessionStore   │  │  Storage        │  │  Project/Knowledge/       │   │
│  │  (RAM)          │  │  (with history) │  │  Definition/Instance      │   │
│  └─────────────────┘  └─────────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLIENT                                      │
│  { project_id, npc_id, player_id }                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION START                                 │
│  1. Load project config and API keys                            │
│  2. Load NPC definition                                         │
│  3. Load knowledge base                                         │
│  4. Get or create instance for player                           │
│  5. Cache original anchor                                       │
│  6. Create session in RAM                                       │
│  7. Send { type: 'ready', session_id, npc_name }               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONVERSATION LOOP                             │
│                                                                  │
│  processTurn:                                                    │
│    1. Security pipeline                                          │
│    2. Resolve knowledge (category -> depth -> content)          │
│    3. Assemble context with knowledge                            │
│    4. LLM streaming                                              │
│    5. TTS streaming (sentence-by-sentence)                       │
│    6. Update session state in RAM                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION END                                   │
│  1. Close voice pipeline                                        │
│  2. Summarize conversation -> create Memory                     │
│  3. Update mood                                                 │
│  4. Validate anchor integrity                                   │
│  5. Save instance (archive previous version)                    │
│  6. Delete from RAM                                             │
│  7. Send { type: 'sync', success, version }                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Coding Standards

### Error Handling

- [ ] All provider calls wrapped in try-catch
- [ ] Typed error classes: ProviderError, ValidationError, StateError, SecurityError
- [ ] Never swallow errors silently
- [ ] Graceful degradation: TTS fails -> text only

### Logging

- [ ] Child loggers per module
- [ ] Levels: error, warn, info, debug
- [ ] Timing for external calls
- [ ] Redact player content
- [ ] Security events at warn+

### TypeScript

- [ ] Strict mode
- [ ] No `any` types
- [ ] Zod for runtime validation
- [ ] AsyncIterable for streaming
- [ ] Functions under 30 lines

---

## Progress Tracking

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation | Complete |
| 2 | Security Foundation | Complete |
| 3 | Provider Abstraction | Complete |
| 4 | Storage Layer | Complete |
| 5 | Core NPC Logic | Complete |
| 6 | Session Management | Not Started |
| 7 | API Routes | Not Started |
| 8 | Voice Pipeline | Not Started |
| 9 | Web Test UI | Not Started |
| 10 | Deployment | Not Started |

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| No auth for MVP | "Create Project" on homepage, no signup required |
| Project-scoped | All NPCs, knowledge, settings within project boundary |
| Knowledge depth tiers | NPCs know different things at different detail levels |
| Definition vs Instance | Templates reused, instances evolve per-player |
| Transient sessions | RAM during conversation, persist only on end |
| State history | Git-like versioning for rollback |
| Cartesia default TTS | 40ms latency, cost-effective |
| Custom WebSocket | Not LiveKit rooms - simpler, no cloud dependency |
| Client-side VAD | Saves bandwidth, instant interruption |

---

## Future Enhancements

- User accounts and authentication
- Team collaboration per project
- NPC Health Dashboard
- Unity SDK
- Usage billing

---

## Limits (Initial)

| Resource | Limit |
|----------|-------|
| NPCs per project | 10 |
| Knowledge categories | 20 |
| Depth tiers per category | 5 |
| Concurrent sessions | 100 |
| State history versions | 10 |
| STM memories | 20 |
| LTM memories | 50 |