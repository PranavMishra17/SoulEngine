# Voice WebSocket Protocol

## Overview

The `/ws/voice` endpoint provides a full-duplex, JSON-framed WebSocket channel
for real-time NPC voice interactions. Each session follows a strict message
ordering (see Ordering below). All messages are JSON strings.

Current protocol version: **1**

---

## Connection

```
GET /ws/voice?session_id=<id>
Upgrade: websocket
```

The `session_id` query parameter is required. A session must be created via the
REST API before opening the WebSocket. The server validates the session and
checks cooldown before accepting the upgrade; on failure it returns an HTTP
error code (400 / 404 / 429 / 426).

---

## Audio Format

The `ready` handshake message contains an `audio_format` object that is the
single authoritative source of truth for audio encoding. Clients must use these
values — do not hardcode per-provider sample rates.

```
audio_format: {
  input:  { sampleRate, encoding, channels }   // what the server expects from the client
  output: { sampleRate, encoding, channels }   // what the server streams back to the client
}
```

### Input (client -> server, STT)

| Field       | Value       | Notes                              |
|-------------|-------------|------------------------------------|
| sampleRate  | 16000       | Deepgram expects 16 kHz            |
| encoding    | "linear16"  | 16-bit signed PCM, little-endian   |
| channels    | 1           | Mono                               |

### Output (server -> client, TTS)

Output format depends on the configured TTS provider for the NPC:

| Provider    | sampleRate | encoding     | channels |
|-------------|------------|--------------|----------|
| cartesia    | 44100      | "pcm_f32le"  | 1        |
| elevenlabs  | 16000      | "pcm_s16le"  | 1        |

The exact values are returned in `audio_format.output` on every session; clients
need not branch on provider name.

---

## Message Reference

### Inbound (client -> server)

#### `init`
Must be the first message sent after the WebSocket opens.

```json
{
  "type": "init",
  "session_id": "<string>",
  "mode": { "input": "voice|text", "output": "voice|text" }
}
```

`mode` is optional; defaults to `{ "input": "voice", "output": "voice" }`.

#### `audio`
Raw PCM audio chunk from the microphone, base64-encoded. Must only be sent
after receiving `ready` and only in voice-input modes.

```json
{
  "type": "audio",
  "data": "<base64>"
}
```

Audio must match the `audio_format.input` spec from the `ready` message
(16 kHz, linear16, mono).

#### `commit`
Signals the end of the user's speech turn. The server will process the
accumulated STT transcript and generate a response.

```json
{ "type": "commit" }
```

#### `text`
Send a text message directly to the NPC (text-input modes).

```json
{
  "type": "text",
  "content": "<string>"
}
```

#### `end`
Gracefully end the voice session. The server saves the session, sends `sync`,
then closes the WebSocket.

```json
{ "type": "end" }
```

---

### Outbound (server -> client)

#### `ready`
Sent immediately after the server has initialized the pipeline in response to
`init`. This is the handshake completion message.

```json
{
  "type": "ready",
  "session_id": "<string>",
  "npc_name": "<string>",
  "voice_config": {
    "provider": "cartesia|elevenlabs",
    "voice_id": "<string>",
    "speed": <number>
  },
  "mode": { "input": "voice|text", "output": "voice|text" },
  "protocol_version": "1",
  "audio_format": {
    "input": {
      "sampleRate": 16000,
      "encoding": "linear16",
      "channels": 1
    },
    "output": {
      "sampleRate": <number>,
      "encoding": "<string>",
      "channels": 1
    }
  }
}
```

Clients should treat `protocol_version` as opaque for now and store it for
diagnostic logging.

#### `transcript`
Streaming STT transcript of what the user said.

```json
{
  "type": "transcript",
  "text": "<string>",
  "is_final": <boolean>
}
```

`is_final: false` indicates an interim result; `true` indicates the utterance
is complete.

#### `text_chunk`
Streaming LLM response text (one or more words at a time).

```json
{
  "type": "text_chunk",
  "text": "<string>"
}
```

#### `audio_chunk`
Streaming TTS audio, base64-encoded. Encoding matches `audio_format.output`
from the `ready` message.

```json
{
  "type": "audio_chunk",
  "data": "<base64>"
}
```

#### `tool_call`
Emitted when the NPC's Mind agent invokes a game tool.

```json
{
  "type": "tool_call",
  "name": "<string>",
  "args": { ... }
}
```

#### `mind_activity`
Emitted after the Mind agent completes its reasoning cycle.

```json
{
  "type": "mind_activity",
  "tools_called": [
    { "name": "<string>", "args": { ... }, "status": "success|error" }
  ],
  "duration_ms": <number>,
  "completed": <boolean>
}
```

#### `generation_end`
Signals that the NPC has finished generating its full response for this turn.

```json
{ "type": "generation_end" }
```

#### `sync`
Sent after an `end` message is processed. Indicates the session was saved.

```json
{
  "type": "sync",
  "success": <boolean>,
  "version": "<string>"
}
```

#### `exit_convo`
Sent when the NPC's Mind agent decides to end the conversation. The WebSocket
will be closed by the server immediately after.

```json
{
  "type": "exit_convo",
  "reason": "<string>",
  "cooldown_seconds": <number | undefined>
}
```

#### `error`
Sent when a recoverable or fatal error occurs.

```json
{
  "type": "error",
  "code": "<string>",
  "message": "<string>"
}
```

Common codes: `SESSION_MISMATCH`, `ALREADY_INITIALIZED`, `NOT_INITIALIZED`,
`INIT_FAILED`, `AUDIO_ERROR`, `COMMIT_ERROR`, `TEXT_ERROR`, `END_FAILED`,
`TTS_KEY_MISSING`, `LLM_KEY_MISSING`, `UNKNOWN_MESSAGE`, `INVALID_MESSAGE`.

---

## Message Ordering

```
Client                                Server
  |--- WS upgrade (session_id) -------->|
  |                                     |  (validates session + cooldown)
  |<-- HTTP 101 Switching Protocols ----|
  |--- init (session_id, mode?) ------->|
  |                                     |  (initializes STT/TTS/LLM pipeline)
  |<-- ready (protocol_version, ...) ---|
  |                                     |
  |  [voice turn loop]                  |
  |--- audio (base64 PCM) ------------>|  (repeated; matches audio_format.input)
  |--- commit ----------------------->|
  |<-- transcript (interim) -----------|  (repeated)
  |<-- transcript (final) -------------|
  |<-- text_chunk ----------------------|  (repeated)
  |<-- audio_chunk --------------------|  (repeated; matches audio_format.output)
  |<-- generation_end ------------------|
  |                                     |
  |  [or text turn]                     |
  |--- text (content) ---------------->|
  |<-- text_chunk ----------------------|  (repeated)
  |<-- audio_chunk --------------------|  (if output mode = voice, repeated)
  |<-- generation_end ------------------|
  |                                     |
  |--- end --------------------------->|
  |<-- sync (success, version) ---------|
  |    [server closes WS]              |
```

Notes:
- `init` must be sent exactly once and must precede all other messages.
- Audio chunks and text chunks may arrive interleaved during generation.
- The server may emit `exit_convo` at any point during a turn; the WebSocket
  will close immediately after.
- `error` messages are informational; the WebSocket may or may not close
  depending on the severity.

---

## Versioning Policy

The `protocol_version` field in `ready` is a monotonically incrementing integer
string. Clients should log this value for diagnostics.

A version bump will occur when:
- A required field is added to or removed from any existing message type.
- The semantics of a field change in a backward-incompatible way.
- A new mandatory message type is added.

Additive changes (new optional fields, new optional message types) do not
require a version bump.
