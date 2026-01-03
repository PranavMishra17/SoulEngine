You are implementing **Evolve.NPC**, a TypeScript framework for AI-driven game NPCs with voice, memory, and tool-based agency.

REFERENCE DOCUMENTS (assume mounted in your workspace):
1. `Evolve_NPC_System_Design.md` – Architecture, data structures, design decisions  
2. `IMPLEMENTATION_PLAN.md` – Phase-by-phase tasks with checkboxes  
3. `SDK_REFERENCE.md` – Concrete SDK usage for:
   - `@google/generative-ai` (Gemini)
   - `@deepgram/sdk`
   - `@cartesia/cartesia-js`
   - `elevenlabs`
   - `hono`
   - LiveKit-inspired STT/TTS patterns

HIGH-LEVEL GOAL:
Implement all phases of Evolve.NPC exactly as specified, using the SDK reference for provider integration and the system design doc for architecture and data shapes.

GLOBAL RULES (APPLY TO ALL PHASES):
- Follow `IMPLEMENTATION_PLAN.md` **exactly**, phase by phase, in order.  
- Treat `Evolve_NPC_System_Design.md` as the source of truth for architecture, types, and behavior.  
- Treat `SDK_REFERENCE.md` as the source of truth for SDK usage and streaming patterns.  
- If any required behavior, shape, or config is not clearly specified in these documents, **STOP and ask the user** before proceeding.
- **Do not invent**:
  - New APIs, data structures, routes, or fields not present or implied in the docs.
  - Placeholder values, magic strings, or hardcoded constants (use config/environment as described).
- All code:
  - TypeScript strict mode; **no `any`**.
  - Comprehensive error handling for all external calls (LLM, STT, TTS, file IO, network, WebSocket).
  - Structured logging via Pino for all significant events and errors.
  - No emojis.
  - No temporary/test code unless explicitly requested by the user.
  - Prefer small, composable functions; keep functions under ~30 lines unless clearly justified by the docs.
- **Config-driven**:
  - Read all tunable values (timeouts, limits, API keys, provider selection, URLs) from config/env as defined in the implementation plan and system design.
- **Graceful failure**:
  - Never crash the process.
  - On error: log with context + error object; propagate a typed error or a well-structured error result.
  - For provider failures, follow the “graceful degradation” rules from the system design (e.g., fall back to text-only if TTS fails).

PROGRESS TRACKING:
- Use the checkboxes in `IMPLEMENTATION_PLAN.md` as the canonical task list.
- When you fully implement an item, update the file content from `- [ ]` to `- [*]` for that item.
- After finishing a phase, summarize:
  - What files were created/modified.
  - Key types, functions, and modules introduced.
  - Any TODOs that remain (only if explicitly allowed by docs).
- Do **not** change the meaning of any existing checklist items.

CURRENT PHASE:
- The user will specify `CURRENT PHASE` (e.g., “Phase 5:”).
- You must **only** work on the specified phase unless the user explicitly instructs you to move on.

WHEN STARTING A PHASE:
1. **Read the phase section** in `IMPLEMENTATION_PLAN.md`:
   - Identify all checklist items under that phase.
   - Do not skip or reorder items unless the plan explicitly allows it.
2. **Cross-reference** with `Evolve_NPC_System_Design.md`:
   - Confirm relevant data structures, flows, and constraints.
   - Ensure new modules/types align with the architecture (session lifecycle, memory model, voice pipeline, security pipeline, etc.).
3. **Cross-reference** with `SDK_REFERENCE.md` whenever you touch:
   - Gemini (LLM streaming, function calling, AbortController).
   - Deepgram (live STT WebSocket).
   - Cartesia (streaming TTS with contexts/continuations).
   - ElevenLabs (WebSocket streaming TTS).
   - Hono (routes, middleware, WebSocket upgrade, CORS).
   - LiveKit-inspired voice patterns (STT/TTS wrappers, audio utilities, interruption handling).

PHASE IMPLEMENTATION PROCEDURE:
For each checklist item in the current phase:

1. Locate the **exact subsection** in `IMPLEMENTATION_PLAN.md` (e.g., `### 3.1 LLM Provider`).
2. For each `- [ ]` line under that subsection:
   - Implement exactly what is specified.
   - If the item references a module path (e.g., `src/providers/llm/gemini.ts`), create/modify that file accordingly.
   - Align public interfaces and types with:
     - The corresponding section in `Evolve_NPC_System_Design.md`.
     - The usage patterns implied in other phases (e.g., `VoicePipeline`, `SessionManager`, `context.ts`).
     - The concrete code signatures in `SDK_REFERENCE.md`.
3. Add comprehensive error handling:
   - Wrap all SDK calls (Gemini, Deepgram, Cartesia, ElevenLabs) in `try/catch`.
   - Log with Pino (`logger.error`) including:
     - Provider name
     - Operation (e.g., `generateContentStream`, `listen.live`, `tts.websocket.send`)
     - Relevant identifiers (projectId, sessionId, instanceId) where available.
   - Return typed error results (or throw typed errors) as per the system design’s error categories.
4. Add structured logging:
   - Use the `createLogger(name: string)` helper from `logger.ts`.
   - Create module-specific loggers (`llmLogger`, `sttLogger`, `ttsLogger`, `sessionLogger`, etc.).
   - Log at appropriate levels: `debug`, `info`, `warn`, `error`.
   - Never log raw player content; respect redaction rules from the system design.
5. Ensure types are strict:
   - Define interfaces/types in the appropriate `src/types/*.ts` file when shared.
   - Reuse existing types where the design doc already defines them (e.g., `VoiceConfig`, `AudioChunk`, `TranscriptEvent`, `TTSChunk`).
   - No implicit `any`. If the SDK provides types, use them; otherwise, create precise interfaces based on the SDK reference.
6. After finishing all items under the phase:
   - Update the checkboxes `- [ ]` → `- [*]` for all completed items.
   - Write a concise summary for the user describing:
     - What was implemented.
     - Where (file paths, key exports).
     - How it aligns with the system design (e.g., how `GeminiLlmProvider` fits into `VoicePipeline`).
   - Then ask the user:
     - To confirm the phase as complete.
     - Whether to proceed to the next phase.
     - Any preferences or constraints before continuing.

PROVIDER-SPECIFIC RULES (USE SDK_REFERENCE):

### GEMINI (LLM)
- Use `generateContentStream()` for streaming chat.
- Implement function/tool calling exactly as in `SDK_REFERENCE.md`:
  - Use `tools` + `functionDeclarations` + `functionCallingConfig`.
  - Properly marshal tool calls into the MCP tool system.
- Expose a streaming interface that returns an `AsyncIterable` of tokens/chunks suitable for:
  - Sentence detection.
  - TTS streaming.
- Support cancellation with `AbortController` and propagate this through:
  - Voice pipeline interruption handling.
  - Session/WebSocket “interrupt” messages.

### DEEPGRAM (STT)
- Use the v3 `@deepgram/sdk` interface with `client.listen.live`.
- Configure the model (`nova-2`) and audio format (16kHz, PCM) per the system design.
- Wire events:
  - `Open`, `Transcript`, `Error`, `Close`.
- Convert SDK transcript events into the internal `TranscriptEvent` type.
- Implement reconnection/backoff patterns as suggested in `SDK_REFERENCE.md` while respecting the system design’s session model.

### CARTESIA (Default TTS)
- Implement a TTS provider that:
  - Uses WebSocket TTS.
  - Supports incremental text via `contextId` + `continue` + `maxBufferDelayMs`.
  - Outputs audio chunks as internal `AudioChunk` objects.
- Respect voice configuration from project/NPC `VoiceConfig`:
  - `provider`, `voice_id`, speed, etc.
- Implement flush behavior:
  - Properly terminate contexts when a turn is done.
  - Ensure no cross-contamination between sessions/turns.

### ELEVENLABS (Alt TTS)
- Implement a separate TTS provider using WebSocket streaming.
- Mirror the same internal interface as Cartesia’s provider so the factory can switch providers.
- Support incremental text + flushing based on docs and `SDK_REFERENCE.md`.

### HONO (Web Framework)
- Implement routes, middleware, and WebSocket handlers exactly as described in `IMPLEMENTATION_PLAN.md`.
- Use the WebSocket patterns from `SDK_REFERENCE.md` for:
  - `/ws/voice` connection.
  - Message types (`init`, `audio`, `commit`, `interrupt`, `end`, etc.).
  - Outgoing messages (`ready`, `transcript`, `text_chunk`, `audio_chunk`, `tool_call`, `generation_end`, `sync`, `error`).

### LIVEKIT PATTERNS (REFERENCE ONLY)
- Use LiveKit’s patterns to shape:
  - Provider interfaces (STT/TTS).
  - Audio utilities.
  - Interruption handling.
  - Sentence detection.
- Do **not** import or depend on LiveKit packages in this project.
- Only replicate patterns that are explicitly compatible with the system design.

DECISION HANDLING:
- Any time you reach a decision that is not clearly guided by:
  - `Evolve_NPC_System_Design.md`,  
  - `IMPLEMENTATION_PLAN.md`, or  
  - `SDK_REFERENCE.md`,  
  you must:
  1. Stop implementation at that point.
  2. Describe the specific decision you need to make (with concrete options).
  3. Ask the user which option to choose.

INTERACTION PATTERN WITH USER:
- At the start of work, ask the user:
  - Which phase to run (`CURRENT PHASE`).
  - Any environment or deployment constraints that affect SDK usage (e.g., “Bun only”, local dev vs. production).
- After each phase:
  - Report progress and changed files.
  - Ask for permission to proceed to the next phase.
- When blocked by missing spec:
  - Ask targeted, concrete questions (with 2–3 options) rather than open-ended vague questions.
