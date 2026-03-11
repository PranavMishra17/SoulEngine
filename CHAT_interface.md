# CHAT Interface and Voice Pipeline (Playground)

## Quick mental model
- Each user turn runs **parallel** Mind + Speaker: Speaker streams immediately, Mind runs in the background with tool access.
- **Recall tools** (recall_npc, recall_knowledge, recall_memories): results are deferred and injected into the Speaker's prompt on the **next turn** only.
- **MCP/project tools** (request_credentials, lock_door, call_guards, etc.): trigger a short **follow-up speech** in the same turn addressing the action taken.
- **exit_convo**: ends the session after Speaker finishes.
- Voice WebSocket is used if input or output is voice; text-only uses REST.

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

## Parallel Mind + Speaker architecture
- **Speaker** streams immediately via the active LLM provider. Uses a slim system prompt (no knowledge, no tools). If deferred mind context exists from the previous turn, it is injected into the Speaker's system prompt via `augmentPromptWithMindContext()`.
- **Mind** runs in parallel via `runMindAgentLoop()` with a configurable timeout: decides tools (recall, MCP conversation tools, exit_convo), executes them, returns `MindResult`.
- **Recall tools** (recall_npc, recall_knowledge, recall_memories): results are stored in `deferredMindContext` and injected into the Speaker's prompt on the **next turn**. No follow-up speech.
- **MCP/project tools** (request_credentials, lock_door, etc.): trigger a short follow-up Speaker call using `buildFollowUpPrompt()` — a minimal system prompt that only addresses the action taken. This prevents the LLM from repeating the primary response.
- **exit_convo**: handled after Speaker finishes; session ends and WS closes.
- Both update the same session instance; Mind does not maintain a separate stored instance.

## Voice pipeline flow (server)
1. WS init loads session context and voice config.
2. Pipeline initializes STT and/or TTS based on mode.
3. Input handling:
   - Voice: audio chunks -> Deepgram STT -> transcript aggregation (1.5s debounce) -> processTurn
   - Text: handleTextInput -> processTurn
4. processTurn (parallel):
   - Speaker starts streaming immediately (no waiting for Mind)
   - If `deferredMindContext` exists from previous turn, it is injected into Speaker's system prompt
   - Mind runs in parallel with configurable timeout (default 15s)
   - Speaker streams LLM output, pushes TTS per sentence if output is voice
   - After Speaker finishes, Mind result is awaited (likely already done)
   - Mind activity emitted to client (tool call chips)
   - Recall tool results -> stored in `deferredMindContext` for next turn
   - MCP tool results -> follow-up Speaker call with minimal prompt, streamed to client
   - Single generation_end emitted after all speech is done
   - exit_convo ends session + closes WS
5. After processTurn completes, `resetTranscriptState()` clears all accumulators for a clean next turn.

## VAD gating during NPC speech
- Interruption/barge-in has been removed. VAD is gated at 4 levels while NPC is speaking:
  1. `onSpeechStart`: skipped if `isNPCSpeaking`
  2. `onFrameProcessed`: audio frames not sent to STT if `isNPCSpeaking`
  3. `onSpeechEnd`: commit discarded if `isNPCSpeaking`
  4. `onTranscript`: final transcripts discarded if `isNPCSpeaking`
- VAD resumes normal operation after `generationEnd` event.

## Frontend flow (Playground)
- Mode selection sets input/output mode.
- Start session -> configure UI -> connect WS if any voice.
- Voice input uses Silero VAD in browser; streams PCM16 frames, commits on speech end.
- Audio output uses Web Audio API; sample rate picked by provider (Cartesia 44100, ElevenLabs 16000).
- Mind activity panel shows tool calls alongside the response.

## Associated files and what they do

Frontend UI and logic
- web/index.html: playground template and DOM ids for chat, voice controls, mind panels, x-ray.
- web/js/pages/playground.js: main playground state machine (session start/end, mode select, VoiceClient wiring, VAD gating, audio playback, chat UI, mind panel, cycles).
- web/js/api.js: REST wrappers and VoiceClient WebSocket implementation with event callbacks.
- web/js/components.js: toast and modal helpers used by playground.
- web/css/pages-app.css: styling for playground layout, chat, mind panel, voice UI.
- web/css/design-system.css: color tokens and base UI variables (affects playground visuals).

Backend routes and session
- src/routes/session.ts: start/end session, session stats, instance fetch.
- src/routes/conversation.ts: REST chat for text-text mode; parallel Mind+Speaker with deferred recall context.
- src/routes/projects.ts: voices list endpoint used by NPC editor and settings.
- src/routes/npcs.ts: NPC definition updates (includes voice config).
- src/session/manager.ts: session lifecycle, session context, instance updates, endSession persistence.
- src/session/store.ts: in-memory session store.

Voice WebSocket + pipeline
- src/ws/handler.ts: WebSocket handshake, init, message routing, pipeline events -> WS messages, cleanup on close.
- src/voice/pipeline.ts: parallel Mind+Speaker orchestration, transcript aggregation, transcript state reset, VAD gating support.
- src/voice/audio.ts: base64 encode/decode and audio utilities.
- src/voice/sentence-detector.ts: splits streaming text into sentences for TTS.

Providers
- src/providers/stt/deepgram.ts: live STT streaming session, transcript parsing, reconnect + keepalive. Has `clearAccumulator()` for transcript reset.
- src/providers/tts/cartesia.ts: Cartesia streaming TTS (default 44.1 kHz PCM).
- src/providers/tts/elevenlabs.ts: ElevenLabs streaming TTS (16 kHz PCM output).
- src/providers/tts/factory.ts: TTS provider selection by config.
- src/providers/llm/*: LLM providers used by Speaker and Mind.

Mind and tools
- src/core/mind.ts: Mind agent loop with tool decision + execution. System prompt explicitly lists available MCP conversation tools.
- src/core/context.ts: slim system prompt for Speaker, conversation history assembly, `augmentPromptWithMindContext()`, `buildFollowUpPrompt()`.
- src/core/tools.ts: defines available tools, `isRecallTool()`, `isExitConvoTool()`.
- src/mcp/registry.ts: project tool registry and execution (MCP tools).
- src/mcp/exit-handler.ts: exit_convo handling and cooldowns.

Types and shared contracts
- src/types/voice.ts: ConversationMode and voice config types.
- src/types/mind.ts: MindResult (tools_called, exit_convo, usage), MindActivity.
- src/types/session.ts: session state (includes `deferred_mind_context`) and message types.

Voice config source of truth
- NPC voice config is stored on the NPC definition.
- Updated via NPC editor UI and saved through NPC routes and storage definitions.
- The voice pipeline uses the definition voice config at WS init and sends it to the client in ready.

## Key places to inspect when polishing
- Mode switching and UI state: web/js/pages/playground.js
- WS lifecycle and readiness handling: web/js/api.js + src/ws/handler.ts
- Transcript aggregation and reset: src/voice/pipeline.ts
- Parallel Mind+Speaker flow: src/voice/pipeline.ts + src/core/mind.ts + src/core/context.ts
- Follow-up prompt for MCP tools: src/core/context.ts (`buildFollowUpPrompt`)
- Audio sample rate and playback: web/js/pages/playground.js + src/providers/tts/*
- VAD gating during NPC speech: web/js/pages/playground.js

## Recent fixes and known issues (keep in mind)
- Deepgram multi-segment STT loss: fixed by accumulating finalized segments so the full utterance is emitted. File: src/providers/stt/deepgram.ts.
- Transcript accumulation across turns: fixed by `resetTranscriptState()` clearing all accumulators after each turn. File: src/voice/pipeline.ts.
- MCP tool follow-up repetition: fixed by using minimal `buildFollowUpPrompt()` instead of full NPC character prompt. File: src/core/context.ts.
- Mind not using MCP tools: fixed by adding explicit `[CONVERSATION TOOLS AVAILABLE]` section to Mind system prompt. File: src/core/mind.ts.
- exit_convo over-triggering: fixed by adding explicit NEVER list to Mind prompt and removing 'you are now' from jailbreak phrases. Files: src/core/mind.ts, src/security/moderator.ts.
- MCP tool registry: tools loaded from storage in getSessionContext() and registered in singleton registry. File: src/session/manager.ts.
