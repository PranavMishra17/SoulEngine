# SDK Reference for Evolve.NPC Phase 3+

A code-focused technical reference for implementing the Evolve.NPC voice pipeline and LLM integration. All examples use TypeScript and follow official SDK documentation.

---

## 1. GEMINI (Google AI Studio)

**Installation:**
```bash
bun add @google/generative-ai
```

**Key Imports:**
```typescript
import { GoogleGenAI, Type } from '@google/generative-ai';
```

**Initialization:**
```typescript
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});
```

**Streaming Chat Completion:**
```typescript
const controller = new AbortController();
const signal = controller.signal;

try {
  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [{ text: 'Hello, who are you?' }] }
    ],
    signal // For cancellation support
  });

  for await (const chunk of response) {
    console.log(chunk.text); // Streaming text tokens
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Stream aborted');
  }
}

// Abort from elsewhere
controller.abort();
```

**Function Calling / Tool Use:**
```typescript
const toolDeclarations = {
  functionDeclarations: [
    {
      name: 'call_police',
      description: 'Contact local police with urgency level',
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: { type: Type.STRING, description: 'Location' },
          urgency: { type: Type.NUMBER, description: '1-10 urgency level' }
        },
        required: ['location', 'urgency']
      }
    }
  ]
};

const config = {
  tools: [toolDeclarations],
  toolConfig: {
    functionCallingConfig: {
      mode: 'AUTO' // or 'ANY', 'NONE', 'VALIDATED'
    }
  }
};

const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'The player is threatening me!',
  config
});

// Check for function calls in streaming
if (response.functionCalls && response.functionCalls.length > 0) {
  for (const call of response.functionCalls) {
    console.log(`Function: ${call.name}`);
    console.log(`Args: ${JSON.stringify(call.args)}`);
    // Execute the function, get result
    const result = await callPolice(call.args);
    // Send result back to model for next turn
  }
}
```

**Streaming Function Calling Loop:**
```typescript
let contents = [
  { role: 'user', parts: [{ text: 'Schedule a meeting and then send an email' }] }
];

while (true) {
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config
  });

  if (result.functionCalls && result.functionCalls.length > 0) {
    const functionCall = result.functionCalls[0];
    const { name, args } = functionCall;
    
    // Execute tool
    const toolResponse = await executeTool(name, args);
    
    // Append to history for next turn
    contents.push({ role: 'model', parts: [{ functionCall }] });
    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name,
            response: { result: toolResponse }
          }
        }
      ]
    });
  } else {
    // No more function calls, done
    console.log(result.text);
    break;
  }
}
```

**Error Handling:**
```typescript
try {
  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: prompt,
    signal: abortController.signal
  });
  
  for await (const chunk of response) {
    processChunk(chunk);
  }
} catch (error) {
  if (error.name === 'AbortError') {
    logger.info('User interrupted generation');
  } else if (error.status === 429) {
    logger.warn('Rate limited, retry with backoff');
  } else if (error.status === 503) {
    logger.error('Service unavailable');
  } else {
    logger.error('Gemini error:', error.message);
  }
}
```

**Types:**
```typescript
interface GenerateContentRequest {
  model: string;
  contents: Content[];
  config?: GenerateContentConfig;
  signal?: AbortSignal;
}

interface Content {
  role?: 'user' | 'model';
  parts: Part[];
}

interface Part {
  text?: string;
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
}

interface FunctionCall {
  name: string;
  args: Record<string, any>;
}

interface FunctionResponse {
  name: string;
  response: Record<string, any>;
}

interface StreamGenerateContentResponse {
  text: string; // Streaming chunk text
  functionCalls?: FunctionCall[];
  candidates: Candidate[];
}
```

**Gotchas:**
- `generateContentStream()` returns an async iterable, not a Promise<string>
- Function calls may appear in later chunks during streaming; check every chunk
- AbortSignal requires passing via request config, not as top-level parameter
- When sending function results back, preserve conversation history exactly as received from model
- Tool declarations use `Type.OBJECT`, `Type.STRING`, etc. (not plain strings)

---

## 2. DEEPGRAM

**Installation:**
```bash
bun add @deepgram/sdk
```

**Key Imports:**
```typescript
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
```

**Initialization:**
```typescript
const client = createClient({
  apiKey: process.env.DEEPGRAM_API_KEY
});
```

**Live Streaming Transcription (WebSocket):**
```typescript
const dgConnection = client.listen.live({
  model: 'nova-2',
  punctuate: true,
  encoding: 'linear16',
  sampleRate: 16000
});

// Handle connection opened
dgConnection.on(LiveTranscriptionEvents.Open, () => {
  console.log('Connection opened');
});

// Handle incoming transcripts
dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
  const transcript = data.channel.alternatives[0].transcript;
  const isFinal = !data.is_final;
  
  if (isFinal) {
    console.log(`Final: ${transcript}`);
    // Send to LLM for processing
  } else {
    console.log(`Interim: ${transcript}`);
    // Update UI with interim result
  }
});

// Handle errors
dgConnection.on(LiveTranscriptionEvents.Error, (error) => {
  console.error('Deepgram error:', error);
});

// Handle connection closed
dgConnection.on(LiveTranscriptionEvents.Close, () => {
  console.log('Connection closed');
});

// Send audio chunks (Buffer format, raw PCM)
async function sendAudioChunk(chunk: Buffer) {
  dgConnection.send(chunk);
}

// Finish transcription
dgConnection.finalize();
```

**Audio Chunk Format:**
```typescript
// Raw PCM audio, 16-bit samples, 16kHz sample rate
// Buffer should contain raw audio bytes
const audioChunk = Buffer.from(pcmData); // Float32Array or Uint8Array
dgConnection.send(audioChunk);
```

**Reconnection Pattern:**
```typescript
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;
const reconnectDelay = 1000; // ms

async function connectWithRetry() {
  try {
    dgConnection = client.listen.live({
      model: 'nova-2',
      punctuate: true
    });
    reconnectAttempts = 0;
  } catch (error) {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      await new Promise(r => setTimeout(r, reconnectDelay * reconnectAttempts));
      await connectWithRetry();
    } else {
      throw error;
    }
  }
}
```

**Error Handling:**
```typescript
dgConnection.on(LiveTranscriptionEvents.Error, (error) => {
  logger.error('Deepgram transcription error:', error);
  
  if (error.message.includes('401')) {
    logger.error('Invalid API key');
  } else if (error.message.includes('429')) {
    logger.warn('Rate limited, backing off');
  } else if (error.message.includes('Network')) {
    logger.warn('Network error, attempting reconnect');
    connectWithRetry();
  }
});
```

**Types:**
```typescript
interface LiveTranscriptionEvent {
  channel: {
    alternatives: Array<{
      transcript: string;
      confidence: number;
      words: Array<{
        word: string;
        start: number;
        end: number;
        confidence: number;
      }>;
    }>;
  };
  is_final: boolean;
  metadata: {
    request_id: string;
  };
}

interface LiveTranscriptionOptions {
  model: string;
  punctuate?: boolean;
  encoding?: string;
  sampleRate?: number;
  language?: string;
}
```

**Gotchas:**
- `send()` is async but does NOT return a promise; it queues the data
- `is_final` is inverted: `is_final: false` means it's a final transcript, `true` means interim
- Audio must be sent as raw PCM bytes, not base64 encoded
- Connection closes automatically after 5 minutes of silence
- Always call `finalize()` when done to signal end of audio stream

---

## 3. CARTESIA (Default TTS)

**Installation:**
```bash
bun add @cartesia/cartesia-js
```

**Key Imports:**
```typescript
import { CartesiaClient } from '@cartesia/cartesia-js';
import { Cartesia } from '@cartesia/cartesia-js'; // For types
```

**Initialization:**
```typescript
const cartesia = new CartesiaClient({
  apiKey: process.env.CARTESIA_API_KEY
});
```

**WebSocket Streaming TTS (Single Request):**
```typescript
const websocket = cartesia.tts.websocket({
  container: 'raw',       // or 'wav', 'mp3'
  encoding: 'pcm_f32le',  // or 'pcm_s16le', 'ulaw'
  sampleRate: 44100
});

const response = await websocket.send({
  modelId: 'sonic-3',
  voice: {
    mode: 'id',
    id: 'a0e99841-438c-4a64-b679-ae501e7d6091' // Voice ID
  },
  transcript: 'Hello, how can I help you today?',
  language: 'en'
});

// Receive audio chunks
response.on('message', (message) => {
  if (message.audio) {
    // message.audio is a base64-encoded string
    const audioBuffer = Buffer.from(message.audio, 'base64');
    playAudio(audioBuffer);
  }
});

// Or use async iterator
for await (const message of response.events('message')) {
  if (message.audio) {
    const audioBuffer = Buffer.from(message.audio, 'base64');
    playAudio(audioBuffer);
  }
}
```

**Streaming Input (Incremental Text):**
```typescript
const contextId = `ctx_${Date.now()}`;
const contextOptions = {
  contextId,
  modelId: 'sonic-3',
  voice: {
    mode: 'id',
    id: 'a0e99841-438c-4a64-b679-ae501e7d6091'
  },
  language: 'en'
};

// First message on context
const response1 = await websocket.send({
  ...contextOptions,
  transcript: 'Hello, ', // Can be partial
  continue: true,        // More text coming
  maxBufferDelayMs: 3000 // Wait up to 3s for more text
});

// Accumulate audio from first part
const audioChunks1: Buffer[] = [];
for await (const msg of response1.events('message')) {
  if (msg.audio) {
    audioChunks1.push(Buffer.from(msg.audio, 'base64'));
  }
}

// Subsequent messages on same context (uses websocket.continue())
const response2 = await websocket.continue({
  ...contextOptions,
  transcript: 'my name is Sonic.',
  continue: false // No more text after this
});

const audioChunks2: Buffer[] = [];
for await (const msg of response2.events('message')) {
  if (msg.audio) {
    audioChunks2.push(Buffer.from(msg.audio, 'base64'));
  }
}

// Playback audio in order received (maintains prosody)
const allAudio = Buffer.concat([...audioChunks1, ...audioChunks2]);
playAudio(allAudio);
```

**Flush / End of Input:**
```typescript
// Option 1: Send empty transcript with continue: false
await websocket.continue({
  ...contextOptions,
  transcript: '',
  continue: false
});

// Option 2: Close context explicitly
await websocket.cancel({ contextId });
```

**Error Handling:**
```typescript
try {
  const response = await websocket.send({
    modelId: 'sonic-3',
    transcript: text,
    voice: { mode: 'id', id: voiceId }
  });

  for await (const msg of response.events('message')) {
    if (msg.error) {
      logger.error('Cartesia error:', msg.error);
    }
    if (msg.audio) {
      playAudio(Buffer.from(msg.audio, 'base64'));
    }
  }
} catch (error) {
  if (error.status === 429) {
    logger.warn('Too many concurrent contexts');
  } else if (error.status === 401) {
    logger.error('Invalid API key');
  } else {
    logger.error('Cartesia TTS error:', error.message);
  }
}
```

**Types:**
```typescript
interface Cartesia.TtsWebSocketRequest {
  modelId: string;
  transcript: string;
  voice: {
    mode: 'id' | 'embedding';
    id: string;
  };
  language?: string;
  continue?: boolean;
  contextId?: string;
  maxBufferDelayMs?: number;
}

interface CartesiaTtsMessage {
  audio?: string; // base64-encoded audio chunk
  done?: boolean;
  error?: string;
  timestamp: number;
  word_timings?: Array<{
    word: string;
    start_time: number;
    end_time: number;
  }>;
  phoneme_timings?: Array<{
    phoneme: string;
    start_time: number;
    end_time: number;
  }>;
}

interface WebSocketStreamResponse {
  on(event: string, handler: Function): void;
  events(event: string): AsyncIterable<CartesiaTtsMessage>;
  source: Source; // For browser playback with WebPlayer
}
```

**Gotchas:**
- Audio output is base64-encoded; decode before playback
- `continue: true` signals more text coming; `continue: false` signals end of input
- Same `contextId` MUST be used for all parts of streamed input to maintain prosody
- `maxBufferDelayMs` buffers text before synthesis; default 3000ms is usually correct
- All fields except `transcript`, `continue`, `contextId` must remain identical within a context
- WebSocket closes if idle >5 minutes; create new connection if needed
- Sample rate must match voice model capability (typically 44.1kHz or 24kHz)

---

## 4. ELEVENLABS (Alternative TTS)

**Installation:**
```bash
bun add elevenlabs
```

**Key Imports:**
```typescript
import { Conversation } from 'elevenlabs';
```

**WebSocket Streaming TTS:**
```typescript
// Initialize WebSocket connection
const ws = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?api_key=${apiKey}`);

ws.onopen = () => {
  console.log('WebSocket connected');
  
  // Send initial config
  ws.send(JSON.stringify({
    text: 'Hello, ',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    },
    generation_config: {
      chunk_length_schedule: [500]
    },
    xi_api_key: process.env.ELEVENLABS_API_KEY
  }));
};

ws.onmessage = (event) => {
  // Audio chunks arrive as binary data
  const audioChunk = event.data; // ArrayBuffer or Blob
  playAudio(audioChunk);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket closed');
};
```

**Streaming Text Input (Incremental):**
```typescript
// Send initial message
ws.send(JSON.stringify({
  text: 'The ',
  voice_settings: { stability: 0.5, similarity_boost: 0.75 }
}));

// Send more text
ws.send(JSON.stringify({
  text: 'weather is ',
  continue: true
}));

// Final text chunk
ws.send(JSON.stringify({
  text: 'nice today.',
  continue: false  // Signal end
}));
```

**Flush / End of Generation:**
```typescript
// Signal completion (optional, can also close connection)
ws.send(JSON.stringify({
  text: '',
  flush: true
}));

// Or close connection
ws.close();
```

**Error Handling:**
```typescript
ws.onerror = (error) => {
  if (ws.readyState === WebSocket.CLOSED) {
    logger.error('WebSocket connection closed unexpectedly');
  } else if (error.message.includes('401')) {
    logger.error('Invalid ElevenLabs API key');
  } else if (error.message.includes('429')) {
    logger.warn('Rate limited');
  } else {
    logger.error('ElevenLabs WebSocket error:', error);
  }
};
```

**Types:**
```typescript
interface ElevenLabsWebSocketMessage {
  text?: string;
  voice_settings?: {
    stability: number;      // 0-1
    similarity_boost: number; // 0-1
  };
  generation_config?: {
    chunk_length_schedule?: number[];
  };
  continue?: boolean;
  flush?: boolean;
  xi_api_key?: string;
}

interface AudioChunk {
  // Binary audio data (format depends on endpoint)
  // Typically MP3 or PCM
}
```

**Gotchas:**
- Audio arrives as binary (ArrayBuffer/Blob), not base64
- API key must be passed in message, not in WebSocket URL
- `xi_api_key` required in every message (ElevenLabs behavior)
- Official docs for streaming are incomplete; patterns inferred from SDKs
- No native NPM WebSocket SDK for streaming TTS (use raw WebSocket)
- Use `Conversation` class for agent-based conversations, raw WebSocket for simple TTS streaming

---

## 5. HONO (Web Framework)

**Installation:**
```bash
bun add hono
```

**Key Imports:**
```typescript
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';  // or hono/deno, hono/cloudflare-workers
```

**Initialization:**
```typescript
const app = new Hono();

// For Bun runtime
export default {
  fetch: app.fetch,
  websocket: app.websocket // Required for Bun
};
```

**Basic Route Setup:**
```typescript
// GET
app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// POST with JSON body
app.post('/api/session/start', async (c) => {
  const body = await c.req.json();
  const { projectId, npcId, playerId } = body;
  
  // Validate and process
  return c.json({ sessionId: 'sess_123' }, 201);
});

// PUT
app.put('/api/npc/:id', async (c) => {
  const id = c.req.param('id');
  const updates = await c.req.json();
  return c.json({ id, ...updates });
});

// DELETE
app.delete('/api/npc/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ deleted: id });
});
```

**WebSocket Upgrade Handling:**
```typescript
app.get(
  '/ws/voice',
  upgradeWebSocket((c) => {
    const sessionId = c.req.query('session_id');
    
    return {
      onOpen() {
        console.log(`WebSocket opened: ${sessionId}`);
      },
      
      onMessage(event, ws) {
        const message = JSON.parse(event.data);
        
        if (message.type === 'audio') {
          // Handle audio chunk
          const chunk = Buffer.from(message.data, 'base64');
          processTTSAudio(chunk);
        } else if (message.type === 'commit') {
          // End of input signal
          finalizeGeneration();
        }
        
        // Send response
        ws.send(JSON.stringify({
          type: 'text_chunk',
          data: 'Hello from server'
        }));
      },
      
      onClose() {
        console.log(`WebSocket closed: ${sessionId}`);
        cleanupSession(sessionId);
      },
      
      onError(error) {
        logger.error(`WebSocket error: ${error}`);
      }
    };
  })
);
```

**Middleware Pattern:**
```typescript
// Custom logger middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const end = Date.now();
  console.log(`${c.req.method} ${c.req.path} ${end - start}ms`);
});

// Error handling middleware
app.use('*', async (c, next) => {
  try {
    await next();
  } catch (error) {
    logger.error('Request error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// CORS middleware
app.use('*', (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  return next();
});
```

**Request Body Parsing:**
```typescript
// JSON
app.post('/api/data', async (c) => {
  const data = await c.req.json();
  return c.json({ received: data });
});

// Form data
app.post('/api/upload', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  return c.json({ filename: file.name });
});

// Query params
app.get('/api/search', (c) => {
  const query = c.req.query('q');
  return c.json({ query });
});

// Path params
app.get('/api/users/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id });
});
```

**Error Handling:**
```typescript
// Global error handler
app.onError((error, c) => {
  logger.error('Unhandled error:', error);
  return c.json({
    error: error.message,
    status: 500
  }, 500);
});

// Per-route error handling
app.post('/api/risky', async (c) => {
  try {
    const result = await riskyOperation();
    return c.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});
```

**Static File Serving:**
```typescript
import { serveStatic } from 'hono/bun';

app.use('/static/*', serveStatic({ root: './public' }));
app.use('/index.html', serveStatic({ path: './public/index.html' }));
```

**CORS Setup:**
```typescript
import { cors } from 'hono/cors';

app.use(
  cors({
    origin: 'https://client.example.com',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
);
```

**Types:**
```typescript
interface Context {
  req: Request;
  env: Record<string, any>;
  var: Record<string, any>;
  header(name: string, value: string): void;
  json(data: any, status?: number): Response;
  text(text: string, status?: number): Response;
  html(html: string, status?: number): Response;
}

interface WebSocketHandler {
  onOpen?(): void;
  onMessage?(event: MessageEvent, ws: WebSocket): void;
  onClose?(): void;
  onError?(error: Error): void;
}

interface Handler {
  (c: Context): Response | Promise<Response>;
}
```

**Gotchas:**
- `upgradeWebSocket()` signature depends on runtime; Bun, Deno, Cloudflare all differ
- Middleware runs in order; place error handlers early
- `c.req.json()` is async; must await
- WebSocket events use `onMessage` not `onmessage` (camelCase)
- Path params use `:name` syntax; access via `c.req.param('name')`
- `c.var` is request-scoped; use for passing data through middleware chain

---

## 6. LIVEKIT (Patterns Only - NOT Agent Worker)

**Context:** We are NOT using LiveKit rooms or agent workers. Instead, we extract implementation patterns for STT/TTS wrappers and audio utilities.

**STT Plugin Pattern (Wrapping Deepgram):**
```typescript
// How LiveKit structures STT integrations (example pattern)
interface STTPlugin {
  initialize(config: STTConfig): Promise<void>;
  startStream(): AsyncIterable<TranscriptionResult>;
  pushAudio(chunk: Buffer): Promise<void>;
  stopStream(): Promise<void>;
}

class DeepgramSTTPlugin implements STTPlugin {
  private connection: DeepgramConnection;
  
  async initialize(config: STTConfig) {
    this.connection = deepgramClient.listen.live({
      model: config.model,
      punctuate: true
    });
  }
  
  async *startStream() {
    for await (const transcript of this.connection.transcripts()) {
      yield {
        text: transcript,
        isFinal: transcript.isFinal
      };
    }
  }
  
  async pushAudio(chunk: Buffer) {
    this.connection.send(chunk);
  }
}
```

**TTS Plugin Pattern (Wrapping Cartesia):**
```typescript
interface TTSPlugin {
  synthesize(text: string): AsyncIterable<Buffer>;
  setVoice(voiceId: string): void;
  flush(): Promise<void>;
}

class CartesiaTTSPlugin implements TTSPlugin {
  private contextId: string = `ctx_${Date.now()}`;
  private voiceId: string;
  
  async *synthesize(text: string) {
    const response = await this.cartesia.tts.websocket({
      container: 'raw',
      encoding: 'pcm_f32le',
      sampleRate: 44100
    }).send({
      modelId: 'sonic-3',
      voice: { mode: 'id', id: this.voiceId },
      transcript: text,
      contextId: this.contextId,
      continue: false
    });
    
    for await (const msg of response.events('message')) {
      if (msg.audio) {
        yield Buffer.from(msg.audio, 'base64');
      }
    }
  }
  
  setVoice(voiceId: string) {
    this.voiceId = voiceId;
  }
  
  async flush() {
    // Finalize current context
    this.contextId = `ctx_${Date.now()}`;
  }
}
```

**Audio Buffer Utilities (LiveKit Pattern):**
```typescript
// PCM buffer manipulation helpers
class AudioBuffer {
  static resample(data: Buffer, fromRate: number, toRate: number): Buffer {
    // Resample PCM audio from one rate to another
    const ratio = toRate / fromRate;
    const newLength = Math.ceil(data.length * ratio);
    // Linear interpolation implementation would go here
    return Buffer.alloc(newLength);
  }
  
  static concat(...buffers: Buffer[]): Buffer {
    return Buffer.concat(buffers);
  }
  
  static trim(data: Buffer, silenceThreshold: number = 0.01): Buffer {
    // Remove leading/trailing silence from PCM
    const int16 = new Int16Array(data.buffer);
    let start = 0, end = int16.length - 1;
    
    while (start < int16.length && Math.abs(int16[start]) < silenceThreshold * 32767) start++;
    while (end >= 0 && Math.abs(int16[end]) < silenceThreshold * 32767) end--;
    
    return Buffer.from(int16.slice(start, end + 1).buffer);
  }
}
```

**Sentence Detection Pattern:**
```typescript
class SentenceDetector {
  private buffer: string = '';
  private readonly sentenceEndings = /[.!?;:\n]/;
  
  processChunk(text: string): string[] {
    this.buffer += text;
    const sentences: string[] = [];
    
    // Split on sentence boundaries, keep accumulated non-final text
    const parts = this.buffer.split(this.sentenceEndings);
    
    // All but last are complete sentences
    for (let i = 0; i < parts.length - 1; i++) {
      sentences.push(parts[i] + this.buffer.charAt(this.buffer.indexOf(parts[i + 1]) - 1));
    }
    
    // Keep incomplete sentence in buffer
    this.buffer = parts[parts.length - 1];
    
    return sentences;
  }
  
  flush(): string {
    const final = this.buffer;
    this.buffer = '';
    return final;
  }
}
```

**Interruption Handling Pattern:**
```typescript
class InterruptionHandler {
  private abortController: AbortController;
  private isGenerating: boolean = false;
  
  async startGeneration(prompt: string) {
    this.abortController = new AbortController();
    this.isGenerating = true;
    
    try {
      const stream = await llm.generateContentStream({
        contents: prompt,
        signal: this.abortController.signal
      });
      
      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) break;
        yield chunk;
      }
    } finally {
      this.isGenerating = false;
    }
  }
  
  interrupt() {
    if (this.isGenerating) {
      this.abortController.abort();
      // Also abort TTS if needed
      this.ttsStream?.abort();
    }
  }
}
```

**Gotchas - Pattern Notes:**
- LiveKit plugins are designed as async iterables for streaming
- Always maintain context IDs when using continuations (streaming inputs)
- Interruption must handle both LLM and TTS streams
- Sentence detection should preserve punctuation
- Audio utilities operate on PCM buffers; ensure consistent sample rates
- These are patterns only—Evolve.NPC implements custom WebSocket management

---

## Common Integration Points

**Security Pipeline Order:**
```typescript
async function processUserInput(input: string): Promise<ProcessedInput> {
  // 1. Sanitize
  const sanitized = sanitizer.clean(input);
  if (!sanitized.valid) {
    logger.warn('Input failed sanitization');
    return null;
  }
  
  // 2. Rate limit
  if (!rateLimiter.allow(userId, npcId)) {
    logger.warn('Rate limit exceeded');
    throw new RateLimitError();
  }
  
  // 3. Moderate
  const moderation = await moderator.check(sanitized.text);
  if (moderation.action === 'block') {
    logger.warn('Content blocked');
    return null;
  }
  
  return { text: sanitized.text, moderationFlag: moderation.action };
}
```

**Streaming Pattern (All Services):**
```typescript
async function streamResponse(
  input: string,
  abortSignal: AbortSignal
): Promise<void> {
  // 1. Get streaming text from LLM
  const textStream = llm.generateContentStream(input, { signal: abortSignal });
  
  // 2. Detect sentence boundaries
  const sentenceStream = detectSentences(textStream);
  
  // 3. Stream to TTS incrementally
  for await (const sentence of sentenceStream) {
    if (abortSignal.aborted) break;
    
    const audioStream = tts.synthesize(sentence);
    for await (const chunk of audioStream) {
      sendToClient(chunk); // Send audio to client
    }
  }
}
```

---

## Version Notes

| Service | Package | Tested Version |
|---------|---------|---|
| Gemini | @google/generative-ai | 0.3.0+ |
| Deepgram | @deepgram/sdk | 3.0.0+ |
| Cartesia | @cartesia/cartesia-js | 2.0.0+ |
| ElevenLabs | elevenlabs | (WebSocket, raw) |
| Hono | hono | 4.0.0+ |

---

## Validation & Type Safety

All code examples maintain TypeScript strict mode:
```typescript
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}
```

Each SDK supports full type inference. Use `as const` assertions sparingly; let the SDK provide types.

---

## Additional Resources

- [Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [Deepgram Docs](https://developers.deepgram.com/docs)
- [Cartesia Docs](https://docs.cartesia.ai)
- [ElevenLabs Docs](https://elevenlabs.io/docs)
- [Hono Docs](https://hono.dev/docs)

Last updated: January 2026 • Evolve.NPC Phase 3+
