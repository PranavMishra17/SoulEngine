# Single-pass streaming turn architecture for a talking NPC

Research pass 09-A, 2026-09-12. Claim ledger with every raw candidate and its fate:
[`raw/a-voice-turn-pipelines.md`](raw/a-voice-turn-pipelines.md) (54 claims, 8 verified, 1 refuted).
Provenance labels follow [`../README.md`](../README.md): demonstrated / marketing / research-only /
community. Confidence: high = 3-0 in adversarial verification, medium = 2-1. Code references are to
the diagnoses in [`diagnosis/`](diagnosis/), which cite file:line for what runs today.

## The headline

Every production voice stack in the retrieved evidence runs one LLM call per turn and gets its speed
from overlapping stages, not from a second model: STT partials arrive while the user is still talking,
the LLM streams tokens, and TTS synthesizes the first sentence while the rest is still generating. Tool
calls live inside that one streamed response (OpenAI Realtime interleaves function-call argument deltas
with text and audio deltas; LiveKit and Pipecat put tool calling inside the LLM stage), so speech and
action come from the same generation. Nobody in this set ships two independent LLM calls per turn, and
nobody ships a fast-speaker/slow-planner pair with a serial dependency either; the second is a coverage
gap, the first matches Pass B's Q8 verdict in
[`../02-agent-architecture-and-actions.md`](../02-agent-architecture-and-actions.md). Vendor budgets
(all marketing-grade) put STT partial under 100-300 ms, LLM time-to-first-token at 200-800 ms, TTS
time-to-first-byte at 50-300 ms, and a streamed turn at 400-800 ms end to end. The biggest finding for
our runtime is not about the LLM: the Deepgram endpointing plus client debounce chain spends about
1.4 s before generation starts (`diagnosis/voice-pipeline.md`), which alone exceeds the first-audio
target these vendors aim for.

## 1. Turn pipeline anatomy

**Finding 1.1 - high (3-0), demonstrated for the pattern (the primary source is marketing).** The
canonical order is audio in -> VAD/turn detection -> STT -> LLM (tool calls inside this stage) -> TTS ->
audio out, streaming at every boundary rather than waiting for each stage to finish
(https://livekit.com/blog/sequential-pipeline-architecture-voice-agents). Verifiers elevated this to
demonstrated because it is inspectable in shipped open-source code: Pipecat's reference pipeline wires
transport input -> STT -> user context aggregator -> LLM -> TTS -> transport output -> assistant
context aggregator in a fixed order (https://www.assemblyai.com/blog/building-a-voice-agent-with-pipecat)
and its TTS stage aggregates sentences over the token stream
(https://docs.pipecat.ai/pipecat/learn/text-to-speech). One verifier cautioned that "LLM starts on
partial transcripts" is less universal: in most stacks partials drive endpointing and interruption,
not early generation.

**Finding 1.2 - high (3-0), marketing.** LiveKit's per-stage ranges: VAD 10-50 ms, STT partial under
100 ms, LLM first token 300-800 ms, TTS first chunk 100-200 ms
(https://livekit.com/blog/sequential-pipeline-architecture-voice-agents). A second LiveKit post gives
transport under 50 ms, STT partial 100-200 ms, LLM TTFT 200-400 ms, TTS TTFA 100-300 ms
(https://livekit.com/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained). No common
harness; the numbers disagree within the same vendor.

*Code today:* the voice path serializes moderation, `getSessionContext` and prompt assembly ahead of
the Speaker (`src/voice/pipeline.ts:806-847, 779-786, 880-887`); text mode runs up to three LLM calls,
the third strictly after the first two (`src/conversation/turn.ts:291-329, 372-397`).

## 2. Tool calls mid-turn

**Finding 2.1 - high (3-0), demonstrated for the architecture, community for the latency cost.**
OpenAI's Realtime API emits `response.function_call_arguments.delta` within the same response
lifecycle as text and audio deltas, so a function call is part of the turn, not a later one
(https://developers.openai.com/api/docs/guides/realtime-conversations). LiveKit places tool calls
inside the LLM stage, running before the reply, and says they "can add large, variable latency" with
no measurement shown (https://livekit.com/blog/understand-and-improve-agent-latency). LiveKit also
exposes `disallow_interruptions` to protect a tool's side effect from barge-in in the same turn
(ledger claim 5, https://livekit.com/blog/sequential-pipeline-architecture-voice-agents).

**Not found:** filler or thinking utterances, speculative TTS, and async tools whose results are
injected later (ledger claim 6).

*Code today does the opposite:* the Speaker has no tools (`src/core/context.ts:628-632`;
`src/core/tools.ts:338-430` feeds only the Mind), recall is deferred a turn
(`src/conversation/turn.ts:366-370`; `src/voice/pipeline.ts:1069-1072`), and an action result triggers
a second, fully serial Speaker+TTS pass (`src/voice/pipeline.ts:1074-1130`). That is the
independent-modules shape PIANO names as a coherence hazard; its fix, serial conditioning through one
decision point, is what a single streamed call with tools gives for free (Pass B, Q8 Finding 1,
arXiv 2411.00114; research-only).

## 3. Retrieval inside the budget

**Finding 3.1 - high (3-0), community.** Server-side prefix caching on Anthropic, OpenAI and Google
requires the prefix to be "byte-identical across turns"; the same post reports TTFT on a 1500-token
system prompt dropping from 500-800 ms uncached to 200-300 ms cached
(https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/). The mechanism is sound; the numbers
are single-source with no methodology. Trust the direction, measure the magnitude.

**Not found:** any comparison of RAG-before-the-call, parallel prefetch, and large cached context. Pass
B already refuted the circulating prefetch numbers (arXiv 2603.02206, unsubstantiated).

*Code today:* only the Anthropic provider caches, as one `cache_control` block over the whole system
string (`src/providers/llm/anthropic.ts:141-150`), so per-turn memory selection
(`src/core/context.ts:207-228`) and the appended `[MIND CONTEXT]` block (`src/core/context.ts:769-775`)
invalidate the prefix every turn. The default provider is Gemini, which has no caching
(`src/providers/llm/factory.ts:44-46`).

## 4. Endpointing, turn detection, interruption

**Finding 4.1 - high (3-0), demonstrated for the OpenAI feature, marketing for the industry trend.**
OpenAI Realtime ships `turn_detection: { type: semantic_vad }` and treats interruption as a separate
mechanism: the client truncates unplayed audio with `conversation.item.truncate` (or the server clears
it with `output_audio_buffer.clear` on WebRTC/SIP), and `interrupt_response` and `create_response` are
configurable independently of turn detection
(https://developers.openai.com/api/docs/guides/realtime-conversations). LiveKit's rationale: VAD works
on audio frames with no semantics, so it cannot tell a sentence-final pause from a mid-thought pause;
STT-provider endpointing is faster because it does not wait out a fixed silence window; a fixed 800 ms
silence timeout "adds nearly a full second" per turn (no data shown)
(https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection).
LiveKit's endpointing is tunable between roughly 0.3 s and 2.5 s
(https://livekit.com/blog/turn-detection-and-interruption-handling, marketing); Pipecat's
`min_turn_silence` example is 100 ms once the turn model is confident
(https://www.assemblyai.com/blog/building-a-voice-agent-with-pipecat, demonstrated). One verifier noted
LiveKit recommends STT endpointing, not a semantic model, as the production default, so "increasingly
default" overstates the trend.

*Code today does the opposite:* Deepgram `utterance_end_ms: 1000` and `endpointing: 500`
(`src/providers/stt/deepgram.ts:85-86`) stack with a 400 ms client debounce
(`src/voice/pipeline.ts:194, 439-454`) to about 1.4 s before `first_transcript`; barge-in is a no-op in
the pipeline (`src/voice/pipeline.ts:463-465`) and the WS handler (`src/ws/handler.ts:386-391`).

## 5. Sentence-level TTS streaming, and the two-model question

**Finding 5.1 - high (3-0), demonstrated.** Pipecat's TTS stage defaults to
`TextAggregationMode.SENTENCE` and offers `TOKEN` mode to stream tokens straight into TTS
(https://docs.pipecat.ai/pipecat/learn/text-to-speech). LiveKit describes the same first-sentence
overlap (https://livekit.com/blog/sequential-pipeline-architecture-voice-agents).

**Finding 5.2 - high (3-0), marketing.** Streamed pipelines report 400-800 ms turns against
1000-2000 ms+ blocking (https://livekit.com/blog/sequential-pipeline-architecture-voice-agents); a
third-party guide reports vanilla LiveKit at 1.2-1.4 s p95 and an optimized stack at 500-650 ms p95
(https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/, community, no methodology).

**Two models with a serial dependency: not found.** No source here or in Pass B shows a shipped
fast-speaker plus slow-planner design where the planner gates the speaker. The only
serial-conditioning precedent is PIANO, research-only.

*Code today:* `SentenceDetector` already aggregates sentences (`src/voice/sentence-detector.ts:24, 52`),
but synthesis calls fire un-awaited against one reused Cartesia `contextId` with `isContinuation`
always `false` (`src/voice/pipeline.ts:962-968, 1239`; `src/providers/tts/cartesia.ts:40-49`), so send
order to the provider is not guaranteed under fast token output.

## 6. Per-stage budgets, 2025-2026

Vendor assertions unless marked otherwise; none measured on a shared harness. LiveKit says it does
not publish per-model numbers because they go stale (ledger claim 26).

| Stage | Range | Source | Label |
|---|---|---|---|
| VAD | 10-50 ms | LiveKit (sequential-pipeline post) | marketing |
| STT first partial | under 100 ms; 100-200 ms; 40-300 ms | LiveKit (two posts); Vapi | marketing |
| STT immutable final | under 300 ms (Universal-3 Pro) | AssemblyAI via Pipecat post | demonstrated (vendor-shown) |
| LLM TTFT | 300-800 ms; 200-400 ms; 100-400 ms | LiveKit (two posts); Vapi | marketing |
| LLM TTFT, cached prefix | 200-300 ms (from 500-800) | futureagi | community |
| TTS TTFB | 100-200 ms; 100-300 ms; 50-250 ms warmed | LiveKit (two posts); Vapi | marketing |
| End-to-end, streamed | 400-800 ms; under 1 s; 500-650 ms p95 | LiveKit; LiveKit; futureagi | marketing / community |
| End-to-end target | p50 under 500 ms, p95 under 800 ms; perceptible at ~300 ms | Vapi | marketing |

URLs for every row are in "Sources" below.

**Finding 6.1 - high (3-0), marketing.** Vapi's stated SLO is p50 under 500 ms and p95 under 800 ms,
with delay perceptible around 300 ms (https://vapi.ai/blog/speech-latency). Tighter than our 1-2 s
budget, which leaves room for retrieval and a tool call inside one streamed turn once endpointing stops
eating 1.4 s of it.

*Code today:* no test asserts a millisecond bound, `TurnTimings` has no time-to-first-token
(`src/conversation/turn.ts:90-99`), and the only "baseline" uses stub latencies of 20/10/30 ms
(`tests/unit/deferred-recall-baseline.test.ts`).

## Did not survive verification

- **Preemptive generation on STT partials with a discard rate "below 5 percent"** (1-2,
  https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/). The feature exists in LiveKit
  Agents (`preemptive_generation`, corroborated by LiveKit's issue tracker); the 5 percent figure is a
  bare assertion from one third-party blog with no methodology. Do not budget against it; measure our
  own discard rate if we try speculative generation.

## Coverage gaps

- **Sub-question 5, two-model serial dependency.** No shipped example. Next: Sesame's CSM write-up,
  Hume EVI docs, ElevenLabs Conversational AI docs, Inworld runtime docs.
- **Sub-question 2, filler utterances and async tool injection.** No source. Next: Vapi and Retell
  docs on speak-while-tool-runs settings, Pipecat's function-calling guide, Deepgram Voice Agent docs.
- **Sub-question 3, RAG-before vs prefetch vs cached context.** Only caching was evidenced. Next:
  Anthropic and OpenAI prompt-caching docs for prefix and TTL rules, plus any published TTFT numbers.
- **Vendors not covered:** Retell, ElevenLabs, Sesame, Hume EVI, Deepgram Voice Agent, Inworld, Convai,
  NVIDIA ACE, Charisma. Evidence here is LiveKit, Pipecat, OpenAI Realtime, Vapi and AssemblyAI only.

## What this changes

1. **`PRODUCT.md` section 3.6, `CognitionRuntime`.** The second implementation behind the interface is
   a single streaming LLM call owning speech, tool calls and recall in one generation (Findings 1.1,
   2.1). `latencyBreakdown` must carry time-to-first-token and first-audio, which `TurnTimings`
   (`src/conversation/turn.ts:90-99`) cannot express today.
2. **`PRODUCT.md` section 5, Q8.** Update the answer: shipped systems run one call with tools
   in-stream; neither the parallel split nor a serial two-model split has precedent.
3. **`src/conversation/turn.ts:291-397` and `src/voice/pipeline.ts:862-1130`.** Collapse Mind, Speaker
   and follow-up into one streamed call with tools; recall becomes a pre-call fetch or a tool result the
   same generation consumes. This removes all four say-A-do-B hazards in
   `diagnosis/turn-latency-path.md` at once.
4. **`src/providers/stt/deepgram.ts:85-86` and `src/voice/pipeline.ts:194`.** Fix endpointing before
   any LLM work: make the three thresholds project-configurable, try STT-provider endpointing without
   the client debounce, and measure (Finding 4.1).
5. **`src/providers/llm/anthropic.ts:141-150` and `src/core/context.ts:575`.** Split the system prompt
   into a stable prefix block (role, anchor, personality, boilerplate) and a dynamic suffix (memories,
   mind context), ordered stable-first, so the cache survives turn-to-turn change (Finding 3.1). Add
   caching to the OpenAI provider; Gemini, the default, has none.
6. **`src/voice/pipeline.ts:463-465` and `src/ws/handler.ts:386-391`.** Re-enable barge-in as its own
   mechanism, with a tool-side-effect guard in the shape of LiveKit's `disallow_interruptions`
   (Findings 2.1, 4.1); `PRODUCT.md` section 3.7 item 5 is the same concern from the action side.
7. **`src/voice/pipeline.ts:962-968, 1239`.** Queue sentence synthesis in order and use Cartesia's
   continuation flag; un-awaited sends risk out-of-order audio (Finding 5.1).
8. **Playground harness (`diagnosis/eval-harness.md` brief).** Add marks for STT-final, LLM
   first-token, TTS first-byte and first-audio on both paths; record cache-hit status per call; make the
   harness the A/B for single-call vs parallel on real providers; assert a p50/p95 budget (Finding 6.1)
   so a regression fails a test.

## Infra candidates

| Name | What it is | Verdict | Why |
|---|---|---|---|
| LiveKit Agents | Open-source voice agent framework (pipeline, turn detector, preemptive generation) | pattern-only | We build our own; copy stage overlap and the interruption guard, not the dependency. Its numbers are marketing. |
| Pipecat | Open-source pipeline framework with sentence/token TTS aggregation and Smart Turn | pattern-only | Same. `TextAggregationMode` and `min_turn_silence` are the reference shapes for `SentenceDetector` and endpointing config. |
| OpenAI Realtime API | Speech-to-speech model with in-stream function calls, semantic VAD, truncate-on-interrupt | pattern-only | Proves tools-in-stream and independent interruption ship; adopting it locks the mind to one vendor, against section 3.6. |
| Vapi | Hosted voice-agent platform | reject | Vendor platform; only its p50/p95 SLO framing is useful. |
| STT-provider endpointing (Deepgram, AssemblyAI) | End-of-turn signal from the STT model instead of a silence timeout | adopt (config on a provider we already use) | Directly attacks the 1.4 s endpointing chain. Measure before trusting. |
| Anthropic / OpenAI prompt-prefix caching | Server-side cached system prefix | adopt (request flag) | Half-wired in `anthropic.ts:141-150`; needs the stable/dynamic split to pay off. |
| Semantic turn-detection models (LiveKit turn detector, Pipecat Smart Turn) | Small model classifying end-of-turn | pattern-only, evaluate later | Trend evidence is marketing; STT endpointing is the cheaper first step. |
| Cartesia context continuation | TTS `contextId` plus `isContinuation` across sentences | adopt (already integrated, unused) | Pure utility in a shipped provider; fixes ordering and prosody at once. |

## Sources

- https://livekit.com/blog/sequential-pipeline-architecture-voice-agents - marketing (pattern corroborated by open-source code)
- https://livekit.com/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained - marketing
- https://livekit.com/blog/understand-and-improve-agent-latency - marketing
- https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection - marketing
- https://livekit.com/blog/turn-detection-and-interruption-handling - marketing
- https://docs.pipecat.ai/pipecat/learn/text-to-speech - demonstrated (open-source docs describing shipped code)
- https://www.assemblyai.com/blog/building-a-voice-agent-with-pipecat - demonstrated (pipeline order, config); vendor STT figure is vendor-shown
- https://developers.openai.com/api/docs/guides/realtime-conversations - demonstrated (shipped API surface)
- https://vapi.ai/blog/speech-latency - marketing (2025-06-23)
- https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/ - community (one refuted figure, see above)
- https://arxiv.org/abs/2411.00114 - research-only (PIANO, cited via Pass B)
