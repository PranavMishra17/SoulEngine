# CHAT Interface and Voice Pipeline (Playground)

## Quick mental model
- Each user turn runs two parallel LLM roles: Speaker (fast, no tools) and Mind (agent loop with tools + optional follow-up).
- Voice WebSocket is used if input or output is voice; text-only uses REST.
- Mind can emit tool activity, follow-up text, or exit_convo which ends the session and applies cooldown.

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
- followup_start: Mind follow-up is starting
- generation_end: optional phase 'speaker' or 'followup'
- exit_convo: { reason, cooldown_seconds }
- sync: session end result
- error

## Speaker vs Mind (dual state)
- Speaker: uses slim prompt (no tools, no world knowledge), streams text and optionally TTS. Source: assembleSlimSystemPrompt in core context.
- Mind: runs runMindAgentLoop in parallel, uses recall tools + MCP tools, may emit tool activity, follow_up_text, or exit_convo.
- Both update the same session instance; Mind does not maintain a separate stored instance, it operates on the session instance snapshot.

## Voice pipeline flow (server)
1. WS init loads session context and voice config.
2. Pipeline initializes STT and/or TTS based on mode.
3. Input handling:
   - Voice: audio chunks -> Deepgram STT -> transcript aggregation -> processTurn
   - Text: handleTextInput -> processTurn
4. processTurn:
   - Speaker streams LLM output, pushes TTS per sentence if output is voice
   - Mind runs agent loop in parallel; may return follow-up and tool activity
   - Emits generation_end for speaker/followup, mind_activity, followup_start
   - exit_convo ends session + closes WS

## Frontend flow (Playground)
- Mode selection sets input/output mode.
- Start session -> configure UI -> connect WS if any voice.
- Voice input uses Silero VAD in browser; streams PCM16 frames, commits on speech end.
- Audio output uses Web Audio API; sample rate picked by provider (Cartesia 44100, ElevenLabs 16000).
- Mind activity panel shows tool calls; follow-up text appears after speaker text.

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
- src/routes/conversation.ts: REST chat for text-text mode; runs Speaker + Mind in parallel.
- src/routes/projects.ts: voices list endpoint used by NPC editor and settings.
- src/routes/npcs.ts: NPC definition updates (includes voice config).
- src/session/manager.ts: session lifecycle, session context, instance updates, endSession persistence.
- src/session/store.ts: in-memory session store.

Voice WebSocket + pipeline
- src/ws/handler.ts: WebSocket handshake, init, message routing, pipeline events -> WS messages, cleanup on close.
- src/voice/pipeline.ts: STT -> security -> Speaker + Mind -> TTS orchestration, transcript aggregation, interruption, exit_convo handling.
- src/voice/audio.ts: base64 encode/decode and audio utilities.
- src/voice/sentence-detector.ts: splits streaming text into sentences for TTS.
- src/voice/interruption.ts: interruption utility (not currently wired into pipeline).

Providers
- src/providers/stt/deepgram.ts: live STT streaming session, transcript parsing, reconnect + keepalive.
- src/providers/tts/cartesia.ts: Cartesia streaming TTS (default 44.1 kHz PCM).
- src/providers/tts/elevenlabs.ts: ElevenLabs streaming TTS (16 kHz PCM output).
- src/providers/tts/factory.ts: TTS provider selection by config.
- src/providers/llm/*: LLM providers used by Speaker and Mind.

Mind and tools
- src/core/mind.ts: Mind agent loop, tool execution, follow-up generation.
- src/core/context.ts: slim system prompt for Speaker, conversation history assembly.
- src/core/tools.ts: defines available tools and tool selection logic.
- src/mcp/registry.ts: project tool registry and execution (MCP tools).
- src/mcp/exit-handler.ts: exit_convo handling and cooldowns.

Types and shared contracts
- src/types/voice.ts: ConversationMode and voice config types.
- src/types/mind.ts: MindResult, MindActivity, tool result shapes.
- src/types/session.ts: session state and message types.

Voice config source of truth
- NPC voice config is stored on the NPC definition.
- Updated via NPC editor UI and saved through NPC routes and storage definitions.
- The voice pipeline uses the definition voice config at WS init and sends it to the client in ready.

## Key places to inspect when polishing
- Mode switching and UI state: web/js/pages/playground.js
- WS lifecycle and readiness handling: web/js/api.js + src/ws/handler.ts
- Transcript aggregation and commit timing: src/voice/pipeline.ts
- Follow-up sequencing (speaker vs mind): src/voice/pipeline.ts + src/core/mind.ts
- Audio sample rate and playback: web/js/pages/playground.js + src/providers/tts/*

## Recent fixes and known issues (keep in mind)
- Deepgram multi-segment STT loss: fixed by accumulating finalized segments so the full utterance is emitted. File: src/providers/stt/deepgram.ts.
- Mind agent loop logging: added key info logs in runMindAgentLoop for visibility and timing. File: src/core/mind.ts.
- Mind timeout default: increased from 5s to 15s to allow full 3-step loop. Files: src/voice/pipeline.ts and src/routes/conversation.ts. Re-test after server restart.
- Transcript not emitted to client: fixed by emitting final transcript in processAggregatedTranscript, not handleSTTTranscript. File: src/voice/pipeline.ts.
- Duplicate user messages: still occurring when transcripts flush in multiple places on the client. File: web/js/pages/playground.js. Needs consolidation to one flush path.
- Invalid starter voice IDs: replaced with valid Cartesia voices (Edmund->Ross, Vera->Elaine, Pryce->Damon, Tom->Gavin, Lena->Diana). Files: NPC seed/config definitions.
- Temporary debug logs: added and then removed after verification (audio chunks, transcript segments, tool events). Files: web/js/pages/playground.js, src/ws/handler.ts.
