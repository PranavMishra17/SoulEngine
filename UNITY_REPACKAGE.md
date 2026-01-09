# SoulEngine Unity SDK

Implementation plan for repackaging SoulEngine as a Unity asset that runs all NPC intelligence locally while syncing state to the cloud.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UNITY GAME                                     │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                    SoulEngine SDK (C#)                                │ │
│  │                                                                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │ LLMProvider │  │ STTProvider │  │ TTSProvider │  │ VADProcessor│  │ │
│  │  │ (REST/SSE)  │  │ (WebSocket) │  │ (WebSocket) │  │ (Silero)    │  │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │ │
│  │         │                │                │                │         │ │
│  │         └────────────────┼────────────────┼────────────────┘         │ │
│  │                          │                │                          │ │
│  │                    ┌─────┴────────────────┴─────┐                    │ │
│  │                    │      VoicePipeline         │                    │ │
│  │                    │  - Conversation orchestration                   │ │
│  │                    │  - Turn management                              │ │
│  │                    │  - Security/moderation                          │ │
│  │                    └─────────────┬──────────────┘                    │ │
│  │                                  │                                   │ │
│  │  ┌─────────────────┐  ┌─────────┴─────────┐  ┌─────────────────┐    │ │
│  │  │  MemoryCycles   │  │   SessionManager  │  │  ContextBuilder │    │ │
│  │  │ - DailyPulse    │  │ - Start/End       │  │ - System prompt │    │ │
│  │  │ - WeeklyWhisper │  │ - State tracking  │  │ - Knowledge     │    │ │
│  │  │ - PersonaShift  │  │ - Summarization   │  │ - Network       │    │ │
│  │  └─────────────────┘  └───────────────────┘  └─────────────────┘    │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    │ Local Read/Write                      │
│                                    ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     Local Storage (StreamingAssets)                   │ │
│  │  - Project config (project.yaml)                                      │ │
│  │  - NPC definitions (*.yaml)                                           │ │
│  │  - NPC instances/state (*.json)                                       │ │
│  │  - Knowledge base                                                     │ │
│  │  - MCP tool definitions                                               │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    │ Async Sync                            │
│                                    ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         SyncManager                                   │ │
│  │  - Push NPC state changes to cloud                                    │ │
│  │  - Pull project updates from cloud                                    │ │
│  │  - Conflict resolution (local wins)                                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │ HTTPS
                                     ▼
                    ┌────────────────────────────────┐
                    │        SoulEngine Cloud        │
                    │    (Supabase + Vercel)         │
                    │                                │
                    │  - Project management          │
                    │  - NPC state backup            │
                    │  - User authentication         │
                    └────────────────────────────────┘
```

---

## Key Design Principles

1. **All Processing is Local**: LLM calls, STT, TTS, memory cycles - everything runs from Unity
2. **Cloud is for Sync Only**: Backend stores project data and NPC states as backups
3. **Offline-First**: Game works without internet; syncs when connection available
4. **Direct Provider Connections**: Unity connects directly to Gemini/Deepgram/Cartesia APIs
5. **Project Created on Website**: Users design NPCs on soulengine.dev, then link in Unity

---

## SDK Structure

### Namespace: `SoulEngine`

```
Assets/
└── SoulEngine/
    ├── Runtime/
    │   ├── Core/
    │   │   ├── SoulEngineManager.cs       # Singleton manager
    │   │   ├── NPCCharacter.cs            # MonoBehaviour for NPCs
    │   │   └── SessionManager.cs          # Conversation lifecycle
    │   │
    │   ├── Providers/
    │   │   ├── LLM/
    │   │   │   ├── ILLMProvider.cs        # Interface
    │   │   │   ├── GeminiProvider.cs      # Google Gemini
    │   │   │   ├── OpenAIProvider.cs      # OpenAI
    │   │   │   ├── AnthropicProvider.cs   # Claude
    │   │   │   └── GrokProvider.cs        # xAI Grok
    │   │   ├── STT/
    │   │   │   ├── ISTTProvider.cs        # Interface
    │   │   │   └── DeepgramProvider.cs    # Deepgram WebSocket
    │   │   └── TTS/
    │   │       ├── ITTSProvider.cs        # Interface
    │   │       ├── CartesiaProvider.cs    # Cartesia WebSocket
    │   │       └── ElevenLabsProvider.cs  # ElevenLabs WebSocket
    │   │
    │   ├── Voice/
    │   │   ├── VoicePipeline.cs           # Orchestrates STT→LLM→TTS
    │   │   ├── MicrophoneCapture.cs       # Unity microphone input
    │   │   ├── VADProcessor.cs            # Silero VAD via Sentis
    │   │   ├── AudioPlayback.cs           # Queue-based audio player
    │   │   └── SentenceDetector.cs        # Text chunking for TTS
    │   │
    │   ├── Memory/
    │   │   ├── MemoryCycles.cs            # Daily/Weekly/Persona
    │   │   ├── ConversationSummarizer.cs  # End-of-session summary
    │   │   └── SalienceCalculator.cs      # Memory importance scoring
    │   │
    │   ├── Context/
    │   │   ├── ContextBuilder.cs          # System prompt assembly
    │   │   ├── KnowledgeResolver.cs       # Knowledge base access
    │   │   └── NetworkResolver.cs         # NPC network context
    │   │
    │   ├── Storage/
    │   │   ├── LocalStorage.cs            # Read/write local YAML/JSON
    │   │   ├── ProjectLoader.cs           # Load project from files
    │   │   └── StateManager.cs            # NPC instance state
    │   │
    │   ├── Sync/
    │   │   ├── SyncManager.cs             # Cloud sync orchestration
    │   │   ├── CloudClient.cs             # Supabase REST client
    │   │   └── ConflictResolver.cs        # Local-wins merge logic
    │   │
    │   ├── MCP/
    │   │   ├── ToolRegistry.cs            # Available tools
    │   │   ├── ToolExecutor.cs            # Execute tool calls
    │   │   └── ExitHandler.cs             # exit_convo handling
    │   │
    │   └── Types/
    │       ├── NPCDefinition.cs           # NPC static data
    │       ├── NPCInstance.cs             # NPC runtime state
    │       ├── Memory.cs                  # Memory structures
    │       └── ConversationMode.cs        # Text/Voice modes
    │
    ├── Editor/
    │   ├── SoulEngineSetupWizard.cs       # Project linking UI
    │   ├── NPCInspector.cs                # Custom NPC inspector
    │   └── DebugWindow.cs                 # Debug/testing window
    │
    ├── Models/
    │   └── silero_vad.onnx                # VAD model for Sentis
    │
    └── Resources/
        └── SoulEngineSettings.asset       # Project config asset
```

---

## Project Linking Flow

### Step 1: User Creates Project on Website

```
1. User visits soulengine.dev
2. Creates account (Google OAuth)
3. Creates project, adds NPCs, knowledge, tools
4. Gets Project ID + API Key from Settings page
```

### Step 2: Link Project in Unity

```csharp
// In Unity Editor: SoulEngine > Setup Wizard

public class SoulEngineSetupWizard : EditorWindow
{
    private string projectId;
    private string apiKey;
    
    void OnGUI()
    {
        projectId = EditorGUILayout.TextField("Project ID", projectId);
        apiKey = EditorGUILayout.PasswordField("API Key", apiKey);
        
        if (GUILayout.Button("Link Project"))
        {
            await LinkProject(projectId, apiKey);
        }
    }
    
    async Task LinkProject(string projectId, string apiKey)
    {
        // 1. Validate credentials with cloud
        // 2. Download project files to StreamingAssets
        // 3. Save credentials to SoulEngineSettings.asset
    }
}
```

### Step 3: SDK Downloads Project Files

```
StreamingAssets/
└── SoulEngine/
    └── {project_id}/
        ├── project.yaml           # Project config
        ├── definitions/
        │   ├── npc_abc123.yaml    # NPC definitions
        │   └── npc_def456.yaml
        ├── instances/
        │   └── inst_xyz789/
        │       └── current.json   # NPC state
        ├── knowledge.yaml         # Knowledge base
        └── mcp-tools.yaml         # Tool definitions
```

---

## Core Classes

### SoulEngineManager (Singleton)

```csharp
namespace SoulEngine
{
    public class SoulEngineManager : MonoBehaviour
    {
        public static SoulEngineManager Instance { get; private set; }
        
        [Header("Configuration")]
        public SoulEngineSettings settings;
        
        [Header("Providers")]
        private ILLMProvider llmProvider;
        private ISTTProvider sttProvider;
        private ITTSProvider ttsProvider;
        
        // Active sessions
        private Dictionary<string, NPCSession> activeSessions = new();
        
        void Awake()
        {
            Instance = this;
            InitializeProviders();
        }
        
        void InitializeProviders()
        {
            // Initialize based on project settings
            llmProvider = settings.llmProvider switch
            {
                "gemini" => new GeminiProvider(settings.geminiApiKey),
                "openai" => new OpenAIProvider(settings.openaiApiKey),
                "anthropic" => new AnthropicProvider(settings.anthropicApiKey),
                "grok" => new GrokProvider(settings.grokApiKey),
                _ => new GeminiProvider(settings.geminiApiKey)
            };
            
            sttProvider = new DeepgramProvider(settings.deepgramApiKey);
            ttsProvider = settings.ttsProvider switch
            {
                "cartesia" => new CartesiaProvider(settings.cartesiaApiKey),
                "elevenlabs" => new ElevenLabsProvider(settings.elevenlabsApiKey),
                _ => new CartesiaProvider(settings.cartesiaApiKey)
            };
        }
        
        // ============================================
        // PUBLIC API
        // ============================================
        
        /// <summary>
        /// Start a conversation with an NPC
        /// </summary>
        public async Task<NPCSession> StartConversation(
            string npcId,
            string playerId,
            PlayerInfo playerInfo = null,
            ConversationMode mode = ConversationMode.TextText)
        {
            var definition = LocalStorage.LoadDefinition(npcId);
            var instance = LocalStorage.LoadOrCreateInstance(npcId, playerId, definition);
            
            var session = new NPCSession(
                definition, instance, playerInfo, mode,
                llmProvider, sttProvider, ttsProvider
            );
            
            await session.Initialize();
            activeSessions[session.Id] = session;
            
            return session;
        }
        
        /// <summary>
        /// End a conversation and save state
        /// </summary>
        public async Task EndConversation(string sessionId)
        {
            if (!activeSessions.TryGetValue(sessionId, out var session))
                return;
            
            // Summarize and update state
            await session.End();
            
            // Save locally
            LocalStorage.SaveInstance(session.Instance);
            
            // Sync to cloud (async, non-blocking)
            _ = SyncManager.SyncInstanceAsync(session.Instance);
            
            activeSessions.Remove(sessionId);
        }
        
        /// <summary>
        /// Run Daily Pulse cycle for an NPC
        /// </summary>
        public async Task RunDailyPulse(string npcId, string playerId, DayContext context = null)
        {
            var instance = LocalStorage.LoadInstance(npcId, playerId);
            
            await MemoryCycles.RunDailyPulse(instance, llmProvider, context);
            
            LocalStorage.SaveInstance(instance);
            _ = SyncManager.SyncInstanceAsync(instance);
        }
        
        /// <summary>
        /// Run Weekly Whisper cycle for an NPC
        /// </summary>
        public async Task RunWeeklyWhisper(string npcId, string playerId, int retainCount = 3)
        {
            var definition = LocalStorage.LoadDefinition(npcId);
            var instance = LocalStorage.LoadInstance(npcId, playerId);
            
            await MemoryCycles.RunWeeklyWhisper(
                instance, llmProvider, 
                retainCount, 
                definition.SalienceThreshold
            );
            
            LocalStorage.SaveInstance(instance);
            _ = SyncManager.SyncInstanceAsync(instance);
        }
        
        /// <summary>
        /// Run Persona Shift cycle for an NPC
        /// </summary>
        public async Task RunPersonaShift(string npcId, string playerId)
        {
            var definition = LocalStorage.LoadDefinition(npcId);
            var instance = LocalStorage.LoadInstance(npcId, playerId);
            
            await MemoryCycles.RunPersonaShift(instance, definition, llmProvider);
            
            LocalStorage.SaveInstance(instance);
            _ = SyncManager.SyncInstanceAsync(instance);
        }
        
        /// <summary>
        /// Force sync all changes to cloud
        /// </summary>
        public async Task SyncToCloud()
        {
            await SyncManager.SyncAllPendingAsync();
        }
        
        /// <summary>
        /// Refresh project from cloud (for updated NPCs, knowledge, etc.)
        /// </summary>
        public async Task RefreshFromCloud()
        {
            await SyncManager.PullProjectUpdatesAsync(settings.projectId);
        }
    }
}
```

### NPCCharacter (MonoBehaviour)

```csharp
namespace SoulEngine
{
    public class NPCCharacter : MonoBehaviour
    {
        [Header("NPC Configuration")]
        public string npcId;
        public string playerId = "default_player";
        
        [Header("Voice Settings")]
        public ConversationMode mode = ConversationMode.VoiceVoice;
        public AudioSource audioSource;
        
        [Header("Events")]
        public UnityEvent<string> OnNPCSpeak;       // Text response
        public UnityEvent<string> OnPlayerSpeak;    // Transcribed input
        public UnityEvent OnConversationStart;
        public UnityEvent OnConversationEnd;
        public UnityEvent<string, object> OnToolCall;
        
        private NPCSession currentSession;
        
        /// <summary>
        /// Start talking to this NPC
        /// </summary>
        public async Task StartConversation(PlayerInfo playerInfo = null)
        {
            currentSession = await SoulEngineManager.Instance.StartConversation(
                npcId, playerId, playerInfo, mode
            );
            
            // Subscribe to events
            currentSession.OnTranscript += (text, isFinal) => {
                if (isFinal) OnPlayerSpeak?.Invoke(text);
            };
            currentSession.OnTextChunk += (text) => OnNPCSpeak?.Invoke(text);
            currentSession.OnAudioChunk += PlayAudio;
            currentSession.OnToolCall += (name, args) => OnToolCall?.Invoke(name, args);
            
            OnConversationStart?.Invoke();
        }
        
        /// <summary>
        /// Send a text message to the NPC
        /// </summary>
        public async Task SendMessage(string text)
        {
            if (currentSession == null) return;
            await currentSession.SendMessage(text);
        }
        
        /// <summary>
        /// Push audio samples (for voice input)
        /// </summary>
        public void PushAudio(float[] samples)
        {
            currentSession?.PushAudio(samples);
        }
        
        /// <summary>
        /// End the conversation
        /// </summary>
        public async Task EndConversation()
        {
            if (currentSession == null) return;
            
            await SoulEngineManager.Instance.EndConversation(currentSession.Id);
            currentSession = null;
            
            OnConversationEnd?.Invoke();
        }
        
        private void PlayAudio(byte[] audioData)
        {
            // Convert to AudioClip and play
            var clip = AudioConverter.BytesToClip(audioData);
            audioSource.PlayOneShot(clip);
        }
    }
}
```

---

## Voice Pipeline in C#

### VoicePipeline Class

```csharp
namespace SoulEngine.Voice
{
    public class VoicePipeline
    {
        private readonly ConversationMode mode;
        private readonly ISTTProvider sttProvider;
        private readonly ITTSProvider ttsProvider;
        private readonly ILLMProvider llmProvider;
        private readonly NPCSession session;
        
        private ISTTSession sttSession;
        private ITTSSession ttsSession;
        private SentenceDetector sentenceDetector;
        
        // Events
        public event Action<string, bool> OnTranscript;
        public event Action<string> OnTextChunk;
        public event Action<byte[]> OnAudioChunk;
        public event Action<string, Dictionary<string, object>> OnToolCall;
        public event Action OnGenerationEnd;
        
        public async Task Initialize()
        {
            sentenceDetector = new SentenceDetector();
            
            // Only init STT if voice input
            if (mode.Input == InputMode.Voice)
            {
                sttSession = await sttProvider.CreateSession(new STTConfig
                {
                    Language = "en",
                    Model = "nova-2"
                });
                sttSession.OnTranscript += HandleTranscript;
            }
            
            // Only init TTS if voice output
            if (mode.Output == OutputMode.Voice)
            {
                ttsSession = await ttsProvider.CreateSession(new TTSConfig
                {
                    VoiceId = session.Definition.Voice.VoiceId,
                    Speed = session.Definition.Voice.Speed
                });
                ttsSession.OnAudioChunk += (data) => OnAudioChunk?.Invoke(data);
            }
        }
        
        public void PushAudio(float[] samples)
        {
            if (sttSession == null) return;
            var pcmBytes = AudioConverter.FloatToPCM(samples);
            sttSession.SendAudio(pcmBytes);
        }
        
        public async Task SendText(string text)
        {
            await ProcessTurn(text);
        }
        
        private async void HandleTranscript(string text, bool isFinal)
        {
            OnTranscript?.Invoke(text, isFinal);
            
            if (isFinal && !string.IsNullOrWhiteSpace(text))
            {
                await ProcessTurn(text);
            }
        }
        
        private async Task ProcessTurn(string input)
        {
            // 1. Build context
            var systemPrompt = ContextBuilder.Build(session.Definition, session.Instance);
            var history = session.GetConversationHistory();
            
            // 2. Stream LLM response
            await foreach (var chunk in llmProvider.StreamChat(systemPrompt, history, input))
            {
                if (chunk.Text != null)
                {
                    OnTextChunk?.Invoke(chunk.Text);
                    
                    // TTS if voice output
                    if (mode.Output == OutputMode.Voice)
                    {
                        var sentences = sentenceDetector.AddChunk(chunk.Text);
                        foreach (var sentence in sentences)
                        {
                            await ttsSession.Synthesize(sentence);
                        }
                    }
                }
                
                if (chunk.ToolCall != null)
                {
                    OnToolCall?.Invoke(chunk.ToolCall.Name, chunk.ToolCall.Arguments);
                }
            }
            
            // 3. Flush remaining TTS
            if (mode.Output == OutputMode.Voice)
            {
                var remaining = sentenceDetector.Flush();
                if (!string.IsNullOrEmpty(remaining))
                {
                    await ttsSession.Synthesize(remaining);
                }
                await ttsSession.Flush();
            }
            
            OnGenerationEnd?.Invoke();
        }
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
        private static Queue<SyncOperation> pendingOperations = new();
        private static bool isSyncing = false;
        
        /// <summary>
        /// Queue an NPC instance for sync
        /// </summary>
        public static async Task SyncInstanceAsync(NPCInstance instance)
        {
            pendingOperations.Enqueue(new SyncOperation
            {
                Type = SyncType.Instance,
                Data = instance,
                Timestamp = DateTime.UtcNow
            });
            
            await ProcessQueueAsync();
        }
        
        /// <summary>
        /// Sync all pending operations
        /// </summary>
        public static async Task SyncAllPendingAsync()
        {
            while (pendingOperations.Count > 0)
            {
                await ProcessQueueAsync();
                await Task.Delay(100);
            }
        }
        
        /// <summary>
        /// Pull project updates from cloud
        /// </summary>
        public static async Task PullProjectUpdatesAsync(string projectId)
        {
            var client = new CloudClient();
            
            // Check for updates
            var cloudProject = await client.GetProject(projectId);
            var localProject = LocalStorage.LoadProject();
            
            if (cloudProject.UpdatedAt > localProject.UpdatedAt)
            {
                // Download updated files
                var definitions = await client.GetDefinitions(projectId);
                var knowledge = await client.GetKnowledge(projectId);
                var tools = await client.GetMcpTools(projectId);
                
                // Save locally
                LocalStorage.SaveProject(cloudProject);
                LocalStorage.SaveDefinitions(definitions);
                LocalStorage.SaveKnowledge(knowledge);
                LocalStorage.SaveMcpTools(tools);
            }
        }
        
        private static async Task ProcessQueueAsync()
        {
            if (isSyncing || pendingOperations.Count == 0) return;
            
            isSyncing = true;
            var client = new CloudClient();
            
            try
            {
                while (pendingOperations.TryDequeue(out var op))
                {
                    switch (op.Type)
                    {
                        case SyncType.Instance:
                            await client.UpdateInstance((NPCInstance)op.Data);
                            break;
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"Sync failed: {e.Message}. Will retry later.");
                // Re-queue failed operations
            }
            finally
            {
                isSyncing = false;
            }
        }
    }
}
```

---

## Developer API Reference

### Quick Start

```csharp
using SoulEngine;

public class GameManager : MonoBehaviour
{
    async void Start()
    {
        // Refresh project data from cloud (optional)
        await SoulEngineManager.Instance.RefreshFromCloud();
    }
}

public class NPCInteraction : MonoBehaviour
{
    public NPCCharacter npc;
    
    async void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Player"))
        {
            var playerInfo = new PlayerInfo
            {
                Name = "Sir Aldric",
                Description = "A knight in silver armor"
            };
            
            await npc.StartConversation(playerInfo);
        }
    }
    
    public async void OnPlayerSendMessage(string text)
    {
        await npc.SendMessage(text);
    }
    
    public async void OnPlayerLeave()
    {
        await npc.EndConversation();
    }
}
```

### Memory Cycles (Call at Game Events)

```csharp
// End of game day
public async void OnDayEnd()
{
    var context = new DayContext
    {
        GameTime = "Evening, Day 15",
        WorldEvents = new[] { "Storm passed", "Market opened" }
    };
    
    // Run daily pulse for all active NPCs
    foreach (var npcId in activeNpcIds)
    {
        await SoulEngineManager.Instance.RunDailyPulse(npcId, playerId, context);
    }
}

// Weekly save point
public async void OnWeekEnd()
{
    foreach (var npcId in activeNpcIds)
    {
        await SoulEngineManager.Instance.RunWeeklyWhisper(npcId, playerId);
    }
}

// Major story milestone
public async void OnActComplete()
{
    foreach (var npcId in activeNpcIds)
    {
        await SoulEngineManager.Instance.RunPersonaShift(npcId, playerId);
    }
}

// Before quitting / autosave
public async void OnGameSave()
{
    await SoulEngineManager.Instance.SyncToCloud();
}
```

### Tool Handling

```csharp
public class GameToolHandler : MonoBehaviour
{
    void Start()
    {
        // Register tool handlers
        ToolRegistry.Register("call_police", async (args) => {
            var location = args["location"].ToString();
            var urgency = (int)args["urgency"];
            
            // Execute game logic
            await SpawnPolice(location, urgency);
            
            return new ToolResult { Success = true };
        });
        
        ToolRegistry.Register("flee_to", async (args) => {
            var locationId = args["location_id"].ToString();
            
            // Make NPC run away
            await npcController.FleeToLocation(locationId);
            
            return new ToolResult { Success = true };
        });
    }
}
```

---

## Implementation Phases

### Phase 1: Core SDK Structure
- [ ] Create Unity package structure
- [ ] Implement LocalStorage (YAML/JSON read/write)
- [ ] Implement ProjectLoader
- [ ] Create SoulEngineSettings ScriptableObject
- [ ] Implement Setup Wizard (Editor)

### Phase 2: Provider Ports
- [ ] Port LLM providers (REST streaming in C#)
- [ ] Port STT provider (WebSocket to Deepgram)
- [ ] Port TTS provider (WebSocket to Cartesia/ElevenLabs)
- [ ] Implement VAD with Sentis (Silero ONNX)

### Phase 3: Voice Pipeline
- [ ] Port VoicePipeline logic
- [ ] Implement MicrophoneCapture
- [ ] Implement AudioPlayback with queue
- [ ] Port SentenceDetector

### Phase 4: Context & Memory
- [ ] Port ContextBuilder
- [ ] Port MemoryCycles (Daily/Weekly/Persona)
- [ ] Port ConversationSummarizer

### Phase 5: Sync & Cloud
- [ ] Implement CloudClient (Supabase REST)
- [ ] Implement SyncManager
- [ ] Handle offline/online transitions

### Phase 6: Testing & Polish
- [ ] Create sample scenes
- [ ] Write documentation
- [ ] Performance optimization
- [ ] Publish to Asset Store

---

## File Comparison: TypeScript → C#

| TypeScript File | C# Equivalent |
|-----------------|---------------|
| `src/providers/llm/gemini.ts` | `Providers/LLM/GeminiProvider.cs` |
| `src/providers/stt/deepgram.ts` | `Providers/STT/DeepgramProvider.cs` |
| `src/providers/tts/cartesia.ts` | `Providers/TTS/CartesiaProvider.cs` |
| `src/voice/pipeline.ts` | `Voice/VoicePipeline.cs` |
| `src/core/context.ts` | `Context/ContextBuilder.cs` |
| `src/core/cycles.ts` | `Memory/MemoryCycles.cs` |
| `src/core/summarizer.ts` | `Memory/ConversationSummarizer.cs` |
| `src/session/manager.ts` | `Core/SessionManager.cs` |
| `src/storage/definitions.ts` | `Storage/LocalStorage.cs` |
| `src/storage/instances.ts` | `Storage/StateManager.cs` |
| `src/mcp/registry.ts` | `MCP/ToolRegistry.cs` |

---

## Notes

### WebSocket Libraries for Unity
- **NativeWebSocket**: `com.endel.nativewebsocket` (recommended)
- **websocket-sharp**: Alternative option
- Unity 6+ has built-in WebSocket support

### Audio Format
- Deepgram expects: 16kHz, 16-bit PCM, mono
- Cartesia returns: 24kHz, 16-bit PCM
- Unity AudioClip: Convert as needed

### Sentis (Unity Inference Engine)
- Silero VAD model (~1MB ONNX)
- Runs on CPU, <1ms per 30ms audio chunk
- Included in SDK package
