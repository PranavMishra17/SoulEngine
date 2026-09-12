# Angle A — Single-pass streaming turn architecture for a talking NPC

Full ledger of 54 claims extracted from fetched sources. Sub-questions referenced below:
1. Turn pipeline anatomy (stage order, streaming, published per-stage numbers)
2. Tool calls mid-turn (filler/thinking speech, speculative TTS, async tools, same-turn vs next-turn, coherence)
3. Retrieval inside the budget (RAG timing, prompt caching, TTFT effects)
4. Endpointing, turn detection, interruption handling
5. Sentence-level TTS streaming; two-model (fast speaker + slow planner) serial dependency
6. Realistic 2025-2026 per-stage and end-to-end budgets

8 claims were promoted to c1-c8 for adversarial verification. 8 claims were dropped outright (background,
unfalsifiable, off-angle, or below the importance cutoff). The remaining 38 were merged into one of the 8 as
corroborating evidence. Every one of the 54 source claims is listed below with its verdict.

---

## Kept for verification (c1-c8)

### c1 — Streaming/overlapping turn pipeline architecture
Turn pipelines are built so stages stream and overlap rather than run strictly sequentially: STT emits
partial transcripts while the user is still speaking, the LLM streams tokens off that partial context, and
TTS begins synthesizing audio before the LLM has finished generating the rest of the response.
- Quote: "Stages overlap. STT emits partial text, LLM streams tokens, TTS synthesizes chunks in parallel."
- URL: https://livekit.com/blog/sequential-pipeline-architecture-voice-agents
- Label: marketing | Sub-questions: 1, 5 | Importance: 5
- Status: KEPT (c1)

### c2 — Multi-vendor per-stage latency budgets
Vendors publish differing per-stage latency ranges (VAD, STT, LLM time-to-first-token, TTS time-to-first-byte)
used to build a turn-latency budget; the exact numbers vary by source and are not benchmarked against each
other on a common harness.
- Quote: "VAD: 10 to 50ms; STT partial: <100ms; LLM first token: 300 to 800ms; TTS first chunk: 100 to 200ms"
- URL: https://livekit.com/blog/sequential-pipeline-architecture-voice-agents
- Label: marketing | Sub-questions: 1, 6 | Importance: 5
- Status: KEPT (c2)

### c3 — Streaming pipelines cut total turn latency substantially vs a naive blocking pipeline
Streaming/optimized pipelines report turn latency roughly half to a quarter of a naive blocking
(wait-for-full-stage) pipeline; absolute numbers differ by source but the direction and rough magnitude of
the gain are consistent.
- Quote: "Naive (blocking): 1000 to 2000ms+; Streaming: 400 to 800ms"
- URL: https://livekit.com/blog/sequential-pipeline-architecture-voice-agents
- Label: marketing | Sub-questions: 1, 5, 6 | Importance: 4
- Status: KEPT (c3)

### c4 — Speculative/preemptive LLM generation on partial transcripts
LiveKit Agents supports starting LLM inference on STT partial transcripts before the user's turn has
finished, with a reported discard rate below 5 percent of turns for cases where the partial changes
meaningfully before finalizing.
- Quote: "preemptive_generation=True starts LLM inference on STT partials before the user finishes the turn"
- URL: https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/
- Label: community | Sub-questions: 2, 5, 6 | Importance: 5
- Status: KEPT (c4)

### c5 — Prompt-prefix caching cuts LLM time-to-first-token
Server-side prompt-prefix caching (Anthropic/OpenAI) requires the system prompt to be byte-identical across
turns to hit the cache, and is reported to roughly halve LLM time-to-first-token (500-800ms uncached to
200-300ms cached).
- Quote: "byte-identical across turns"
- URL: https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/
- Label: community | Sub-questions: 3, 6 | Importance: 5
- Status: KEPT (c5)

### c6 — Semantic/model-based turn detection is displacing raw silence-based VAD as the shipped default
Shipped realtime voice systems increasingly default to semantic or model-based turn detection rather than
raw silence-timeout VAD, because VAD alone cannot distinguish a genuine end-of-turn pause from a mid-thought
pause; interruption handling (canceling or truncating in-flight TTS audio, then re-enabling listening) is
implemented as a related but distinct same-turn mechanism, and can be configured independently of turn
detection.
- Quote: "turn_detection: { type: semantic_vad }"
- URL: https://developers.openai.com/api/docs/guides/realtime-conversations
- Label: demonstrated | Sub-questions: 4 | Importance: 4
- Status: KEPT (c6)

### c7 — Tool calls run inside the same turn, interleaved into the model's response stream
Tool/function calls execute inside the same turn as the LLM response rather than being deferred to a later
turn: OpenAI's Realtime API interleaves function-call argument deltas into the same streamed response object
as text/audio deltas, and other frameworks likewise place tool calling inside the LLM stage - at the cost of
adding variable, sometimes large, latency to that turn.
- Quote: "response.function_call_arguments.delta"
- URL: https://developers.openai.com/api/docs/guides/realtime-conversations
- Label: demonstrated | Sub-questions: 1, 2 | Importance: 4
- Status: KEPT (c7)

### c8 — Named target SLO for end-to-end voice latency
Vapi states an explicit target service-level objective for end-to-end voice response latency: delay becomes
perceptible to users around 300ms, and the stated production target is p50 under 500ms and p95 under 800ms.
- Quote: "Users start noticing delays around 300ms"
- URL: https://vapi.ai/blog/speech-latency
- Label: marketing | Sub-questions: 6 | Importance: 5
- Status: KEPT (c8)

---

## Full ledger (all 54 claims, in source order)

1. Canonical sequential pipeline order Audio In -> VAD -> STT -> LLM -> TTS -> Audio Out, tool calls inside
   the LLM stage. (livekit/sequential-pipeline-architecture-voice-agents) - demonstrated - subq 1 -
   **merged-into c1**
2. Per-stage latency ranges: VAD 10-50ms, STT partial <100ms/complete ~200ms, LLM TTFT 300-800ms, TTS first
   chunk 100-200ms. (livekit/sequential-pipeline-architecture-voice-agents) - marketing - subq 1, 6 -
   **merged-into c2**
3. Naive/blocking pipeline totals ~1000-2000ms+ vs 400-800ms when stages stream and overlap.
   (livekit/sequential-pipeline-architecture-voice-agents) - marketing - subq 1, 5, 6 - **merged-into c3**
4. Stages overlap: STT partials while speaking, LLM streams tokens, TTS synthesizes first sentence while LLM
   still generating. (livekit/sequential-pipeline-architecture-voice-agents) - marketing - subq 1, 5 -
   **KEPT (c1)**
5. Tool-call side effects protected via an explicit disallow_interruptions API call; agent can wait for its
   own speech to finish before continuing - both same-turn mechanisms.
   (livekit/sequential-pipeline-architecture-voice-agents) - demonstrated - subq 2 - **merged-into c6**
6. Article's turn-handling config exposes pluggable semantic turn detection but does not describe filler
   utterances, speculative TTS, async-tool deferral to a later turn, or a two-model serial fast/slow design.
   (livekit/sequential-pipeline-architecture-voice-agents) - demonstrated - subq 2, 3, 4, 5 -
   **dropped: unfalsifiable/non-substantive negative claim (states what a source does NOT cover, not a
   finding)**
7. VAD works at the audio-frame level with no semantic understanding, so it cannot tell a sentence-final
   pause from a mid-thought pause. (livekit/turn-detection-voice-agents-vad-endpointing-model-based-detection)
   - demonstrated - subq 4 - **merged-into c6**
8. STT-provider end-of-utterance endpointing can be faster than VAD-based silence timeouts because it
   doesn't require waiting out a fixed silence window.
   (livekit/turn-detection-voice-agents-vad-endpointing-model-based-detection) - demonstrated - subq 4 -
   **merged-into c6**
9. Model-based (semantic) turn detection classifies the partial transcript in real time to predict turn
   completion, trading false positives/overreaction to pauses for lower latency.
   (livekit/turn-detection-voice-agents-vad-endpointing-model-based-detection) - demonstrated - subq 4 -
   **merged-into c6**
10. A fixed 800ms silence-timeout endpointing policy adds nearly a full second of latency per turn, compounding
    over a conversation. (livekit/turn-detection-voice-agents-vad-endpointing-model-based-detection) -
    marketing - subq 4, 6 - **merged-into c6**
11. Interruption/barge-in requires keeping turn detection live during agent playback, canceling TTS on
    detected user speech, and depends on client-side echo cancellation.
    (livekit/turn-detection-voice-agents-vad-endpointing-model-based-detection) - demonstrated - subq 4 -
    **merged-into c6**
12. LiveKit's default turn detector combines VAD with semantic and acoustic cues (intonation, rhythm),
    supporting 14 languages. (livekit/turn-detection-and-interruption-handling) - marketing - subq 4 -
    **merged-into c6**
13. The audio-based turn detector avoids false endpointing on mid-utterance pauses.
    (livekit/turn-detection-and-interruption-handling) - marketing - subq 4 - **merged-into c6**
14. STT-based endpointing can delegate to the STT provider's own endpointing model (Deepgram Flux, AssemblyAI
    Universal-3 Pro). (livekit/turn-detection-and-interruption-handling) - marketing - subq 4 -
    **merged-into c6**
15. Endpointing is tunable via min_delay/max_delay, typically ~0.3s minimum and ~2.5s maximum before forcing
    turn close. (livekit/turn-detection-and-interruption-handling) - marketing - subq 4 - **merged-into c6**
16. LiveKit's adaptive interruption mode uses acoustic cues to distinguish true barge-ins from backchannels
    ("mhm"), but is LiveKit-Cloud-only. (livekit/turn-detection-and-interruption-handling) - marketing -
    subq 2, 4 - **merged-into c6**
17. When a realtime speech-to-speech LLM does its own server-side turn detection, most of LiveKit's own
    InterruptionOptions are ignored. (livekit/turn-detection-and-interruption-handling) - marketing -
    subq 1, 4 - **merged-into c6**
18. Vanilla LiveKit Agents pipeline runs 1.2-1.4s p95; an optimized stack reaches 500-650ms p95, sub-500ms for
    short turns. (futureagi.com/blog/how-to-optimize-livekit-latency-2026) - community - subq 1, 6 -
    **merged-into c3**
19. Streaming STT emits partials every 100-200ms while the user is still talking, credited with 200-400ms
    savings. (futureagi.com/blog/how-to-optimize-livekit-latency-2026) - community - subq 1, 6 -
    **merged-into c3**
20. Preemptive/speculative LLM generation starts inference on STT partials before the turn ends, saving an
    additional 150-350ms. (futureagi.com/blog/how-to-optimize-livekit-latency-2026) - community - subq 2, 5, 6
    - **KEPT (c4)**
21. TTS consumes the LLM token stream incrementally and flushes audio at sentence boundaries rather than
    waiting for the full response. (futureagi.com/blog/how-to-optimize-livekit-latency-2026) - community -
    subq 5 - **merged-into c1**
22. Prompt-prefix caching requires a byte-identical system prompt across turns and is reported to cut LLM
    TTFT from 500-800ms to 200-300ms. (futureagi.com/blog/how-to-optimize-livekit-latency-2026) - community -
    subq 3, 6 - **KEPT (c5)**
23. Speculative/prefetched tool calls carry a discard-rate tradeoff, estimated below 5 percent of turns, for
    200-400ms saved. (futureagi.com/blog/how-to-optimize-livekit-latency-2026) - community - subq 2, 6 -
    **merged-into c4**
24. Standard pipeline: VAD/Turn Detection -> STT -> LLM -> TTS, contrasted with realtime models that
    integrate speech and reasoning in one path. (livekit/understand-and-improve-agent-latency) - marketing -
    subq 1 - **merged-into c1**
25. Tool/function calls execute before the reply is generated and can add large, variable latency.
    (livekit/understand-and-improve-agent-latency) - marketing - subq 1, 2, 6 - **merged-into c7**
26. LiveKit deliberately does not publish per-model latency numbers because they go stale quickly; points
    users to their own observability metrics instead. (livekit/understand-and-improve-agent-latency) -
    marketing - subq 1, 6 - **dropped: background/non-substantive vendor disclaimer, no design-relevant
    content**
27. Turn-detection sensitivity is a tunable tradeoff: more aggressive endpointing feels faster but less
    natural. (livekit/understand-and-improve-agent-latency) - marketing - subq 4 - **merged-into c6**
28. Pipecat's default TTS behavior aggregates streaming LLM tokens into complete sentences before synthesis.
    (docs.pipecat.ai/pipecat/learn/text-to-speech) - demonstrated - subq 5 - **merged-into c1**
29. Pipecat exposes a flag (text_aggregation_mode=TOKEN) to bypass sentence aggregation and stream tokens
    directly to TTS. (docs.pipecat.ai/pipecat/learn/text-to-speech) - demonstrated - subq 5 -
    **merged-into c1**
30. With sentence-level streaming, Pipecat reports end-to-end latency often under 200ms.
    (docs.pipecat.ai/pipecat/learn/text-to-speech) - marketing - subq 5, 6 - **dropped: metric scope is the
    TTS sub-stage only, not a full voice-to-voice turn; redundant with, and could be misleadingly conflated
    with, the full-turn numbers in c2/c8**
31. WebSocket-based TTS connections give more consistently low latency than HTTP-based calls.
    (docs.pipecat.ai/pipecat/learn/text-to-speech) - marketing - subq 5, 6 - **dropped: provider-integration
    detail, below the importance cutoff for macro turn-pipeline architecture**
32. Cartesia, ElevenLabs, and Rime return word-level timestamps alongside audio for downstream sync.
    (docs.pipecat.ai/pipecat/learn/text-to-speech) - demonstrated - subq 4, 5 - **dropped: background feature
    note, off the critical path for turn-latency budgeting**
33. Standard pipeline: STT transcribes, LLM generates a response, TTS speaks it back.
    (livekit/voice-agent-architecture-stt-llm-tts-pipelines-explained) - marketing - subq 1 -
    **merged-into c1**
34. Fully streaming pipeline: STT partials feed the LLM, LLM tokens feed TTS, TTS starts before the user
    finishes speaking. (livekit/voice-agent-architecture-stt-llm-tts-pipelines-explained) - marketing -
    subq 1, 5 - **merged-into c1**
35. Non-streaming pipelines produce 2-4 seconds of response delay vs under 1 second for a streaming pipeline.
    (livekit/voice-agent-architecture-stt-llm-tts-pipelines-explained) - marketing - subq 1, 6 -
    **merged-into c3**
36. Indicative per-stage targets: transport <50ms, STT first partial 100-200ms, LLM TTFT 200-400ms, TTS
    TTFA 100-300ms, total perceived <1s. (livekit/voice-agent-architecture-stt-llm-tts-pipelines-explained) -
    marketing - subq 6 - **merged-into c2**
37. Tool calling (record lookup, orders, transfers) is implemented via the LLM's structured tool-calling
    support, positioning tool calls inside the LLM stage.
    (livekit/voice-agent-architecture-stt-llm-tts-pipelines-explained) - marketing - subq 1, 2 -
    **merged-into c7**
38. Three turn-detection approaches named (VAD, STT endpointing, model-based semantic classifier);
    interruption handling cancels TTS playback immediately on detecting user speech mid-response.
    (livekit/voice-agent-architecture-stt-llm-tts-pipelines-explained) - marketing - subq 4 -
    **merged-into c6**
39. Pipecat's reference pipeline wires stages in a fixed literal order: transport input -> STT -> user
    context aggregator -> LLM -> TTS -> transport output -> assistant context aggregator.
    (assemblyai.com/blog/building-a-voice-agent-with-pipecat) - demonstrated - subq 1 - **merged-into c1**
40. AssemblyAI's Universal-3 Pro Streaming STT returns immutable transcripts in under 300ms.
    (assemblyai.com/blog/building-a-voice-agent-with-pipecat) - demonstrated - subq 6 - **merged-into c2**
41. Turn-taking is configurable between VAD+Smart Turn (default) and AssemblyAI's own STT-based turn
    detection via vad_force_turn_endpoint. (assemblyai.com/blog/building-a-voice-agent-with-pipecat) -
    demonstrated - subq 4 - **merged-into c6**
42. A min_turn_silence parameter tunes how quickly a turn ends once the turn-detection model is confident,
    illustrated with a 100ms example. (assemblyai.com/blog/building-a-voice-agent-with-pipecat) -
    demonstrated - subq 4 - **merged-into c6**
43. Vapi decomposes end-to-end voice latency into named stage budgets: telephony 200-800ms, network <10ms/hop.
    (vapi.ai/blog/speech-latency) - marketing - subq 6 - **merged-into c2**
44. Vapi states streaming ASR first-token latency (40-300ms) and LLM processing latency (100-400ms) as
    distinct budget lines. (vapi.ai/blog/speech-latency) - marketing - subq 6 - **merged-into c2**
45. Vapi states neural TTS time-to-first-byte is 50-250ms once warmed, implying a cold-start penalty exists.
    (vapi.ai/blog/speech-latency) - marketing - subq 5, 6 - **merged-into c2**
46. Vapi sets a perceptibility threshold (~300ms) and target SLO (p50<500ms, p95<800ms) for end-to-end voice
    response. (vapi.ai/blog/speech-latency) - marketing - subq 6 - **KEPT (c8)**
47. Vapi claims 1% packet loss can double conversational delay. (vapi.ai/blog/speech-latency) - marketing -
    subq 6 - **dropped: network-transport reliability tangent, off-angle for turn-pipeline architecture
    design rather than stage latency budgeting**
48. Vapi names specific vendor building blocks used in production stacks (Deepgram/AssemblyAI/Gladia ASR,
    Deepinfra LLM endpoint, Azure/Rime/Cartesia Sonic 2.0/Deepgram Aura-2 TTS). (vapi.ai/blog/speech-latency)
    - marketing - subq 1, 6 - **dropped: vendor-name background list, no additional design-relevant number
    or pattern beyond what c2/c8 already capture**
49. OpenAI Realtime API streams text and audio deltas concurrently within one response object, with function
    calls interleaved into that same stream rather than a separate turn.
    (developers.openai.com/api/docs/guides/realtime-conversations) - demonstrated - subq 1, 2 -
    **KEPT (c7)**
50. Default turn-detection mode is semantic VAD (a semantic end-of-turn model), not raw silence-based VAD,
    and is enabled by default. (developers.openai.com/api/docs/guides/realtime-conversations) - demonstrated
    - subq 4 - **KEPT (c6)**
51. Interruption is first-class: the client detects a speech-started event mid-playback and truncates
    already-generated but unplayed assistant audio via conversation.item.truncate with an explicit
    played-duration cutoff. (developers.openai.com/api/docs/guides/realtime-conversations) - demonstrated -
    subq 4 - **merged-into c6**
52. For WebRTC/SIP transports, interruption is handled server-side via output_audio_buffer.clear instead of
    a client-computed truncation offset. (developers.openai.com/api/docs/guides/realtime-conversations) -
    demonstrated - subq 4 - **merged-into c6**
53. Turn-taking behavior is independently configurable from interruption behavior
    (turn_detection.interrupt_response, turn_detection.create_response).
    (developers.openai.com/api/docs/guides/realtime-conversations) - demonstrated - subq 2, 4 -
    **merged-into c6**
54. The guide publishes no per-stage or end-to-end latency numbers for the Realtime API; the only
    quantitative figure present is the 60-minute session cap.
    (developers.openai.com/api/docs/guides/realtime-conversations) - demonstrated - subq 6 -
    **dropped: background/negative claim (absence of disclosed numbers), non-substantive**

---

## Dropped claims (reasons summarized)

- Claim 6 - unfalsifiable/non-substantive: describes what a source does NOT cover.
- Claim 26 - background/non-substantive vendor disclaimer (LiveKit declines to publish per-model numbers).
- Claim 30 - metric scope too narrow (TTS sub-stage only), redundant with full-turn numbers already in c2/c8.
- Claim 31 - provider-integration detail (WebSocket vs HTTP), below the importance cutoff.
- Claim 32 - background feature note (word-level timestamps), off the critical path for latency budgeting.
- Claim 47 - network-reliability tangent (packet loss), off-angle for turn-pipeline architecture.
- Claim 48 - vendor-name background list, no incremental design-relevant content.
- Claim 54 - background/negative claim (absence of disclosed numbers).

Total dropped: 8. Total merged into c1-c8: 38. Total kept as primary (c1-c8): 8. (8 + 38 + 8 = 54)

## Coverage gaps

- No source in this set demonstrates a shipped two-model architecture with a genuinely serial
  fast-speaker/slow-planner dependency (sub-question 5's PIANO-style comparison point). Sentence-level
  streaming into TTS is well evidenced (folded into c1); the specific "two independent models, serial
  dependency" claim is not evidenced anywhere in the fetched sources.
- No source describes filler/thinking utterances used to cover tool-call latency (sub-question 2). One
  source (claim 6, dropped) explicitly notes its own silence on this point; no other source fills the gap.

## Unreadable URLs

None.
