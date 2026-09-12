# Voice pipeline diagnosis: STT final transcript to first TTS byte

Scope: current implementation only, traced from `src/voice/pipeline.ts`, `src/ws/handler.ts`,
`src/providers/stt/deepgram.ts`, `src/providers/tts/cartesia.ts`, and their interfaces. No
proposed changes below, only what the code does today.

## Flow diagram

```
audio --> pushAudio() --> Deepgram (interim + final events)
                              |
commit() --> finalize() [no-op, deepgram.ts:377-383]
          --> restart 400ms debounce [pipeline.ts:439-454]
                              v
processAggregatedTranscript() --dedup--> processTranscriptWithLock()
                              |  [mark: first_transcript, pipeline.ts:630]
                              v
processTranscript(): sanitize -> rate limit -> moderate [pipeline.ts:806-847]
                              v
                        processTurn()
      +--------------------------------------------------------+
      | Speaker: streamChat() tokens -> SentenceDetector ->     |
      |   synthesizeSentence() fired, not awaited [944-974]     |
      |                                                          |
      | Mind: runMindAgentLoop() parallel, awaited only after   |
      |   Speaker's stream+TTS finish [903-931, 998]            |
      +--------------------------------------------------------+
                              |  [mark: first_token, 956]
                              v
              TTS session.synthesize() --> onAudioChunk --> client
                              |  [mark: first_audio, 667]
```
(line numbers above are in `src/voice/pipeline.ts` unless a file is named)

## What is serial vs. parallel

Serial, on every turn, before the Speaker can start: STT endpointing/aggregation
(`AGGREGATION_WINDOW_MS`), the dedup check, `runSecurityPipeline` (sanitize, rate limit, then
an **awaited** `moderate()` call) in `src/voice/pipeline.ts:806-847`, `getSessionContext`
(with a 500 ms retry on first failure, `src/voice/pipeline.ts:779-786`), and
`assembleSlimSystemPrompt` (`src/voice/pipeline.ts:880-887`, awaited). None of this is
overlapped with LLM or TTS work — it all runs before `processTurn` even builds the Speaker
prompt.

Parallel, once `processTurn` begins (`src/voice/pipeline.ts:862-1225`): the Mind agent loop
(`runMindAgentLoop`, started at `src/voice/pipeline.ts:912-931`) runs concurrently with the
Speaker's `llmProvider.streamChat()` loop (`src/voice/pipeline.ts:944-974`), and is only
awaited later, at `src/voice/pipeline.ts:998`, after the Speaker's full response and all of its
TTS synthesis have completed (`src/voice/pipeline.ts:976-989`). Mind gets a full turn's worth
of wall-clock time before it can block anything, gated by `mindTimeoutMs = min(project setting
?? 15000, 8000)` (`src/voice/pipeline.ts:904-907`, an 8000 ms hard ceiling regardless of
project configuration).

Within the Speaker loop, sentence-level TTS is also fired without blocking token ingestion:
each completed sentence is pushed into `ttsPipeline` as an un-awaited promise
(`src/voice/pipeline.ts:962-968`), so the LLM stream keeps consuming tokens while a previous
sentence's audio is still synthesizing. The promises are only awaited, in push order, after the
stream ends (`src/voice/pipeline.ts:982-985`) — that only constrains the order in which the
code *finishes waiting* on each `synthesize()` call, not the order those calls reach the TTS
provider's network connection, since nothing stops sentence *N+1*'s `synthesize()` from firing
before sentence *N*'s promise settles.

If Mind reports a non-recall (MCP/project) tool call, a second Speaker pass runs — a brand new
`llmProvider.streamChat()` plus its own sentence-by-sentence TTS loop
(`src/voice/pipeline.ts:1089-1121`) — entirely **after** the primary response and its TTS have
already flushed, fully serial with the first.

## Where sentence-level streaming to TTS begins

`SentenceDetector.addChunk()` (`src/voice/sentence-detector.ts:63-70`) runs on every non-empty
LLM text chunk (`src/voice/pipeline.ts:961-968`); any sentences it returns go straight to
`synthesizeSentence()` (`src/voice/pipeline.ts:1230-1245`), which calls
`ttsSession.synthesize(sentence, false)`. A sentence closes when the buffer matches
`SENTENCE_ENDINGS` (`.`, `!`, `?`, or `;` before a capital/quote, or end-of-buffer;
`src/voice/sentence-detector.ts:24`) **and** is at least `minSentenceLength` chars (default 10,
`src/voice/sentence-detector.ts:52`), after abbreviation/decimal/initial filtering
(`src/voice/sentence-detector.ts:161-190`). Past `maxBufferLength` (default 500,
`src/voice/sentence-detector.ts:52`) with no boundary found, `forceSplit()` cuts at the last
comma/semicolon/dash/colon/space (`src/voice/sentence-detector.ts:196-221`). The
`isContinuation` flag Cartesia's interface docs describe as preserving prosody across chunks
(`src/providers/tts/interface.ts:48-49`) is never set `true` — every call passes `false`
(`src/voice/pipeline.ts:1239`) — and `CartesiaSession` reuses one `contextId` per turn anyway
(`src/providers/tts/cartesia.ts:40-49`, rotated only in `flush()`/`abort()`,
`src/providers/tts/cartesia.ts:275-313`).

## How the Mind runs alongside the Speaker

Recall tools (`recall_npc`/`recall_knowledge`/`recall_memories`, checked via `isRecallTool`,
`src/voice/pipeline.ts:1059`) never speak in the same turn — their results are stashed in
`this.deferredMindContext` (`src/voice/pipeline.ts:1069-1072`) and only injected into the
*next* turn's Speaker prompt (`src/voice/pipeline.ts:895-901`). Non-recall MCP tool results
instead trigger the second, fully serial follow-up Speaker+TTS pass covered above
(`src/voice/pipeline.ts:1074-1130`).

## Interruption / barge-in

Barge-in is disabled outright. `handleInterruption()` is a documented no-op
(`src/voice/pipeline.ts:463-465`, "no-op — barge-in removed"), and the WebSocket handler
treats an inbound `interrupt` message the same way (`src/ws/handler.ts:386-391`, logged and
dropped). Nothing pauses or aborts an in-flight Speaker/TTS turn in response to new user audio;
the user cannot cut the NPC off mid-sentence through this pipeline.

## Transcript accumulation and reset

Deepgram's `DeepgramSession` accumulates per-segment `is_final` text into `finalizedSegments`
and joins it with the live segment so every event carries the full utterance so far
(`src/providers/stt/deepgram.ts:33-37, 240-256`), clearing the array on `speech_final`
(`src/providers/stt/deepgram.ts:253-256`) or reconnect (`src/providers/stt/deepgram.ts:326-337`).
`VoicePipeline` layers its own aggregator on top: interim text accumulates in
`this.accumulatedTranscript` (`src/voice/pipeline.ts:526-534`), and both that and any STT-final
text feed `this.transcriptAggregator`, flushed by a 400 ms debounce timer
(`AGGREGATION_WINDOW_MS`, `src/voice/pipeline.ts:194`) restarted on every new fragment
(`src/voice/pipeline.ts:439-454, 566-595`). A monotonic `currentUtteranceId`/
`committedUtteranceId` pair (`src/voice/pipeline.ts:196-206, 546-556`) suppresses a late STT
final for an utterance `commit()` already forwarded, replacing an earlier, more fragile
boolean-flag design per the inline comment. A content-hash dedup window
(`DEDUP_WINDOW_MS = 1000`, `src/voice/pipeline.ts:174, 615-623`) catches duplicate aggregated
text within one second. Everything is reset in `resetTranscriptState()`
(`src/voice/pipeline.ts:721-737`), called from `processTranscriptWithLock`'s `.finally()`
(`src/voice/pipeline.ts:703-706`) and from `end()` (`src/voice/pipeline.ts:476`); it clears the
aggregator, the committed-utterance ID, the dedup hash, and calls the STT session's own
`clearAccumulator()` (`src/providers/stt/deepgram.ts:372-375`). `currentUtteranceId` is
deliberately never reset, so it stays ahead of any in-flight STT finals from the completed turn
(`src/voice/pipeline.ts:729-730`).

## Latency measurement

`LatencyTracker` (`src/voice/pipeline.ts:98-138`) records millisecond offsets from
`markStart()` for four named stages: `commit` (turn start, `src/voice/pipeline.ts:408-409`),
`first_transcript` (aggregated transcript ready, `src/voice/pipeline.ts:630`), `first_token`
(first Speaker LLM chunk, `src/voice/pipeline.ts:956`), and `first_audio` (first TTS chunk
delivered to the client, `src/voice/pipeline.ts:667`). Only the first occurrence of each stage
per turn is kept (`src/voice/pipeline.ts:109-115`). The breakdown is written twice: into the
durable session log via `appendSessionLog` (`src/voice/pipeline.ts:1140-1173`, under
`latency.commitToFirstTranscript` / `firstTranscriptToFirstToken` / `firstTokenToFirstAudio` /
`commitToFirstAudio`, plus `mindMs`), and into the structured logger
(`src/voice/pipeline.ts:1176-1187`). There is no separate mark for STT-provider-internal
latency, TTS-provider connect time, or Mind's own duration breakdown beyond the single
`mindResult.duration_ms` total.

## Hard-coded thresholds (file:line)

- `AGGREGATION_WINDOW_MS = 400` (debounce after commit/speech_final) — `src/voice/pipeline.ts:194`
- `DEDUP_WINDOW_MS = 1000` (duplicate-transcript window) — `src/voice/pipeline.ts:174`
- Mind timeout `min(project setting ?? 15000, 8000)` (8000 ms hard ceiling) — `src/voice/pipeline.ts:904-907`
- STT config `sampleRate: 16000`, `punctuate: true`, `interimResults: true` — `src/voice/pipeline.ts:266-271`
- `getSessionContext` retry delay `500` ms — `src/voice/pipeline.ts:784`
- Deepgram `utterance_end_ms: 1000` (server VAD silence) — `src/providers/stt/deepgram.ts:85`
- Deepgram `endpointing: 500` — `src/providers/stt/deepgram.ts:86`
- Deepgram `KEEPALIVE_INTERVAL_MS = 5000` — `src/providers/stt/deepgram.ts:19`
- Deepgram `MAX_RECONNECT_ATTEMPTS = 3`, `RECONNECT_DELAY_MS = 1000` — `src/providers/stt/deepgram.ts:17-18`
- Deepgram connection-open timeout `10000` ms — `src/providers/stt/deepgram.ts:283-285`
- Deepgram `DEFAULT_SAMPLE_RATE = 16000`, `DEFAULT_MODEL = 'nova-2'` — `src/providers/stt/deepgram.ts:14-15`
- SentenceDetector `minSentenceLength = 10`, `maxBufferLength = 500` — `src/voice/sentence-detector.ts:52`
- Cartesia `MAX_WAIT_MS = 30000` (synthesis hard timeout) — `src/providers/tts/cartesia.ts:192`
- Cartesia `DEFAULT_SAMPLE_RATE = 44100`, `DEFAULT_MODEL = 'sonic-2'` — `src/providers/tts/cartesia.ts:14-15`

## Top three places latency is spent or risked

1. **The endpointing/aggregation chain is additive, not overlapped.** Deepgram's server-side
   `utterance_end_ms: 1000` (`src/providers/stt/deepgram.ts:85`) and the pipeline's own
   `AGGREGATION_WINDOW_MS = 400` debounce (`src/voice/pipeline.ts:194`, restarted on every
   fragment at `src/voice/pipeline.ts:439-454`) stack to a worst case of about 1.4 seconds
   before `first_transcript` is even marked — a fact the code's own comment documents
   (`src/voice/pipeline.ts:182-188`). Within a 1-2 second turn budget, this alone can consume
   most of it before the LLM has seen a single word, and it is spent purely on
   confirm-the-user-is-done detection, not on generation.

2. **A second, fully serial Speaker+TTS pass for any MCP tool call.** When Mind reports a
   non-recall tool result, `processTurn` runs an entire second `llmProvider.streamChat()` and
   its own sentence-by-sentence TTS loop only after the primary response's audio has already
   flushed (`src/voice/pipeline.ts:1074-1130`) — no overlap with the primary generation, none
   with Mind (already resolved by this point). Any quest-giver/companion turn that triggers a
   project action (locking a door, granting a quest) pays for two full LLM round trips and two
   full TTS syntheses back to back, which can double the turn's total time even though Mind's
   result was likely ready much earlier.

3. **Un-awaited concurrent TTS sends against one reused synthesis context.** Sentence
   synthesis promises are pushed without awaiting between them
   (`src/voice/pipeline.ts:962-968`), so sentence *N+1*'s `CartesiaSession.synthesize()` call
   can reach the network before sentence *N*'s call — which itself blocks on the full remote
   audio stream closing (`src/providers/tts/cartesia.ts:194-252`) — has resolved. All target the
   same `contextId` for the whole turn, since `isContinuation` is always passed `false`
   (`src/voice/pipeline.ts:1239`) and the context only rotates in `flush()`/`abort()`
   (`src/providers/tts/cartesia.ts:275-313`). The code's comment
   (`src/voice/pipeline.ts:982-985`) only claims *awaiting* happens in push order, not that the
   underlying `send()` calls reach Cartesia in that order — a source of both risked latency and
   potential audio-ordering bugs under fast LLM output.

Two structural notes alongside the above, though not strictly latency: barge-in is
unconditionally disabled (`src/voice/pipeline.ts:463-465`, `src/ws/handler.ts:386-391`), so a
user cannot shorten a long-running turn — including the double-pass case above — by
interrupting; and voice's `processTurn` runs its own turn loop rather than the shared
`runConversationTurn` used by the text path, a gap the code's own comment
(`src/voice/pipeline.ts:1133-1137`) attributes to backlog items 5.19/5.21.
