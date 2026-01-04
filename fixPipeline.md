# Voice Pipeline Debug Plan - Evolve.NPC

## Executive Summary

The voice pipeline is not functioning - no logs appear when starting voice mode. This document provides a systematic approach to diagnose and fix the entire voice pipeline from browser to backend providers.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Frontend)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  playground.js                                                               │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐                 │
│  │ UI Controls │───►│ VAD + Audio  │───►│ VoiceClient     │                 │
│  │ (buttons)   │    │ Processing   │    │ (api.js)        │                 │
│  └─────────────┘    └──────────────┘    └────────┬────────┘                 │
│                                                   │                          │
│                                    WebSocket: ws://host:3001/ws/voice        │
└───────────────────────────────────────────────────┼──────────────────────────┘
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER (Backend)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  index.ts (port 3001 - WebSocket Server)                                    │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ wss.on('connection') → handleVoiceWebSocket()                      │     │
│  └──────────────────────────────────┬─────────────────────────────────┘     │
│                                     │                                        │
│  handler.ts                         ▼                                        │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ handleInitMessage() → creates VoicePipeline                        │     │
│  └──────────────────────────────────┬─────────────────────────────────┘     │
│                                     │                                        │
│  pipeline.ts                        ▼                                        │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ VoicePipeline                                                      │     │
│  │ ┌──────────┐   ┌──────────┐   ┌──────────┐                        │     │
│  │ │ STT      │──►│ LLM      │──►│ TTS      │                        │     │
│  │ │ Deepgram │   │ Gemini   │   │ Cartesia │                        │     │
│  │ └──────────┘   └──────────┘   └──────────┘                        │     │
│  └────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Message Flow

```
Frontend                          Backend
   │                                 │
   │──── WS Connect ────────────────►│  (port 3001)
   │                                 │
   │──── { type: 'init' } ─────────►│
   │                                 │  handleInitMessage()
   │                                 │  - Load session context
   │                                 │  - Create VoicePipeline
   │                                 │  - Initialize STT session
   │                                 │  - Initialize TTS session
   │◄─── { type: 'ready' } ─────────│
   │                                 │
   │──── { type: 'audio' } ────────►│  pushAudio() → STT
   │                                 │
   │◄─── { type: 'transcript' } ────│  STT result
   │                                 │
   │──── { type: 'commit' } ───────►│  Process turn
   │                                 │  - Security pipeline
   │                                 │  - Assemble context
   │                                 │  - Stream LLM response
   │◄─── { type: 'text_chunk' } ────│  LLM tokens
   │◄─── { type: 'audio_chunk' } ───│  TTS audio
   │◄─── { type: 'generation_end' }─│
   │                                 │
```

---

## Identified Issues

### Critical Issues (Blocking)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **No error logging on WS connection failure** | `index.ts:239-262` | Silent failures |
| 2 | **VoiceClient connection race condition** | `playground.js:400-420` | Voice won't start |
| 3 | **Missing try-catch in audio processing** | `playground.js:470-520` | Crashes silently |
| 4 | **STT session async connect not awaited properly** | `handler.ts:350-380` | Init fails |
| 5 | **TTS WebSocket may not be open** | `cartesia.ts:90-120` | No audio out |

### Moderate Issues (Degraded Experience)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 6 | ScriptProcessor is deprecated | `playground.js:445` | Browser warnings |
| 7 | No reconnection logic for STT/TTS | `pipeline.ts` | Drops on network hiccup |
| 8 | `is_final` property confusion in Deepgram | `deepgram.ts:95-110` | Wrong transcript timing |

### Minor Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 9 | No audio level visualization in voice mode | `playground.js` | UX |
| 10 | Missing heartbeat/ping on WebSocket | `handler.ts` | Stale connections |

---

## Debug Phase 1: Frontend Connection

### Problem Statement
When user clicks "Start Voice", no logs appear. Need to verify the WebSocket connection is being attempted.

### Files to Modify
- `web/js/api.js` - VoiceClient class
- `web/js/pages/playground.js` - Voice flow handlers

### Debugging Steps

#### 1.1 Add Console Logs to VoiceClient

```javascript
// web/js/api.js - VoiceClient.connect()

connect() {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const httpPort = parseInt(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80);
    const wsPort = httpPort + 1;
    const url = `${protocol}//${window.location.hostname}:${wsPort}/ws/voice?session_id=${this.sessionId}`;

    // ADD: Debug logging
    console.log('[VoiceClient] Connecting to:', url);
    console.log('[VoiceClient] Session ID:', this.sessionId);
    console.log('[VoiceClient] HTTP Port:', httpPort, '→ WS Port:', wsPort);

    this.ws = new WebSocket(url);

    // ADD: Connection state tracking
    this.ws.onopen = () => {
      console.log('[VoiceClient] WebSocket OPEN');
      this.send({ type: 'init', session_id: this.sessionId });
    };

    this.ws.onerror = (error) => {
      console.error('[VoiceClient] WebSocket ERROR:', error);
      reject(error);
      this.callbacks.onError('CONNECTION_ERROR', 'WebSocket connection error');
    };

    this.ws.onclose = (event) => {
      console.log('[VoiceClient] WebSocket CLOSE:', event.code, event.reason);
      this.callbacks.onClose();
    };

    // ... rest of handler
  });
}
```

#### 1.2 Add Console Logs to Playground Voice Flow

```javascript
// web/js/pages/playground.js

async function connectVoice() {
  console.log('[Playground] connectVoice() called');
  console.log('[Playground] Current session ID:', currentSessionId);
  
  if (!currentSessionId) {
    console.error('[Playground] No session ID - cannot connect voice');
    toast.error('No Session', 'Start a session first before enabling voice.');
    return;
  }

  try {
    updateVoiceStatus('Connecting...');
    console.log('[Playground] Creating VoiceClient...');
    
    voiceClient = new VoiceClient(currentSessionId);
    // ... rest
  } catch (error) {
    console.error('[Playground] connectVoice() error:', error);
    // ...
  }
}

async function startLiveVoice() {
  console.log('[Playground] startLiveVoice() called');
  console.log('[Playground] voiceClient exists:', !!voiceClient);
  console.log('[Playground] voiceClient state:', voiceClient?.ws?.readyState);
  
  if (!voiceClient) {
    console.warn('[Playground] No voiceClient - showing warning');
    toast.warning('Voice Not Connected', 'Please wait for voice connection.');
    return;
  }
  // ... rest
}

function toggleLiveVoice() {
  console.log('[Playground] toggleLiveVoice() called');
  console.log('[Playground] isVoiceActive:', isVoiceActive);
  console.log('[Playground] voiceClient:', !!voiceClient);
  
  if (isVoiceActive) {
    stopLiveVoice();
  } else {
    startLiveVoice();
  }
}
```

#### 1.3 Verify Connection Flow

**Expected sequence:**
1. User starts session (text mode)
2. User switches to voice mode → `setMode('voice')` → `connectVoice()`
3. WebSocket connects to `ws://localhost:3001/ws/voice?session_id=X`
4. On open, sends `{ type: 'init', session_id: X }`
5. Server responds with `{ type: 'ready', ... }`
6. `onReady` callback auto-starts `startLiveVoice()`

**Actual bug found:**
In `setMode('voice')`:
```javascript
if (mode === 'voice' && currentSessionId && !voiceClient) {
  connectVoice();
}
```
This only calls `connectVoice()` if `voiceClient` is null. If a previous connection failed but `voiceClient` was assigned, it won't retry.

### Fix Required

```javascript
// web/js/pages/playground.js - setMode()

function setMode(mode) {
  currentMode = mode;

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  document.getElementById('text-input-container').style.display = mode === 'text' ? 'flex' : 'none';
  document.getElementById('voice-input-container').style.display = mode === 'voice' ? 'flex' : 'none';

  // FIX: Check if voice client is actually connected, not just exists
  if (mode === 'voice' && currentSessionId) {
    const needsConnection = !voiceClient || 
                           !voiceClient.ws || 
                           voiceClient.ws.readyState !== WebSocket.OPEN;
    
    if (needsConnection) {
      console.log('[Playground] Voice mode selected, connecting...');
      connectVoice();
    }
  }
}
```

---

## Debug Phase 2: Backend WebSocket Server

### Problem Statement
No server-side logs appearing means either:
1. Connection never reaches the server
2. Connection is rejected before logging
3. Logging is not working

### Files to Modify
- `src/index.ts` - WebSocket server setup

### Debugging Steps

#### 2.1 Add Comprehensive Logging to WebSocket Server

```typescript
// src/index.ts - WebSocket server section

// Create WebSocket server on a separate port
const wss = new WebSocketServer({ port: port + 1 });

logger.info({ wsPort: port + 1 }, 'WebSocket server starting...');

wss.on('listening', () => {
  logger.info({ wsPort: port + 1 }, 'WebSocket server now listening');
});

wss.on('error', (error) => {
  logger.error({ 
    error: String(error), 
    code: (error as NodeJS.ErrnoException).code,
    message: error.message 
  }, 'WebSocket server error');
});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  const url = new URL(req.url || '', `http://localhost:${port + 1}`);
  
  logger.info({ 
    clientIp, 
    path: url.pathname, 
    query: Object.fromEntries(url.searchParams),
    headers: {
      origin: req.headers.origin,
      host: req.headers.host,
    }
  }, 'WebSocket connection received');

  // Only handle /ws/voice connections
  if (url.pathname !== '/ws/voice') {
    logger.warn({ path: url.pathname }, 'Unsupported WebSocket path');
    ws.close(1003, 'Unsupported path');
    return;
  }

  const sessionId = url.searchParams.get('session_id');
  logger.info({ sessionId }, 'Voice WebSocket: checking session');

  if (!sessionId) {
    logger.warn('Voice WebSocket: missing session_id');
    ws.close(1008, 'session_id query parameter required');
    return;
  }

  // Verify session exists
  const stored = sessionStore.get(sessionId);
  if (!stored) {
    logger.warn({ sessionId }, 'Voice WebSocket: session not found');
    ws.close(1008, 'Session not found');
    return;
  }

  logger.info({ sessionId }, 'Voice WebSocket: session verified');

  // Get API keys from config
  const deepgramKey = config.providers.deepgramApiKey;
  const cartesiaKey = config.providers.cartesiaApiKey;
  const geminiKey = config.providers.geminiApiKey;

  logger.info({
    hasDeepgram: !!deepgramKey,
    hasCartesia: !!cartesiaKey,
    hasGemini: !!geminiKey,
  }, 'Voice WebSocket: API key status');

  // Check if all required keys are available
  if (!deepgramKey || !cartesiaKey || !geminiKey) {
    logger.error({ 
      sessionId,
      missingKeys: {
        deepgram: !deepgramKey,
        cartesia: !cartesiaKey,
        gemini: !geminiKey,
      }
    }, 'Voice WebSocket: missing API keys');
    ws.close(1008, 'Voice providers not configured');
    return;
  }

  logger.info({ sessionId }, 'Voice WebSocket: creating providers');

  try {
    // Create providers with configured API keys
    const deps: VoiceWebSocketDependencies = {
      sttProvider: new DeepgramSttProvider({ apiKey: deepgramKey }),
      ttsProvider: createTtsProvider({ provider: 'cartesia', apiKey: cartesiaKey }),
      llmProvider: new GeminiLlmProvider({ apiKey: geminiKey }),
    };

    logger.info({ sessionId }, 'Voice WebSocket: providers created, calling handler');

    // Handle the voice WebSocket connection
    handleVoiceWebSocket(ws as unknown as WebSocket, sessionId, deps);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ sessionId, error: errorMessage }, 'Voice WebSocket: failed to create providers');
    ws.close(1011, 'Failed to initialize voice providers');
  }
});
```

#### 2.2 Add Error Handling for Provider Creation

```typescript
// src/providers/stt/deepgram.ts - Constructor

constructor(config: STTProviderConfig) {
  if (!config.apiKey) {
    throw new Error('Deepgram API key is required');
  }
  
  // ADD: Validate API key format
  if (config.apiKey.length < 20) {
    logger.warn('Deepgram API key appears invalid (too short)');
  }
  
  this.config = config;
  logger.info({ 
    model: config.model ?? DEFAULT_MODEL,
    keyLength: config.apiKey.length 
  }, 'Deepgram provider initialized');
}
```

```typescript
// src/providers/tts/cartesia.ts - Constructor

constructor(config: TTSProviderConfig) {
  if (!config.apiKey) {
    throw new Error('Cartesia API key is required');
  }

  // ADD: Validate API key format
  if (config.apiKey.length < 20) {
    logger.warn('Cartesia API key appears invalid (too short)');
  }

  this.config = config;
  this.client = new CartesiaClient({
    apiKey: config.apiKey,
  });

  logger.info({ 
    defaultVoiceId: config.defaultVoiceId,
    keyLength: config.apiKey.length 
  }, 'Cartesia provider initialized');
}
```

---

## Debug Phase 3: Voice Pipeline Initialization

### Problem Statement
Even if WebSocket connects, the pipeline initialization might fail silently.

### Files to Modify
- `src/ws/handler.ts` - handleInitMessage
- `src/voice/pipeline.ts` - VoicePipeline.initialize

### Debugging Steps

#### 3.1 Add Logging to Handler Init Message

```typescript
// src/ws/handler.ts - handleInitMessage()

async function handleInitMessage(
  connection: VoiceConnection,
  message: InitMessage,
  deps: VoiceWebSocketDependencies
): Promise<void> {
  const { sessionId, ws } = connection;

  logger.info({ sessionId, messageSessionId: message.session_id }, 'handleInitMessage: start');

  // Validate session ID matches
  if (message.session_id !== sessionId) {
    logger.error({ sessionId, messageSessionId: message.session_id }, 'handleInitMessage: session mismatch');
    sendMessage(ws, { type: 'error', code: 'SESSION_MISMATCH', message: 'Session ID does not match' });
    return;
  }

  // Check if already initialized
  if (connection.pipeline) {
    logger.warn({ sessionId }, 'handleInitMessage: already initialized');
    sendMessage(ws, { type: 'error', code: 'ALREADY_INITIALIZED', message: 'Pipeline already initialized' });
    return;
  }

  try {
    logger.info({ sessionId }, 'handleInitMessage: getting session context');
    
    // Get session context to get voice config
    const context = await getSessionContext(sessionId);
    const voiceConfig = context.definition.voice;

    logger.info({ 
      sessionId, 
      voiceProvider: voiceConfig.provider,
      voiceId: voiceConfig.voice_id,
      speed: voiceConfig.speed 
    }, 'handleInitMessage: voice config loaded');

    // Create pipeline events
    const events: VoicePipelineEvents = {
      onTranscript: (text, isFinal) => {
        logger.debug({ sessionId, text: text.slice(0, 50), isFinal }, 'Pipeline event: transcript');
        sendMessage(ws, { type: 'transcript', text, is_final: isFinal });
      },
      onTextChunk: (text) => {
        logger.debug({ sessionId, chunkLength: text.length }, 'Pipeline event: text_chunk');
        sendMessage(ws, { type: 'text_chunk', text });
      },
      onAudioChunk: (audioBase64) => {
        logger.debug({ sessionId, audioLength: audioBase64.length }, 'Pipeline event: audio_chunk');
        sendMessage(ws, { type: 'audio_chunk', data: audioBase64 });
      },
      onToolCall: (name, args) => {
        logger.info({ sessionId, toolName: name }, 'Pipeline event: tool_call');
        sendMessage(ws, { type: 'tool_call', name, args });
      },
      onGenerationEnd: () => {
        logger.info({ sessionId }, 'Pipeline event: generation_end');
        sendMessage(ws, { type: 'generation_end' });
      },
      onError: (code, message) => {
        logger.error({ sessionId, code, message }, 'Pipeline event: error');
        sendMessage(ws, { type: 'error', code, message });
      },
      onExitConvo: (reason, cooldownSeconds) => {
        logger.info({ sessionId, reason, cooldownSeconds }, 'Pipeline event: exit_convo');
        sendMessage(ws, { type: 'exit_convo', reason, cooldown_seconds: cooldownSeconds });
        ws.close(1000, 'Session ended by NPC');
      },
    };

    logger.info({ sessionId }, 'handleInitMessage: creating pipeline');

    // Create and initialize pipeline
    const pipeline = createVoicePipeline({
      sessionId,
      sttProvider: deps.sttProvider,
      ttsProvider: deps.ttsProvider,
      llmProvider: deps.llmProvider,
      voiceConfig,
      events,
    });

    logger.info({ sessionId }, 'handleInitMessage: initializing pipeline');

    await pipeline.initialize();
    connection.pipeline = pipeline;

    logger.info({ sessionId }, 'handleInitMessage: sending ready message');

    // Send ready message
    sendMessage(ws, {
      type: 'ready',
      session_id: sessionId,
      npc_name: context.definition.name,
      voice_config: voiceConfig,
    });

    logger.info({ sessionId, npcName: context.definition.name }, 'handleInitMessage: complete');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error({ 
      sessionId, 
      error: errorMessage,
      stack: errorStack 
    }, 'handleInitMessage: failed');
    
    sendMessage(ws, { type: 'error', code: 'INIT_FAILED', message: errorMessage });
  }
}
```

#### 3.2 Add Logging to Pipeline Initialize

```typescript
// src/voice/pipeline.ts - initialize()

async initialize(): Promise<void> {
  logger.info({ sessionId: this.sessionId }, 'VoicePipeline.initialize: start');

  try {
    // Create STT session with callbacks
    const sttConfig: STTSessionConfig = {
      sampleRate: 16000,
      encoding: 'linear16',
      punctuate: true,
      interimResults: true,
    };

    logger.info({ sessionId: this.sessionId, sttConfig }, 'VoicePipeline.initialize: creating STT session');

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

    try {
      this.sttSession = await this.sttProvider.createSession(sttConfig, sttEvents);
      logger.info({ sessionId: this.sessionId }, 'VoicePipeline.initialize: STT session created');
    } catch (sttError) {
      const errorMessage = sttError instanceof Error ? sttError.message : String(sttError);
      logger.error({ sessionId: this.sessionId, error: errorMessage }, 'VoicePipeline.initialize: STT session creation failed');
      throw new Error(`STT initialization failed: ${errorMessage}`);
    }

    // Create TTS session with callbacks
    const ttsConfig: TTSSessionConfig = {
      voiceId: this.voiceConfig.voice_id,
      speed: this.voiceConfig.speed,
      outputFormat: 'pcm_s16le',
    };

    logger.info({ sessionId: this.sessionId, ttsConfig }, 'VoicePipeline.initialize: creating TTS session');

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

    try {
      this.ttsSession = await this.ttsProvider.createSession(ttsConfig, ttsEvents);
      logger.info({ sessionId: this.sessionId }, 'VoicePipeline.initialize: TTS session created');
    } catch (ttsError) {
      const errorMessage = ttsError instanceof Error ? ttsError.message : String(ttsError);
      logger.error({ sessionId: this.sessionId, error: errorMessage }, 'VoicePipeline.initialize: TTS session creation failed');
      
      // Clean up STT session if TTS fails
      if (this.sttSession) {
        try {
          this.sttSession.close();
        } catch (cleanupError) {
          logger.warn({ sessionId: this.sessionId }, 'Failed to cleanup STT session after TTS failure');
        }
      }
      
      throw new Error(`TTS initialization failed: ${errorMessage}`);
    }

    this.isActive = true;
    logger.info({ sessionId: this.sessionId }, 'VoicePipeline.initialize: complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ sessionId: this.sessionId, error: message }, 'VoicePipeline.initialize: failed');
    throw error;
  }
}
```

---

## Debug Phase 4: Provider Integration

### Problem Statement
STT and TTS providers may fail to connect to external services.

### Files to Modify
- `src/providers/stt/deepgram.ts`
- `src/providers/tts/cartesia.ts`

### Debugging Steps

#### 4.1 Add Logging to Deepgram Provider

```typescript
// src/providers/stt/deepgram.ts - DeepgramSession.connect()

async connect(): Promise<void> {
  const startTime = Date.now();

  logger.info({ 
    model: this.providerConfig.model ?? DEFAULT_MODEL,
    sampleRate: this.config.sampleRate,
    language: this.config.language 
  }, 'DeepgramSession.connect: starting');

  try {
    const client = createClient(this.providerConfig.apiKey);
    
    logger.debug('DeepgramSession.connect: client created, starting live connection');

    this.connection = client.listen.live({
      model: this.providerConfig.model ?? DEFAULT_MODEL,
      punctuate: this.config.punctuate,
      encoding: this.config.encoding,
      sample_rate: this.config.sampleRate,
      language: this.config.language,
      interim_results: this.config.interimResults,
    });

    this.setupEventHandlers();

    logger.debug('DeepgramSession.connect: waiting for WebSocket open');

    // Wait for connection to open
    await this.waitForOpen();

    const duration = Date.now() - startTime;
    logger.info({ 
      duration, 
      model: this.providerConfig.model ?? DEFAULT_MODEL 
    }, 'DeepgramSession.connect: success');
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error({ 
      duration, 
      error: errorMessage,
      stack: errorStack 
    }, 'DeepgramSession.connect: failed');
    
    throw new DeepgramConnectionError(errorMessage);
  }
}

private setupEventHandlers(): void {
  if (!this.connection) {
    logger.warn('DeepgramSession.setupEventHandlers: no connection');
    return;
  }

  logger.debug('DeepgramSession.setupEventHandlers: setting up handlers');

  this.connection.on(LiveTranscriptionEvents.Open, () => {
    this._isConnected = true;
    this.reconnectAttempts = 0;
    logger.info('DeepgramSession: connection OPEN');
    this.events.onOpen?.();
  });

  this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    logger.debug({ 
      hasChannel: !!data?.channel,
      isFinal: data?.is_final,
      speechFinal: data?.speech_final 
    }, 'DeepgramSession: transcript event received');
    
    try {
      const transcript = this.parseTranscript(data);
      if (transcript) {
        logger.debug({ 
          text: transcript.text.slice(0, 30), 
          isFinal: transcript.isFinal 
        }, 'DeepgramSession: parsed transcript');
        this.events.onTranscript(transcript);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'DeepgramSession: error parsing transcript');
    }
  });

  this.connection.on(LiveTranscriptionEvents.Error, (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'DeepgramSession: transcription error');

    if (this.shouldReconnect(errorMessage)) {
      logger.info('DeepgramSession: attempting reconnect');
      this.attemptReconnect();
    } else {
      this.events.onError(new DeepgramError(errorMessage));
    }
  });

  this.connection.on(LiveTranscriptionEvents.Close, () => {
    this._isConnected = false;
    logger.info('DeepgramSession: connection CLOSE');
    this.events.onClose();
  });
}
```

#### 4.2 Add Logging to Cartesia Provider

```typescript
// src/providers/tts/cartesia.ts - CartesiaSession.connect()

async connect(): Promise<void> {
  const startTime = Date.now();

  logger.info({ 
    voiceId: this.config.voiceId,
    model: this.config.model ?? DEFAULT_MODEL,
    sampleRate: this.config.sampleRate ?? DEFAULT_SAMPLE_RATE 
  }, 'CartesiaSession.connect: starting');

  try {
    const outputFormat = this.mapOutputFormat(this.config.outputFormat);
    
    logger.debug({ outputFormat }, 'CartesiaSession.connect: creating WebSocket');

    this.websocket = this.client.tts.websocket({
      container: 'raw',
      encoding: outputFormat,
      sampleRate: this.config.sampleRate ?? DEFAULT_SAMPLE_RATE,
    });

    this._isConnected = true;

    const duration = Date.now() - startTime;
    logger.info({
      duration,
      voiceId: this.config.voiceId,
      model: this.config.model ?? DEFAULT_MODEL
    }, 'CartesiaSession.connect: success');
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error({ 
      duration, 
      error: errorMessage,
      stack: errorStack 
    }, 'CartesiaSession.connect: failed');
    
    throw new CartesiaConnectionError(errorMessage);
  }
}

async synthesize(text: string, isContinuation = false): Promise<void> {
  if (!this.websocket || !this._isConnected) {
    logger.error('CartesiaSession.synthesize: not connected');
    throw new CartesiaError('Session not connected');
  }

  if (!text || text.trim() === '') {
    logger.debug('CartesiaSession.synthesize: empty text, skipping');
    return;
  }

  const startTime = Date.now();
  this.abortController = new AbortController();

  logger.info({ 
    textLength: text.length, 
    isContinuation,
    contextId: this.contextId 
  }, 'CartesiaSession.synthesize: starting');

  try {
    const response = await this.websocket.send({
      modelId: this.config.model ?? this.providerConfig.defaultModel ?? DEFAULT_MODEL,
      voice: {
        mode: 'id',
        id: this.config.voiceId,
      },
      transcript: text,
      language: this.config.language ?? DEFAULT_LANGUAGE,
      contextId: this.contextId,
      continue: isContinuation,
    });

    logger.debug('CartesiaSession.synthesize: request sent, awaiting response');

    let chunkCount = 0;
    
    for await (const rawMessage of response.events('message')) {
      if (this.abortController?.signal.aborted) {
        logger.debug('CartesiaSession.synthesize: aborted');
        break;
      }

      const message = rawMessage as { audio?: string; done?: boolean; error?: string };

      if (message.error) {
        logger.error({ error: message.error }, 'CartesiaSession.synthesize: server error');
        throw new CartesiaError(message.error);
      }

      if (message.audio) {
        chunkCount++;
        const audioBuffer = Buffer.from(message.audio, 'base64');
        
        logger.debug({ 
          chunkCount, 
          audioBytes: audioBuffer.length 
        }, 'CartesiaSession.synthesize: audio chunk received');
        
        const chunk: TTSChunk = {
          audio: audioBuffer,
          text,
          isComplete: message.done === true,
          timestamp: Date.now(),
        };
        this.events.onAudioChunk(chunk);
      }

      if (message.done) {
        logger.debug('CartesiaSession.synthesize: done signal received');
        break;
      }
    }

    const duration = Date.now() - startTime;
    logger.info({ 
      duration, 
      textLength: text.length,
      chunkCount 
    }, 'CartesiaSession.synthesize: complete');
  } catch (error) {
    // ... error handling with logging
  }
}
```

---

## Debug Phase 5: Audio Flow

### Problem Statement
Audio from browser may not be reaching the server, or audio from server may not be playing.

### Files to Modify
- `web/js/pages/playground.js` - Audio capture
- `src/voice/audio.ts` - Audio encoding/decoding

### Debugging Steps

#### 5.1 Add Logging to Audio Processing

```javascript
// web/js/pages/playground.js - audio processor

audioProcessor.onaudioprocess = (e) => {
  if (!isVoiceActive) return;

  const inputData = e.inputBuffer.getChannelData(0);
  const energy = calculateEnergy(inputData);
  const isSpeech = energy > vadState.energyThreshold;

  // ADD: Periodic logging (every 100 frames)
  if (!this._frameCount) this._frameCount = 0;
  this._frameCount++;
  
  if (this._frameCount % 100 === 0) {
    console.log('[Audio] Frame:', this._frameCount, 'Energy:', energy.toFixed(4), 'IsSpeech:', isSpeech);
  }

  // ... rest of VAD logic
  
  if (vadState.isSpeaking) {
    const pcm16 = float32ToPcm16(inputData);
    const base64 = arrayBufferToBase64(pcm16.buffer);
    
    // ADD: Log audio send
    if (this._frameCount % 100 === 0) {
      console.log('[Audio] Sending chunk, base64 length:', base64.length);
    }
    
    voiceClient.sendAudio(base64);
  }
};
```

#### 5.2 Add Server-Side Audio Logging

```typescript
// src/voice/pipeline.ts - pushAudio()

pushAudio(audioBuffer: Buffer): void {
  if (!this.isActive || !this.sttSession) {
    logger.warn({ sessionId: this.sessionId }, 'pushAudio: inactive or no STT session');
    return;
  }

  if (!this.sttSession.isConnected) {
    logger.warn({ sessionId: this.sessionId }, 'pushAudio: STT not connected');
    return;
  }

  // ADD: Periodic logging
  if (!this._audioChunkCount) this._audioChunkCount = 0;
  this._audioChunkCount++;
  
  if (this._audioChunkCount % 50 === 0) {
    logger.debug({ 
      sessionId: this.sessionId, 
      chunkCount: this._audioChunkCount,
      bufferSize: audioBuffer.length 
    }, 'pushAudio: sending to STT');
  }

  this.sttSession.sendAudio(audioBuffer);
}
```

---

## Implementation Fixes

### Fix 1: VoiceClient Connection State Tracking

```javascript
// web/js/api.js - VoiceClient class

export class VoiceClient {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.ws = null;
    this.connectionState = 'disconnected'; // ADD: Track state
    this.callbacks = { /* ... */ };
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Prevent duplicate connections
      if (this.connectionState === 'connecting' || this.connectionState === 'connected') {
        console.warn('[VoiceClient] Already connecting/connected');
        return resolve();
      }
      
      this.connectionState = 'connecting';
      
      // ... connection logic
      
      this.ws.onopen = () => {
        console.log('[VoiceClient] WebSocket OPEN');
        this.connectionState = 'connected';
        this.send({ type: 'init', session_id: this.sessionId });
      };

      this.ws.onerror = (error) => {
        console.error('[VoiceClient] WebSocket ERROR:', error);
        this.connectionState = 'error';
        reject(error);
        this.callbacks.onError('CONNECTION_ERROR', 'WebSocket connection error');
      };

      this.ws.onclose = (event) => {
        console.log('[VoiceClient] WebSocket CLOSE:', event.code, event.reason);
        this.connectionState = 'disconnected';
        this.callbacks.onClose();
      };
    });
  }

  // ADD: Check if ready
  isReady() {
    return this.connectionState === 'connected' && 
           this.ws && 
           this.ws.readyState === WebSocket.OPEN;
  }
}
```

### Fix 2: Graceful Provider Initialization

```typescript
// src/index.ts - WebSocket connection handler

wss.on('connection', async (ws, req) => {
  // ... validation code ...

  try {
    logger.info({ sessionId }, 'Voice WebSocket: creating providers');

    const deps: VoiceWebSocketDependencies = {
      sttProvider: new DeepgramSttProvider({ apiKey: deepgramKey }),
      ttsProvider: createTtsProvider({ provider: 'cartesia', apiKey: cartesiaKey }),
      llmProvider: new GeminiLlmProvider({ apiKey: geminiKey }),
    };

    logger.info({ sessionId }, 'Voice WebSocket: providers created');

    handleVoiceWebSocket(ws as unknown as WebSocket, sessionId, deps);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ 
      sessionId, 
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined 
    }, 'Voice WebSocket: provider creation failed');
    
    // Send error to client before closing
    try {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'PROVIDER_INIT_FAILED',
        message: `Failed to initialize voice providers: ${errorMessage}`
      }));
    } catch (sendError) {
      logger.warn('Failed to send error message to client');
    }
    
    ws.close(1011, 'Provider initialization failed');
  }
});
```

### Fix 3: Audio Context Resume on User Gesture

```javascript
// web/js/pages/playground.js - startLiveVoice()

async function startLiveVoice() {
  console.log('[Playground] startLiveVoice() called');
  
  if (!voiceClient || !voiceClient.isReady()) {
    console.warn('[Playground] VoiceClient not ready');
    toast.warning('Voice Not Connected', 'Please wait for voice connection.');
    return;
  }

  try {
    // Initialize audio context on user gesture
    if (!audioContext) {
      console.log('[Playground] Creating AudioContext');
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
    }

    // Resume if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      console.log('[Playground] Resuming suspended AudioContext');
      await audioContext.resume();
    }

    console.log('[Playground] AudioContext state:', audioContext.state);

    // Get microphone stream
    console.log('[Playground] Requesting microphone access');
    
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    console.log('[Playground] Microphone access granted');
    console.log('[Playground] Audio tracks:', mediaStream.getAudioTracks().length);

    // ... rest of audio setup
  } catch (error) {
    console.error('[Playground] startLiveVoice error:', error);
    
    if (error.name === 'NotAllowedError') {
      toast.error('Microphone Denied', 'Please allow microphone access in your browser.');
    } else if (error.name === 'NotFoundError') {
      toast.error('No Microphone', 'No microphone found on this device.');
    } else {
      toast.error('Microphone Error', error.message);
    }
    
    stopLiveVoice();
  }
}
```

### Fix 4: Deepgram is_final Fix

```typescript
// src/providers/stt/deepgram.ts - parseTranscript()

private parseTranscript(data: unknown): TranscriptEvent | null {
  const transcriptData = data as {
    channel?: {
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    };
    is_final?: boolean;
    speech_final?: boolean;
  };

  const alternatives = transcriptData.channel?.alternatives;
  if (!alternatives || alternatives.length === 0) {
    return null;
  }

  const transcript = alternatives[0].transcript;
  if (!transcript || transcript.trim() === '') {
    return null;
  }

  // FIX: Deepgram's is_final indicates if this transcript segment is final
  // speech_final indicates if the speaker has finished their utterance
  // We should treat EITHER as a final transcript for our purposes
  const isFinal = transcriptData.is_final === true || transcriptData.speech_final === true;

  logger.debug({
    transcript: transcript.substring(0, 50),
    isFinal,
    rawIsFinal: transcriptData.is_final,
    rawSpeechFinal: transcriptData.speech_final
  }, 'parseTranscript result');

  return {
    text: transcript,
    isFinal,
    timestamp: Date.now(),
  };
}
```

---

## Testing Checklist

### Pre-Test Setup

- [ ] Verify `.env` has all required keys:
  ```
  GEMINI_API_KEY=xxx
  DEEPGRAM_API_KEY=xxx
  CARTESIA_API_KEY=xxx
  ```
- [ ] Server started with `npm run dev` or `bun run dev`
- [ ] Check console for: "HTTP server started" and "WebSocket server started"
- [ ] Browser dev tools open (Console + Network tabs)

### Test 1: WebSocket Connection

1. [ ] Create a project in the UI
2. [ ] Create an NPC in the project
3. [ ] Go to Playground, select the NPC
4. [ ] Start a text session first (verify it works)
5. [ ] Switch to Voice mode
6. [ ] **Check browser console for:** `[VoiceClient] Connecting to: ws://localhost:3001/ws/voice?session_id=xxx`
7. [ ] **Check server console for:** `Voice WebSocket connected`
8. [ ] **Check browser console for:** `[VoiceClient] WebSocket OPEN`

### Test 2: Pipeline Initialization

1. [ ] After WebSocket connects, check for init message
2. [ ] **Check server console for:** `handleInitMessage: start`
3. [ ] **Check server console for:** `VoicePipeline.initialize: complete`
4. [ ] **Check browser console for:** `'ready'` message received
5. [ ] **Check UI for:** "Connected" status

### Test 3: Audio Capture

1. [ ] Click "Start Live Voice" button
2. [ ] **Check browser console for:** `[Playground] Creating AudioContext`
3. [ ] **Check browser console for:** `[Playground] Microphone access granted`
4. [ ] Speak something
5. [ ] **Check browser console for:** `[Audio] Sending chunk` logs
6. [ ] **Check server console for:** `pushAudio: sending to STT` logs

### Test 4: Transcription

1. [ ] Speak clearly into microphone
2. [ ] **Check server console for:** `STT transcript` logs
3. [ ] **Check browser UI for:** Transcript appearing
4. [ ] Stop speaking for 700ms
5. [ ] **Check for:** VAD committing the utterance

### Test 5: Full Round Trip

1. [ ] Speak: "Hello, how are you?"
2. [ ] Wait for silence timeout
3. [ ] **Check for:** User message in chat
4. [ ] **Check for:** NPC response text chunks
5. [ ] **Check for:** TTS audio chunks (audio playing)
6. [ ] **Check for:** generation_end message

### Test 6: Error Handling

1. [ ] Test with invalid API key (Deepgram)
2. [ ] **Verify:** Error message shown to user
3. [ ] Test with no microphone
4. [ ] **Verify:** Graceful error message
5. [ ] Test network disconnection
6. [ ] **Verify:** Reconnection attempt or clear error

---

## Quick Reference: Expected Log Sequence

```
# Server startup
INFO: Evolve.NPC HTTP server started { port: 3000 }
INFO: WebSocket server started { wsPort: 3001 }

# On voice connection
INFO: Voice WebSocket connection received { path: '/ws/voice', ... }
INFO: Voice WebSocket: session verified { sessionId: 'xxx' }
INFO: Voice WebSocket: creating providers
INFO: Voice WebSocket: providers created, calling handler
INFO: Voice WebSocket connected { sessionId: 'xxx' }

# On init message
INFO: handleInitMessage: start { sessionId: 'xxx' }
INFO: handleInitMessage: voice config loaded { voiceId: '...' }
INFO: VoicePipeline.initialize: start
INFO: DeepgramSession.connect: starting
INFO: DeepgramSession: connection OPEN
INFO: DeepgramSession.connect: success
INFO: CartesiaSession.connect: starting
INFO: CartesiaSession.connect: success
INFO: VoicePipeline.initialize: complete
INFO: handleInitMessage: complete

# On audio input
DEBUG: pushAudio: sending to STT { chunkCount: 50 }
DEBUG: DeepgramSession: transcript event received
DEBUG: STT transcript { text: 'hello', isFinal: true }
INFO: Processing transcript { textLength: 5 }

# On LLM response
DEBUG: LLM stream chunk { textLength: 10 }
DEBUG: TTS audio chunk { audioBytes: 4096 }
INFO: Pipeline event: generation_end
```

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `web/js/api.js` | Add connection state, logging, isReady() method |
| `web/js/pages/playground.js` | Add console logs, fix connection flow, error handling |
| `src/index.ts` | Add comprehensive WS logging, error handling |
| `src/ws/handler.ts` | Add logging to all message handlers |
| `src/voice/pipeline.ts` | Add logging to initialize(), pushAudio() |
| `src/providers/stt/deepgram.ts` | Add logging, fix is_final handling |
| `src/providers/tts/cartesia.ts` | Add logging to connect(), synthesize() |

---

## Next Steps After Debugging

1. Once the issue is identified through logs:
   - Fix the root cause
   - Remove excessive debug logging (keep error/warn/info levels)
   - Add proper error boundaries
   
2. Consider implementing:
   - WebSocket heartbeat/ping to detect stale connections
   - Automatic reconnection on network hiccup
   - AudioWorklet instead of deprecated ScriptProcessor
   - Better VAD with Silero model for browser

---
