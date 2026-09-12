# Baseline — the parallel Mind+Speaker runtime, measured

First numbers from the playground (`npm run npc -- play`, backlog 7.4) against real providers.
This is the "measure before you change it" step `PRODUCT.md` §4 W4 demanded. Every run below is
reproducible from the committed scenario and, for the recorded ones, replayable for free from its
cassette. Append new runs at the bottom; never overwrite a row.

## Method

- Scenario [`tests/fixtures/playground/deferred-recall.json`](../../tests/fixtures/playground/deferred-recall.json):
  two player turns (turn 1 states a fact — "My brother Kael owes you forty crowns"; turn 2 asks
  "Do you remember what I told you about my brother?"), a world event between them, expectations on
  moderation and on `exit_convo` not firing. Embedded NPC, fresh scratch project per trial.
- 5 trials per provider, `--record` on, both Mind and Speaker on the same provider (cassette mode
  overrides the per-project Mind provider; see `PLAYGROUND_PROTOCOL.md`).
- Local storage (Supabase variables unset for the run), keys from the developer's `.env`.
- Models: the factory defaults — `gemini-2.5-flash`, `gpt-4o` (`src/providers/llm/factory.ts:62-70`).
- Date: 2026-09-12. Runtime: parallel Mind+Speaker with deferred recall, after 7.1-7.3 landed.

## Latency and usage (2026-09-12, main `1a94144`)

| Provider | p50 wall | p95 wall | p50 speaker TTFT | p95 speaker TTFT | Mind (typ.) | Speaker input tokens / turn | Cache reads | passK (loose fixture) |
|---|---|---|---|---|---|---|---|---|
| gemini-2.5-flash | **1320 ms** | 4438 ms | 1232 ms | 4396 ms | 750-1370 ms | ~950 | n/a (provider reports none) | 5/5 |
| gpt-4o | **1077 ms** | 1838 ms | 1065 ms | 1794 ms | 580-1060 ms | 927-983 | **0** | 5/5 |

Cassettes: [`tests/fixtures/playground/cassettes/deferred-recall.gemini.json`](../../tests/fixtures/playground/cassettes/deferred-recall.gemini.json),
[`deferred-recall.openai.json`](../../tests/fixtures/playground/cassettes/deferred-recall.openai.json).

Reading the numbers:

1. **The turn sits at the top of the 1-2 s few-and-deep budget before any voice stage is added.**
   With STT endpointing (~1.4 s today, backlog 7.2 makes it tunable) and TTS in front and behind,
   the voice turn is 3 s or more. The p95 on Gemini (4.4 s) is one outlier turn of 5.4 s.
2. **Speaker TTFT is almost the whole Speaker time on both providers.** Replies are 10-20 tokens, so
   provider prefill dominates and streaming buys little on text. This is not a buffering bug; it
   means the lever is prompt size and caching, not chunking. On voice the first sentence still gates
   first audio, so TTFT remains the metric to drive down.
3. **The Speaker prompt does not clear OpenAI's caching minimum.** 927-983 input tokens per turn,
   `cached_input_tokens` never reported. OpenAI caches prefixes of 1024 tokens or more, so the 7.3
   stable/dynamic split cannot show a win on OpenAI until the prefix grows (or on Anthropic, whose
   minimum for Sonnet-class models is also 1024; not measured — no key in `.env`). Spec 7.3 §7
   predicted this and deferred the decision to this measurement.
4. **Mind and Speaker overlap as designed**: wall ≈ max(mind, speaker), not their sum. The parallel
   design does what it claims on latency; its cost is coherence, below.

## Behaviour (the finding that matters)

**ERR-030 — the NPC denies what the player said two turns earlier.** On turn 2, 4 of 5 trials on
*each* provider replied along the lines of "This is the first time we've spoken", "I don't recall you
telling me anything", "I don't remember you at all" — while the turn-1 user message was in the
conversation history the Speaker received, nothing was deferred from the Mind, and the recall tools
returned nothing wrong.

The cause is the prompt, not recall: the dynamic `[RELATIONSHIP TO PLAYER]` section renders
"This is your first interaction with this person / You have no prior opinions or relationship
history" (`src/core/context.ts:180-182`) and `[THE PERSON YOU'RE TALKING TO]` renders "You don't know
who this person is / Treat them as a stranger" (`context.ts:147-149`) for any player without a
relationship record — which is every player in their first session. The model obeys the system
prompt over the two-turn-old history. The wording means "no history before this conversation" and
must say so.

Gate: [`tests/fixtures/playground/deferred-recall-strict.json`](../../tests/fixtures/playground/deferred-recall-strict.json)
adds `recallFacts: ["Kael"]` and a `replyNotMatches` pattern for the denial phrases on turn 2.
Measured 2026-09-12 on gpt-4o: **passK 0, 1 of 5 trials** (`recallFacts` 0.2, `replyNotMatches` 0.6).
Passing 5/5 on both providers is the acceptance criterion for backlog 7.13, and the recall bar
`CognitionRuntime` v2 (7.5) must clear as well.

**Moderation and exit work live.** [`abusive-player.json`](../../tests/fixtures/playground/abusive-player.json)
on gemini-2.5-flash: turn 1 `none`; turn 2 `exit` from the moderator, and the Mind's `exit_convo`
fired independently with reason "Explicit jailbreak attempt: player is asking to ignore instructions
and reveal system prompt." Both exit paths are reported on the record (`exit.forcedByModeration:
true`). The Speaker still produced an in-character line ("What in the blazes are you on about?")
because the exit is decided after the Speaker commits — the ordering problem `d-disposition-and-patience.md`
describes and 7.10 fixes.

## After the ERR-030 fix (2026-09-12, same day)

Three prompt sections changed in `src/core/context.ts`: `[RELATIONSHIP TO PLAYER]` and
`[THE PERSON YOU'RE TALKING TO]` now describe a first *session* ("no history from before this
conversation", "everything said earlier in this conversation still happened") and the memories
section is headed `[MEMORIES FROM BEFORE THIS CONVERSATION]` with a line saying the current
conversation is in the messages and is remembered too.

What each change did, measured with `deferred-recall-strict.json`, 5 trials per provider:

| Step | gpt-4o turn 2 | gemini-2.5-flash turn 2 |
|---|---|---|
| Baseline | first-meeting denials in 4/5; debt recalled in ~3/5 | first-meeting denials in 3/5; debt recalled in 1/5 |
| Relationship + identity reworded | first-meeting denials **0/5**; debt recalled 4/5 | denials **0/5**; debt recalled 1/5 |
| Memories header scoped to prior sessions | denials 0/5; debt recalled **5/5**, 4 attribute it to the player | denials 0/5; debt recalled **5/5**, 5 attribute it to the player |

The relationship wording removed the "this is our first meeting" symptom on its own. The recall
miss needed the second change: an explicit memory list that omits the conversation in progress
reads to the model as the whole of what it remembers, and in the parallel runtime short-term memory
is only written at session end, so the list can never contain the current conversation.

Gate as committed: `recallFacts: ["owe"]` (the debt, however phrased) and `replyNotMatches` on
first-meeting denials. **passK 1 on both providers** (`tests/fixtures/playground/deferred-recall-strict.json`,
regression test `tests/regression/err-030-first-session-not-first-meeting.test.ts`). Live models
are stochastic; a passK gate at 5 trials will occasionally fail on a good build. Read the per-check
`passRate` across runs before calling a regression, and expect a pass-rate threshold field to follow
when this scenario enters CI against real providers.

## A/B: parallel Mind+Speaker vs the single-call runtime (2026-09-12)

`npm run npc -- play --scenario tests/fixtures/playground/deferred-recall-strict.json --trials 5 --runtime <name>`,
same day, same providers, same fixture (gate widened to any phrasing of the debt: `replyMatches
owe|debt|forty crowns`). Parallel numbers are the post-ERR-030 runs above.

| | gpt-4o parallel | gpt-4o **single** | gemini-2.5-flash parallel | gemini-2.5-flash **single** |
|---|---|---|---|---|
| Turn-2 recall (debt recalled, no first-meeting denial) | 5/5 | **5/5** | 5/5 | **5/5** (4/5 under the literal `owe` check; the miss said "the debt") |
| p50 wall | 1349 ms | **1128 ms** | 1383 ms | **1198 ms** |
| p95 wall | 1838 ms | 2634 ms | 4438 ms | 2731 ms |
| p50 speaker TTFT | 1065 ms | 1125 ms | 1232 ms | 1155 ms |
| LLM calls per turn | 2 (3 with an action) | **1** | 2 (3 with an action) | **1** |
| Input tokens, 10 turns | 19 311 | **11 283** | ~19 200 | **11 270** |
| Recall mechanism | Mind tool, result deferred to the next turn | pre-fetched from the input before the call | same | same |

Cassettes: `tests/fixtures/playground/cassettes/deferred-recall-strict.{openai,gemini}.single.json`.

Reading it:

1. **Same recall quality, one call, about 40 percent fewer input tokens, ~15 percent lower p50 wall.**
   The single runtime never waits on a second model and never pays a follow-up leg. p95 is
   noise at five trials (one slow provider response each side); rerun at 20 trials before quoting it.
2. **TTFT is unchanged, as predicted** in the baseline: prefill dominates a 15-token reply, and the
   single call's prompt is the Speaker's prompt plus a recall section and a task section. The lever
   for TTFT is still prompt size and cache hits, not architecture; the cache floor (1024 tokens on
   OpenAI) is now closer because the single prompt is larger.
3. **Coherence hazards are gone by construction**: speech and action come from one generation, and
   recall arrives *before* the call rather than a turn late. `deferred.forNextTurn` on single-runtime
   records carries only action results.
4. **Exit behaviour differs.** On `abusive-player.json` (gemini, single) the moderator forced the exit
   and the reply stayed in character, but the model did not also call `exit_convo` as the parallel
   Mind did. Whether the single call exits on abuse the keyword moderator misses is untested; add a
   scenario before flipping the default.

Default stays `parallel` in code until that decision is recorded in `PRODUCT.md` §3.6.

## How to rerun

```bash
set -a; source .env; set +a
unset SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_PROJECT_ID
DEFAULT_LLM_PROVIDER=openai npm run npc -- play --scenario tests/fixtures/playground/deferred-recall-strict.json --trials 5
```

Replay a recorded run without a key:
`npm run npc -- play --scenario tests/fixtures/playground/deferred-recall.json --replay tests/fixtures/playground/cassettes/deferred-recall.openai.json`
