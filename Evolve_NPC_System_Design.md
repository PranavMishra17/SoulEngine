# SoulEngine (Evolve.NPC)

**NPCs with memory, motive, and agency.**

> Stateless NPC intelligence with layered memory cycles, personality evolution, multi-modal voice interaction, and MCP-based agency in game environments.

---

SoulEngine is a TypeScript framework for creating game characters that remember player interactions, evolve their personalities over time, speak with their own voices, and take actions in the game world. No persistent processes, no complex databases. NPCs are YAML files that become intelligent when queried against an LLM. Talk to them via text or voice (or any combination), they respond in kind through integrated STT/TTS pipelines. Define a character's childhood, principles, and personality once. The system handles the rest: forming memories, forgetting trivia, holding grudges, building relationships, and deciding when to call the cops on a threatening player. MCP-based tool system lets NPCs act on their decisions: lock doors, refuse service, alert guards, flee danger.

**Core Features:**
- **Multi-provider LLM support**: Gemini, OpenAI, Anthropic Claude, xAI Grok
- **Flexible conversation modes**: Text-Text, Voice-Voice, Text-Voice, Voice-Text
- **Player identity system**: NPCs can recognize and remember players
- **Per-NPC memory retention**: Smart NPCs remember more, simpletons forget
- **NPC profile pictures**: Visual identification in UI
- **Dual storage backends**: Local filesystem (dev) + Supabase (production)
- **BYOK security**: Per-project API key isolation with Game Client authentication
- **Full version history**: NPC definitions and mind states are versioned and rollback-able

Characters that listen, think, speak, and do.

---

## Core Vision

A lightweight, LLM-driven architecture that transforms static game NPCs into genuinely evolving entities. Unlike traditional scripted characters, these NPCs develop over time through player interactions, game events, and internal psychological cycles that mirror human memory formation and decay.

The system operates on a fundamental insight: **humans don't remember everything**. We forget trivia, form habits through repetition, hold grudges from betrayals, and rarely change our core beliefs except through profound experiences. SoulEngine replicates these patterns through five interconnected psychological layers.

---

## The Five Pillars

### 1. Core Anchor (Immutable)

Psychological DNA that never changes. A 100-200 token backstory encoding the character's fundamental worldview, childhood context, and 3-5 unbreakable principles. This foundation is **permanently immutable** — no trauma flags or milestone events can modify it. The anchor ensures characters remain recognizable across hundreds of interactions.

```
core_anchor: {
  backstory: string,
  principles: string[],
  trauma_flags: string[]  // For narrative tracking only, does NOT modify anchor
}
```

A village elder who witnessed war as a child will carry that perspective forever. A merchant raised on honesty will struggle to lie even under pressure. The Core Anchor is enforced at both the cycle logic layer and storage layer — belt and suspenders.

**Name Tolerance:** NPCs are instructed to be forgiving about slight name mispronunciations from STT transcription. A player saying "Slop" when the NPC's name is "Slorp" won't trigger frustration — the NPC assumes good intent and interprets close phonetic matches as their actual name.

### 2. Daily Pulse

Lightweight emotional state captured at session or day boundaries. Two components: a mood vector representing current emotional state, and a single-sentence takeaway from the day's events. Creates behavioral continuity across short timespans.

```
daily_pulse: {
  mood: MoodVector,
  takeaway: string,
  timestamp: ISO8601
}
```

The barista who had a rough morning carries irritability into afternoon interactions. The guard who received good news is more lenient at the gate. Small emotional threads that make characters feel present in time.

**Token cost: ~200 tokens.** Accepts optional game context (events list, overall mood, notable interactions) to give the NPC narrative grounding without requiring direct player input.

### 3. Weekly Whisper

Short-term memory curation with **cyclic pruning and LLM synthesis**. Most interactions fade, but emotionally significant events persist based on salience scoring. This is a **replacement** operation, not append. The system retains configurable N memories per cycle, aggressively discarding the rest.

**Two-stage memory pipeline:**

1. **Prune:** Sort STM by salience. Keep top N (default: 3), discard the rest.
2. **Synthesize:** Run high-salience STM entries through an LLM to produce condensed, insight-level LTM entries. Multiple raw session memories are compressed into a single meaningful observation. Synthesized entries receive elevated salience (`avg + 0.1`, capped at 0.95).
3. **Promote:** Move synthesized memories to LTM. Remove promoted entries from STM (no duplication).

```
weekly_whisper: {
  retained_memories: Memory[],  // Replaces previous STM, not appends
  ltm_entries: Memory[],        // Synthesized long-term memories
  last_run: ISO8601
}
```

**Per-NPC Memory Retention:**

Each NPC has a configurable `salience_threshold` (0.0-1.0) that controls how well they remember:

| Memory Retention | Threshold | Behavior |
|-----------------|-----------|----------|
| 80-100% (Genius) | 0.35-0.47 | Remembers small details, 2-sentence summaries |
| 40-60% (Average) | 0.59-0.71 | Standard memory retention, 1-sentence summaries |
| 0-20% (Dimwit) | 0.83-0.95 | Struggles to recall, brief summaries |

**Telephone Game Logic:** Session raw dialogue → summarized STM entry → weekly synthesis → condensed LTM. Old raw data is aggressively discarded at each stage. Only high-salience insights persist long-term.

**Token cost: ~500 tokens.**

### 4. Persona Shift

Major personality recalibration triggered at developer-defined intervals. The system reviews accumulated experiences (LTM), cross-references against the Core Anchor, and modifies active personality traits within bounded limits. Friendships deepen or dissolve. New habits form. Tone shifts naturally.

```
persona_shift: {
  trait_modifications: TraitDelta[],
  relationship_changes: RelDelta[],
  last_run: ISO8601
}
```

The interval is entirely game-dependent. A survival game might trigger shifts after each in-game month. A social sim might run them weekly. A noir detective story might reserve shifts for act breaks.

**Important:** Persona Shift can modify personality traits but NEVER the Core Anchor. Any LLM suggestions to modify the anchor are logged and ignored. Trait changes are bounded to [-0.1, +0.1] per cycle.

**Token cost: ~1000 tokens.**

### 5. Player Identity & Network

NPCs can recognize players before conversation starts. Developers configure whether an NPC "knows" the player:

```
player_recognition: {
  reveal_player_identity: boolean,  // Include player info in NPC context
}
```

When a session starts with player info provided, the NPC's system prompt includes:
- Player's name (so NPC can address them)
- Description (what the NPC sees)
- Role and context (relationship notes)

**NPC Social Graph (Network):**

Each NPC has a network of relationships with other NPCs, with tiered familiarity:

| Tier | Label | Information Shared |
|------|-------|-------------------|
| 1 | Acquaintance | Name + brief description |
| 2 | Familiar | + backstory + schedule/location |
| 3 | Close | + personality traits + principles + trauma flags |

Networks support **bidirectional awareness**: "You know them, and they know you back" (mutual) or "You know of them (famous), but they don't know you" (reverse context only).

### 6. MCP Action Layer

NPCs don't just talk. They act. Through Model Context Protocol tools, characters execute world actions with real consequences. Three distinct tool categories with two decision authorities:

**Conversation Tools** (project-defined): Decided by the **Mind instance** (see Section 7) during its sequential agent loop (Mind runs before Speaker). A player threatens the barista. The Mind decides to call the police. The decision emerges from the character's personality, current mood, and relationship with the player. The Speaker never sees or invokes these tools directly — it receives the Mind's tool results as context.

**Game-Event Tools**: Game logic invokes directly, bypassing LLM entirely. An explosion triggers a flee response. Same tool interface, different decision authority. These remain unchanged by the dual-instance architecture.

**`exit_convo`**: A special built-in tool handled by the **Mind instance**. Injected only when moderation flags inappropriate content, allowing the NPC to end conversation gracefully while staying in character.

```
mcp_registry: {
  call_police: { params: { location: string, urgency: 1-10 } },
  refuse_service: { params: { target: string, duration: number } },
  flee_to: { params: { location_id: string } },
  lock_door: { params: { door_id: string } },
  alert_guards: { params: { threat_level: number } },
  exit_convo: { params: { reason: string } }  // Security escape hatch (Mind-only)
}
```

### 7. The NPC Mind (Sequential Mind -> Speaker Architecture)

Every conversation turn runs two LLM roles **sequentially**: a **Mind** that thinks first with full tool access, then a **Speaker** that generates a unified response informed by the Mind's results. This produces natural, cohesive NPC responses where tool actions and recalled knowledge are woven into a single utterance.

#### Mind (runs first)

The Mind operates as a single-step agent loop: the LLM decides which tools to call, the server executes them, and the results are formatted as `tool_context` for the Speaker. The Mind does NOT generate spoken dialogue — it only decides and acts.

The Mind has access to **all tools**, organized into two categories:

**Recall Tools** (built-in, always available):
- `recall_npc` -- Retrieve another NPC's information from the social network (tiers 2-3 details)
- `recall_knowledge` -- Search the project's knowledge base by category and depth
- `recall_memories` -- Search STM and LTM for relevant memories by keyword/topic

**Conversation Tools** (project-defined):
- All tools from the project's `mcp_registry` (e.g., `warn_player`, `call_police`, `refuse_service`)
- `exit_convo` -- End the conversation (injected when moderation flags content)

**Game-Event Tools** remain unchanged -- they are triggered by game code, not by the Mind.

#### Speaker (runs second)

The Speaker is the NPC's conversational voice. It receives a **slim context window** augmented with the Mind's `tool_context`:
- Core Anchor (backstory, principles)
- Tier 1 network entries (acquaintance-level: names and brief descriptions only)
- Current mood vector and daily pulse
- Conversation history
- Player identity (if configured)
- **[MIND CONTEXT]** block with tool results (injected by `augmentPromptWithMindContext()`)

The Speaker has **no tools**. Its job is to produce an in-character conversational response that naturally incorporates the Mind's findings and actions. If the Mind recalled knowledge, the Speaker uses it. If the Mind called `request_credentials`, the Speaker acknowledges it conversationally.

#### Sequential Flow

```
Player says something
    |
    v
[MIND] Full context + all tools -> Agent loop:
    |
    v
LLM decides: call tool(s) or return NO_ACTION
    |
    v
Server executes tool(s), returns results as tool_context
    |
    v
[SPEAKER] Slim context + Mind's tool_context -> Unified response streamed to client
    |
    v
Single generation_end emitted
```

#### Always On

The Mind runs on **every turn**, not selectively. When there is nothing to act on (no relevant memories to recall, no tools to invoke), it returns NO_ACTION and the Speaker runs with its base prompt. The Mind NO_ACTION path is fast (~1-2s), keeping total latency acceptable.

The `mind_model` configuration allows using a cheaper or faster model for the Mind instance (e.g., `gemini-2.0-flash` or `gpt-4o-mini`), keeping per-turn cost low.

#### Graceful Degradation

If the Mind times out (voice: 8s cap, text: `mind_timeout_ms` default 15s) or encounters an error, the Speaker runs with its base prompt (no Mind context). Partial Mind results (tools that completed before timeout) are still included in the tool_context. The conversation continues normally.

#### Unified Response

Since Mind runs before Speaker, there is no separate follow-up phase. The Speaker's output is the single, complete NPC response for the turn, stored as one assistant message in conversation history.

#### Token Cost Estimates

| Component | Tokens | Notes |
|-----------|--------|-------|
| Speaker prompt | ~3,500 | Slim context: anchor, Tier 1 network, mood, history |
| Mind (no action) | ~500 | Returns empty, minimal overhead |
| Mind (with tools) | ~2,000-3,000 | Agent loop with recall or conversation tools |
| **Per-turn total** | ~4,000-6,500 | Compared to ~7,000+ for single-instance with full context |

Estimated savings vs single-instance architecture: **29-57% per turn** depending on Mind activity, since the Speaker avoids paying for tool definitions, full network context, and knowledge retrieval on every call.

---

## Architecture

### Transient Session Model

**Critical Design Decision:** The backend is **stateful during conversations** but **stateless between conversations**.

When a conversation begins, the NPC's JSON state is "hydrated" into an ephemeral in-memory session. All state changes (mood updates, STM additions, conversation history) happen in RAM. Persistence (writing to storage) happens **only on session_end** or explicit force_save.

```
Session Lifecycle:
1. START  -> Client requests NPC -> Server loads from storage, caches in RAM with SessionID
2. CHAT   -> SessionID -> Speaker responds (slim context, no tools)
                       -> Mind runs parallel (agent loop with all tools)
                       -> Follow-up streamed after Speaker
3. END    -> Server summarizes, updates state -> Writes to storage -> Archives version -> Dumps RAM
```

**Trade-off acknowledged:** If connection drops or player force-quits before "End" signal, that conversation's memory is lost. This is acceptable for most game scenarios and dramatically simplifies the architecture.

**Scalability:** 1000 concurrent NPCs = 1000 open WebSockets. Node/Bun handles this trivially. No database writes during conversation. No per-NPC background processes.

### Dual Storage Backend

The system runs identically in two storage modes, selected automatically at startup:

| Mode | When | Storage |
|------|------|---------|
| **Local** | Development (`NODE_ENV != production` or no Supabase env) | Filesystem: `./data/` |
| **Supabase** | Production (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set) | PostgreSQL via Supabase |

`getStorageForUser(userId)` returns the appropriate backend based on authentication context. Authenticated dashboard users always get Supabase; unauthenticated local dev gets filesystem. All storage operations have identical interfaces in both backends.

### Instance State with Version History

Every NPC instance (a specific NPC-player pair) has full version history. On every `saveInstance()` call, the previous state is archived before the new one is written.

```
Local:
data/instances/{instance_id}/
  current.json          # Latest state
  history/
    {timestamp}.json    # v1
    {timestamp}.json    # v2
    ...

Supabase:
npc_instance_history table:
  instance_id TEXT
  version     INTEGER
  state       JSONB     # Full NPCInstance snapshot
  timestamp   TIMESTAMPTZ
```

This happens on every **session end**, **daily pulse**, **weekly whisper**, and **persona shift**. The UI exposes all versions and supports rollback to any prior state.

### State Flow

```
SERVER STORAGE                    SERVER RAM                      CLIENT
     |                                 |                              |
     |  [Load on session start]        |                              |
     |------------------------------->|                              |
     |                                 |  [Hydrate session]           |
     |                                 |----------------------------->|
     |                                 |  { type: 'ready' }           |
     |                                 |                              |
     |                                 |  [Conversation loop]         |
     |                                 |<---------------------------->|
     |                                 |  (all changes in RAM)        |
     |                                 |                              |
     |                                 |  [Session end]               |
     |  [Write + archive version]      |<-----------------------------|
     |<-------------------------------|  { type: 'end' }             |
     |                                 |                              |
     |                                 |  [Return sync]               |
     |                                 |----------------------------->|
     |                                 |  { type: 'sync', success }   |
```

### I/O Agnostic Mind

The NPC cognitive core is completely decoupled from input/output modalities. Text, audio, or multimodal inputs all normalize to text before reaching the "mind". Responses are text that can be output directly or routed through TTS.

The same NPC definition works across web testing (text), voice demos (audio), and game integration (either). Configuration happens per session, not per NPC.

---

## The Voice Pipeline

We use **LiveKit's TypeScript SDK** for STT/TTS integration patterns and audio utilities, but **NOT** their agent worker or room-based architecture. Instead, we implement a custom VoicePipeline class over standard WebSocket connections for maximum control and scalability.

### Conversation Modes

The pipeline supports four conversation modes, enabling flexible input/output combinations:

| Mode | Input | Output | Use Case |
|------|-------|--------|----------|
| `text-text` | Keyboard | Text | Chat interfaces, accessibility |
| `voice-voice` | Microphone | Speakers | Full voice conversations |
| `text-voice` | Keyboard | Speakers | Type to NPC, hear response |
| `voice-text` | Microphone | Text | Speak to NPC, read response |

```typescript
// Mode-aware resource initialization
async initialize(): Promise<void> {
  if (this.mode.input === 'voice') await this.initializeSTT();
  if (this.mode.output === 'voice') await this.initializeTTS();
}
```

### Why Custom WebSocket Over LiveKit Rooms

- **No Room Overhead:** LiveKit's room model is designed for multi-party video calls. NPC conversations are 1-on-1.
- **No Cloud Dependency:** Our WebSocket approach works with any deployment, no LiveKit Cloud required.
- **Simpler Load Balancing:** Standard WebSocket connections are trivial to load balance.
- **Full Control:** We control interruption handling, turn detection, and state management.

### What We Use From LiveKit

- **@livekit/agents-plugins-deepgram**: STT streaming patterns and Deepgram integration
- **@livekit/agents-plugins-cartesia**: TTS streaming patterns (Cartesia as default)
- **Audio utilities**: PCM handling, resampling, buffer management
- **Turn detection patterns**: VAD integration approaches

### Pipeline Architecture

```typescript
class VoicePipeline {
  private sttStream: DeepgramLiveClient;
  private ttsStream: CartesiaWebSocket;
  private mode: ConversationMode;

  private isAgentSpeaking: boolean = false;
  private abortController: AbortController;

  constructor(
    private session: Session,
    private config: VoiceConfig,
    mode: ConversationMode = { input: 'voice', output: 'voice' }
  ) {
    this.mode = mode;
    if (mode.input === 'voice') this.setupSTT();
    if (mode.output === 'voice') this.setupTTS();
  }

  public pushAudio(chunk: Buffer): void         // Audio from client (voice-* modes)
  public async handleTextInput(text: string)    // Text from client (text-* modes)
  private onTranscript(text: string, isFinal: boolean): void  // STT -> LLM
  private async processTurn(input: string)      // LLM -> TTS (if voice output)
  public handleInterruption(): void             // Cancel generation
}
```

### Streaming Flow

```
Client Audio (VAD-filtered)
    |
    v
[STT - Deepgram WebSocket]
    |
    | final transcript (aggregated, deduped)
    v
[Security Pipeline]
    |
    | sanitized input
    v
[Mind Agent Loop]        <- Decides tools, executes them, returns tool_context
    |                       (8s cap for voice, 15s for text)
    | tool_context
    v
[Context Assembly]       <- augmentPromptWithMindContext() injects Mind results
    |
    v
[Speaker LLM - Streaming] <- Unified response informed by Mind context
    |
    | token stream
    v
[Sentence Detector]
    |
    | complete sentences (tracked in spokenSentences[] for interruption)
    v
[TTS - Cartesia/ElevenLabs WebSocket]
    |
    | audio chunks
    v
Client Speaker
```

Key principle: **Mind decides, Speaker speaks**. Mind runs first with bounded timeout so tool results inform the Speaker's unified response. Speaker streams at every stage — sentence detection feeds TTS incrementally.

**Narration Stripping:** All NPC responses are post-processed before storage and playback. Parenthetical stage directions `(Osman frowns)` and asterisk actions `*sighs*` are stripped at the line level, ensuring clean dialogue output regardless of LLM tendency toward roleplay formatting. This runs on both text and voice modes.

### Barge-In / Interruption Handling

The pipeline natively supports player interruptions (barge-in) during NPC speech:
- **Client-Side:** The VAD detects if the user speaks continuously for a threshold (e.g., 1000ms) while the NPC is speaking. If triggered, the client instantly stops audio playback and sends an `interrupt` signal to the server.
- **Server-Side:** The `VoicePipeline` aborts the LLM generation and the active TTS stream, flushing all audio and sentence buffers. It then emits an `interrupted` event back to the client to confirm speech has ceased, allowing the NPC to immediately listen to the player's new input.

### TTS Provider Configuration

**Default: Cartesia** — Fastest latency (40ms), cost-effective, good voice quality.

**Available alternatives** (configurable per project):
- ElevenLabs — Premium quality, most voice variety, higher cost
- Deepgram Aura — Enterprise reliability, limited voices

```typescript
// Provider selection in project settings
llm_provider: 'gemini' | 'openai' | 'anthropic' | 'grok'
tts_provider: 'cartesia' | 'elevenlabs'
stt_provider: 'deepgram'
```

---

## Security Architecture

### Pipeline Position

```
Player Input
    |
    v
[1. INPUT SANITIZATION]     <- Max length, rate limit, pattern strip, XSS escape
    |
    v
[2. MODERATION CHECK]       <- Content policy, inject exit_convo if flagged
    |
    v
[3. LOAD NPC STATE]         <- Anchor integrity check
    |
    v
[4. CONTEXT ASSEMBLY]
    |
    v
[5. MIND AGENT LOOP]        <- Sequential: all tools (recall + conversation + exit_convo)
    |
    | tool_context
    v
[5b. LLM CALL - SPEAKER]   <- Slim context + Mind context injection, no tools
    |
    v
[6. NARRATION STRIP]        <- Remove stage directions from Speaker response
    |
    v
[7. TOOL VALIDATION]        <- Permission check on Mind tool calls, exit_convo handling
    |
    v
[8. RESPONSE STREAMING]
    |
    v
[9. MEMORY CREATION]        <- Summarize (never raw), skip if exit_convo
    |
    v
[10. STATE UPDATE & SAVE]   <- Anchor immutability enforced, version archived
```

### Security Measures

**Input Sanitization:**
- Max input length: 2000 characters (configurable)
- Rate limiting: 10 messages per minute per player per NPC
- HTML entity escaping for XSS prevention
- Pattern stripping for obvious injection attempts

**Moderation + exit_convo:**
- Content policy check targets strict out-of-character abuse (jailbreaks, slurs, political coercion)
- Normal in-game threats, violence, and manipulation do NOT trigger moderation
- If flagged: inject exit instruction, add exit_convo tool
- NPC ends conversation in-character, cooldown applied

**Immutable Core Anchors:**
- Enforced in Persona Shift logic (ignore LLM suggestions)
- Enforced at session end (anchor integrity verified against session-start snapshot)
- Trauma flags recorded for narrative tracking only

**Memory Summarization (Injection Hardening):**
- Never store raw player input — always summarize from NPC perspective
- Summarization prompt is detective-note style: capture specific facts, phrases, names
- `filterInjectionPatterns()` strips instruction-injection attempts (`ignore previous`, `[SYSTEM: ...]`) but deliberately preserves quoted phrases and content the player intended to share
- Max summary length: 500 characters

**Narration Filtering:**
- Server-side post-processing strips `(parenthetical stage directions)` and `*action asterisks*` from all LLM responses before storing or streaming to clients
- Fallback to original text if stripping removes everything (prevents empty responses)

**BYOK & Game Client Security:**
- **Bring Your Own Key (BYOK):** Developers provide their own LLM/TTS/STT API keys per project via the settings page. Keys are AES-encrypted at rest, resolved per-request via `resolveProjectLlmProvider()`.
- **Game Client API Key:** To prevent abuse of the BYOK model, external game clients must include a `x-api-key` header when initiating sessions. The key is stored as a SHA-256 hash only (never plaintext). The gate only applies to unauthenticated requests — dashboard users bypass it automatically.

---

## Update Cycles

Cycles are never auto-triggered. The host (game or web UI) explicitly calls these endpoints. This allows games to batch process during loading screens or rest sequences.

```
POST /api/instances/:instanceId/daily-pulse
  body: { game_context?: { events?, overallMood?, interactions? } }
  effect: Summarizes day, updates mood baseline, captures 1-sentence takeaway
  cost: ~200 tokens

POST /api/instances/:instanceId/weekly-whisper
  body: { retain_count?: number }
  effect: Prunes STM → LLM synthesizes to LTM → STM cleared of promoted entries
  cost: ~500 tokens

POST /api/instances/:instanceId/persona-shift
  body: {}
  effect: Major review, modifies personality traits (NOT anchor), updates relationships
  cost: ~1000 tokens
```

All cycle endpoints:
- Load per-project BYOK LLM provider (fall back to global default)
- Save updated instance state and archive a new version
- Return cycle result metrics (counts, changes, timestamps)

---

## NPC Definition Version History

Every time an NPC definition is saved with at least one changed field, the previous state is archived. This gives developers a full audit trail and the ability to revert any NPC blueprint to any prior state.

### How It Works

1. On every `updateDefinition()` call, `computeChangedFields()` diffs the incoming update against the current definition.
2. If any fields changed, the **current** definition is inserted into `npc_definition_history` before the update is applied.
3. The `npc_definitions.version` counter increments with each archived save.
4. **Rollback** fetches a snapshot from history, archives the current state as a new version, and writes the snapshot back as the new current — making every revert itself reversible.
5. No pruning by default (definitions change infrequently). Full snapshots are stored (~3KB each).

### Database Tables (Supabase)

```sql
-- Version column added to npc_definitions
npc_definitions.version  INTEGER DEFAULT 1

-- Full snapshot archive
npc_definition_history (
  id            UUID,
  definition_id TEXT FK -> npc_definitions,
  version       INTEGER,      -- version number at time of archival
  snapshot      JSONB,        -- full NPCDefinition at that version
  changed_fields TEXT[],      -- field names that changed (e.g. ["personality_baseline"])
  created_at    TIMESTAMPTZ
)
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/npcs/:npcId/history` | List version metadata (no snapshots) |
| `GET` | `/api/projects/:projectId/npcs/:npcId/history/:version` | Fetch full snapshot for a version |
| `POST` | `/api/projects/:projectId/npcs/:npcId/rollback` | Body: `{ version }` — revert to that version |

### Web UI (History Tab — Definition Section)

The NPC editor History tab shows a vertical timeline of definition versions. Each entry displays:
- Version number + timestamp
- Pill tags for changed fields (e.g. `personality_baseline`, `core_anchor`)
- "View" button: opens a two-column diff modal comparing the snapshot to the current state
- "Revert to vN" button: prompts for confirmation, then calls the rollback API and reloads

---

## NPC Mind State Version History

Every save of an NPC's runtime instance state creates a versioned snapshot. This captures the evolving mind of the NPC over time — memory growth, mood drift, trait changes.

### When Snapshots Are Created

| Trigger | Endpoint |
|---------|---------|
| Session end | `POST /api/session/:sessionId/end` |
| Daily Pulse | `POST /api/instances/:instanceId/daily-pulse` |
| Weekly Whisper | `POST /api/instances/:instanceId/weekly-whisper` |
| Persona Shift | `POST /api/instances/:instanceId/persona-shift` |
| Manual rollback (the rollback itself is archived) | `POST /api/instances/:instanceId/rollback` |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/instances/:instanceId/history` | List all instance snapshots (version + timestamp) |
| `GET` | `/api/instances/:instanceId/history/:version` | Fetch full NPCInstance at that version |
| `POST` | `/api/instances/:instanceId/rollback` | Body: `{ version }` — restore mind state to that snapshot |

### Web UI (History Tab — Mind State Section)

The Mind State section appears at the top of the History tab (above Definition History):

- Each entry shows: version identifier + formatted timestamp
- **"View State"** button: opens a modal showing the full mind snapshot:
  - Mood bars (Valence / Arousal / Dominance as visual progress bars)
  - Short-Term Memory list (content + salience + timestamp per entry)
  - Long-Term Memory list
  - Trait Modifiers (only non-zero deltas shown)
  - Daily Pulse takeaway text
  - Cycle Metadata (last weekly whisper / last persona shift timestamps)
- **"Revert to this"** button (hidden for the most recent / current snapshot): restores the instance to that state after confirmation. The current state is archived first, so the revert is itself reversible.

---

## NPC Definition Fields

### Full Schema

```typescript
NPCDefinition {
  id: string                        // Unique identifier
  project_id: string
  name: string                      // Display name (1-100 chars)
  description: string               // Brief external description (what others see)
  status: 'draft' | 'complete'     // Configuration completeness

  // Core Psychology (immutable in production)
  core_anchor: {
    backstory: string               // Up to 2000 chars
    principles: string[]            // Up to 10 principles, 500 chars each
    trauma_flags: string[]          // Sensitive topics, narrative use only
  }

  // Personality (Big Five model, all 0-1)
  personality_baseline: {
    openness: number
    conscientiousness: number
    extraversion: number
    agreeableness: number
    neuroticism: number
  }

  // Voice
  voice: {
    provider: 'cartesia' | 'elevenlabs'
    voice_id: string
    speed: number                   // 0.5 - 2.0
  }

  // World presence
  schedule: ScheduleBlock[] {
    start: string                   // ISO 8601 time
    end: string
    location_id: string             // Game-world location reference
    activity: string                // What NPC is doing
  }

  // MCP tool access
  mcp_permissions: {
    conversation_tools: string[]    // Tools NPC can invoke from dialogue
    game_event_tools: string[]      // Tools game can trigger on NPC
    denied: string[]                // Explicitly blocked tools
  }

  // Knowledge base access
  knowledge_access: Record<string, number>
  // Maps knowledge category ID -> depth level (0-N)

  // Social graph
  network: NPCNetworkEntry[] {
    npc_id: string
    familiarity_tier: 1 | 2 | 3
    mutual_awareness?: boolean
    reverse_context?: string
  }

  // Player identity
  player_recognition: {
    reveal_player_identity: boolean
  }

  // Memory intelligence
  salience_threshold: number        // 0-1, default 0.7

  // Avatar
  profile_image?: string            // Stored filename

  // Version tracking
  version?: number                  // Incremented on every definition save
}
```

---

## NPC Instance (Runtime Mind State)

```typescript
NPCInstance {
  id: string
  definition_id: string
  project_id: string
  player_id: string

  // Current emotional state (MoodVector all 0-1)
  current_mood: {
    valence: number          // How positive/negative
    arousal: number          // How energized/calm
    dominance: number        // How in-control/submissive
  }

  // Personality drift from baseline
  trait_modifiers: Partial<PersonalityBaseline>
  // Bounded to [-0.3, +0.3], final = baseline + modifier (clamped 0-1)

  // Memory
  short_term_memory: Memory[]      // Session-scoped, pruned at weekly whisper
  long_term_memory: Memory[]       // Synthesized and persistent, pruned when over limit
  // Memory = { id, content, timestamp, salience, type }

  // Player relationship
  relationships: Record<string, {
    trust: number                  // 0-1
    familiarity: number            // 0-1
    sentiment: number              // -1 to 1
  }>

  // Daily state
  daily_pulse: {
    mood: MoodVector
    takeaway: string               // 1-sentence day reflection
    timestamp: string
  } | null

  // Cycle tracking
  cycle_metadata: {
    last_weekly: string | null
    last_persona_shift: string | null
  }
}
```

---

## Technical Stack

### Runtime

- **Runtime**: Bun (recommended for WebSocket performance) or Node.js 20+
- **Framework**: Hono (lightweight, WebSocket support, edge-compatible)
- **Language**: TypeScript with strict mode
- **Deployment**: Render (container, WebSocket-friendly)

### Providers

The system uses a factory pattern for LLM, STT, and TTS providers, enabling runtime switching via configuration:

```typescript
const llmProvider = createLlmProvider({
  provider: 'gemini',  // or 'openai', 'anthropic', 'grok'
  apiKey: config.providers.geminiApiKey,
  model: 'gemini-2.0-flash',
});
```

| Provider Type | Options | Default | Library |
|---------------|---------|---------|---------|
| **LLM** | Gemini, OpenAI, Anthropic, Grok | Gemini 2.0 Flash | Native fetch streaming |
| **STT** | Deepgram | Deepgram Nova-2 | `@deepgram/sdk` |
| **TTS** | Cartesia, ElevenLabs | Cartesia Sonic | Native WebSocket |

#### Mind Instance Configuration

The NPC Mind (Section 7) can use a separate provider/model from the Speaker, allowing cost optimization:

```typescript
// Project-level Mind configuration
mind_provider: string    // LLM provider for Mind instance (defaults to project provider)
mind_model: string       // Model for Mind instance (defaults to project model)
mind_timeout_ms: number  // Mind timeout in ms (default: 5000)
```

Typical configuration: Speaker uses the project's primary model for quality, Mind uses a cheaper/faster model (e.g., `gemini-2.0-flash` or `gpt-4o-mini`) since its output is shorter and more structured.

#### LLM Providers

| Provider | Default Model | Other Models | Notes |
|----------|---------------|--------------|-------|
| Google Gemini | gemini-2.0-flash | gemini-2.0-flash-exp, gemini-pro | Fastest, recommended |
| OpenAI | gpt-4o | gpt-4o-mini, gpt-4-turbo | Best quality |
| Anthropic | claude-3-5-sonnet | claude-3-opus, claude-3-haiku | Strong reasoning |
| xAI Grok | grok-beta | - | Experimental |

### Storage

- **NPC State**: JSON files with version history (local) or Supabase PostgreSQL (production)
- **Active Sessions**: In-memory Map (RAM only, no write during conversation)
- **Project Config**: Database/YAML files
- **API Keys**: AES-encrypted, never stored in plaintext
- **Images**: Local filesystem (dev) or Supabase Storage (production)

### Dependencies

```json
{
  "@google/generative-ai": "Gemini SDK (streaming)",
  "@deepgram/sdk": "Live STT (WebSocket)",
  "@cartesia/cartesia-js": "Streaming TTS (default)",
  "elevenlabs": "Alternative TTS",
  "hono": "Web framework",
  "zod": "Schema validation",
  "pino": "Structured logging",
  "ws": "WebSocket server",
  "@supabase/supabase-js": "Production storage"
}
```

Client-side (Web):
```json
{
  "@ricky0123/vad-web": "Browser VAD (Silero-based)"
}
```

---

## Error Handling

### Logging Strategy

- Structured JSON logs via Pino
- Request ID propagated through entire request lifecycle
- Log levels: error, warn, info, debug
- All provider API calls logged with timing
- NPC state changes logged at debug level
- No PII in logs (NPC names acceptable, player content redacted)
- Security events logged at warn or higher

### Error Categories

| Category | Handling |
|----------|----------|
| Provider Errors | Retry with backoff, fallback to text-only if TTS fails |
| Validation Errors | Return 400 with specific error message |
| State Errors | Attempt recovery or return 404 |
| Tool Errors | Log and skip tool, continue conversation |
| Session Errors | Clean up RAM, notify client, allow reconnect |
| Security Errors | Log, apply cooldown, trigger exit_convo if needed |

### Graceful Degradation

- TTS failure: Fall back to text-only response
- STT failure: Prompt client to retry or use text input
- LLM timeout: Return error to client with retry suggestion
- WebSocket disconnect: Session remains in RAM until timeout, allows reconnect
- State save failure: Hold in memory, retry, warn client

---

## Web UI

The framework includes a complete web-based management and testing interface built as a vanilla JS SPA (no build step).

### Project Management

- Create/manage multiple NPC projects
- **Settings Page** for each project with:
  - LLM provider selection (Gemini, OpenAI, Anthropic, Grok) + model selection
  - API key management (AES-encrypted storage, never exposed after entry)
  - TTS/STT provider configuration
  - Game Client API Key generation and revocation (for external game clients)
  - Import API keys from another project

### NPC Editor

**9-tab editor** for complete NPC configuration:

1. **Basic Info** — Name, description, draft/complete status, profile picture upload
2. **Core Anchor** — Backstory, principles (tag input), trauma flags (tag input)
3. **Personality** — Big Five sliders, personality template presets (6+ archetypes), memory retention slider mapped to salience threshold
4. **Voice** — Provider selection, voice browser with sample playback, speed control
5. **Knowledge Access** — Knowledge category browser with depth-level assignment per NPC
6. **Schedule** — Time-block builder for location and activity routines
7. **MCP Tools** — Tool permission assignment (conversation vs game-event, with deny list)
8. **Network** — NPC social graph builder: add relationships with familiarity tiers, mutual/one-sided awareness
9. **History** — Version timeline with two sub-sections:
   - **Mind State** (primary): All instance snapshots with "View State" and "Revert to this" buttons
   - **Definition** (secondary): All definition change versions with field-level diff view and "Revert to vN" buttons

### Testing Playground

- **Conversation mode selector** (4 modes: text-text, voice-voice, text-voice, voice-text)
- Real-time chat with NPCs (streaming response)
- Player identity configuration (name, description, role, context)
- **Live NPC State panel** in sidebar showing:
  - Current mood (valence/arousal/dominance as progress bars) + mood emoji label
  - Short-term and long-term memory counts
  - Latest memory snippet
  - Daily pulse takeaway
- **Cycles panel** for triggering daily-pulse, weekly-whisper, persona-shift directly
- **World Context panel** showing project context:
  - Project info (ID, settings)
  - NPC roster (all NPCs in project)
  - Knowledge base tiers
  - Available MCP tools

### Starter Packs

Pre-built NPC templates that can be loaded into a project as a starting point. Includes full definition, starter knowledge, and example tool configurations.

---

## API Overview

### Session

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/session/start` | Start conversation; input: project_id, npc_id, player_id, optional player_info, mode |
| POST | `/api/session/:id/end` | End session, persist memory, archive version |
| GET | `/api/session/:id` | Get session state |

### Conversation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/session/:id/message` | Send message; rate-limited, moderated, streams response |
| GET | `/api/session/:id/history` | Get conversation history |

### Cycles

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/instances/:id/daily-pulse` | Capture daily emotional state |
| POST | `/api/instances/:id/weekly-whisper` | Curate STM, synthesize to LTM |
| POST | `/api/instances/:id/persona-shift` | Recalibrate personality from experiences |

### Instance History

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/instances/:id/history` | List all mind state snapshots |
| GET | `/api/instances/:id/history/:version` | Fetch specific snapshot |
| POST | `/api/instances/:id/rollback` | Restore mind state to version |
| GET | `/api/instances/:id` | Current instance state |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/projects` | List / create projects |
| GET/PUT/DELETE | `/api/projects/:id` | Get / update / delete project |
| GET/PUT | `/api/projects/:id/keys` | API key management |
| POST/DELETE/GET | `/api/projects/:id/api-key` | Game Client API Key management |
| GET | `/api/projects/:id/voices` | List available voices |
| GET | `/api/projects/:id/stats` | Project statistics |
| POST | `/api/projects/:id/load-starter-pack` | Load NPC template pack |

### NPCs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/projects/:id/npcs` | List / create NPC definitions |
| GET/PUT/DELETE | `/api/projects/:id/npcs/:npcId` | Get / update / delete NPC |
| POST/GET/DELETE | `/api/projects/:id/npcs/:npcId/avatar` | Profile picture management |
| GET | `/api/projects/:id/npcs/:npcId/history` | Definition version list |
| GET | `/api/projects/:id/npcs/:npcId/history/:version` | Definition snapshot |
| POST | `/api/projects/:id/npcs/:npcId/rollback` | Revert definition |

### Knowledge & Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/PUT | `/api/projects/:id/knowledge` | Knowledge base CRUD |
| GET/PUT | `/api/projects/:id/mcp-tools` | MCP tool definitions |

**WebSocket**: `ws://host:port+1/ws/voice?session_id=xxx`

**WebSocket Outbound Messages (Mind-related):**

| Message Type | Payload | Description |
|--------------|---------|-------------|
| `mind_activity` | `{ tools: string[], results: object[] }` | Tools called by the Mind during this turn (for UI display) |
| `followup_start` | `{}` | Mind follow-up response is beginning to stream |
| `generation_end` | `{ phase: 'speaker' \| 'followup' }` | Generation complete; `phase` field distinguishes Speaker finish from follow-up finish |

---

## Design Principles

| Principle | Implementation |
|-----------|----------------|
| Transient sessions | RAM during conversation, persist only on end |
| State with history | Every save creates a versioned archive |
| Immutable anchors | Core Anchor never modified, enforced at multiple layers |
| Client-side VAD | Saves bandwidth, enables instant interruption |
| WebSocket everything | STT, TTS, client comms — all WebSocket for low latency |
| Stream everything | Token-by-token LLM -> sentence-by-sentence TTS -> chunk audio |
| Cyclic memory pruning | Replace, don't append. Aggressive data discard |
| LLM memory synthesis | Weekly whisper compresses STM into insight-level LTM via LLM |
| Modal I/O | Any input mode (text/voice) with any output mode (text/voice) |
| Factory providers | Swap LLM/STT/TTS at runtime via configuration |
| Per-NPC memory | Configurable memory retention per character |
| Player awareness | NPCs can recognize players before conversation |
| Explicit cycle triggers | Host controls all update cycles |
| Two tool types | Conversation (Mind decides) vs Game-event (game decides) |
| Sequential Mind -> Speaker | Mind thinks first with tools, Speaker responds with Mind's context |
| Comprehensive logging | Structured, traceable, no PII |
| Graceful degradation | Failures reduce features, not availability |
| Security by design | Multiple pipeline layers, no raw player input stored |

---

## Getting Started

```bash
# Clone and install
git clone https://github.com/PranavMishra17/SoulEngine.git
cd SoulEngine
npm install

# Configure providers
cp .env.example .env
# Add your API keys for LLM, STT, TTS providers

# Run development server
npm run dev

# Open web UI
open http://localhost:3000
```

### Environment Variables

```bash
# LLM Providers (at least one required)
GEMINI_API_KEY=your_key
OPENAI_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
GROK_API_KEY=your_key

# Voice Providers
DEEPGRAM_API_KEY=your_key  # STT
CARTESIA_API_KEY=your_key  # TTS (default)
ELEVENLABS_API_KEY=your_key  # TTS (alternative)

# Default LLM provider
DEFAULT_LLM_PROVIDER=gemini  # or openai, anthropic, grok

# Encryption for API key storage
ENCRYPTION_KEY=your_32_char_key

# Production only
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```
