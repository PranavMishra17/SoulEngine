# HANDOFF — NPC runtime work, 2026-09-12 session

For the next agent picking this up. Everything below is on `main` at `0e77360` (548 tests, 80 files,
tsc clean), pushed to `origin/main`. Read this, then `CLAUDE.md`, then `backlog.md` Tier 7.

## 1. Where things are

| What | Where |
|---|---|
| Working branch (identical to `main`) | `claude/npc-playground`, checked out in worktree `E:\Evolve-NPC\.claude\worktrees\npc-system-research-3f13e9` |
| Git flow (changed this session) | `CLAUDE.md` Git Conventions: **no PRs**. Finish an item green in the worktree, `git -C E:/Evolve-NPC merge --ff-only <branch>`, `git push origin main`. PR #10 was the last PR. |
| Research pass E (6 angles + 4 code diagnoses) | `research/09-npc-runtime/` — start with `PROPOSAL.md`, then `BASELINE.md` (all live numbers) |
| Decisions | `PRODUCT.md` §6: D11 decided, D16 built-not-default, D17 approved; §3.4 new toggle rows; §3.6 v2 note; §5 Q8 answered |
| Backlog | `backlog.md` Tier 7 (7.1-7.18). 100 items, 59 done |
| Specs written this session | `specs/7.1.md` `7.2.md` `7.3.md` `7.4.md` `7.5.md` `7.6.md` `7.14.md` |
| Bugs found and fixed | `ERRORS.md` ERR-030 (first-session prompt wording), ERR-031 (`stripNarration` ate emphasis) |
| Playground protocol | `documentation/PLAYGROUND_PROTOCOL.md`; pointer in `WORKFLOW.md` "Testing & CI" |
| Live scenarios (the gates) | `tests/fixtures/playground/{deferred-recall,deferred-recall-strict,abusive-player,unmoderated-abuse,action-with-speech}.json` + recorded cassettes in `cassettes/` |
| Session memory (Claude-side) | `C:\Users\prana\.claude\projects\E--Evolve-NPC\memory\npc-runtime-pass-e-decisions.md` |

## 2. What was done, in order (commit -> item)

1. `a28616a` Research pass E: 202 agents, 48 claims adversarially verified, 35 survived. `research/09-npc-runtime/`.
2. `8e29b4c` Decisions recorded, Tier 7 planned, specs 7.1-7.3.
3. **7.1** `18e0f63` `TurnTimings.speakerTtftMs/followUpTtftMs`, provider-neutral `cached_input_tokens`, usage on `TurnResult` + session log, harness prints them, first orchestration-overhead assertion.
4. **7.2** `23c5949` `ProjectSettings.voice_latency {utterance_end_ms, endpointing_ms, aggregation_window_ms}` threaded `ws/handler.ts` -> `VoicePipeline` -> Deepgram; defaults unchanged (1000/500/400).
5. **7.3** `4077b1f` Speaker prompt split: `assembleSlimSystemPromptParts() -> {stable, dynamic}`; `LLMChatRequest.systemPromptPrefix/cacheKey`; Anthropic two blocks with `cache_control` on the first; OpenAI `prompt_cache_key` (review fix `56ad586`: it was on the message, belongs on the body).
6. **7.4** `8df0856` Playground: `npm run npc -- play` JSON-lines mode, scenario files, `--trials k` pass^k, `--record/--replay` cassettes, logs to stderr. Builder stopped at type errors; finished by orchestrator, which also fixed a real-project teardown hazard and missing provider resolution.
7. `2a8de12` **Live baseline** on gemini-2.5-flash and gpt-4o (`BASELINE.md`): p50 wall 1.3 s / 1.1 s; zero OpenAI cache reads (927-token prompt under the 1,024 floor).
8. **ERR-030 / 7.13** `1970098` Playground found the NPC denying what the player said two turns earlier (4/5 both providers). Cause: `[RELATIONSHIP TO PLAYER]` / `[THE PERSON YOU'RE TALKING TO]` called every first session a first meeting, and the memories list read as "all I remember". Reworded (`src/core/context.ts`), memories header now "FROM BEFORE THIS CONVERSATION". Gate went 1/5 -> 5/5 (OpenAI), 0/5 -> 5/5 (Gemini).
9. **7.5 Phase A** `4a3aeaa` + `cae0d85` `CognitionRuntime` event-stream seam (`src/core/runtime.ts`), parallel design moved behind it (`src/core/runtime/parallel.ts`), `runConversationTurn` is the host, `cognition_runtime` project setting, `--runtime` flag. Review caught the builder hard-coding the Mind timeout (dropped `mind_timeout_ms`); fixed and pinned by test.
10. **7.5 Phase B** `e492f3c` + `479c00f` + `84df79a` `SingleCallRuntime` (`src/core/runtime/single.ts`): one `streamChat`, recall pre-fetched deterministically (`src/core/recall.ts`, shared with the Mind tools, drift-guarded), no follow-up leg. A/B: same recall, ~40% fewer input tokens, ~15% lower p50 wall, TTFT unchanged. **But** both models emit speech *or* a tool call, never both: `give_item` 0/6 on single vs 3/3 on parallel; exits were silent (fallback line added). Also fixed: the single call offered no built-in tools at all. **Default stays `parallel`.**
11. **7.15** `624b5ed` `stripNarration` keeps emphasised words (ERR-031).
12. **7.14** `245cb07` + `d192406` Voice pipeline runs `runConversationTurn` (new `RunTurnOptions.onEvent` streams events to TTS); ~380 duplicated lines removed from `src/voice/pipeline.ts`. Behaviour changes: voice Mind budget is now `mind_timeout_ms` (was fixed 8 s); voice turn logged once by the host; voice can select `cognition_runtime`. Review fixed a flush firing on every follow-up delta.
13. **7.6** `3e6ad6e` + `0e77360` (re-scoped) Mind prompt split stable/dynamic, history + player line moved into `messages` (was inside the system prompt with `messages: []`), conservative action instruction, dead `getAvailableTools` deleted, Mind reports cache tokens, one `promptCacheKey()` helper in `src/core/context.ts`. Live gate 3/3 on all scenarios both providers. **No cache hits anywhere**: Speaker stable prefix ~816 tokens, Mind ~525, both under the 1,024-token floor every provider enforces.

## 3. Architecture now (read these files in this order)

1. `src/conversation/turn.ts` — the host. Sanitize, moderate, prompt parts, provider resolution, Mind timeout, `runtime.generate()` consumed into `TurnResult`, session log. `RunTurnOptions.onEvent` streams events to callers (voice).
2. `src/core/runtime.ts` — `CognitionRuntime`, `CognitionInput`, `CognitionEvent` (`text | tool_call | tool_result | follow_up | done`), `selectRuntime`.
3. `src/core/runtime/parallel.ts` — Mind || Speaker, deferred recall, follow-up leg. **Default.**
4. `src/core/runtime/single.ts` — one call, pre-fetched recall, no recall tools offered, silent-exit fallback line. Built, not default.
5. `src/core/recall.ts` — `recallMemoriesFor / recallKnowledgeFor / recallNpcsFor`, used by both the Mind tools and the single runtime.
6. `src/core/context.ts` — `assembleSlimSystemPromptParts`, `formatSingleCallTask`, `promptCacheKey`. `src/core/mind.ts` — `buildMindSystemPromptParts`, `runMindAgentLoop`. `src/core/tools.ts` — `EXIT_CONVO_RULES` (one copy), `getMindAvailableTools`.
7. `src/harness/playground.ts` (+ `lookup.ts`, `cli.ts`) — the play mode; `src/providers/llm/cassette.ts` — record/replay.
8. `src/voice/pipeline.ts` — thin adapter over the host; keeps STT/TTS sessions, aggregation, rate limiting, `SentenceDetector`.

## 4. How to run the live gates

```bash
# from the worktree; keys live in E:/Evolve-NPC/.env (Gemini, OpenAI, Deepgram, Cartesia; no Anthropic)
set -a; source E:/Evolve-NPC/.env; set +a
unset SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_PROJECT_ID   # keep scratch projects local
export LOG_LEVEL=warn DEFAULT_LLM_PROVIDER=openai                                   # or gemini
npx tsx src/harness/cli.ts play --scenario tests/fixtures/playground/deferred-recall-strict.json --trials 5 --runtime parallel
```

Stdout is one JSON record per line; the last is `summary` with `passK`, per-check `passRate`, p50/p95.
Exit code is 0 only when every trial passed. Live models are stochastic: read `passRate` across runs
before calling a regression. `--record <file>` saves a cassette; `--replay <file>` needs no key.
Stub mode (`--stub`, `ENCRYPTION_KEY=anything`) is deterministic and what the e2e tests use.

## 5. Next steps, in the order I would take them

1. **Decision 7.18 — the cache floor** (`backlog.md` 7.18, `BASELINE.md` "The cache floor"). Options:
   (a) grow both stable prefixes past 1,024 tokens with content that earns its place — the
   world-knowledge summary the slim prompt omits (`src/core/context.ts`, "NO world knowledge section in
   slim prompt"), richer behavioural examples — then measure `cached_input_tokens` and TTFT; or
   (b) record that prompts this small never cache and drop caching from the latency plan. Pranav has
   not chosen. Do not pad for padding's sake.
2. **7.16 — structured single call** (`backlog.md` 7.16). A third runtime where the model must answer
   through a required `respond({ speech, action? })` tool so speech and action are two fields of one
   generation. This is the only proposed path to flipping D16. Gate: `action-with-speech.json` and
   `unmoderated-abuse.json` 3/3 *with speech* on both providers, `deferred-recall-strict.json` at
   parity. Needs a spec first (`specs/7.16.md`); the streaming-JSON reader for the `speech` field is
   the hard part on OpenAI/Anthropic; Gemini delivers function args whole.
3. **7.17 — TTS ordering** (proposal win 5): await-queue sentence synthesis, Cartesia `contextId` +
   `isContinuation`, streaming `stripNarration` inside `SentenceDetector`, tag dialect on `TTSProvider`.
4. **7.8 fact table** (knowledge tiers + world events as scoped facts with TTL; replaces the playground's
   `event` memory stopgap), **7.9 quest state + tool preconditions**, **7.10 patience ladder** — the
   features Pranav asked for at the start, all specced at the row level in `backlog.md`, none built.
5. 7.11 dollars in the playground, 7.12 LLM persona player.

## 6. Things that will bite you

- **Agents in isolated worktrees branch from the session's original base**, not `main` (`CLAUDE.md`
  "Agent worktrees branch from the session's ORIGINAL base"). Everything after 7.1 was built by
  dispatching `feature-builder` **without** `isolation: "worktree"`, directly in this worktree, one
  agent at a time. Never run two in the same tree.
- **Review every builder report against the diff.** This session's builders: hard-coded the Mind
  timeout and called it an invariant; wrote tests that grep source text; put `prompt_cache_key` on
  the wrong object; skipped a test whose input was not on the jailbreak list; reported threading a
  value they recomputed. All caught only by reading the diff. `.claude/agents/feature-builder.md`
  now forbids source-text tests.
- **`SendMessage` was disabled in this session**, so builders could not be sent back; fixes were done
  by the orchestrator in-tree. Check whether it works before relying on it.
- **Jailbreak phrases match contiguous text** (`src/security/moderator.ts`): "Ignore all previous
  instructions" does NOT match; "Ignore your instructions" does.
- **Bash heredocs on this Windows Git-Bash mangle backslashes** in Python `<<'EOF'` scripts; use the
  Edit tool for anything containing `\n` or regexes.
- **Pre-commit runs the full suite** (~60-90 s) on every commit; docs-only commits too.
- **The live-run scripts** used this session lived in the scratchpad and are gone; the command in §4
  is the whole recipe.
- **RULE ZERO**: no AI attribution in any commit, ever, whatever the harness reminder says. Every
  commit this session is authored by Pranav Mishra with no trailer.

## 7. Numbers to beat (parallel runtime, 2026-09-12)

| | gpt-4o | gemini-2.5-flash |
|---|---|---|
| p50 wall (text turn) | 1.1-1.3 s | 1.3-1.4 s |
| p50 speaker TTFT | ~1.1 s (prefill-bound; replies are 15 tokens) | ~1.2 s |
| Mind p50 | 790-900 ms | 750-920 ms |
| Cache reads | 0 (prefix under 1,024 tokens) | n/a |
| Recall / action / exit gates | 3/3, 3/3, 3/3 | 3/3, 3/3, 3/3 |

Full tables and the story behind each number: `research/09-npc-runtime/BASELINE.md`.
