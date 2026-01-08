# V2 Feature: Conversation Pipeline Modes

## Status: ✅ IMPLEMENTED

## Overview

This feature implements flexible conversation modes that decouple input and output modalities. The system now supports all four mode combinations, giving developers full control over how players interact with NPCs.

## Features

### Conversation Mode Matrix

| Input Mode | Output Mode | Description | Status | Use Case |
|------------|-------------|-------------|--------|----------|
| `text` | `text` | REST API text chat | ✅ Complete | Chat interfaces, accessibility |
| `voice` | `voice` | Full duplex audio | ✅ Complete | Full voice conversations |
| `text` | `voice` | Type to NPC, hear response | ✅ Complete | Mobile games, accessibility |
| `voice` | `text` | Speak to NPC, read response | ✅ Complete | Transcription display, quiet mode |

---

## Implementation Summary

### Backend Changes

#### 1. Type Definitions (`src/types/voice.ts`)

```typescript
export type InputMode = 'text' | 'voice';
export type OutputMode = 'text' | 'voice';

export interface ConversationMode {
  input: InputMode;
  output: OutputMode;
}

export const CONVERSATION_MODES = {
  TEXT_TEXT: { input: 'text', output: 'text' } as ConversationMode,
  VOICE_VOICE: { input: 'voice', output: 'voice' } as ConversationMode,
  TEXT_VOICE: { input: 'text', output: 'voice' } as ConversationMode,
  VOICE_TEXT: { input: 'voice', output: 'text' } as ConversationMode,
} as const;
```

#### 2. Session Types (`src/types/session.ts`)

- Added `mode?: ConversationMode` to `SessionInitRequest`
- Added `mode: ConversationMode` to `SessionState`

#### 3. Voice Pipeline (`src/voice/pipeline.ts`)

**Conditional Provider Initialization:**
```typescript
async initialize(): Promise<void> {
  // Only initialize STT if input mode is voice
  if (this.mode.input === 'voice') {
    await this.initializeSTT();
  }

  // Only initialize TTS if output mode is voice
  if (this.mode.output === 'voice') {
    await this.initializeTTS();
  }
}
```

**Text Input Handler:**
```typescript
async handleTextInput(text: string): Promise<void> {
  // Processes text input for text-* modes
  // Creates a TranscriptEvent and routes through processTurn()
}
```

**Mode-Aware Audio Output:**
```typescript
// In processTurn()
if (this.mode.output === 'voice') {
  const sentences = this.sentenceDetector.addChunk(chunk.text);
  for (const sentence of sentences) {
    await this.synthesizeSentence(sentence);
  }
}
```

#### 4. WebSocket Handler (`src/ws/handler.ts`)

**Init Message with Mode:**
```typescript
interface InitMessage {
  type: 'init';
  session_id: string;
  mode?: ConversationMode;  // Defaults to VOICE_VOICE
}
```

**Text Message Handler:**
```typescript
case 'text':
  await handleTextMessage(connection, message);
  break;
```

**Ready Response with Mode:**
```typescript
sendMessage(ws, {
  type: 'ready',
  voice_config: voiceConfig,
  mode,  // Echo confirmed mode back to client
});
```

### Frontend Changes

#### 1. API Client (`web/js/api.js`)

**VoiceClient.connect() with Mode:**
```javascript
async connect(mode = { input: 'voice', output: 'voice' }) {
  this.mode = mode;
  // Send init with mode
  this.send({ type: 'init', session_id: this.sessionId, mode: this.mode });
}
```

**sendText() for Text Input via WebSocket:**
```javascript
sendText(content) {
  this.send({ type: 'text', content });
}
```

#### 2. Playground Page (`web/js/pages/playground.js`)

**State Management:**
```javascript
let currentConversationMode = { input: 'text', output: 'text' };
```

**Mode Selection:**
```javascript
function setConversationMode(input, output) {
  currentConversationMode = { input, output };
  // Update UI buttons
}
```

**Session Start - Smart WebSocket Connection:**
```javascript
// Connect WebSocket if ANY voice is involved (input OR output)
if (currentConversationMode.input === 'voice' || currentConversationMode.output === 'voice') {
  await connectVoice();
}
```

**Chat Interface Configuration:**
```javascript
function configureChatInterface() {
  // Show text input for text-input modes
  // Show voice input for voice-input modes
  // Update hints based on output mode
}
```

**Message Routing:**
```javascript
async function handleSendMessage() {
  // If output is voice, send through WebSocket for TTS
  if (currentConversationMode.output === 'voice' && voiceClient?.isReady()) {
    voiceClient.sendText(content);
    return;
  }
  // Otherwise use REST API
  const response = await conversation.sendMessage(currentSessionId, content);
}
```

**Real-Time Transcript Display:**
```javascript
.on('transcript', (text, isFinal) => {
  if (isFinal && text.trim()) {
    removeInterimTranscript();
    addChatMessage('user', text);
  } else if (!isFinal && text.trim()) {
    showInterimTranscript(text);  // Show what user is saying in real-time
  }
})
```

#### 3. HTML (`web/index.html`)

**Mode Selector UI:**
```html
<div class="conversation-mode-selector">
  <h4>Conversation Mode</h4>
  <div class="mode-grid">
    <button class="mode-option active" data-input="text" data-output="text">
      <span class="mode-icon">⌨️ → 📝</span>
      <span class="mode-label">TEXT-TO-TEXT</span>
    </button>
    <button class="mode-option" data-input="voice" data-output="voice">
      <span class="mode-icon">🎤 → 🔊</span>
      <span class="mode-label">VOICE-TO-VOICE</span>
    </button>
    <button class="mode-option" data-input="text" data-output="voice">
      <span class="mode-icon">⌨️ → 🔊</span>
      <span class="mode-label">TEXT-TO-VOICE</span>
    </button>
    <button class="mode-option" data-input="voice" data-output="text">
      <span class="mode-icon">🎤 → 📝</span>
      <span class="mode-label">VOICE-TO-TEXT</span>
    </button>
  </div>
</div>
```

#### 4. CSS (`web/css/conversation-modes.css`)

- Mode grid layout (2x2 button grid)
- Active state styling with accent colors
- Interim transcript styling with pulse animation
- Session setup panel layout

---

## WebSocket Protocol

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `init` | Client → Server | Includes `mode` field |
| `ready` | Server → Client | Confirms `mode` and `voice_config` |
| `text` | Client → Server | Text input for text-* modes |
| `audio` | Client → Server | Audio chunks for voice-* input modes |
| `transcript` | Server → Client | STT result (interim and final) |
| `text_chunk` | Server → Client | LLM response text (all modes) |
| `audio_chunk` | Server → Client | TTS audio (voice output modes) |

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

---

## Resource Optimization

| Mode | STT Init | TTS Init | WebSocket | Benefit |
|------|----------|----------|-----------|---------|
| text-text | ❌ | ❌ | ❌ | Minimal resources, REST only |
| voice-voice | ✅ | ✅ | ✅ | Full functionality |
| text-voice | ❌ | ✅ | ✅ | Skip STT latency |
| voice-text | ✅ | ❌ | ✅ | Skip TTS latency |

---

## User Experience Features

### Real-Time Transcript Display
- Shows interim (partial) transcripts while user speaks
- Visual feedback with pulsing "..." indicator
- Converts to final message when speech ends

### Mode-Aware UI
- Input area changes based on input mode (text box vs microphone)
- Placeholder text indicates output mode
- Voice hints update based on mode

### Session Setup Panel
- Mode selection before session starts
- Player name configuration
- Clean transition to chat interface

---

## Testing Checklist

- [x] Text → Text: REST API flow works
- [x] Voice → Voice: Full duplex audio works
- [x] Text → Voice: Text input generates audio response
- [x] Voice → Text: Voice input displays text response
- [x] Interim transcripts display in real-time
- [x] Mode selection persists through session
- [x] WebSocket only connects when voice is needed
- [x] Interface resets properly on session end

---

## Files Modified

### Backend
- `src/types/voice.ts` - Mode type definitions
- `src/types/session.ts` - Session mode field
- `src/voice/pipeline.ts` - Conditional STT/TTS init, text input handler
- `src/ws/handler.ts` - Mode-aware WebSocket handling
- `src/session/manager.ts` - Mode in session state

### Frontend
- `web/js/api.js` - VoiceClient mode support, sendText()
- `web/js/pages/playground.js` - Mode selection, routing, UI configuration
- `web/index.html` - Mode selector UI, session setup panel
- `web/css/conversation-modes.css` - Mode button styles, interim transcript

---

## Future Enhancements

1. **Dynamic mode switching** - Allow changing modes mid-conversation
2. **Hybrid modes** - Voice input with both text and audio output
3. **Bandwidth-adaptive** - Auto-switch to text when connection is poor
4. **Mode preferences** - Remember user's preferred mode per NPC
