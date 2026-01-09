# SoulEngine (Evolve.NPC v2.0)

**NPCs with memory, motive, and agency.**

> Stateless NPC intelligence with layered memory cycles, personality evolution, multi-modal voice interaction, and MCP-based agency in game environments.

---

SoulEngine is a TypeScript framework for creating game characters that remember player interactions, evolve their personalities over time, speak with their own voices, and take actions in the game world. No persistent processes, no complex databases. NPCs are YAML files that become intelligent when queried against an LLM. Talk to them via text or voice (or any combination), they respond in kind through integrated STT/TTS pipelines. Define a character's childhood, principles, and personality once. The system handles the rest: forming memories, forgetting trivia, holding grudges, building relationships, and deciding when to call the cops on a threatening player. MCP-based tool system lets NPCs act on their decisions: lock doors, refuse service, alert guards, flee danger.

**v2.0 Features:**
- **Multi-provider LLM support**: Gemini, OpenAI, Anthropic Claude, xAI Grok
- **Flexible conversation modes**: Text↔Text, Voice↔Voice, Text→Voice, Voice→Text
- **Player identity system**: NPCs can recognize and remember players
- **Per-NPC memory retention**: Smart NPCs remember more, simpletons forget
- **NPC profile pictures**: Visual identification in UI
- **Dedicated settings page**: Per-project API key and provider configuration

Characters that listen, think, speak, and do.

---

## Core Vision

A lightweight, LLM-driven architecture that transforms static game NPCs into genuinely evolving entities. Unlike traditional scripted characters, these NPCs develop over time through player interactions, game events, and internal psychological cycles that mirror human memory formation and decay.

The system operates on a fundamental insight: **humans don't remember everything**. We forget trivia, form habits through repetition, hold grudges from betrayals, and rarely change our core beliefs except through profound experiences. Evolve.NPC replicates these patterns through five interconnected psychological layers.

---

## The Five Pillars

### 1. Core Anchor (Immutable)

Psychological DNA that never changes. A 100-200 token backstory encoding the character's fundamental worldview, childhood context, and 3-5 unbreakable principles. This foundation is **permanently immutable** - no trauma flags or milestone events can modify it. The anchor ensures characters remain recognizable across hundreds of interactions.

```
core_anchor: {
  backstory: string,
  principles: string[],
  trauma_flags: string[]  // For narrative tracking only, does NOT modify anchor
}
```

A village elder who witnessed war as a child will carry that perspective forever. A merchant raised on honesty will struggle to lie even under pressure. The Core Anchor is enforced at both the cycle logic layer and storage layer - belt and suspenders.

**v2.0: Name Tolerance**

NPCs are now instructed to be forgiving about slight name mispronunciations that occur due to STT transcription. A player saying "Slop" when the NPC's name is "Slorp" won't trigger frustration - the NPC assumes good intent and interprets close phonetic matches as their actual name.

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

### 3. Weekly Whisper

Short-term memory curation with **cyclic pruning**. Most interactions fade, but emotionally significant events persist based on salience scoring. This is a **replacement** operation, not append. The system retains configurable N memories (default: 3) per cycle, aggressively discarding the rest.

```
weekly_whisper: {
  retained_memories: Memory[],  // Replaces previous, not appends
  last_run: ISO8601
}
```

**v2.0: Per-NPC Memory Retention**

Each NPC now has a configurable `salience_threshold` (0.0-1.0) that controls how well they remember:

| Memory Retention | Threshold | Behavior |
|-----------------|-----------|----------|
| 80-100% (Genius) | 0.35-0.47 | Remembers small details, longer summaries |
| 40-60% (Average) | 0.59-0.71 | Standard memory retention |
| 0-20% (Dimwit) | 0.83-0.95 | Struggles to recall, brief summaries |

This affects both Weekly Whisper (how many memories get promoted to LTM) and conversation summarization (how detailed the NPC's recap is).

**Telephone Game Logic:** Day -> Summary -> Week -> Summary -> Core. Old raw data is aggressively discarded after each summarization step. Only high-salience summaries persist long-term, preventing unbounded memory growth.

### 4. Persona Shift

Major personality recalibration triggered at developer-defined intervals. The system reviews accumulated experiences, cross-references against the Core Anchor, and modifies active personality traits within bounded limits. Friendships deepen or dissolve. New habits form. Tone shifts naturally.

```
persona_shift: {
  trait_modifications: TraitDelta[],
  relationship_changes: RelDelta[],
  last_run: ISO8601
}
```

The interval is entirely game-dependent. A survival game might trigger shifts after each in-game month. A social sim might run them weekly. A noir detective story might reserve shifts for act breaks.

This is where genuine character development occurs. An NPC who experiences repeated kindness from a player gradually opens up. One who faces constant hostility hardens. Evolution happens organically, not through developer scripting.

**Important:** Persona Shift can modify personality traits but NEVER the Core Anchor. Any LLM suggestions to modify the anchor are logged and ignored.

### 5. Player Identity & Network (v2.0)

NPCs can now recognize players before conversation starts. Developers configure whether an NPC "knows" the player:

```
player_recognition: {
  reveal_player_identity: boolean,  // Include player info in NPC context
  default_player_tier: 1 | 2 | 3    // How well NPC knows player
}
```

When a session starts with player info provided, the NPC's system prompt includes:
- Player's name (so NPC can address them)
- Description (what the NPC sees)
- Context (relationship notes)

**Bidirectional Network Awareness:** The existing NPC network now supports one-sided relationships:
- "You know them, and they know you back" (mutual)
- "You know of them (famous), but they don't know you" (reverse context)

### 6. MCP Action Layer

NPCs don't just talk. They act. Through Model Context Protocol tools, characters execute world actions with real consequences. Two distinct tool categories serve different decision sources:

**Conversation Tools**: The LLM decides to invoke based on dialogue context. A player threatens the barista. The LLM decides to call the police. The decision emerges from the character's personality, current mood, and relationship with the player.

**Game-Event Tools**: Game logic invokes directly, bypassing LLM. An explosion triggers a flee response. Same tool interface, different decision authority.

```
mcp_registry: {
  call_police: { params: { location: string, urgency: 1-10 } },
  refuse_service: { params: { target: string, duration: number } },
  flee_to: { params: { location_id: string } },
  lock_door: { params: { door_id: string } },
  alert_guards: { params: { threat_level: number } },
  exit_convo: { params: { reason: string } }  // Security escape hatch
}
```

The `exit_convo` tool is special - injected only when moderation flags inappropriate content, allowing the NPC to end conversation gracefully while staying in character.

---

## Architecture

### Transient Session Model

**Critical Design Decision:** The backend is **stateful during conversations** but **stateless between conversations**.

When a conversation begins, the NPC's JSON state is "hydrated" into an ephemeral in-memory session. All state changes (mood updates, STM additions, conversation history) happen in RAM. Persistence (writing to JSON) happens **only on session_end** or explicit force_save.

```
Session Lifecycle:
1. START  -> Client requests NPC -> Server loads from storage, caches in RAM with SessionID
2. CHAT   -> WebSocket uses SessionID -> Server appends to RAM state
3. END    -> Server summarizes, updates state -> Writes to storage -> Returns sync confirmation -> Dumps RAM
```

**Trade-off acknowledged:** If connection drops or player force-quits before "End" signal, that conversation's memory is lost. This is acceptable for most game scenarios and dramatically simplifies the architecture.

**Scalability:** 1000 concurrent NPCs = 1000 open WebSockets. Node/Bun handles this trivially. No database writes during conversation. No per-NPC background processes.

### State Storage with History

NPC states are stored on the server with optional version history (git-like commits):

```
data/instances/{instance_id}/
  current.json          # Latest state
  history/
    {timestamp}_v1.json
    {timestamp}_v2.json
    ...
```

On session end, the server:
1. Writes updated state to `current.json`
2. Optionally archives previous state to `history/` with timestamp
3. Returns sync confirmation to client

This enables rollback if an NPC gets into a bad state, and provides audit trail for debugging personality drift.

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
     |  [Write + archive]              |<-----------------------------|
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

### v2.0: Conversation Modes

The pipeline now supports four conversation modes, enabling flexible input/output combinations:

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
  private mode: ConversationMode;  // v2.0: Mode awareness
  
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

  // Audio from client (voice-* modes)
  public pushAudio(chunk: Buffer): void

  // Text from client (text-* modes) - v2.0
  public async handleTextInput(text: string): Promise<void>

  // STT transcript -> LLM processing
  private onTranscript(text: string, isFinal: boolean): void

  // LLM streaming -> TTS streaming (if voice output)
  private async processTurn(input: string): Promise<void>

  // Client interruption -> cancel generation
  public handleInterruption(): void
}
```

### Streaming Flow

```
Client Audio (VAD-filtered)
    |
    v
[STT - Deepgram WebSocket]
    |
    | final transcript
    v
[Security Pipeline]
    |
    | sanitized input
    v
[Context Assembly]
    |
    v
[LLM - Gemini Streaming]
    |
    | token stream
    v
[Sentence Detector]
    |
    | complete sentences
    v
[TTS - Cartesia WebSocket]
    |
    | audio chunks
    v
Client Speaker
```

Key principle: **Stream at every stage**. Don't wait for full LLM response before starting TTS. Detect sentence boundaries and synthesize incrementally.

### TTS Provider Configuration

**Default: Cartesia** - Fastest latency (40ms), cost-effective, good voice quality.

**Available alternatives** (configurable via environment):
- ElevenLabs - Premium quality, most voice variety, higher cost
- Deepgram Aura - Enterprise reliability, limited voices
- PlayHT - Middle ground option

```typescript
// Provider selection in config
TTS_PROVIDER=cartesia  // default
// TTS_PROVIDER=elevenlabs
// TTS_PROVIDER=deepgram
```

---

## Security Architecture

### Pipeline Position

```
Player Input
    |
    v
[1. INPUT SANITIZATION]     <- Max length, rate limit, pattern strip
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
[5. LLM CALL]
    |
    v
[6. TOOL VALIDATION]        <- Permission check, exit_convo handling
    |
    v
[7. RESPONSE STREAMING]
    |
    v
[8. MEMORY CREATION]        <- Summarize (never raw), skip if exit_convo
    |
    v
[9. STATE UPDATE & SAVE]    <- Anchor immutability enforced
```

### Security Measures

**Input Sanitization:**
- Max input length: 500 characters
- Rate limiting: 10 messages per minute per player per NPC
- Pattern stripping for obvious injection attempts

**Moderation + exit_convo:**
- Content policy check before processing
- If flagged: inject exit instruction, add exit_convo tool
- NPC ends conversation in-character, cooldown applied

**Immutable Core Anchors:**
- Enforced in Persona Shift logic (ignore LLM suggestions)
- Enforced in storage layer (reject anchor changes on save)
- Trauma flags recorded for narrative tracking only

**Memory Summarization:**
- Never store raw player input
- LLM summarizes from NPC perspective (2-3 sentences)
- Injection attempts defanged through summarization

---

## Update Cycles

Cycles are never auto-triggered. The host (game or web UI) explicitly calls these endpoints. This allows games to batch process during loading screens or rest sequences.

```
POST /api/session/:sessionId/daily-pulse
  body: { game_context?: DayContext }
  effect: Summarizes day, updates mood baseline, captures takeaway

POST /api/session/:sessionId/weekly-whisper
  body: { retain_count?: number }
  effect: Curates STM, REPLACES with high-salience selections, purges rest

POST /api/session/:sessionId/persona-shift
  effect: Major review, can modify personality traits (NOT anchor), update relationships
```

Token costs per cycle: Daily Pulse ~200, Weekly Whisper ~500, Persona Shift ~1000. These run asynchronously and are not latency-sensitive.

---

## Technical Stack

### Runtime

- **Runtime**: Bun (recommended for WebSocket performance) or Node.js 20+
- **Framework**: Hono (lightweight, WebSocket support, edge-compatible)
- **Language**: TypeScript with strict mode
- **Deployment**: Render (container, WebSocket-friendly)

### Providers

**v2.0: Factory Pattern for All Providers**

The system uses a factory pattern for LLM, STT, and TTS providers, enabling runtime switching via configuration:

```typescript
// LLM Provider Factory
const llmProvider = createLlmProvider({
  provider: 'gemini',  // or 'openai', 'anthropic', 'grok'
  apiKey: config.providers.geminiApiKey,
  model: 'gemini-2.5-flash',
});
```

| Provider Type | Options | Default | Library |
|---------------|---------|---------|---------|
| **LLM** | Gemini, OpenAI, Anthropic, Grok | Gemini 2.5 Flash | Native fetch streaming |
| **STT** | Deepgram | Deepgram Nova-2 | `@deepgram/sdk` |
| **TTS** | Cartesia, ElevenLabs | Cartesia Sonic | Native WebSocket |

#### LLM Providers

| Provider | Default Model | Other Models | Notes |
|----------|---------------|--------------|-------|
| Google Gemini | gemini-2.5-flash | gemini-2.5-pro, gemini-1.5-pro | Fastest, recommended |
| OpenAI | gpt-4o | gpt-4o-mini, gpt-4-turbo | Best quality |
| Anthropic | claude-3-5-sonnet | claude-3-opus, claude-3-haiku | Strong reasoning |
| xAI Grok | grok-beta | - | Experimental |

**Why WebSocket for STT/TTS?** REST APIs add per-request latency. WebSocket connections stay open, enabling true streaming with sub-100ms time-to-first-audio.

### Storage

- **NPC State**: JSON files with version history
- **Active Sessions**: In-memory Map (RAM)
- **Project Config**: YAML files, loaded at startup
- **Future**: SQLite or Postgres for multi-tenant SaaS

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
  "ws": "WebSocket server"
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

## Unity Integration (Future)

The TypeScript backend and web testing UI are stepping stones to the primary goal: a Unity SDK that game developers can drop into their projects.

### Integration Model

Unity game connects to Evolve.NPC backend via **standard WebSocket** (not WebRTC). This is simpler to implement, easier to load balance, and doesn't require a media server.

```
Unity Client                          Evolve.NPC Server
     |                                      |
     |-- WebSocket Connect ---------------->|
     |-- { type: 'init', instance_id } ---->|
     |<-- { type: 'ready', ... } -----------|
     |                                      |
     |-- Audio chunks (VAD active) -------->|
     |-- { type: 'commit' } --------------->|
     |<-- { type: 'text_chunk', ... } ------|
     |<-- { type: 'audio_chunk', ... } -----|
     |<-- { type: 'generation_end' } -------|
     |                                      |
     |-- { type: 'end' } ------------------>|
     |<-- { type: 'sync', success: true } --|
```

### SDK Responsibilities

- C# WebSocket client wrapper
- NPC component (MonoBehaviour) for easy scene integration
- Microphone capture with VAD (Silero via Unity Sentis/Inference Engine)
- Audio playback with queue management
- Tool bridge for registering game-side handlers
- Update cycle triggers for game time integration

### Unity VAD Solution

**Silero VAD + Unity Sentis (now Inference Engine)**

- Load `silero_vad.onnx` model via Unity Sentis
- Process 30ms audio chunks in <1ms on CPU
- Runs entirely client-side, saves bandwidth
- Cross-platform: Windows, Mac, iOS, Android
- MIT licensed, no cloud dependency

### What Stays in Unity

- NPC movement, pathfinding, animation
- FSM/behavior trees for routine behaviors
- Game-event tool execution (actual game effects)
- Schedule interpretation (location IDs to transforms)
- When to trigger update cycles (game time mapping)
- VAD processing (saves bandwidth, enables instant interruption)

---

## Future Enhancements

### NPC Health Dashboard

A web-based dashboard for monitoring NPC states across a project:

**Per-NPC Metrics:**
- Current mood visualization
- Trait drift from baseline
- Memory counts (STM/LTM)
- Relationship summary
- Tool call history
- Moderation event log

**Project-wide Metrics:**
- Total conversations
- Tool usage breakdown
- Moderation trigger rate
- Average conversation length

**Health Flags:**
- Mood stuck at extreme >3 days
- Trait drift >0.25 from baseline
- Multiple moderation triggers

*Implementation deferred to post-MVP.*

---

## Design Principles

| Principle | Implementation |
|-----------|----------------|
| Transient sessions | RAM during conversation, persist only on end |
| State with history | Server stores states with optional version tracking |
| Immutable anchors | Core Anchor never modified, enforced at multiple layers |
| Client-side VAD | Saves bandwidth, enables instant interruption |
| WebSocket everything | STT, TTS, client comms - all WebSocket for low latency |
| Stream everything | Token-by-token LLM -> sentence-by-sentence TTS -> chunk-by-chunk audio |
| Cyclic memory pruning | Replace, don't append. Aggressive data discard. |
| **Modal I/O** | Any input mode (text/voice) with any output mode (text/voice) |
| **Factory providers** | Swap LLM/STT/TTS at runtime via configuration |
| **Per-NPC memory** | Configurable memory retention per character |
| **Player awareness** | NPCs can recognize players before conversation |
| Explicit triggers | Host controls update cycles |
| Two tool types | Conversation (LLM decides) vs Game-event (game decides) |
| Comprehensive logging | Structured, traceable, no PII |
| Graceful degradation | Failures reduce features, not availability |
| Security by design | Five layers, clear pipeline positions |

---

## Web UI (v2.0)

The framework includes a complete web-based management and testing interface:

### Project Management
- Create/manage multiple NPC projects
- **Settings Page** for each project with:
  - LLM provider selection (Gemini, OpenAI, Anthropic, Grok)
  - Model selection per provider
  - API key management (encrypted storage)
  - TTS/STT provider configuration

### NPC Editor
- **8-tab editor** for complete NPC configuration:
  - Basic Info (name, description, profile picture)
  - Core Anchor (backstory, principles, traumas)
  - Personality (traits, template, memory retention slider)
  - Voice (provider, voice ID, style)
  - Knowledge Access (tiered knowledge categories)
  - Schedule & Stats (routines, default mood)
  - MCP Tools (permitted actions)
  - Network (NPC relationships, player recognition)

### Testing Playground
- **Conversation mode selector** (4 modes)
- Real-time chat with NPCs
- Player identity testing
- Mind viewer for NPC state inspection
- Memory cycle triggers

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
```

---

**SoulEngine** - Characters that listen, think, speak, and do.