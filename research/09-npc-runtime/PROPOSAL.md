# Pass E proposal — one streamed turn, a fact table, and a playground you can drive from a terminal

Date: 2026-09-12. Evidence: the six angle files in this folder (`a-` to `f-`), the four code
diagnoses in [`diagnosis/`](diagnosis/), and the full claim ledgers in [`raw/`](raw/). 202 agents,
48 claims put through a three-lens adversarial check, 35 survived. Scope answers that shaped this:
optimize for **few-and-deep with voice first-class, text as fallback**; **build our own** (vendors
are pattern sources, not dependencies); engine plugins out of scope.

## 0. The verdict

1. **Replace parallel Mind+Speaker with one streamed LLM call that owns speech, tool calls and
   recall.** Every production voice stack the evidence reached (LiveKit Agents, Pipecat, OpenAI
   Realtime, Vapi) runs one call per turn with tool calls interleaved in the same stream; none runs two
   independent calls, and none runs a serial fast/slow pair either
   ([`a-voice-turn-pipelines.md`](a-voice-turn-pipelines.md), headline, 3-0). This closes
   `PRODUCT.md` §5 Q8 and gives §3.6's `CognitionRuntime` its second implementation.
2. **The biggest latency item is not the LLM.** Deepgram `utterance_end_ms 1000` + `endpointing 500`
   (`src/providers/stt/deepgram.ts:85-86`) + a 400ms client debounce (`src/voice/pipeline.ts:194`)
   spend ~1.4s before generation starts — more than the vendor first-audio targets on their own.
3. **Knowledge tiers, world events and quest gates are all the same data structure:** a per-NPC
   **fact table with a scope criterion and optional TTL**, filtered before the model sees anything
   and re-evaluated at every turn start (Valve response rules, the only first-party-documented shipped
   precedent; [`b-knowledge-and-world-events.md`](b-knowledge-and-world-events.md)).
4. **Tool visibility is a filter computed from game state, and the executor is the authority.**
   Anthropic's own cookbook shows the model over-calls tools; `tool_choice` flips also invalidate the
   prompt cache every turn ([`c-tool-gating-and-quests.md`](c-tool-gating-and-quests.md)).
5. **Annoyance is one scalar with a staged ladder and a floor**, decoupled from moderation
   (BG3 warns at -20/-40 and leaves at -50; BailBench shows refusing and leaving are different
   behaviours; [`d-disposition-and-patience.md`](d-disposition-and-patience.md)).
6. **The harness is a relative regression detector, scored with pass^k**, not an absolute quality
   score — simulated players are measurably miscalibrated
   ([`f-player-sim-and-harness.md`](f-player-sim-and-harness.md)).

## 1. What is broken today (from [`diagnosis/`](diagnosis/))

| # | Problem | Where | Effect |
|---|---|---|---|
| 1 | Up to **three** LLM calls per turn: Mind ∥ Speaker, then a serial follow-up for any tool call | `src/conversation/turn.ts:291-329`, `:372-397`; voice `src/voice/pipeline.ts:1074-1130` | Tool turns pay a full second LLM+TTS pass with zero overlap |
| 2 | Recall arrives **one turn late** via `deferred_mind_context` | `turn.ts:366-370`, `src/core/context.ts:769-775` | The say-A-do-B hazards listed in [`diagnosis/turn-latency-path.md`](diagnosis/turn-latency-path.md) |
| 3 | Endpointing chain ~1.4s, three independent timers, none project-configurable | `deepgram.ts:85-86`, `pipeline.ts:182-194, 439-454` | Budget gone before the first token |
| 4 | Prompt cache cannot hit: one `cache_control` block over the whole system string, dynamic sections **before** the stable ones; OpenAI provider has no caching; default Gemini has none | `src/providers/llm/anthropic.ts:141-150`, `src/core/context.ts:597-654`, `factory.ts:44-46` | Full-price, full-latency prefill every turn |
| 5 | Tool visibility is static author-time permissions; `update_quest` takes free text; no `quest_state` anywhere; all providers hard-code `tool_choice: auto`, none set `strict` | `src/core/tools.ts:338-430`, `src/mcp/registry.ts:293-315`, `src/schema/index.ts:150-163` | `reward_player` cannot be gated on anything |
| 6 | Mood moves only on a moderation hit; exit is a binary decided **after** the Speaker has spoken | `turn.ts:427-435`, `:329, 345-351`, `src/security/moderator.ts:47-77` | No warning can land in the spoken line |
| 7 | Sentence TTS calls fired un-awaited on one Cartesia `contextId`, `isContinuation` always false; barge-in is a no-op | `pipeline.ts:962-968, 1239`, `:463-465`, `src/ws/handler.ts:386-391` | Out-of-order audio risk, no interruption |
| 8 | No time-to-first-token or first-audio metric; no test asserts any millisecond bound | `turn.ts:90-99`, `tests/unit/deferred-recall-baseline.test.ts` | Cannot see or guard latency |

Missing outright (`diagnosis/memory-knowledge-tools.md`): world-event inbox, goals/needs, opinions
and beliefs, patience meter, per-subsystem evolution toggles (§3.4 decided, not built), NPC-to-NPC
propagation (only a static network at `src/types/npc.ts:55-68`).

## 2. Target shape: `CognitionRuntime` v2, one streamed turn

```
player input (text, or STT final via provider endpointing)
  -> turn start: assemble
       STABLE PREFIX  role, anchor, personality baseline, guidance, security   [cached]
       DYNAMIC SUFFIX fact table (scope-filtered, TTL-pruned), quest_state,
                      patience band, relationship, recent memories, world-event inbox
       TOOL LIST      registry entries whose precondition(gameState) is true
  -> ONE streaming LLM call (tools in-stream)
       text deltas  -> SentenceDetector -> strip narration -> ordered TTS queue (context continuation)
       tool deltas  -> executor: re-check precondition, run, write result back as a FACT
                       composing tools return void; gating tools return an awaitable (PRODUCT.md §3.7)
  -> turn end: patience ladder step, evolution subsystems that are ON, session log with
               ttft / first-audio / cache-hit / tokens / cost / exit reason
```

Recall stops being a second mind: it is either a pre-call fetch inside the budget (facts and
memories selected into the suffix) or a tool the same generation calls and consumes. This removes all
four coherence hazards at once and makes the suffix the only thing that changes turn to turn.

How the wanted features map, and which switch turns each off (`PRODUCT.md` §3.4 table gets the new rows):

| Feature | Mechanism | Toggle | Precedent |
|---|---|---|---|
| Knowledge tiers | Facts with `scope: common / faction:X / personal:<player> / secret`; a criterion naming an absent fact rejects | always on (memory is never off) | Valve response rules, 3-0 |
| World events, recent event | Same fact table, `ttl`, ingested by a POST route mirroring `src/routes/cycles.ts`, appended to the suffix | `world_events` | Valve fact write-back with TTL |
| Immediate need / goal | `goals[]` on `NPCDefinition`, rendered as a suffix section and as a bias line for tool selection | `goals` | **design intent only, no shipped precedent found** |
| Social web | Proximity-scoped fact broadcast to linked NPCs through the same inbox | `social_propagation` | Dwarf Fortress two-tier decay (community) |
| Quest direction and gates | `quest_state: Record<string,string>` on `NPCInstance`; registry `precondition(gameState)`; `update_quest` action becomes an enum | per tool | Sims Check Tree (one validator for both menus), §3.7 rule 6 |
| Annoyance | `patience` scalar, three per-NPC parameters (accumulation, decay, breaking point), two warning thresholds + one exit, fires once each, separate from moderation exit | `patience` | BG3 ladder + DF stress shape |
| Evolution | unchanged: §3.4 rules 1-6; drift lives in the suffix, authored prefix frozen per session | existing rows | Pass D2 |

## 3. Immediate wins — no architecture change, each measurable in the harness

Ranked by latency recovered per hour of work. All five ship with a test.

1. **Endpointing** (~half the budget). Make the three thresholds project config; try Deepgram's own
   end-of-turn signal without the client debounce; measure p50/p95 before and after.
   `deepgram.ts:85-86`, `pipeline.ts:194, 439-454`.
2. **Prompt split + cache.** Reorder `assembleSlimSystemPrompt` (`context.ts:597-654`) into a stable
   prefix and dynamic suffix returned as two halves; two Anthropic blocks with `cache_control` on the
   stable one (`anthropic.ts:141-150`); add `prompt_cache_key` = NPC definition id+version to
   `openai.ts`; stop the per-turn `exit_convo` force-add that changes the tool list
   (`tools.ts:112-119, 415-418`). Test: prefix byte-identical across two turns of one session.
3. **See latency.** Add `ttft`, `firstAudio`, `cacheReadTokens` to `TurnTimings` (`turn.ts:90-99`),
   reuse `LatencyTracker` (`pipeline.ts:98-138`); one generous p95 assertion in
   `deferred-recall-baseline.test.ts` so a regression fails CI.
4. **Tool hygiene.** `strict: true` on every Anthropic tool; expose `tool_choice` through the provider
   interface and use `none` when game state says nothing is legal; rewrite the Mind's "use them
   proactively" line (`mind.ts:103`) into the NEVER-list shape `exit_convo` already has (`mind.ts:115-119`).
5. **Audio order.** Await-queue sentence synthesis and use Cartesia `contextId` + `isContinuation`
   (`pipeline.ts:962-968`, `cartesia.ts:40-49`); run `stripNarration` inside `SentenceDetector` before TTS.

## 4. The playground harness (the deliverable)

`npm run npc -- talk <npcId> "..."` (`src/harness/cli.ts:4`) **already drives real NPCs against real
providers and storage**, one process per turn, resuming the session rather than ending it. Claude Code
can test NPCs with it today. The playground is a JSON-lines mode on that CLI, not a new tool.

**Protocol.** `npm run npc -- play --npc <id> [--scenario file] [--trials k] [--record cassette]`:
stdin one JSON object per line (`{"say": "..."}`, `{"event": {...fact...}}`, `{"state": {"quest_state":
{...}}}`, `{"inspect": true}`, `{"end": true}`); stdout one JSON object per turn: reply text, tool calls
offered / called / refused-by-precondition, `timings` incl. ttft and first-audio, cache hit, tokens and
dollars, state deltas (patience value and band, quest_state, relationship), exit reason, and the
facts injected this turn with their scopes. Human-readable rendering stays on `talk`.

**Scenario file** (extends `ConversationFixtureSchema`, `src/schema/eval.ts:55-70`, drops the stub
scripts): `npc`, `provider`, a `player` block patterned on promptfoo's simulated user (persona and goal
text, `maxTurns`, optional seeded history, stop sentinel, pinned player model), per-turn `gameState`,
`events` that arrive between turn N and N+1, `expect` per turn (`visibleTools`, `toolsCalled`,
`toolsNotCalled`, `recallFacts`, `noLeak` of secret-scoped facts, `exitTurn`), and `trials`.

**Scoring.** pass^k per scenario (all k trials succeed), hallucinated-reward check (`reward_player` or
`update_quest` args not present in injected quest state), exit-correctness, and an LLM-judge rubric
used only to compare two builds with the same pinned player model. Ship one adversarial persona
(jailbreak phrasing, abuse, spam) as the regression test for `moderate()` and the patience ladder.

**Cassette.** A delegating `LLMProvider` wrapping whatever `createLlmProvider` returns
(`factory.ts:16`) records; a playback provider replays. This is how the single-call runtime gets A/B'd
against the parallel one on identical inputs without paying twice.

**Reuse seams** are listed with line numbers in [`diagnosis/eval-harness.md`](diagnosis/eval-harness.md)
("Design brief"); the eight additions and four hard spots there are the implementation checklist.

## 5. Infra: adopt, copy the pattern, or reject

| Verdict | Item | Why |
|---|---|---|
| **adopt** (config on a provider we ship) | Deepgram end-of-turn endpointing | attacks the 1.4s chain directly |
| **adopt** (request flags) | Anthropic `cache_control` two-block; OpenAI `prompt_cache_key`; Anthropic `strict: true` | zero dependencies, half-wired already |
| **adopt** (already integrated, unused) | Cartesia context continuation | fixes ordering and prosody |
| **adopt** (build) | VCR-style LLM cassette; pass^k trials | pure utility, no dependency |
| pattern-only | LiveKit / Pipecat stage overlap, `disallow_interruptions`, `TextAggregationMode`, `min_turn_silence` | the shapes for our own pipeline and config |
| pattern-only | OpenAI Realtime in-stream `function_call_arguments.delta`, semantic VAD, truncate-on-interrupt | proves tools-in-stream and independent interruption ship; adopting it locks the mind to one vendor (§3.6) |
| pattern-only | Valve response rules fact table; DF two-tier decay; BG3 approval ladder; DF stress facets | data models for §2 |
| pattern-only | promptfoo Simulated User scenario shape; tau-bench pass^k; BailBench exit-vs-refusal split | copied into our schema and metrics |
| pattern-only | Character Card V2/V3 field split; SillyTavern World Info budget-priority insertion | unverified this pass; author-facing vs model-facing separation is worth copying |
| evaluate later | Semantic turn-detection models (LiveKit turn detector, Pipecat Smart Turn) | trend evidence is marketing; STT endpointing first |
| **reject** | Anthropic Tool Search / `defer_loading`; RAG-MCP | built for 50+ tools; adds a round-trip inside the budget |
| **reject** | Vapi as platform; modl.ai; Bing Chat exit-on-tension prompt; AgentBench | vendor lock-in, engine QA out of scope, documented over-firing, wrong domain |

## 6. What the evidence did not give us

Six sub-questions came back empty or refuted and are now **manual browser fetches**, not research
questions (the same failure class Pass C diagnosed): Nemesis and CK3 knowledge scoping, Dave Mark's
utility AI talks, Creation Kit quest stages and conditions, Inworld / Convai / Charisma goals, facts and
emotions pages (Inworld docs returned JS shells), Oblivion / Morrowind / Fallout disposition on UESP,
small-fast-model role-play evidence. Each angle file names the exact URLs under "Coverage gaps".

Do not design against the refuted numbers: LiveKit preemptive-generation "<5% discard", tool-count
accuracy degradation figures, Generative Agents 4%->48% diffusion, tau2-bench as tool-call precision
precedent, the Claude Opus 4 end-conversation gate (provenance via a tweet footnote). All are
quarantined in the angle files' "Did not survive verification" sections.

## 7. Sequence and decisions

Order: **§3 wins (with the §4 metrics first, so each win has a before/after) -> §4 harness -> baseline
the current parallel runtime -> `CognitionRuntime` v2 behind §3.6 -> A/B with pass^k -> §2 subsystems
one at a time, facts table first.**

Records to make in `PRODUCT.md` once you approve: D11 decided (few-and-deep, voice first-class,
text fallback); §3.6 names the v2 implementation; §5 Q8 answer updated; §3.4 table gains
`world_events`, `goals`, `social_propagation`, `patience` rows with the "no shipped precedent" note on
goals.

Decisions for you:

1. **Approve this proposal** as the W4 direction, or say which section to rework.
2. **Harness surface:** a `play` subcommand on the existing `npm run npc` (recommended — one CLI, one
   provider-resolution path, one env story) vs a separate `npm run playground`.
3. **Order of the first sprint:** wins 1-3 then harness (recommended: numbers before overhaul, which is
   what W4 says), or harness first.
