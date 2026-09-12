# LLM player simulators and NPC evaluation harnesses

Research pass 09-F, 2026-09-12. Claim ledger with every raw candidate and its fate:
[`raw/f-player-sim-and-harness.md`](raw/f-player-sim-and-harness.md). Provenance labels follow
[`../README.md`](../README.md): demonstrated / marketing / research-only / community. Confidence is
the adversarial tally: high = 3-0, medium = 2-1. Code references describe the runtime as diagnosed in
[`diagnosis/eval-harness.md`](diagnosis/eval-harness.md) and
[`diagnosis/turn-latency-path.md`](diagnosis/turn-latency-path.md).

## The headline

Having an LLM play the player is a shipped, inspectable practice (promptfoo's Simulated User provider),
and the scoring idea that matters most is tau-bench's pass^k: rerun the identical scenario k times and
report the fraction that succeed every time, because single-shot success hides the inconsistency
players actually experience. A January 2026 human-subject study found LLM-simulated users systematically
miscalibrated, with success rates swinging up to 9 points depending on which model plays the user, so
the player-agent harness is a regression detector, not a substitute for human playtests. Nothing was
found on game-industry LLM-NPC testing tools, red-team player agents, or shipped LLM-NPC turn latency;
the latency target must come from our own numbers, the same conclusion Pass B reached in
[`../02-agent-architecture-and-actions.md`](../02-agent-architecture-and-actions.md) Q8. Today's
`runReplay` (`src/eval/replay.ts:135`) is the right skeleton; it lacks a live player agent, repeated
trials, a cassette recorder, and any latency or cost assertion.

## 1. User simulators: persona, goals, scoring

**Finding 1.1 (high, 3-0, demonstrated).** promptfoo's Simulated User provider is a complete reference
shape for a player agent: persona and goal via Nunjucks-templated `instructions` referencing per-test
variables; `maxTurns` (default 10, counted after any seeded history) as the cost cap; seeded history via
`initialMessages` inline or `file://`; early exit when the agent emits a literal `###STOP###`; and
`llm-rubric` assertions over the transcript (https://www.promptfoo.dev/docs/providers/simulated-user/,
current as of today). The target must accept OpenAI-format `{role, content}` messages; our text endpoint
(`src/routes/conversation.ts:49`) does not, so an adapter is needed, and the voice path
(`src/voice/pipeline.ts:862-1225`) cannot be driven this way at all.

**Finding 1.2 (medium, 2-1, demonstrated).** tau-bench's design choice is that consistency, not
capability, is the yardstick: "Unlike traditional benchmarks, tau-bench doesn't just test whether an
agent can complete a task once; it measures whether it can do so consistently multiple times"
(https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents, methodology formalised as
pass^k in https://arxiv.org/abs/2406.12045, mid-2024). The dissenting verifier's point is fair and
should be carried: tau-bench is a text-only customer-service benchmark with a policy document to obey,
not a voice NPC under a 1-2 s budget. The metric transfers; the task set does not.

**Finding 1.3 (medium, 2-1, research-only).** Simulated users are a biased proxy. Seshadri et al.,
"Lost in Simulation" (https://arxiv.org/pdf/2601.17087, ICLR 2026): "Evaluations using simulated users
exhibit systematic miscalibration, underestimating agent performance on challenging tasks and
overestimating it on moderately difficult ones." Success rates varied up to 9 points across user
LLMs; the proxy was worst for AAVE and Indian English speakers, worsening with age; and simulated users
introduced conversational artifacts absent from human dialogue. It is a task-completion benchmark, not a
game: the magnitudes may not carry over, the direction of the warning does.

**Finding 1.4 (medium, 2-1, demonstrated, 2023).** AgentBench names "poor long-term reasoning,
decision-making, and instruction following abilities" as the main agent failure causes
(https://arxiv.org/abs/2308.03688). The dissent: this diagnoses 2023 models on OS/DB/web tasks, not
NPC dialogue. Borrow the three headings as failure tags, nothing more.

## 2. Game industry automated testing

**Finding 2.1 (medium, 2-1, demonstrated via secondary source).** The only precedent retrieved is
scripted QA bots, not LLM players. modl.ai's overview reports that Rare "deployed bots to simulate
complex player interactions, uncovering edge-case bugs human testers might miss" on Sea of Thieves,
paired with automated screenshot capture and AI-assisted visual analysis for graphical regressions
(https://modl.ai/what-is-modern-game-testing, citing a GDC talk by Rare engineer Robert Masella; the
talk itself was not watched). The dissent is right that this is heuristic mechanics QA from roughly
2018-2020 with nothing to say about conversational NPCs. The transferable idea is the CI shape: bots
run on every build, artifacts are diffed automatically, a human reads only the diff. Nothing on EA,
Ubisoft, Inworld, Convai, Charisma or NEO NPC testing was retrieved (see Coverage gaps).

## 3. Metrics

**Finding 3.1 (medium, 2-1, demonstrated for the 2024 half).** Concrete baseline numbers exist for
tool-using conversational agents. At launch, tau-bench's GPT-4-class agents "succeeded in fewer than
50% of tasks and struggled with consistency, achieving only ~25% success when repeating the same task
eight times" (https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents). The blog's
follow-on assertion that current models exceed 80% pass^1 on retail was contested: one verifier traced
the frozen tau-bench leaderboard to a 69.2% top score and could only find 80%+ figures on third-party
aggregators or successor benchmarks. Use the 2024 pair (under 50% single-shot, about 25% at k=8) as
the illustration of why pass^k matters; do not quote the 80% figure as a tau-bench result.

**Finding 3.2 (from 1.1, high).** promptfoo scores persona adherence with an LLM rubric over the whole
transcript. The 80%-human-agreement claim for GPT-4 judges was refuted for our use (see below), so
rubric scores are a relative signal between two builds, with answer-order randomisation and a length
control, never an absolute number.

**What the code measures today.** `runReplay` computes a three-way recall split (fact in reply / in
prompt / neither, `src/eval/replay.ts:174-182`) and tool accuracy as expected-found-in-actual plus an
`unexpectedCalls` list (`src/eval/replay.ts:184-198`). It asserts no latency anywhere
(`tests/unit/deferred-recall-baseline.test.ts` prints stub latencies of 20/10/30 ms), has no
time-to-first-token in `TurnTimings` (`src/conversation/turn.ts:90-99`), no persona rubric, no
hallucinated-quest check, and no exit check beyond `tools_called`. Exit correctness deserves its own
metric because `exit_convo` is decided only after the Speaker has spoken
(`src/conversation/turn.ts:345-351`), so a transcript can say "stay a while" and then end the session.

## 4. Harness design

**Finding 4.1 (high, from 1.1).** promptfoo's structure is the reference for a multi-turn simulated
conversation: seeded history for deterministic setup, a turn cap as the cost cap, a sentinel for early
exit, rubric assertions on the transcript. Braintrust, Langfuse, inspect_ai and OpenAI evals were not
retrieved in this pass; no claim about them is made here.

**Finding 4.2 (medium, from 1.2).** Deterministic replay and live runs answer different questions:
pass^k is only meaningful against a live, stochastic agent, while replay proves a regression did not
occur. The repo has only the deterministic half: `tests/unit/replay-determinism.test.ts:16-17` runs a
fixture twice and asserts identical output, which holds only because both providers are
`StubLLMProvider` (`src/providers/llm/stub.ts:40`). There is no cassette, and the turn's `providers`
override (`src/conversation/turn.ts:87`) takes exactly `{speaker, mind}` with no wrapping seam, so a
recorder must itself implement `LLMProvider` and delegate.

No retrieved source described a JSON-lines agent protocol; the design brief in
[`diagnosis/eval-harness.md`](diagnosis/eval-harness.md) remains the only specification of that piece.

## 5. Adversarial player agents

Nothing retrieved: no claim about red-team players, jailbreak-driving simulated users, spam or
off-topic pressure entered the ledger. The code has a keyword moderator (`moderate()`,
`src/security/moderator.ts:47`, matching `JAILBREAK_PHRASES` at line 15), a moderation-forced
`exit_convo`, and a cooldown applied only when `forcedByModeration` is true
(`src/mcp/exit-handler.ts:60-84`). A red-team persona under Finding 1.1's mechanism is the natural test
for all three; the gap is evidence about what such agents find, not how to run them.

## 6. Reference latency numbers

Nothing retrieved. No Inworld, Convai, NVIDIA ACE Kairos or Ubisoft NEO NPC turn-latency figure
entered this ledger. Generic voice-agent stage budgets (LiveKit, Vapi, Pipecat) sit in the sibling
ledger [`raw/a-voice-turn-pipelines.md`](raw/a-voice-turn-pipelines.md), labelled marketing or
community there; they describe call-center agents, not NPCs, and are not restated as NPC targets. The
target comes from measuring our own path, where the diagnosis already shows about 1.4 s spent before
the LLM sees a word (`src/providers/stt/deepgram.ts:85` plus `src/voice/pipeline.ts:194`).

## Did not survive verification

- **"tau2-bench gates reward on expected actions, not final state"** (1-2,
  https://github.com/sierra-research/tau2-bench). Two verifiers read `docs/evaluation.md` and found the
  opposite as the general rule: `reward_basis` defaults to DB end-state plus COMMUNICATE, the reference
  `actions` are "not a requirement", and the ACTION basis covers only a small subset of banking_knowledge
  tasks. The third confirmed the ACTION evaluator exists and is recall-only. Do not cite tau2-bench as
  precedent for tool-call precision scoring; its default is final-state comparison.
- **"GPT-4 as judge reaches over 80% human agreement, supporting LLM-judge persona scoring"** (1-2,
  https://arxiv.org/abs/2306.05685). The quote is accurate, but the figure is a 2023 MT-Bench/Chatbot
  Arena result with a superseded judge, never measured for persona adherence, and research-only. The
  bias list (position, verbosity, self-enhancement) is carried into Finding 3.2 as design advice only.

## Coverage gaps

- **Sub-question 2, game industry.** Nothing on EA or Ubisoft bot-playtesting, Inworld/Convai/Charisma
  testing tooling, or NEO NPC evaluation. Look next at GDC Vault sessions by Ubisoft La Forge on NEO
  NPC (2024-2025), EA SEED publications on agent-based playtesting, and Inworld/Convai developer docs,
  fetched by hand as Pass D concluded for JS-shell vendor sites.
- **Sub-question 4, other eval frameworks.** Braintrust, Langfuse, inspect_ai and OpenAI evals were not
  retrieved. Their multi-turn and recorded-run documentation is a documentation-retrieval task, not a
  research question.
- **Sub-question 5, adversarial players.** Nothing. The sibling ledger
  [`raw/d-disposition-and-patience.md`](raw/d-disposition-and-patience.md) carries a BailBench finding
  about jailbreaks decoupling refusal from leaving; it was verified for that angle, not this one, and is
  the nearest starting point.
- **Sub-question 6, shipped LLM-NPC latency.** Nothing. NVIDIA's GDC 2025 ACE session is already listed
  as marketing in Pass B; Inworld and Convai latency pages need a manual browser fetch.
- **Unreadable:** https://arxiv.org/pdf/2406.12045 (tau-bench PDF). Its abstract page was readable and is
  what Finding 1.2 corroborates against.

## What this changes

1. **The playground harness gets a player-agent mode, patterned on promptfoo.** The scenario schema
   proposed in [`diagnosis/eval-harness.md`](diagnosis/eval-harness.md) item 2 should carry a
   `player` block: persona and goal template, `maxTurns`, optional seeded history, and a stop sentinel.
   It runs against `runConversationTurn` (`src/conversation/turn.ts:188`) through the same
   `providers` seam `runReplay` uses (`src/eval/replay.ts:157-167`). This is the W4 measurement harness
   PRODUCT.md section 4 calls for.
2. **Every live scenario reports pass^k, not pass^1.** Add a `trials` field to the scenario and report the
   all-k-succeed fraction alongside per-trial results. The existing determinism test
   (`tests/unit/replay-determinism.test.ts`) stays as the stub-mode regression check; pass^k is the
   live-mode number. Any comparison between the current parallel Mind+Speaker and a serial
   `CognitionRuntime` implementation (PRODUCT.md section 3.6) must be a pass^k comparison, because the
   coherence hazards in [`diagnosis/turn-latency-path.md`](diagnosis/turn-latency-path.md) are
   intermittent by nature.
3. **Treat simulated-player results as relative, never absolute.** Given Finding 1.3, pin the player
   model per scenario, record it in the session log (`channel` union at `src/conversation/turn.ts:76-77`
   needs a `playground` value), and never change it between the two builds compared. Human playtests
   cover anything the harness scores as borderline.
4. **Add the missing metrics before the missing infrastructure.** Extend `TurnTimings`
   (`src/conversation/turn.ts:90-99`) with time-to-first-token, and add an exit-correctness check
   (expected exit turn vs. actual `exit_convo` turn) and a hallucinated-reward check (any
   `update_quest`/reward tool argument not present in injected quest state) to `TurnReport`
   (`src/eval/replay.ts:31-61`). A first latency assertion, even a generous one, belongs in
   `tests/unit/deferred-recall-baseline.test.ts`, which today asserts nothing about time.
5. **Build the cassette as a delegating `LLMProvider`.** Because the turn's override takes concrete
   providers (`src/conversation/turn.ts:87`), a recorder that wraps whatever `createLlmProvider`
   returns (`src/providers/llm/factory.ts:16`) and a playback provider reading the cassette are the
   smallest change that gives deterministic CI on real model output without a live key.
6. **Red-team players are a scenario, not a subsystem.** Ship at least one adversarial persona scenario
   (jailbreak phrasing, abuse, spam) as the regression test for `moderate()`
   (`src/security/moderator.ts:47`) and the moderation-only cooldown (`src/mcp/exit-handler.ts:60-84`).
   This also gives the patience work in PRODUCT.md section 3.4 a test target before it is designed.

## Infra candidates

| Name | What it is | Verdict | Why |
|---|---|---|---|
| promptfoo Simulated User provider | Open-source LLM user simulator with maxTurns, seeded history, stop sentinel, rubric scoring | pattern-only | Requires OpenAI chat-format targets and would sit outside our turn loop; copy the scenario shape into our own schema (change 1) rather than adopt the tool. |
| tau-bench / tau2-bench | Text customer-service benchmarks with a simulated user and pass^k | pattern-only | The pass^k metric is adopted (change 2); the task set, policy documents and action-based reward are not relevant, and the action-reward claim was refuted. |
| AgentBench | 8-environment agent benchmark, 2023 | reject | Environments are OS/DB/web tasks; only its three failure headings are borrowed as tags. |
| LLM-as-judge rubric | Model-graded transcript scoring | pattern-only | Relative signal only; the 80% agreement figure did not survive for persona scoring. Randomise order and control for length. |
| VCR-style LLM cassette | Record real provider responses, replay in CI | adopt (build our own) | Pure utility with no external dependency; implemented as a delegating `LLMProvider` (change 5). |
| modl.ai / modl:test | Commercial bot QA platform with Unity/Unreal plugins | reject | Engine-plugin mechanics QA; out of scope for a TS runtime, and marketing-sourced. |

## Sources

- https://www.promptfoo.dev/docs/providers/simulated-user/ - demonstrated (open-source, shipped docs)
- https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents - demonstrated for 2024 numbers; the 80% current-model figure is contested
- https://arxiv.org/abs/2406.12045 - demonstrated (open-source benchmark, mid-2024; PDF unreadable, abstract used)
- https://arxiv.org/pdf/2601.17087 - research-only (ICLR 2026 human-subject study)
- https://arxiv.org/abs/2308.03688 - demonstrated, 2023
- https://modl.ai/what-is-modern-game-testing - demonstrated via secondary source, hosted on a vendor marketing page
- https://github.com/sierra-research/tau2-bench - refuted claim, listed for the record
- https://arxiv.org/abs/2306.05685 - refuted claim for this use, research-only, 2023
