# CHAT Interface and Voice Pipeline (Playground)

## Quick mental model
- Each user turn runs **sequential** Mind then Speaker: Mind (agent loop with tools) runs first, then Speaker (voice LLM) generates a unified response informed by Mind's context.
- Voice WebSocket is used if input or output is voice; text-only uses REST.
- Mind can emit tool activity or exit_convo which ends the session and applies cooldown.

## Conversation modes and transport
- text-text: REST only.
- text-voice: WebSocket for output audio. Client sends text over WS, server responds with text_chunk + audio_chunk.
- voice-text: WebSocket for input audio and text output. Client streams audio and commits, server responds with text_chunk.
- voice-voice: WebSocket for input audio and output audio.

## WebSocket protocol (voice)
Inbound messages from client:
- init: { session_id, mode }
- audio: { data: base64 PCM }
- commit: end of user utterance
- text: { content } (text input via WS)
- interrupt: stop current generation
- end: end session

Outbound messages to client:
- ready: { session_id, npc_name, voice_config, mode }
- transcript: { text, is_final }
- text_chunk: streamed assistant text
- audio_chunk: base64 PCM audio
- mind_activity: tool calls metadata (name, args, status)
- generation_end: NPC turn complete
- exit_convo: { reason, cooldown_seconds }
- sync: session end result
- error

## Sequential Mind -> Speaker architecture
- **Mind** runs first via `runMindAgentLoop()`: decides tools (recall, MCP conversation tools, exit_convo), executes them, returns `tool_context` (formatted tool results string).
- **Speaker** runs second with an augmented system prompt: `augmentPromptWithMindContext()` injects Mind's tool_context into the slim prompt so Speaker can naturally weave tool results into its response.
- Result: ONE unified NPC response per turn (no separate follow-up phase).
- Both update the same session instance; Mind does not maintain a separate stored instance.

## Voice pipeline flow (server)
1. WS init loads session context and voice config.
2. Pipeline initializes STT and/or TTS based on mode.
3. Input handling:
   - Voice: audio chunks -> Deepgram STT -> transcript aggregation (1.5s debounce) -> processTurn
   - Text: handleTextInput -> processTurn
4. processTurn (sequential):
   - Mind runs first (8s timeout cap for voice, 15s for text)
   - Mind activity emitted to client (tool call chips)
   - exit_convo handled before Speaker if triggered
   - Speaker prompt augmented with Mind's tool_context
   - Speaker streams LLM output, pushes TTS per sentence if output is voice
   - Sentences tracked in spokenSentences[] for interruption context truncation
   - Single generation_end emitted when Speaker finishes
   - exit_convo ends session + closes WS

## Interruption handling
- Client: VAD detects user speech during NPC playback -> 1s barge-in timer -> triggerBargeIn()
- Client clears: audio queue, voiceUserTranscript, responseBuffer
- Server: aborts LLM + TTS, clears transcript aggregator + STT accumulator
- Context truncation: last assistant message in history replaced with actually-spoken sentences + [interrupted] marker
- Transcript processing state reset for clean next turn

## Frontend flow (Playground)
- Mode selection sets input/output mode.
- Start session -> configure UI -> connect WS if any voice.
- Voice input uses Silero VAD in browser; streams PCM16 frames, commits on speech end.
- Audio output uses Web Audio API; sample rate picked by provider (Cartesia 44100, ElevenLabs 16000).
- Mind activity panel shows tool calls alongside the unified response.

## Associated files and what they do

Frontend UI and logic
- web/index.html: playground template and DOM ids for chat, voice controls, mind panels, x-ray.
- web/js/pages/playground.js: main playground state machine (session start/end, mode select, VoiceClient wiring, VAD, audio playback, chat UI, mind panel, cycles).
- web/js/api.js: REST wrappers and VoiceClient WebSocket implementation with event callbacks.
- web/js/components.js: toast and modal helpers used by playground.
- web/css/pages-app.css: styling for playground layout, chat, mind panel, voice UI.
- web/css/design-system.css: color tokens and base UI variables (affects playground visuals).

Backend routes and session
- src/routes/session.ts: start/end session, session stats, instance fetch.
- src/routes/conversation.ts: REST chat for text-text mode; runs Mind then Speaker sequentially.
- src/routes/projects.ts: voices list endpoint used by NPC editor and settings.
- src/routes/npcs.ts: NPC definition updates (includes voice config).
- src/session/manager.ts: session lifecycle, session context, instance updates, endSession persistence.
- src/session/store.ts: in-memory session store.

Voice WebSocket + pipeline
- src/ws/handler.ts: WebSocket handshake, init, message routing, pipeline events -> WS messages, cleanup on close.
- src/voice/pipeline.ts: STT -> security -> Mind -> Speaker -> TTS orchestration, transcript aggregation, interruption with context truncation.
- src/voice/audio.ts: base64 encode/decode and audio utilities.
- src/voice/sentence-detector.ts: splits streaming text into sentences for TTS.

Providers
- src/providers/stt/deepgram.ts: live STT streaming session, transcript parsing, reconnect + keepalive.
- src/providers/tts/cartesia.ts: Cartesia streaming TTS (default 44.1 kHz PCM).
- src/providers/tts/elevenlabs.ts: ElevenLabs streaming TTS (16 kHz PCM output).
- src/providers/tts/factory.ts: TTS provider selection by config.
- src/providers/llm/*: LLM providers used by Speaker and Mind.

Mind and tools
- src/core/mind.ts: Mind agent loop — tool decision (LLM call 1) + execution, returns tool_context for Speaker.
- src/core/context.ts: slim system prompt for Speaker, conversation history assembly, augmentPromptWithMindContext().
- src/core/tools.ts: defines available tools and tool selection logic.
- src/mcp/registry.ts: project tool registry and execution (MCP tools).
- src/mcp/exit-handler.ts: exit_convo handling and cooldowns.

Types and shared contracts
- src/types/voice.ts: ConversationMode and voice config types.
- src/types/mind.ts: MindResult (tool_context, tools_called, exit_convo), MindActivity.
- src/types/session.ts: session state and message types.

Voice config source of truth
- NPC voice config is stored on the NPC definition.
- Updated via NPC editor UI and saved through NPC routes and storage definitions.
- The voice pipeline uses the definition voice config at WS init and sends it to the client in ready.

## Key places to inspect when polishing
- Mode switching and UI state: web/js/pages/playground.js
- WS lifecycle and readiness handling: web/js/api.js + src/ws/handler.ts
- Transcript aggregation and commit timing: src/voice/pipeline.ts
- Mind -> Speaker sequencing: src/voice/pipeline.ts + src/core/mind.ts + src/core/context.ts
- Audio sample rate and playback: web/js/pages/playground.js + src/providers/tts/*

## Recent fixes and known issues (keep in mind)
- Deepgram multi-segment STT loss: fixed by accumulating finalized segments so the full utterance is emitted. File: src/providers/stt/deepgram.ts.
- Transcript dedup: onTranscript now emitted AFTER dedup check to prevent client double-accumulation. File: src/voice/pipeline.ts.
- Interruption context truncation: on interrupt, assistant message truncated to actually-spoken sentences. File: src/voice/pipeline.ts.
- MCP tool registry: tools loaded from storage in getSessionContext() and registered in singleton registry. File: src/session/manager.ts.
- Invalid starter voice IDs: replaced with valid Cartesia voices. Files: NPC seed/config definitions.
