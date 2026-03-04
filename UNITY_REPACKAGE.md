# SoulEngine Unity SDK

Implementation plan for repackaging SoulEngine as a Unity asset. All NPC intelligence runs locally inside Unity, with optional cloud sync back to the SoulEngine backend for state persistence, history, and the web management UI.

---

## Design Goals

A developer should be able to add SoulEngine to their Unity project in three steps:

1. Drop three scripts into a scene: `SoulEngineManager`, `NPCCharacter`, `GameToolHandler`
2. Fill in: Project ID + API Key (from soulengine.dev) + your LLM/TTS/STT API keys
3. Assign the NPC ID from the web editor to each `NPCCharacter` component

Everything else — memory, personalities, voice, cycles, tools — is handled by the SDK.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------+
|                              UNITY GAME                                     |
|                                                                             |
|  +-----------------------------------------------------------------------+  |
|  |                    SoulEngine SDK (C#)                                |  |
|  |                                                                       |  |
|  |  +---------------+  +---------------+  +---------------+             |  |
|  |  | LLMProvider   |  | STTProvider   |  | TTSProvider   |             |  |
|  |  | (REST/SSE)    |  | (WebSocket)   |  | (WebSocket)   |             |  |
|  |  +-------+-------+  +-------+-------+  +-------+-------+             |  |
|  |          |                  |                  |                      |  |
|  |          +------------------+------------------+                      |  |
|  |                             |                                         |  |
|  |                     +-------+-------+                                 |  |
|  |                     |  VoicePipeline|                                 |  |
|  |                     | (all 4 modes) |                                 |  |
|  |                     +-------+-------+                                 |  |
|  |                             |                                         |  |
|  |  +-----------------+  +-----+--------+  +-------------------+        |  |
|  |  | MemoryCycles    |  | SessionMgr   |  | ContextBuilder    |        |  |
|  |  | DailyPulse      |  | Start / End  |  | System prompt     |        |  |
|  |  | WeeklyWhisper   |  | State track  |  | Knowledge         |        |  |
|  |  | PersonaShift    |  | Summarizer   |  | Network context   |        |  |
|  |  +-----------------+  +--------------+  +-------------------+        |  |
|  |                                                                       |  |
|  +-----------------------------------------------------------------------+  |
|                                     |                                       |
|                          Local Read/Write                                   |
|                                     v                                       |
|  +-----------------------------------------------------------------------+  |
|  |                  Local Storage (StreamingAssets)                      |  |
|  |  project.yaml, definitions/*.yaml, instances/*.json                  |  |
|  |  knowledge.yaml, mcp-tools.yaml                                      |  |
|  +-----------------------------------------------------------------------+  |
|                                     |                                       |
|                               Async Sync                                    |
|                                     v                                       |
|  +-----------------------------------------------------------------------+  |
|  |                         SyncManager                                   |  |
|  |  Push NPC state -> cloud, Pull project updates <- cloud               |  |
|  +-----------------------------------------------------------------------+  |
|                                     |                                       |
+-------------------------------------|---------------------------------------+
                                      | HTTPS
                                      v
                     +-----------------------------+
                     |     SoulEngine Cloud        |
                     |   (Supabase + Vercel)       |
                     |                             |
                     |  Project management UI      |
                     |  NPC state backup           |
                     |  Version history            |
                     |  User authentication        |
                     +-----------------------------+
```

---

## Key Design Principles

1. **All NPC intelligence is local** — LLM calls, STT, TTS, memory cycles all run directly from Unity to provider APIs. No server intermediary during gameplay.
2. **Cloud is for sync and management only** — The SoulEngine backend stores project data and NPC states for backup and the web editor. Not involved in real-time conversations.
3. **Offline-first** — Game works without internet. Syncs when connection is available.
4. **Direct provider connections** — Unity connects directly to Gemini/Deepgram/Cartesia APIs using the developer's own keys (BYOK).
5. **Designed on the web, played in Unity** — Developers configure NPCs, knowledge, tools, and schedules via soulengine.dev. Unity downloads the config and runs it.

---

## Complete Feature Mapping

### Project & World Features

| Feature | Web (TypeScript) | Unity (C#) | Notes |
|---------|-----------------|-----------|-------|
| Multi-project support | `GET /api/projects` | `ProjectLoader.LoadProject()` | One project per Unity build |
| API key management (BYOK) | Settings page (AES encrypted) | `SoulEngineSettings` asset | Keys stored in ScriptableObject, not hardcoded |
| LLM provider selection | Per-project setting | `SoulEngineSettings.llmProvider` | Gemini / OpenAI / Anthropic / Grok |
| TTS provider selection | Per-project setting | `SoulEngineSettings.ttsProvider` | Cartesia / ElevenLabs |
| STT provider selection | Per-project setting | `SoulEngineSettings.sttProvider` | Deepgram |
| Knowledge base (tiered) | Knowledge editor UI | Loaded from `knowledge.yaml` | Depth-level access per NPC |
| MCP tool definitions | MCP tools UI | Loaded from `mcp-tools.yaml` | Conversation + game-event types |
| Game Client API Key | Project settings | `SoulEngineSettings.gameClientApiKey` | Sent as `x-api-key` header |
| Starter packs | Load starter pack button | Pre-bundled in `StreamingAssets` | Optional template NPCs |
| Project statistics | Dashboard | `SyncManager.GetStatsAsync()` | Session counts, memory counts |
| Cloud sync | Auto on session end | `SyncManager.SyncInstanceAsync()` | Non-blocking, fire-and-forget |

### NPC Definition Features

| Feature | TypeScript Field | Unity Access | Notes |
|---------|-----------------|-------------|-------|
| Name & description | `name`, `description` | `npc.Definition.Name` | Shown in NPC inspector |
| Core anchor (backstory) | `core_anchor.backstory` | `npc.Definition.CoreAnchor.Backstory` | Injected into system prompt, immutable |
| Principles | `core_anchor.principles[]` | `npc.Definition.CoreAnchor.Principles` | Up to 10, define NPC values |
| Trauma flags | `core_anchor.trauma_flags[]` | `npc.Definition.CoreAnchor.TraumaFlags` | Emotional triggers, narrative only |
| Big Five personality | `personality_baseline` | `npc.Definition.PersonalityBaseline` | Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism (all 0-1) |
| Memory retention | `salience_threshold` | `npc.Definition.SalienceThreshold` | 0=genius, 1=forgetful |
| Voice provider | `voice.provider` | `npc.Definition.Voice.Provider` | 'cartesia' or 'elevenlabs' |
| Voice ID | `voice.voice_id` | `npc.Definition.Voice.VoiceId` | Provider-specific |
| Voice speed | `voice.speed` | `npc.Definition.Voice.Speed` | 0.5-2.0 |
| Location schedule | `schedule[]` | `npc.Definition.Schedule` | Time blocks with location_id + activity |
| Knowledge access | `knowledge_access` | `npc.Definition.KnowledgeAccess` | Category ID -> depth level map |
| MCP tool permissions | `mcp_permissions` | `npc.Definition.McpPermissions` | Conversation + game-event + denied lists |
| NPC network | `network[]` | `npc.Definition.Network` | Social graph with familiarity tiers |
| Player recognition | `player_recognition` | `npc.Definition.PlayerRecognition` | Whether NPC can be told player identity |
| Profile picture | `profile_image` | Loaded as `Texture2D` from StreamingAssets | Shown in UI overlays |
| Draft status | `status` | Read-only in Unity | Warns if NPC is in draft state |

### NPC Instance (Runtime Mind State) Features

| Feature | TypeScript Field | Unity Access | Notes |
|---------|-----------------|-------------|-------|
| Current mood | `current_mood` (valence/arousal/dominance) | `session.Instance.CurrentMood` | Updated after each response |
| Trait modifiers | `trait_modifiers` | `session.Instance.TraitModifiers` | Accumulated from persona shifts |
| Short-term memory | `short_term_memory[]` | `session.Instance.ShortTermMemory` | Pruned at weekly whisper |
| Long-term memory | `long_term_memory[]` | `session.Instance.LongTermMemory` | Synthesized persistent memories |
| Player relationships | `relationships` | `session.Instance.Relationships` | Trust, familiarity, sentiment per player |
| Daily pulse | `daily_pulse` | `session.Instance.DailyPulse` | Mood snapshot + 1-sentence takeaway |
| Cycle metadata | `cycle_metadata` | `session.Instance.CycleMetadata` | Last weekly / last persona shift timestamps |
| Version history | Auto-archived on save | `SyncManager.GetInstanceHistoryAsync()` | Every session end / cycle creates a snapshot |
| Mind state rollback | Via API | `SyncManager.RollbackInstanceAsync()` | Restore to any prior snapshot |

### Memory System Features

| Feature | TypeScript | Unity | Notes |
|---------|-----------|-------|-------|
| Salience scoring | `calculateSalience()` | `SalienceCalculator.Score()` | Emotion 35% + player 30% + novelty 20% + action 15% |
| Mood-modulated salience | In `calculateSalience()` | Built into `SalienceCalculator` | High arousal/extreme valence amplify salience |
| STM creation | `createMemory()` | `MemoryManager.CreateMemory()` | On session end, not during conversation |
| STM pruning | `pruneSTM()` | `MemoryManager.PruneSTM()` | Filters below NPC's salience_threshold |
| LTM synthesis | `summarizeWeeklyMemories()` | `ConversationSummarizer.SynthesizeLTM()` | LLM compresses multiple STM entries into insights |
| LTM promotion | `promoteToLTM()` | `MemoryManager.PromoteToLTM()` | Elevated salience (+0.1, capped 0.95) |
| STM clearing after promotion | In `runWeeklyWhisper()` | `MemoryCycles.RunWeeklyWhisper()` | Promoted entries removed from STM |
| LTM pruning | `pruneLTM()` | `MemoryManager.PruneLTM()` | Cap on LTM size; lowest-salience removed |
| Memory injection into prompt | `formatMemoriesForPrompt()` | `ContextBuilder.FormatMemories()` | STM + LTM both included |

### Conversation Features

| Feature | TypeScript | Unity | Notes |
|---------|-----------|-------|-------|
| Text input | `POST /session/:id/message` | `session.SendMessage(text)` | Streaming response |
| Voice input | WebSocket VAD pipeline | `VoicePipeline.PushAudio(samples)` | VAD via Silero ONNX (Unity Sentis) |
| Voice output | Cartesia/ElevenLabs streaming | `AudioPlayback.PlayChunked(audio)` | Queue-based streamed playback |
| Input sanitization | `sanitize()` | `InputSanitizer.Sanitize()` | XSS prevention, HTML entity escaping |
| Content moderation | `moderate()` | `ContentModerator.Check()` | Keyword-based, exit_convo on violation |
| Rate limiting | `rateLimiter.checkLimit()` | `RateLimiter.Check()` | Per-player per-NPC per-minute |
| Narration stripping | `stripNarration()` | Applied after LLM response | Removes `(stage directions)` and `*actions*` |
| Tool call handling | `toolRegistry.executeTool()` | `ToolRegistry.Execute()` | Conversation + game-event separation |
| Exit conversation | `exit_convo` tool | `ExitHandler.Handle()` | Security escape, stays in character |
| Player identity | `player_info` at session start | `session.StartConversation(playerInfo)` | Name, description, role, context |
| Conversation history | `assembleConversationHistory()` | `ContextBuilder.AssembleHistory()` | Last N messages, token-bounded |
| Mood drift | `blendMoods()` | `PersonalityEngine.BlendMoods()` | After moderation actions |

### Security Features

| Feature | TypeScript | Unity | Notes |
|---------|-----------|-------|-------|
| Core anchor immutability | `validateAnchorIntegrity()` | `AnchorGuard.Validate()` | Checked at session end |
| Input injection filter | `filterInjectionPatterns()` | `InputSanitizer.FilterInjections()` | Strips instruction injection, preserves quotes |
| BYOK API key isolation | `resolveProjectLlmProvider()` | Keys in `SoulEngineSettings` asset | Never in code or plaintext |
| Game client authentication | SHA-256 hashed API key | `x-api-key` header on session start | Optional per-project |

---

## Unity Scene Setup

### Minimal Scene Requirements

A fully functional SoulEngine scene needs just three GameObjects with their respective scripts:

```
Scene Hierarchy:
  [SoulEngine Manager]
      SoulEngineManager.cs      <- Required, singleton

  [NPC: Osman]
      NPCCharacter.cs           <- One per NPC
      (your other NPC scripts, animator, NavMeshAgent, etc.)

  [NPC: Elara]
      NPCCharacter.cs

  [Tool Handler]                <- Optional, only if you use MCP tools
      GameToolHandler.cs
```

That's it. Three script types for a complete NPC system.

---

### Script 1: SoulEngineManager (Singleton)

Place on a persistent GameObject (do not destroy on load). Holds all configuration, initializes providers, and manages active sessions.

**Inspector fields to fill in:**

| Field | Description |
|-------|-------------|
| Project ID | From soulengine.dev project settings |
| LLM Provider | gemini / openai / anthropic / grok |
| LLM API Key | Your provider key |
| TTS Provider | cartesia / elevenlabs |
| TTS API Key | Your Cartesia or ElevenLabs key |
| STT API Key | Your Deepgram key |
| Game Client API Key | Optional, from project security settings |

The manager auto-downloads project files on startup (definitions, knowledge, MCP tools) and caches them in `StreamingAssets/SoulEngine/{projectId}/`.

```csharp
// How to use from game code
var session = await SoulEngineManager.Instance.StartConversation(
    npcId: "npc_osman",
    playerId: "player_1",
    playerInfo: new PlayerInfo { Name = "Sir Aldric", Description = "A knight in silver armor" },
    mode: ConversationMode.VoiceVoice
);

await SoulEngineManager.Instance.EndConversation(session.Id);
```

---

### Script 2: NPCCharacter (MonoBehaviour)

Attach to each NPC GameObject. Handles the conversation lifecycle for that specific NPC. Wire up Unity Events in the Inspector — no code required for basic use.

**Inspector fields to fill in:**

| Field | Description |
|-------|-------------|
| NPC ID | From soulengine.dev NPC editor (e.g. `npc_abc123`) |
| Player ID | Your player identifier string |
| Conversation Mode | TextText / VoiceVoice / TextVoice / VoiceText |
| Audio Source | AudioSource component for TTS playback (voice output modes) |

**Unity Events (wire in Inspector):**

| Event | When Fires | Payload |
|-------|-----------|---------|
| `OnNPCSpeak` | NPC generates a text response | `string` text |
| `OnPlayerSpeak` | Player speech transcribed (voice input) | `string` transcript |
| `OnConversationStart` | Conversation begins | — |
| `OnConversationEnd` | Conversation ends | — |
| `OnToolCall` | NPC invokes a game tool | `string` toolName, `object` args |
| `OnMoodChange` | NPC mood updates | `MoodVector` |

**Trigger conversation from any script:**

```csharp
// On proximity trigger
async void OnTriggerEnter(Collider other) {
    if (other.CompareTag("Player")) {
        await npcCharacter.StartConversation();
    }
}

// On player leave
async void OnTriggerExit(Collider other) {
    if (other.CompareTag("Player")) {
        await npcCharacter.EndConversation();
    }
}

// Send a text message (text-* modes)
await npcCharacter.SendMessage("I need information about the eastern road.");

// Feed microphone audio (voice-* modes) — called per frame during active VAD
npcCharacter.PushAudio(microphoneSamples);
```

---

### Script 3: GameToolHandler (Optional)

Register handler functions for each MCP tool you've defined in your project. If your NPCs don't use any MCP tools, skip this script entirely.

**Pattern:**

```csharp
void Start() {
    ToolRegistry.Register("call_police", async (args) => {
        var location = args["location"].ToString();
        var urgency = (int)args["urgency"];
        await SpawnPoliceAt(location, urgency);
        return new ToolResult { Success = true };
    });

    ToolRegistry.Register("flee_to", async (args) => {
        var locationId = args["location_id"].ToString();
        await npcNavAgent.FleeToWaypoint(locationId);
        return new ToolResult { Success = true };
    });

    ToolRegistry.Register("lock_door", async (args) => {
        var doorId = args["door_id"].ToString();
        DoorManager.Lock(doorId);
        return new ToolResult { Success = true };
    });
}
```

---

## Scene Configuration Walkthrough

### Step 1: Create Project on soulengine.dev

1. Sign in at soulengine.dev
2. Create a new project
3. Go to **Settings** → add your LLM, TTS, STT API keys
4. Design your NPCs in the **NPC Editor** (name, backstory, principles, voice, schedule, tools)
5. Add knowledge categories in the **Knowledge** tab
6. Define MCP tools in the **MCP Tools** tab
7. From **Settings** → **Game Client Security**: Generate a Game Client API Key
8. Copy your **Project ID** and **Game Client API Key**

### Step 2: Import SoulEngine into Unity

1. Import the SoulEngine Unity package
2. `Window -> SoulEngine -> Setup Wizard`
3. Enter Project ID + Game Client API Key
4. Click **Link Project** — SDK downloads all project files to `StreamingAssets/SoulEngine/`

### Step 3: Configure the Scene

```
1. Create empty GameObject "SoulEngine Manager"
   -> Add SoulEngineManager.cs
   -> Fill in: LLM/TTS/STT API keys, provider selections

2. Select each NPC GameObject
   -> Add NPCCharacter.cs
   -> Set NPC ID (copy from soulengine.dev NPC editor)
   -> Set Player ID (e.g. "player_1" or your player identifier)
   -> Set Conversation Mode
   -> Wire up AudioSource (for voice output)
   -> Wire up Unity Events (optional)

3. If using MCP tools:
   -> Create empty GameObject "Tool Handler"
   -> Add GameToolHandler.cs
   -> Implement handlers for each tool your NPCs can use
```

### Step 4: Trigger Conversations

```csharp
// Minimal: proximity-based start/end
public class NPCInteraction : MonoBehaviour {
    [SerializeField] NPCCharacter npc;

    async void OnTriggerEnter(Collider c) {
        if (!c.CompareTag("Player")) return;
        var player = c.GetComponent<PlayerController>();
        await npc.StartConversation(new PlayerInfo {
            Name = player.CharacterName,
            Description = "A traveler in worn leather armor"
        });
    }

    async void OnTriggerExit(Collider c) {
        if (c.CompareTag("Player")) await npc.EndConversation();
    }
}
```

### Step 5: Run Memory Cycles at Game Events

```csharp
// End of in-game day
public async void OnGameDayEnd(DayContext context) {
    foreach (var npc in activeNpcs) {
        await SoulEngineManager.Instance.RunDailyPulse(npc.NpcId, playerId, context);
    }
}

// End of in-game week (memory consolidation)
public async void OnGameWeekEnd() {
    foreach (var npc in activeNpcs) {
        await SoulEngineManager.Instance.RunWeeklyWhisper(npc.NpcId, playerId);
    }
}

// Major story milestone (personality evolution)
public async void OnMajorAct() {
    foreach (var npc in activeNpcs) {
        await SoulEngineManager.Instance.RunPersonaShift(npc.NpcId, playerId);
    }
}
```

---

## SDK Package Structure

```
Assets/
+-- SoulEngine/
    +-- Runtime/
    |   +-- Core/
    |   |   +-- SoulEngineManager.cs       # Singleton entry point, initializes everything
    |   |   +-- NPCCharacter.cs            # MonoBehaviour, attach to NPC GameObjects
    |   |   +-- SessionManager.cs          # Conversation lifecycle (start, end, state)
    |   |
    |   +-- Providers/
    |   |   +-- LLM/
    |   |   |   +-- ILLMProvider.cs
    |   |   |   +-- GeminiProvider.cs
    |   |   |   +-- OpenAIProvider.cs
    |   |   |   +-- AnthropicProvider.cs
    |   |   |   +-- GrokProvider.cs
    |   |   +-- STT/
    |   |   |   +-- ISTTProvider.cs
    |   |   |   +-- DeepgramProvider.cs    # WebSocket streaming transcription
    |   |   +-- TTS/
    |   |       +-- ITTSProvider.cs
    |   |       +-- CartesiaProvider.cs    # WebSocket streaming synthesis
    |   |       +-- ElevenLabsProvider.cs
    |   |
    |   +-- Voice/
    |   |   +-- VoicePipeline.cs           # Orchestrates all 4 modes
    |   |   +-- MicrophoneCapture.cs       # Unity microphone access
    |   |   +-- VADProcessor.cs            # Silero VAD via Unity Sentis
    |   |   +-- AudioPlayback.cs           # Chunk-based streaming playback
    |   |   +-- SentenceDetector.cs        # Split LLM output for TTS
    |   |
    |   +-- Memory/
    |   |   +-- MemoryCycles.cs            # Daily / Weekly / Persona
    |   |   +-- ConversationSummarizer.cs  # End-of-session STM creation + LTM synthesis
    |   |   +-- SalienceCalculator.cs      # Salience scoring formula
    |   |   +-- MemoryManager.cs           # STM/LTM lifecycle (create, prune, promote)
    |   |
    |   +-- Context/
    |   |   +-- ContextBuilder.cs          # System prompt assembly (all sections)
    |   |   +-- KnowledgeResolver.cs       # Depth-filtered knowledge access
    |   |   +-- NetworkResolver.cs         # NPC relationship context injection
    |   |
    |   +-- Security/
    |   |   +-- InputSanitizer.cs          # XSS + injection pattern removal
    |   |   +-- ContentModerator.cs        # Keyword-based moderation + exit_convo
    |   |   +-- RateLimiter.cs             # Per-player per-NPC rate limit
    |   |   +-- AnchorGuard.cs             # Core anchor immutability enforcement
    |   |
    |   +-- Storage/
    |   |   +-- LocalStorage.cs            # Read/write StreamingAssets YAML/JSON
    |   |   +-- ProjectLoader.cs           # Load and parse project config
    |   |   +-- StateManager.cs            # Instance state read/write + versioning
    |   |
    |   +-- Sync/
    |   |   +-- SyncManager.cs             # Cloud sync orchestration
    |   |   +-- CloudClient.cs             # SoulEngine REST API client
    |   |   +-- ConflictResolver.cs        # Local-wins merge strategy
    |   |
    |   +-- MCP/
    |   |   +-- ToolRegistry.cs            # Register + resolve available tools
    |   |   +-- ToolExecutor.cs            # Execute tool calls with validation
    |   |   +-- ExitHandler.cs             # exit_convo handling
    |   |
    |   +-- Types/
    |       +-- NPCDefinition.cs
    |       +-- NPCInstance.cs
    |       +-- Memory.cs
    |       +-- MoodVector.cs
    |       +-- ConversationMode.cs
    |       +-- PlayerInfo.cs
    |       +-- ToolDefinition.cs
    |
    +-- Editor/
    |   +-- SoulEngineSetupWizard.cs       # Project linking + download
    |   +-- NPCInspector.cs               # Custom inspector for NPCCharacter
    |   +-- DebugWindow.cs                # Runtime debug view (mind state, mood)
    |
    +-- Models/
    |   +-- silero_vad.onnx               # VAD model for Unity Sentis
    |
    +-- Resources/
        +-- SoulEngineSettings.asset      # ScriptableObject for credentials
```

---

## Core Classes

### SoulEngineManager

```csharp
namespace SoulEngine
{
    public class SoulEngineManager : MonoBehaviour
    {
        public static SoulEngineManager Instance { get; private set; }

        [Header("Project")]
        public SoulEngineSettings settings;   // ScriptableObject with all API keys

        // PUBLIC API

        // Start a conversation with an NPC
        public async Task<NPCSession> StartConversation(
            string npcId,
            string playerId,
            PlayerInfo playerInfo = null,
            ConversationMode mode = ConversationMode.TextText)

        // End conversation: summarize, save instance, archive version, sync cloud
        public async Task EndConversation(string sessionId)

        // Memory cycles — call at appropriate game events
        public async Task RunDailyPulse(string npcId, string playerId, DayContext context = null)
        public async Task RunWeeklyWhisper(string npcId, string playerId, int retainCount = 3)
        public async Task RunPersonaShift(string npcId, string playerId)

        // Cloud sync
        public async Task SyncToCloud()
        public async Task RefreshFromCloud()

        // State access
        public NPCInstance GetInstance(string npcId, string playerId)
    }
}
```

### NPCCharacter

```csharp
namespace SoulEngine
{
    public class NPCCharacter : MonoBehaviour
    {
        [Header("NPC Configuration")]
        public string npcId;
        public string playerId = "default_player";

        [Header("Voice Settings")]
        public ConversationMode mode = ConversationMode.TextText;
        public AudioSource audioSource;    // For TTS output

        [Header("Events")]
        public UnityEvent<string> OnNPCSpeak;         // text response
        public UnityEvent<string> OnPlayerSpeak;       // transcribed input
        public UnityEvent<MoodVector> OnMoodChange;    // mood update
        public UnityEvent OnConversationStart;
        public UnityEvent OnConversationEnd;
        public UnityEvent<string, object> OnToolCall;  // tool name + args

        // Call from your trigger/interaction logic
        public async Task StartConversation(PlayerInfo playerInfo = null)
        public async Task EndConversation()
        public async Task SendMessage(string text)       // text input modes
        public void PushAudio(float[] samples)           // voice input modes
        public void Interrupt()                          // stop current generation

        // Read current state
        public MoodVector CurrentMood { get; }
        public NPCInstance CurrentInstance { get; }
    }
}
```

### GameToolHandler

```csharp
namespace SoulEngine
{
    // Extend this class to register your game's tool implementations
    public abstract class GameToolHandler : MonoBehaviour
    {
        void Awake() {
            RegisterTools();
        }

        protected abstract void RegisterTools();

        // Helper: register a tool implementation
        protected void Register(string toolName, Func<Dictionary<string, object>, Task<ToolResult>> handler) {
            ToolRegistry.Register(toolName, handler);
        }
    }
}

// Example: your implementation
public class MyGameToolHandler : GameToolHandler
{
    protected override void RegisterTools()
    {
        Register("call_police", async (args) => {
            string location = args["location"].ToString();
            int urgency = Convert.ToInt32(args["urgency"]);
            await PoliceSystem.Dispatch(location, urgency);
            return ToolResult.Success();
        });

        Register("refuse_service", async (args) => {
            string target = args["target"].ToString();
            ShopSystem.RefusePlayer(target);
            return ToolResult.Success();
        });

        Register("flee_to", async (args) => {
            string locationId = args["location_id"].ToString();
            GetComponent<NavMeshAgent>().SetDestination(Waypoints.Get(locationId));
            return ToolResult.Success();
        });
    }
}
```

---

## State Synchronization

### SyncManager

```csharp
namespace SoulEngine.Sync
{
    public static class SyncManager
    {
        // Queue instance for cloud sync (call after EndConversation or cycles)
        public static async Task SyncInstanceAsync(NPCInstance instance)

        // Flush all pending sync operations
        public static async Task SyncAllPendingAsync()

        // Pull project updates (new NPCs, knowledge changes, etc.)
        public static async Task PullProjectUpdatesAsync(string projectId)

        // Definition version history
        public static async Task<List<DefinitionHistoryEntry>> GetDefinitionHistoryAsync(string projectId, string npcId)
        public static async Task<DefinitionHistorySnapshot> GetDefinitionSnapshotAsync(string projectId, string npcId, int version)
        public static async Task<NPCDefinition> RollbackDefinitionAsync(string projectId, string npcId, int targetVersion)

        // Mind state version history
        public static async Task<List<InstanceHistoryEntry>> GetInstanceHistoryAsync(string instanceId)
        public static async Task<NPCInstance> GetInstanceSnapshotAsync(string instanceId, string version)
        public static async Task<NPCInstance> RollbackInstanceAsync(string instanceId, string version)
    }
}
```

---

## Voice Pipeline Details

### Conversation Mode Handling

```csharp
public class VoicePipeline
{
    private readonly ConversationMode mode;
    private ISTTSession sttSession;    // Only active in voice-input modes
    private ITTSSession ttsSession;    // Only active in voice-output modes

    public async Task Initialize()
    {
        // STT only if input is voice
        if (mode.Input == InputMode.Voice)
            sttSession = await sttProvider.CreateSession(new STTConfig { Language = "en", Model = "nova-2" });

        // TTS only if output is voice
        if (mode.Output == OutputMode.Voice)
            ttsSession = await ttsProvider.CreateSession(new TTSConfig {
                VoiceId = session.Definition.Voice.VoiceId,
                Speed = session.Definition.Voice.Speed
            });
    }

    // Full turn: input -> security -> LLM -> narration strip -> TTS (if voice out)
    private async Task ProcessTurn(string input)
    {
        var systemPrompt = ContextBuilder.Build(session.Definition, session.Instance);

        await foreach (var chunk in llmProvider.StreamChat(systemPrompt, history, input))
        {
            if (chunk.Text != null)
            {
                // Strip stage directions and asterisk actions
                var cleanText = NarrationFilter.Strip(chunk.Text);
                OnTextChunk?.Invoke(cleanText);

                if (mode.Output == OutputMode.Voice)
                {
                    var sentences = sentenceDetector.AddChunk(cleanText);
                    foreach (var s in sentences) await ttsSession.Synthesize(s);
                }
            }
            if (chunk.ToolCall != null) OnToolCall?.Invoke(chunk.ToolCall.Name, chunk.ToolCall.Arguments);
        }
    }
}
```

### VAD with Unity Sentis

- Load `silero_vad.onnx` model via Unity Sentis (Inference Engine)
- Process 30ms audio chunks in <1ms on CPU
- Entirely client-side — saves bandwidth, enables instant interruption
- Cross-platform: Windows, macOS, iOS, Android

```csharp
public class VADProcessor
{
    private Model vadModel;
    private IWorker worker;

    public void Initialize() {
        vadModel = ModelLoader.Load(vadOnnxAsset);
        worker = WorkerFactory.CreateWorker(BackendType.CPU, vadModel);
    }

    public bool ProcessChunk(float[] samples) {
        // Returns true if speech detected
        var tensor = new TensorFloat(new TensorShape(1, samples.Length), samples);
        worker.Execute(new Dictionary<string, Tensor> { {"input", tensor} });
        var output = worker.PeekOutput() as TensorFloat;
        return output[0] > vadThreshold;
    }
}
```

---

## Developer API Reference

### Quick Start (Complete Example)

```csharp
using SoulEngine;

public class GameManager : MonoBehaviour
{
    async void Start()
    {
        // Optional: refresh definitions/knowledge from cloud
        await SoulEngineManager.Instance.RefreshFromCloud();
    }
}

public class NPCInteractionZone : MonoBehaviour
{
    [SerializeField] NPCCharacter npc;

    void Awake()
    {
        // Wire up events in code (or use Inspector Unity Events)
        npc.OnNPCSpeak.AddListener(text => dialogueUI.ShowNPCText(text));
        npc.OnPlayerSpeak.AddListener(text => dialogueUI.ShowPlayerText(text));
        npc.OnMoodChange.AddListener(mood => moodIndicator.Update(mood));
        npc.OnToolCall.AddListener((toolName, args) => Debug.Log($"Tool: {toolName}"));
    }

    async void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag("Player")) return;

        var player = other.GetComponent<PlayerController>();
        await npc.StartConversation(new PlayerInfo {
            Name = player.CharacterName,
            Description = player.Appearance,
            Role = player.CurrentRole,
            Context = player.GetNPCContext(npc.npcId)
        });
    }

    async void OnTriggerExit(Collider other)
    {
        if (other.CompareTag("Player")) await npc.EndConversation();
    }

    // For text input modes
    public async void OnPlayerSendMessage(string text) => await npc.SendMessage(text);
}
```

### Memory Cycles at Game Events

```csharp
public class GameTimeManager : MonoBehaviour
{
    [SerializeField] NPCCharacter[] allNPCs;
    private string playerId = "player_1";

    // Call at end of each in-game day
    public async void OnDayEnd(GameDayContext dayCtx)
    {
        var context = new DayContext {
            GameTime = dayCtx.timeString,
            Events = dayCtx.significantEvents,
            OverallMood = dayCtx.mood   // "positive" / "neutral" / "negative"
        };

        foreach (var npc in allNPCs)
            await SoulEngineManager.Instance.RunDailyPulse(npc.npcId, playerId, context);
    }

    // Call at end of each in-game week
    public async void OnWeekEnd()
    {
        foreach (var npc in allNPCs)
            await SoulEngineManager.Instance.RunWeeklyWhisper(npc.npcId, playerId);
    }

    // Call at major story milestones / act breaks
    public async void OnMajorMilestone()
    {
        foreach (var npc in allNPCs)
            await SoulEngineManager.Instance.RunPersonaShift(npc.npcId, playerId);
    }

    // Before save / quit
    public async void OnBeforeSave()
    {
        await SoulEngineManager.Instance.SyncToCloud();
    }
}
```

---

## TypeScript → C# File Mapping

| TypeScript File | C# Equivalent |
|-----------------|---------------|
| `src/providers/llm/gemini.ts` | `Providers/LLM/GeminiProvider.cs` |
| `src/providers/llm/openai.ts` | `Providers/LLM/OpenAIProvider.cs` |
| `src/providers/llm/anthropic.ts` | `Providers/LLM/AnthropicProvider.cs` |
| `src/providers/llm/grok.ts` | `Providers/LLM/GrokProvider.cs` |
| `src/providers/llm/factory.ts` | `Core/SoulEngineManager.cs` (InitializeProviders) |
| `src/providers/stt/deepgram.ts` | `Providers/STT/DeepgramProvider.cs` |
| `src/providers/tts/cartesia.ts` | `Providers/TTS/CartesiaProvider.cs` |
| `src/providers/tts/elevenlabs.ts` | `Providers/TTS/ElevenLabsProvider.cs` |
| `src/voice/pipeline.ts` | `Voice/VoicePipeline.cs` |
| `src/core/context.ts` | `Context/ContextBuilder.cs` |
| `src/core/cycles.ts` | `Memory/MemoryCycles.cs` |
| `src/core/summarizer.ts` | `Memory/ConversationSummarizer.cs` |
| `src/core/memory.ts` | `Memory/MemoryManager.cs` + `Memory/SalienceCalculator.cs` |
| `src/core/personality.ts` | `Memory/PersonalityEngine.cs` |
| `src/core/knowledge.ts` | `Context/KnowledgeResolver.cs` |
| `src/core/tools.ts` | `MCP/ToolRegistry.cs` |
| `src/session/manager.ts` | `Core/SessionManager.cs` |
| `src/security/sanitizer.ts` | `Security/InputSanitizer.cs` |
| `src/security/moderator.ts` | `Security/ContentModerator.cs` |
| `src/security/rate-limiter.ts` | `Security/RateLimiter.cs` |
| `src/storage/local/instances.ts` | `Storage/StateManager.cs` + `Storage/LocalStorage.cs` |
| `src/mcp/registry.ts` | `MCP/ToolRegistry.cs` |
| `src/mcp/exit-handler.ts` | `MCP/ExitHandler.cs` |

---

## Implementation Phases

### Phase 1: Core SDK Structure
- [ ] Create Unity package structure with namespace `SoulEngine`
- [ ] Implement `LocalStorage` (StreamingAssets YAML/JSON read/write)
- [ ] Implement `ProjectLoader` (parse project.yaml + definitions)
- [ ] Create `SoulEngineSettings` ScriptableObject
- [ ] Implement Setup Wizard (Editor window, project link + download)
- [ ] Implement basic `NPCDefinition` and `NPCInstance` types

### Phase 2: Provider Ports
- [ ] Port LLM providers (streaming REST in C#, async enumerable)
- [ ] Port STT provider (WebSocket to Deepgram, `NativeWebSocket`)
- [ ] Port TTS providers (WebSocket to Cartesia / ElevenLabs)
- [ ] Factory pattern: `SoulEngineManager.InitializeProviders()`

### Phase 3: Voice Pipeline
- [ ] Port `VoicePipeline` (all 4 modes)
- [ ] Implement `MicrophoneCapture` (Unity Microphone API)
- [ ] Implement `VADProcessor` (Silero via Unity Sentis)
- [ ] Implement `AudioPlayback` (chunk queue)
- [ ] Port `SentenceDetector` (TTS chunking)
- [ ] Implement `NarrationFilter` (strip stage directions)

### Phase 4: Context & Memory
- [ ] Port `ContextBuilder` (full system prompt assembly)
- [ ] Port `KnowledgeResolver` + `NetworkResolver`
- [ ] Port `MemoryManager` + `SalienceCalculator`
- [ ] Port `MemoryCycles` (Daily / Weekly / Persona)
- [ ] Port `ConversationSummarizer` (STM creation + LTM synthesis)

### Phase 5: Security
- [ ] Port `InputSanitizer`
- [ ] Port `ContentModerator`
- [ ] Port `RateLimiter`
- [ ] Port `AnchorGuard`

### Phase 6: Sync & Cloud
- [ ] Implement `CloudClient` (SoulEngine REST API)
- [ ] Implement `SyncManager`
- [ ] Handle offline/online transitions

### Phase 7: Testing & Polish
- [ ] Create sample scene (2-3 NPCs, trigger zone, tool handler)
- [ ] Write `NPCInspector` custom editor
- [ ] Write `DebugWindow` (runtime mind state viewer)
- [ ] Performance profiling (especially STT/TTS WebSocket)
- [ ] Publish to Unity Asset Store

---

## Security & BYOK

The Unity SDK uses a **Bring Your Own Key (BYOK)** model. API keys are stored in `SoulEngineSettings.asset` (a ScriptableObject), never hardcoded in scripts. Keys are passed directly to provider APIs — neither SoulEngine's cloud nor any intermediary server sees them during gameplay.

### API Key Protection

- **Never commit** `SoulEngineSettings.asset` to source control if it contains real keys. Add it to `.gitignore`.
- For production builds, consider loading keys from a separate encrypted config file rather than the ScriptableObject.
- **Game Client API Key** (`x-api-key`): Required when communicating with the SoulEngine cloud backend (sync, history). Generated from the project settings page, hashed before storage server-side.

---

## Notes

### WebSocket Libraries for Unity
- **NativeWebSocket** (`com.endel.nativewebsocket`) — Recommended, works on all platforms
- **websocket-sharp** — Alternative
- Unity 6+ has built-in WebSocket support

### Audio Formats
- Deepgram expects: 16kHz, 16-bit PCM, mono
- Cartesia returns: 24kHz, 16-bit PCM (configurable)
- Unity AudioClip: Convert with `AudioConverter` utility class

### Unity Sentis (Inference Engine)
- Silero VAD model: ~1MB ONNX, included in package
- <1ms per 30ms audio chunk on CPU
- Fully cross-platform, no cloud dependency
