# V2 Feature: Conversation Pipeline Modes

## Overview

This cluster implements flexible conversation modes that decouple input and output modalities. Currently the system supports text-text and voice-voice modes. This feature adds text-voice and voice-text modes, giving developers full control over how players interact with NPCs.

## Features

### Conversation Mode Matrix

| Input Mode | Output Mode | Description | Use Case |
|------------|-------------|-------------|----------|
| `text` | `text` | ✅ Implemented | Chat interfaces, accessibility |
| `voice` | `voice` | ✅ Implemented | Full voice conversations |
| `text` | `voice` | **New** | Player types, NPC speaks | Mobile games, accessibility |
| `voice` | `text` | **New** | Player speaks, NPC types | Transcription display, quiet mode |

---

## Implementation Steps

### Step 1: Define Mode Types

**File: `src/types/voice.ts`**

Add conversation mode types:

```typescript
/**
 * Input modality for conversation
 */
export type InputMode = 'text' | 'voice';

/**
 * Output modality for conversation
 */
export type OutputMode = 'text' | 'voice';

/**
 * Combined conversation mode configuration
 */
export interface ConversationMode {
  input: InputMode;
  output: OutputMode;
}

/**
 * Predefined mode shortcuts
 */
export const CONVERSATION_MODES = {
  TEXT_TEXT: { input: 'text', output: 'text' } as ConversationMode,
  VOICE_VOICE: { input: 'voice', output: 'voice' } as ConversationMode,
  TEXT_VOICE: { input: 'text', output: 'voice' } as ConversationMode,
  VOICE_TEXT: { input: 'voice', output: 'text' } as ConversationMode,
} as const;
```

### Step 2: Update Session Types

**File: `src/types/session.ts`**

Add mode to session configuration:

```typescript
import type { ConversationMode } from './voice.js';

export interface SessionInitRequest {
  project_id: string;
  npc_id: string;
  player_id: string;
  player_info?: PlayerInfo;
  /** Conversation mode - defaults to text-text */
  mode?: ConversationMode;
}

export interface SessionState {
  // ... existing fields ...
  
  /** Conversation mode for this session */
  mode: ConversationMode;
}
```

### Step 3: Update Voice Pipeline Configuration

**File: `src/voice/pipeline.ts`**

Make STT and TTS initialization conditional based on mode:

```typescript
import type { ConversationMode } from '../types/voice.js';

export interface VoicePipelineConfig {
  sessionId: SessionID;
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  llmProvider: LLMProvider;
  voiceConfig: VoiceConfig;
  events: VoicePipelineEvents;
  /** Conversation mode - determines which providers to initialize */
  mode: ConversationMode;
}

export class VoicePipeline {
  private readonly mode: ConversationMode;
  // ... existing fields ...

  constructor(config: VoicePipelineConfig) {
    this.mode = config.mode;
    // ... existing constructor ...
  }

  /**
   * Initialize the pipeline based on conversation mode
   */
  async initialize(): Promise<void> {
    logger.info({ sessionId: this.sessionId, mode: this.mode }, 'VoicePipeline.initialize: start');

    try {
      // Only initialize STT if input mode is voice
      if (this.mode.input === 'voice') {
        await this.initializeSTT();
      } else {
        logger.info({ sessionId: this.sessionId }, 'Skipping STT init (text input mode)');
      }

      // Only initialize TTS if output mode is voice
      if (this.mode.output === 'voice') {
        await this.initializeTTS();
      } else {
        logger.info({ sessionId: this.sessionId }, 'Skipping TTS init (text output mode)');
      }

      this.isActive = true;
      logger.info({ sessionId: this.sessionId }, 'VoicePipeline.initialize: complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sessionId: this.sessionId, error: message }, 'VoicePipeline.initialize: failed');
      throw error;
    }
  }

  /**
   * Initialize STT session
   */
  private async initializeSTT(): Promise<void> {
    const sttConfig: STTSessionConfig = {
      sampleRate: 16000,
      encoding: 'linear16',
      punctuate: true,
      interimResults: true,
    };

    logger.info({ sessionId: this.sessionId, sttConfig }, 'Creating STT session');

    const sttEvents: STTSessionEvents = {
      onTranscript: (event) => {
        logger.debug({ sessionId: this.sessionId, text: event.text.slice(0, 30), isFinal: event.isFinal }, 'STT transcript');
        this.handleSTTTranscript(event);
      },
      onError: (error) => {
        logger.error({ sessionId: this.sessionId, error: error.message }, 'STT error');
        this.handleSTTError(error);
      },
      onClose: () => {
        logger.info({ sessionId: this.sessionId }, 'STT session closed');
        this.handleSTTClose();
      },
      onOpen: () => {
        logger.info({ sessionId: this.sessionId }, 'STT session opened');
      },
    };

    this.sttSession = await this.sttProvider.createSession(sttConfig, sttEvents);
    logger.info({ sessionId: this.sessionId }, 'STT session created');
  }

  /**
   * Initialize TTS session
   */
  private async initializeTTS(): Promise<void> {
    const ttsConfig: TTSSessionConfig = {
      voiceId: this.voiceConfig.voice_id,
      speed: this.voiceConfig.speed,
      outputFormat: 'pcm_s16le',
    };

    logger.info({ sessionId: this.sessionId, ttsConfig }, 'Creating TTS session');

    const ttsEvents: TTSSessionEvents = {
      onAudioChunk: (chunk) => {
        logger.debug({ sessionId: this.sessionId, audioBytes: chunk.audio.length }, 'TTS audio chunk');
        this.handleTTSAudioChunk(chunk);
      },
      onComplete: () => {
        logger.debug({ sessionId: this.sessionId }, 'TTS synthesis complete');
      },
      onError: (error) => {
        logger.error({ sessionId: this.sessionId, error: error.message }, 'TTS error');
        this.handleTTSError(error);
      },
    };

    this.ttsSession = await this.ttsProvider.createSession(ttsConfig, ttsEvents);
    logger.info({ sessionId: this.sessionId }, 'TTS session created');
  }

  /**
   * Handle text input (used in text-* modes)
   */
  async handleTextInput(text: string): Promise<void> {
    if (this.mode.input !== 'text') {
      logger.warn({ sessionId: this.sessionId, mode: this.mode }, 'Text input received but mode is voice');
    }

    logger.info({ sessionId: this.sessionId, inputLength: text.length }, 'Processing text input');

    const event: TranscriptEvent = {
      text,
      isFinal: true,
      timestamp: Date.now(),
    };

    await this.processTranscript(event);
  }

  /**
   * Process turn with mode-aware output
   */
  private async processTurn(
    _userInput: string,
    context: SessionContext,
    securityContext: SecurityContext
  ): Promise<void> {
    // ... existing turn state setup ...

    try {
      // ... existing system prompt assembly ...

      // Stream LLM response
      let fullResponse = '';
      const pendingToolCalls: ToolCall[] = [];

      for await (const chunk of this.llmProvider.streamChat(request)) {
        if (this.turnState.abortController.signal.aborted) {
          break;
        }

        // Handle text
        if (chunk.text) {
          fullResponse += chunk.text;
          
          // Always emit text chunks (for UI display in all modes)
          this.events.onTextChunk(chunk.text);

          // Only synthesize to audio if output mode is voice
          if (this.mode.output === 'voice') {
            const sentences = this.sentenceDetector.addChunk(chunk.text);
            for (const sentence of sentences) {
              await this.synthesizeSentence(sentence);
            }
          }
        }

        // Collect tool calls
        if (chunk.toolCalls.length > 0) {
          pendingToolCalls.push(...chunk.toolCalls);
        }
      }

      // Flush remaining text to TTS (only if voice output)
      if (this.mode.output === 'voice') {
        const remaining = this.sentenceDetector.flush();
        if (remaining) {
          await this.synthesizeSentence(remaining);
        }
        if (this.ttsSession) {
          await this.ttsSession.flush();
        }
      }

      // ... rest of turn processing ...

    } catch (error) {
      // ... error handling ...
    }
  }

  /**
   * Check if voice input is supported in current mode
   */
  get supportsVoiceInput(): boolean {
    return this.mode.input === 'voice' && this.sttSession !== null;
  }

  /**
   * Check if voice output is supported in current mode
   */
  get supportsVoiceOutput(): boolean {
    return this.mode.output === 'voice' && this.ttsSession !== null;
  }
}
```

### Step 4: Update WebSocket Handler

**File: `src/ws/handler.ts`**

Handle mode-aware message routing:

```typescript
import { CONVERSATION_MODES, ConversationMode } from '../types/voice.js';

interface InitMessage {
  type: 'init';
  session_id: string;
  mode?: ConversationMode;  // Optional, defaults to voice-voice for WebSocket
}

// In the WebSocket connection handler
ws.on('message', async (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'init') {
    const initMsg = message as InitMessage;
    
    // Default to voice-voice for WebSocket connections
    const mode = initMsg.mode || CONVERSATION_MODES.VOICE_VOICE;
    
    // Create pipeline with specified mode
    pipeline = createVoicePipeline({
      sessionId: initMsg.session_id,
      sttProvider,
      ttsProvider,
      llmProvider,
      voiceConfig,
      events: pipelineEvents,
      mode,  // Pass mode to pipeline
    });

    await pipeline.initialize();
    
    // Send ready with mode info
    ws.send(JSON.stringify({
      type: 'ready',
      voice_config: voiceConfig,
      mode,  // Echo back the active mode
    }));
  }

  // Handle text input for text-* modes
  if (message.type === 'text_input') {
    if (!pipeline) {
      ws.send(JSON.stringify({ type: 'error', code: 'NOT_INITIALIZED', message: 'Pipeline not ready' }));
      return;
    }
    
    await pipeline.handleTextInput(message.text);
  }

  // ... existing audio handling (only works if mode.input === 'voice') ...
});
```

### Step 5: Update VoicePipelineEvents

**File: `src/voice/pipeline.ts`**

Add mode information to events:

```typescript
export interface VoicePipelineEvents {
  /** Called when STT produces a transcript (voice input mode only) */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Called when LLM produces text (always, for UI display) */
  onTextChunk: (text: string) => void;
  /** Called when TTS produces audio (voice output mode only) */
  onAudioChunk: (audioBase64: string) => void;
  /** Called when LLM triggers a tool call */
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  /** Called when the NPC's turn is complete */
  onGenerationEnd: () => void;
  /** Called on error */
  onError: (code: string, message: string) => void;
  /** Called when exit_convo is triggered */
  onExitConvo: (reason: string, cooldownSeconds?: number) => void;
  /** Called when mode doesn't support requested operation */
  onModeUnsupported?: (operation: string, reason: string) => void;
}
```

### Step 6: Update Playground UI

**File: `web/js/pages/playground.js`**

Add mode selection UI:

```javascript
let currentConversationMode = { input: 'text', output: 'text' };

// Mode selection handler
function setConversationMode(input, output) {
  currentConversationMode = { input, output };
  
  // Update UI
  document.querySelectorAll('.mode-option').forEach(opt => {
    opt.classList.remove('active');
    if (opt.dataset.input === input && opt.dataset.output === output) {
      opt.classList.add('active');
    }
  });

  // Show/hide appropriate input areas
  const textInput = document.getElementById('text-input-container');
  const voiceInput = document.getElementById('voice-input-container');
  
  textInput.style.display = input === 'text' ? 'flex' : 'none';
  voiceInput.style.display = input === 'voice' ? 'flex' : 'none';

  // Update audio playback expectation
  updateOutputModeUI(output);
}

function updateOutputModeUI(outputMode) {
  const audioIndicator = document.getElementById('audio-output-indicator');
  const textIndicator = document.getElementById('text-output-indicator');
  
  if (audioIndicator) audioIndicator.style.display = outputMode === 'voice' ? 'block' : 'none';
  if (textIndicator) textIndicator.style.display = outputMode === 'text' ? 'block' : 'none';
}

// Connect voice with mode
async function connectVoice() {
  if (!currentSessionId) return;

  voiceClient = new VoiceClient(currentSessionId);
  
  voiceClient.on('ready', async (data) => {
    // Check if returned mode matches our expectation
    console.log('[Playground] Voice ready with mode:', data.mode);
    
    if (currentConversationMode.input === 'voice') {
      await startLiveVoice();
    }
  });

  // ... existing event handlers ...

  await voiceClient.connect(currentConversationMode);  // Pass mode to connect
}

// Handle send for text input modes
async function handleSendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();

  if (!content || !currentSessionId) return;

  input.value = '';
  addChatMessage('user', content);

  if (currentConversationMode.output === 'voice' && voiceClient) {
    // Text input, voice output - send via WebSocket for TTS
    voiceClient.sendTextInput(content);
  } else {
    // Text input, text output - use REST API
    const response = await conversation.sendMessage(currentSessionId, content);
    addChatMessage('assistant', response.response);
  }
}
```

**File: `web/index.html`**

Add mode selection UI to playground template:

```html
<!-- In template-playground, replace mode toggle section -->
<div class="conversation-mode-selector">
  <h4>Conversation Mode</h4>
  <div class="mode-grid">
    <button class="mode-option active" data-input="text" data-output="text">
      <span class="mode-icon">⌨️ → 📝</span>
      <span class="mode-label">Text → Text</span>
    </button>
    <button class="mode-option" data-input="voice" data-output="voice">
      <span class="mode-icon">🎤 → 🔊</span>
      <span class="mode-label">Voice → Voice</span>
    </button>
    <button class="mode-option" data-input="text" data-output="voice">
      <span class="mode-icon">⌨️ → 🔊</span>
      <span class="mode-label">Text → Voice</span>
    </button>
    <button class="mode-option" data-input="voice" data-output="text">
      <span class="mode-icon">🎤 → 📝</span>
      <span class="mode-label">Voice → Text</span>
    </button>
  </div>
  <p class="hint">Choose how you interact with the NPC</p>
</div>

<!-- Output mode indicators -->
<div id="audio-output-indicator" class="output-indicator" style="display: none;">
  <span class="icon">🔊</span> Audio output enabled
</div>
<div id="text-output-indicator" class="output-indicator">
  <span class="icon">📝</span> Text output only
</div>
```

### Step 7: Update VoiceClient (Frontend)

**File: `web/js/api.js`**

Update VoiceClient to handle modes:

```javascript
export class VoiceClient {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.ws = null;
    this.handlers = {};
    this.mode = null;
  }

  async connect(mode = { input: 'voice', output: 'voice' }) {
    this.mode = mode;
    
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:3001/ws/voice?session_id=${this.sessionId}`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Send init with mode
        this.ws.send(JSON.stringify({ 
          type: 'init', 
          session_id: this.sessionId,
          mode: this.mode,
        }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'ready') {
          this.mode = msg.mode;  // Use server's confirmed mode
          this._emit('ready', msg);
          resolve();
        }
        // ... existing message handling ...
      };

      this.ws.onerror = reject;
    });
  }

  /**
   * Send text input (for text-* modes)
   */
  sendTextInput(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[VoiceClient] Cannot send text: not connected');
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'text_input',
      text,
    }));
  }

  /**
   * Check if voice input is available
   */
  supportsVoiceInput() {
    return this.mode?.input === 'voice';
  }

  /**
   * Check if voice output is available
   */
  supportsVoiceOutput() {
    return this.mode?.output === 'voice';
  }

  // ... existing methods ...
}
```

### Step 8: Add CSS for Mode Selector

**File: `web/css/pages.css`**

Add styles for mode selection:

```css
/* Conversation Mode Selector */
.conversation-mode-selector {
  margin-bottom: var(--space-4);
}

.conversation-mode-selector h4 {
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2);
}

.mode-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-3);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-option:hover {
  border-color: var(--accent-primary);
  background: var(--bg-tertiary);
}

.mode-option.active {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
}

.mode-option .mode-icon {
  font-size: var(--text-lg);
  margin-bottom: var(--space-1);
}

.mode-option .mode-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.mode-option.active .mode-label {
  color: var(--accent-primary);
}

.output-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.output-indicator .icon {
  font-size: var(--text-base);
}
```

---

## WebSocket Protocol Updates

### New Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `init` | Client → Server | Now includes optional `mode` field |
| `ready` | Server → Client | Now includes confirmed `mode` field |
| `text_input` | Client → Server | Send text in text-* input modes |

### Init Message Schema

```typescript
interface InitMessage {
  type: 'init';
  session_id: string;
  mode?: {
    input: 'text' | 'voice';
    output: 'text' | 'voice';
  };
}
```

### Ready Message Schema

```typescript
interface ReadyMessage {
  type: 'ready';
  voice_config: VoiceConfig;
  mode: {
    input: 'text' | 'voice';
    output: 'text' | 'voice';
  };
}
```

### Text Input Message Schema

```typescript
interface TextInputMessage {
  type: 'text_input';
  text: string;
}
```

---

## Error Handling

### Mode Mismatch Errors

When operations don't match the configured mode:

```typescript
// In VoicePipeline
pushAudio(audioBuffer: Buffer): void {
  if (this.mode.input !== 'voice') {
    logger.warn({ sessionId: this.sessionId }, 'Audio received but input mode is text');
    this.events.onError?.('MODE_MISMATCH', 'Voice input not enabled for this session');
    return;
  }
  // ... existing logic ...
}
```

---

## Testing Checklist

1. [ ] Text → Text mode: Verify REST API flow works as before
2. [ ] Voice → Voice mode: Verify full duplex audio works
3. [ ] Text → Voice mode:
   - [ ] Text input via WebSocket
   - [ ] Audio response generated and played
   - [ ] No STT initialization overhead
4. [ ] Voice → Text mode:
   - [ ] Audio input transcribed
   - [ ] Text response displayed (no audio)
   - [ ] No TTS initialization overhead
5. [ ] Mode switching during session (if supported)
6. [ ] Verify proper resource cleanup for unused providers

---

## Performance Considerations

### Resource Optimization

| Mode | STT Initialized | TTS Initialized | Benefit |
|------|-----------------|-----------------|---------|
| text-text | No | No | Minimal resources, fastest startup |
| voice-voice | Yes | Yes | Full functionality |
| text-voice | No | Yes | Skip STT latency, lower bandwidth |
| voice-text | Yes | No | Skip TTS latency, text-only display |

### Startup Time Estimates

- STT session: ~200-500ms
- TTS session: ~100-300ms
- Text-only mode saves up to 800ms startup time

---

## Future Enhancements

1. **Dynamic mode switching**: Allow changing modes mid-conversation
2. **Hybrid modes**: Voice input with both text and audio output
3. **Accessibility modes**: Screen reader optimized text output
4. **Bandwidth-adaptive**: Auto-switch to text when connection is poor

