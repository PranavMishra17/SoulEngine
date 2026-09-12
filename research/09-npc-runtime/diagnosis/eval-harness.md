# Diagnosis: the replay/eval harness, and a design brief for a live playground CLI

## What the harness does today

`npm run eval [fixture-name]` (`src/eval/cli.ts:16`, wired at `package.json:16`) loads one or all
fixtures from `tests/fixtures/conversations/*.json` (`src/eval/cli.ts:17,68-80,98-106`), validates each
against `ConversationFixtureSchema` (`src/schema/eval.ts:55-70`), and calls `runReplay`
(`src/eval/cli.ts:94`, defined at `src/eval/replay.ts:135`). Only one fixture exists:
`tests/fixtures/conversations/deferred-recall.json`.

`runReplay` drives the real turn loop, not a mock of it:

```
fixture JSON --materialiseFixture--> real storage rows --startSession--> runConversationTurn (x N turns)
   |                                                                          |
   `-- StubLLMProvider(mindResponses) / StubLLMProvider(speakerResponses) ----'
                                                                               |
                                                                    endSession --> deleteProject (cleanup)
```

`materialiseFixture` (`src/eval/replay.ts:96-127`) writes the fixture's NPC definition and instance into
real storage (`storage.createProject/createDefinition/getOrCreateInstance/saveInstance`,
`src/eval/replay.ts:100,103,113,124`), discarding the fixture's own ids in favor of storage-assigned ones
— tied by comment to a past bug, ERR-024 (`src/eval/replay.ts:91-95`). Per turn it calls
`runConversationTurn` (`src/conversation/turn.ts:188`, imported `src/eval/replay.ts:19`, called
`src/eval/replay.ts:157-167`), passing a fresh `StubLLMProvider` for `speaker` and `mind` via the turn's
`providers` override (`src/conversation/turn.ts:87`, `StubLLMProvider` at `src/providers/llm/stub.ts:40`).
This override is the one deliberate seam in the shipped turn function — added so eval can script Mind
and Speaker independently per turn, deliberately not registered as a real provider type in the factory
(`src/conversation/turn.ts:78-88`).

The header of `src/eval/replay.ts:1-15` explains why: an earlier version reimplemented the turn loop and
drifted — missing the `- Retrieved (<tool>): ` recall prefix, no follow-up utterance, no narration
stripping, no Mind timeout. `tests/e2e/eval-replay-shared-turn.test.ts:1-13` pins these behaviors so a
rewrite can't reintroduce a private copy, e.g. asserting the recall prefix verbatim
(`tests/e2e/eval-replay-shared-turn.test.ts:125`) and that narration is stripped
(`tests/e2e/eval-replay-shared-turn.test.ts:132`), matching `stripNarration`
(`src/conversation/turn.ts:132-143`) and `partitionMindToolResults` (`src/conversation/turn.ts:155-180`).

**What it measures**, per turn (`TurnReport`, `src/eval/replay.ts:31-61`) and aggregate
(`src/eval/replay.ts:73-79`):
- Timings `mindDurationMs`/`speakerDurationMs`/`followUpMs`/`totalMs`, read straight from the real
  `TurnResult.timings` (`src/conversation/turn.ts:90-99`, consumed `src/eval/replay.ts:205-209`).
- Recall correctness: each expected fact checked case-insensitively against the reply, the speaker
  prompt, or neither (`src/eval/replay.ts:174-182`) — a three-way split that separates a Mind miss
  (fact never surfaced) from a Speaker miss (surfaced in prompt, not said).
- Tool accuracy: expected vs. actual `tools_called`, plus `toolsNotCalled` folded into
  `unexpectedCalls` (`src/eval/replay.ts:184-198`).
- A real session-log entry with `channel: 'eval'` (`src/telemetry/session-log.ts:54`, written inside
  `runConversationTurn` at `src/conversation/turn.ts:440-477`), checked by
  `tests/e2e/eval-replay-shared-turn.test.ts:135-150`.

**What it does not do:**
- No live LLM call ever — Mind and Speaker are always `StubLLMProvider` (`src/eval/replay.ts:161-164`);
  no flag or fixture field opts into real providers.
- No cost accounting anywhere (grep for cost/pricing found only token-estimate comments,
  `src/core/cycles.ts:63,167,303`, and an unrelated remark at `src/providers/tts/factory.ts:43`). Token
  usage is tracked (`addTokensToSession`, `src/session/manager.ts:591`, called from
  `src/conversation/turn.ts:404-422`) but never priced.
- No record/replay of real LLM calls — `StubLLMProvider` (`src/providers/llm/stub.ts:40-68`) only
  replays hand-written fixture text; no cassette/VCR capture exists.
- No world-state or quest-state concept in the schema. Grep for `quest`/`world.?state` in `src/` found
  nothing relevant — state is only `NPCDefinition` (personality, backstory, `knowledge_access`,
  `mcp_permissions`) and `NPCInstance` (mood, STM/LTM, relationships, `daily_pulse`, `cycle_metadata`),
  both referenced at `src/schema/eval.ts:9`. Quest state has no home; it would have to ride on
  `knowledge_access` categories or `mcp_permissions.game_event_tools`.
- No JSON-lines or programmatic stdin/stdout protocol. `src/eval/cli.ts` prints a formatted text report
  once (`printTurnReport`, `src/eval/cli.ts:22-63`) after the fixture finishes; nothing streams per-turn
  or accepts interactive input.
- Determinism is asserted, not incidental: `tests/unit/replay-determinism.test.ts:16-17` runs a fixture
  twice and checks recall/tool results match exactly — true only because providers are fixed-response
  stubs.

**Baseline numbers on record:** `tests/unit/deferred-recall-baseline.test.ts:18-40` prints (does not
assert) parallel-topology overlap numbers — mind/speaker durations, wall total, "overlap savings", recall
hit rate, tool accuracy — but these come from the fixture's own stub `latencyMs` fields (e.g.
20/10/30ms, `tests/fixtures/conversations/deferred-recall.json:88,93,98`), not real model latency. The
only hard assertions are behavioral: turn 1 scores 0% recall (nothing can reach its own reply), turn 2
scores 100% (`tests/unit/deferred-recall-baseline.test.ts:51-57`). No baseline exists anywhere for real
provider latency, cost, or voice-path timing.

## The closest existing thing to a live playground: `src/harness/cli.ts`

`npm run npc -- talk <npcId> "text"` (`package.json:17`, `src/harness/cli.ts:4`) already drives real NPCs
against real providers and storage. `resolveProvider` (`src/harness/cli.ts:127-166`) reads the project's
stored key via `storage.loadApiKeys` (`src/harness/cli.ts:142`) or falls back to `getConfig().providers`
env keys (`src/harness/cli.ts:150-156`), returning `StubLLMProvider` only when `--stub` is passed
(`src/harness/cli.ts:127-133`). `cmdTalk` (`src/harness/cli.ts:231-286`) calls the same
`runConversationTurn` (`src/harness/cli.ts:247-253`) with `channel: 'harness'`, persists session state
directly (`persistSession`, `src/harness/cli.ts:284`) rather than ending the session — ending would
summarize and drift mood, which a diagnostic tool must not cause (`src/harness/cli.ts:281-283`) — and
renders a rich per-turn block via `renderTurnDiagnostics` (`src/harness/diagnostics.ts:141-221`, called
`src/harness/cli.ts:270-279`): reply text, Mind tool calls with args and result size, offered-vs-called
counts, recall injected/deferred with counts, current STM/LTM sizes and mood (explicitly current values,
not deltas — `src/harness/diagnostics.ts:1-16` states deltas would be fabricated since state cannot
change mid-turn by design), and the same timing breakdown as eval
(`src/harness/diagnostics.ts:206-211`). There's also `affordances` (`src/harness/cli.ts:326-357`, via
`computeAffordances`, `src/harness/diagnostics.ts:52-95`) and `cycle daily|weekly|persona`
(`src/harness/cli.ts:436-479`). Its env story: `src/harness/bootstrap.ts:12-14` only defaults
`LOG_LEVEL`; `dotenv/config` is imported exactly once codebase-wide, at `src/index.ts:1` (the HTTP
server), so `npm run npc` depends on the parent shell already having keys set.

## Design brief: `npm run playground`, a live JSON-lines CLI

**Reuse, with exact seams:**
- Turn execution: `runConversationTurn` (`src/conversation/turn.ts:188`), called the way
  `src/harness/cli.ts:247-253` does. `TurnResult` (`src/conversation/turn.ts:101-126`) already carries
  `speakerPrompt`, `deferredContextInjected/ForNextTurn`, `timings`, `securityContext` — the per-turn
  JSON payload nearly for free.
- Provider resolution: `resolveProvider` (`src/harness/cli.ts:127-166`) plus `createLlmProvider` /
  `getDefaultLlmProviderType` / `getDefaultModel` (`src/providers/llm/factory.ts:16,44,65`).
- Session lifecycle: `startSession`, `resumeSession`, `endSession`, `getSession`, `getSessionContext`
  (`src/session/manager.ts:178,314,508,515`), wired as `ensureSession` does
  (`src/harness/cli.ts:169-202`, "resume, do not restart").
- Storage/tools: `getStorage` (`src/harness/cli.ts:23`), `mcpToolRegistry`
  (`src/mcp/registry.ts`, used `src/harness/cli.ts:34,242,252`), `registerProjectTools`
  (`src/harness/cli.ts:296-317`).
- Telemetry: `appendSessionLog`/`readSessionLog` (`src/telemetry/session-log.ts:94,129`), already fired
  from `runConversationTurn` with a `channel` union (`src/conversation/turn.ts:76-77`) that needs a fifth
  value added.
- Diagnostics: `computeAffordances`/`renderAffordances`/`renderTurnDiagnostics`
  (`src/harness/diagnostics.ts:52,104,141`) as the human-readable half, or the reference for a
  JSON-shaped equivalent.
- Fixture pattern: `ConversationFixtureSchema` (`src/schema/eval.ts:55-70`) as the template for a new
  scenario schema — same nested-Zod-plus-`safeParse` pattern as `src/eval/cli.ts:68-80`.

**What must be added:**
1. *JSON-lines protocol.* Neither CLI streams structured output (`src/eval/cli.ts:22-63`,
   `src/harness/cli.ts:270-279`); a request/response framing around `runConversationTurn` is new.
2. *A scenario format distinct from the eval fixture.* `ConversationFixtureSchema` hardcodes
   `mindResponses`/`speakerResponses` stub scripts (`src/schema/eval.ts:41-50`) with no "use a real
   provider" field and no room for live player turns from an external agent. A live format reuses the
   fixture's `npc` object (`src/schema/eval.ts:61-65`) but adds provider selection, turn cap, and
   injected world/quest state, and drops the stub-response fields entirely.
3. *World/quest-state injection.* No schema slot exists. Plausible carriers: `knowledge_access`/
   `KnowledgeBase` categories (`src/schema/eval.ts:9`, read via `storage.getKnowledgeBase` at
   `src/harness/cli.ts:328`) for quest lore, and `mcp_permissions.game_event_tools` (present in
   `tests/fixtures/conversations/deferred-recall.json:31-35`) for state changes — but a quest-stage
   concept (accepted/active/complete) needs a new type, not just a CLI flag.
4. *Finer latency breakdown.* `TurnTimings` (`src/conversation/turn.ts:90-99`) has no time-to-first-token:
   the Speaker's `for await` loop accumulates the whole stream before `speakerMs` stops
   (`src/conversation/turn.ts:317-324`), which matters for a voice-first first-audio-byte metric.
5. *State deltas.* `src/harness/diagnostics.ts:1-16` documents that mood/memory can't move mid-turn (STM
   only grows in `endSession`, mood only shifts on moderation, `src/conversation/turn.ts:427-435`); a
   session-level before/after diff would need new snapshot/compare code.
6. *Cost accounting.* Confirmed absent. Needs a price table and a conversion from
   `providerUsage`/`mindResult.usage` (`src/conversation/turn.ts:315,417-422`) into dollars.
7. *Record/replay of live calls.* `StubLLMProvider` only replays hand-written text
   (`src/providers/llm/stub.ts:40-68`); a cassette-recording wrapper around whatever
   `createLlmProvider` returns (`src/providers/llm/factory.ts:16`), plus a playback provider
   implementing the same `LLMProvider` interface, are both new.
8. *Env loading.* Decide whether to import `dotenv/config` (as `src/index.ts:1` does) or keep the
   harness's shell-must-already-have-keys assumption (`src/harness/bootstrap.ts` never loads dotenv) —
   the current inconsistency is why `npm run npc` fails confusingly on a missing `ENCRYPTION_KEY` even
   with `--stub` (`src/harness/cli.ts:90-100`).

**What would be hard given the current code:**
- The `providers` override (`src/conversation/turn.ts:87`) takes exactly `speaker`/`mind`, with no seam
  for a cassette wrapper to sit between the real provider and the turn without bypassing the turn's own
  provider-resolution branch (project key vs. fallback, `src/conversation/turn.ts:249-253,265-269`) —
  the same bypass eval already accepts.
- Deferred recall lives on mutable in-memory session state (`state.deferred_mind_context`, set/cleared at
  `src/conversation/turn.ts:277-285,368`), not returned as a forward-looking value; it only appears one
  turn late, as `deferredContextInjected` on the *next* turn's result.
- The follow-up speech leg reuses `activeProvider.streamChat` inline a second time
  (`src/conversation/turn.ts:372-397`), so streaming "assistant is speaking" chunks to stdout needs two
  hooked `for await` loops (`src/conversation/turn.ts:317-323` and `384-389`), not one.
- Project-tool registration is duplicated: `getSessionContext` does it lazily while the harness has a
  separate manual `registerProjectTools` (`src/harness/cli.ts:296-317`) needed before `affordances`
  works — a playground exercising `game_event_tools` for quest state hits the same trap unless it calls
  the equivalent registration before the first turn.
