# Raw ledger: LLM player simulators and NPC evaluation harnesses

Angle: LLM player simulators and NPC evaluation harnesses. 45 claims extracted from fetched sources, triaged below. Top 8 survivors carry ids c1..c8 for adversarial verification. Every other claim is listed with its disposition (merged into a surviving claim, or dropped with a stated reason).

Dropped: 21. Coverage gaps: sub-question 5 (adversarial/red-team player agents) has no usable claim anywhere in the fetched set; sub-question 2 (game-industry automated testing) has only a general QA bot-testing claim (modl.ai/Rare) and nothing on EA/Ubisoft playtesting talks, Inworld/Convai/Charisma testing tools, or Ubisoft NEO NPC evaluation specifically.

---

## Surviving claims (c1-c8)

### c1 -- promptfoo Simulated User provider is a ready-made reference harness for persona-driven player-sim testing
- Quote: "facilitates a back-and-forth conversation between a simulated user (controlled by promptfoo) [and] your AI agent."
- URL: https://www.promptfoo.dev/docs/providers/simulated-user/
- Label: demonstrated
- Sub-questions: 1, 4
- Status: kept (c1)
- Corroborating detail folded in from the same URL: persona/goal injection via Nunjucks-templated instructions referencing test variables; a `maxTurns` config bounding new turns after any seeded initial messages (a concrete cost cap); scenarios seedable with a pre-defined conversation history (inline array or `file://`) for deterministic setup; an agent-emitted `###STOP###` sentinel for early, natural conversation exit; conversation-quality scoring via LLM-rubric assertions applied to the transcript; and a hard integration constraint that the target must speak OpenAI-format chat messages (role/content).

### c2 -- tau-bench's pass^k metric: single-shot success is the wrong yardstick for conversational agents
- Quote: "Unlike traditional benchmarks, tau-bench doesn't just test whether an agent can complete a task once; it measures whether it can do so consistently multiple times."
- URL: https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents
- Label: demonstrated
- Sub-questions: 1, 3, 4
- Status: kept (c2)
- Corroborating: arxiv.org/abs/2406.12045 (tau-bench abstract restates the same purpose and introduces pass^k formally; the PDF at arxiv.org/pdf/2406.12045 was unreadable, so this is carried as corroboration rather than independently verified)

### c3 -- LLM-simulated-user evaluations are systematically miscalibrated relative to real users
- Quote: "Evaluations using simulated users exhibit systematic miscalibration, underestimating agent performance on challenging tasks and overestimating it on moderately difficult ones."
- URL: https://arxiv.org/pdf/2601.17087
- Label: demonstrated
- Sub-questions: 1, 3
- Status: kept (c3)
- Corroborating detail folded in from the same URL: success-rate variance of up to 9 percentage points depending solely on which LLM plays the simulated user; AAVE speakers get consistently worse success rates and calibration errors than Standard American English speakers, with the gap widening by age; simulated users are a differentially poor proxy specifically for AAVE and Indian English speakers among the populations tested; and simulated users introduce conversational artifacts, surfacing different failure modes than real human players would.

### c4 -- tau2-bench gates reward on whether the expected actions were taken, not just final state
- Quote: "What evaluation_criteria.actions means, how reward_basis gates the reward, and how to inspect action correctness"
- URL: https://github.com/sierra-research/tau2-bench
- Label: demonstrated
- Sub-questions: 3, 4
- Status: kept (c4)

### c5 -- Strong LLM judges (GPT-4) reach human-level agreement but carry known, controllable biases
- Quote: "strong LLM judges like GPT-4 can match both controlled and crowdsourced human preferences well, achieving over 80% agreement"
- URL: https://arxiv.org/abs/2306.05685
- Label: demonstrated
- Sub-questions: 3
- Status: kept (c5)
- Corroborating detail folded in from the same URL: LLM judges also show documented position, verbosity, and self-enhancement biases plus limited reasoning ability, meaning any judge-based persona-adherence score needs order randomization and length-inflation controls to be trustworthy.

### c6 -- Baseline numbers: GPT-4-class agents fail roughly half of single-run tasks and consistency collapses further under repetition
- Quote: "Even state-of-the-art agents, such as those based on GPT-4, succeeded in fewer than 50% of tasks and struggled with consistency--achieving only ~25% success when repeating the same task eight times."
- URL: https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents
- Label: demonstrated
- Sub-questions: 3, 6
- Status: kept (c6)
- Corroborating: current best models now exceed 80% pass^1 on the easier (retail) domain per the same source, showing rapid progress but continued reliability gaps; arxiv.org/abs/2406.12045 reports the same order-of-magnitude numbers (<50% pass@1, <25% pass^8 on retail) but its PDF was unreadable so it is carried only as corroboration.

### c7 -- AgentBench's failure analysis names three specific causes behind most agent breakdowns
- Quote: "poor long-term reasoning, decision-making, and instruction following abilities are the main obstacles for developing usable LLM agents"
- URL: https://arxiv.org/abs/2308.03688
- Label: demonstrated
- Sub-questions: 1, 3
- Status: kept (c7)

### c8 -- Industry precedent: Rare used automated bots to surface player-interaction edge cases and screenshot-based visual regressions
- Quote: "Rare deployed bots to simulate complex player interactions, uncovering edge-case bugs human testers might miss."
- URL: https://modl.ai/what-is-modern-game-testing
- Label: community
- Sub-questions: 2
- Status: kept (c8)
- Corroborating detail folded in from the same URL: the same pipeline used automated screenshot capture plus AI-driven visual analysis to catch graphical regressions in CI, a distinct check from bot-driven interaction testing.

---

## Full ledger (all 45 claims)

| # | Claim (short) | Quote | URL | Label | Sub-Qs | Status |
|---|---|---|---|---|---|---|
| 1 | tau2-bench domains each have a distinct agent tool set, user-sim tool set, and policy docs | "A set of user tools for the user simulator" | https://github.com/sierra-research/tau2-bench | demonstrated | 1,4 | dropped: background/generic description, no design signal beyond c4 |
| 2 | tau2-bench spans multiple domains incl. telecom and a knowledge/RAG domain | "Available domains: mock airline retail telecom banking_knowledge" | https://github.com/sierra-research/tau2-bench | demonstrated | 1,4 | dropped: off-angle domain breadth, not decision-relevant |
| 3 | tau2-bench's knowledge domain simulates a RAG/document-search pipeline | "configurable RAG pipelines, document search, embeddings, and agentic shell-based search" | https://github.com/sierra-research/tau2-bench | demonstrated | 1,4 | dropped: background, generic RAG description already assumed |
| 4 | tau2-bench gates reward via evaluation_criteria.actions / reward_basis | "What evaluation_criteria.actions means, how reward_basis gates the reward..." | https://github.com/sierra-research/tau2-bench | demonstrated | 3,4 | kept (c4) |
| 5 | tau2-bench required 75+ task fixes, signaling hand-authored eval-task fragility | "75+ task fixes" | https://github.com/sierra-research/tau2-bench | demonstrated | 3,4 | dropped: vague/unfalsifiable number, no context for what the fixes entailed |
| 6 | tau-bench's core idea: score consistency across repeated trials, not one-shot success | "Unlike traditional benchmarks, tau-bench doesn't just test whether an agent can complete a task once..." | https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents | demonstrated | 1,3,4 | kept (c2) |
| 7 | tau-bench's tool-agent-user loop: agent gathers info, checks policy, then acts | "the agent needs to gather all the required information by interacting with the user, check the airline policies..." | https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents | demonstrated | 1,2,4 | dropped: background restatement of the user-sim+agent+policy pattern already covered by c1/c4 |
| 8 | GPT-4-class agents: less than 50% pass at 1, about 25% pass at 8 at launch | "Even state-of-the-art agents, such as those based on GPT-4, succeeded in fewer than 50% of tasks..." | https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents | demonstrated | 3,6 | kept (c6) |
| 9 | Current best models now exceed 80% pass at 1 on the easier retail domain | "The best models are now crossing 80% pass^1 in the easier domain (retail)." | https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents | demonstrated | 3,6 | merged-into c6 |
| 10 | tau-bench abstract: evaluates agents on user interaction and policy adherence via an LLM-played user | "language agents on their interaction with human users or ability to follow domain-specific rules" | https://arxiv.org/abs/2406.12045 | research-only | 1 | merged-into c2 (PDF at arxiv.org/pdf/2406.12045 unreadable; duplicate of c2's purpose statement) |
| 11 | tau-bench scores success by comparing final DB state to an annotated goal state | "compares the final database state after a conversation against the target goal state" | https://arxiv.org/abs/2406.12045 | research-only | 1,3 | dropped: source unreadable (arxiv PDF), distinct scoring detail not independently verifiable |
| 12 | tau-bench introduces pass^k to measure reliability across repeated trials | "pass^k to measure agent reliability across multiple trials" | https://arxiv.org/abs/2406.12045 | research-only | 1,3 | merged-into c2 (PDF unreadable; duplicate of c2) |
| 13 | GPT-4o-class agents succeed on less than 50% of tasks; pass at 8 retail under 25% | "succeed on less than 50% of tasks" | https://arxiv.org/abs/2406.12045 | research-only | 1,3,6 | merged-into c6 (PDF unreadable; duplicate numbers of c6) |
| 14 | tau-bench's stated purpose: expose inconsistent agent behavior across repeated identical tasks | "act consistently and follow rules reliably" | https://arxiv.org/abs/2406.12045 | research-only | 1,3 | dropped: source unreadable (arxiv PDF), restates purpose already in c2 |
| 15 | Success-rate variance up to 9 percentage points depending on which LLM plays the user | "Agent success rates varying up to 9 percentage points across different user LLMs" | https://arxiv.org/pdf/2601.17087 | demonstrated | 1,4 | merged-into c3 |
| 16 | Simulated-user evals are systematically miscalibrated (under/over-estimate by difficulty) | "Evaluations using simulated users exhibit systematic miscalibration..." | https://arxiv.org/pdf/2601.17087 | demonstrated | 1,3 | kept (c3) |
| 17 | AAVE speakers get worse success rates/calibration than SAE speakers, widening with age | "AAVE speakers experience consistently worse success rates and calibration errors than Standard American English speakers..." | https://arxiv.org/pdf/2601.17087 | demonstrated | 1,3 | merged-into c3 |
| 18 | Simulated users are the worst proxy specifically for AAVE and Indian English speakers | "Simulated users to be a differentially effective proxy for different populations, performing worst for AAVE and Indian English speakers." | https://arxiv.org/pdf/2601.17087 | demonstrated | 1,3 | merged-into c3 |
| 19 | Simulated users introduce artifacts and surface different failure modes than humans | "Simulated users introduce conversational artifacts and surface different failure patterns than human users." | https://arxiv.org/pdf/2601.17087 | demonstrated | 1,3,4 | merged-into c3 |
| 20 | Study included a live human-user comparison across 4 countries on tau-Bench retail | "The study tested these claims on tau-Bench retail tasks with a user study across the United States, India, Kenya, and Nigeria." | https://arxiv.org/pdf/2601.17087 | demonstrated | 1 | dropped: methodology detail, not independently decision-changing beyond c3's headline finding |
| 21 | AgentBench evaluates agents across 8 distinct interactive environments | "multi-dimensional benchmark that consists of 8 distinct environments..." | https://arxiv.org/abs/2308.03688 | demonstrated | 1 | dropped: background, duplicate of #30 (github), superseded by c7 |
| 22 | Large capability gap between top commercial LLMs and open-source models up to 70B as agents | "significant disparity in performance between them and many OSS competitors that are no larger than 70B" | https://arxiv.org/abs/2308.03688 | demonstrated | 1 | dropped: off-angle, model-selection finding rather than eval-harness design |
| 23 | AgentBench's failure taxonomy: reasoning, decision-making, instruction-following | "poor long-term reasoning, decision-making, and instruction following abilities are the main obstacles..." | https://arxiv.org/abs/2308.03688 | demonstrated | 1,3 | kept (c7) |
| 24 | Multi-round alignment data helps agent performance; code training has ambivalent effects | "Improving instruction following and training on high quality multi-round alignment data could improve agent performance..." | https://arxiv.org/abs/2308.03688 | demonstrated | 1 | dropped: off-angle, training/fine-tuning advice rather than eval-harness design |
| 25 | AgentBench releases its environments, datasets, and evaluation package publicly | "Datasets, environments, and an integrated evaluation package for AgentBench are released." | https://arxiv.org/abs/2308.03688 | demonstrated | 4 | dropped: background, redundant with more specific #31 |
| 26 | GPT-4 as judge reaches 80%+ agreement with human preference judgments | "strong LLM judges like GPT-4 can match both controlled and crowdsourced human preferences well, achieving over 80% agreement" | https://arxiv.org/abs/2306.05685 | demonstrated | 3 | kept (c5) |
| 27 | LLM judges show position, verbosity, self-enhancement bias and limited reasoning | "position, verbosity, and self-enhancement biases, as well as limited reasoning ability" | https://arxiv.org/abs/2306.05685 | demonstrated | 3 | merged-into c5 |
| 28 | MT-Bench is a multi-turn question set for conversational/instruction-following ability | "a multi-turn question set" | https://arxiv.org/abs/2306.05685 | demonstrated | 3,4 | dropped: background description of a benchmark artifact, secondary to c5's judge-reliability finding |
| 29 | Chatbot Arena is a crowdsourced pairwise-battle platform yielding a large preference dataset | "a crowdsourced battle platform" | https://arxiv.org/abs/2306.05685 | demonstrated | 3,4 | dropped: background/off-angle, alternative method not adopted for our CI harness |
| 30 | AgentBench evaluates across a diverse spectrum of interactive environments | "LLM-as-Agent across a diverse spectrum of different environments" | https://github.com/THUDM/AgentBench | demonstrated | 1,4 | dropped: duplicate of #21, background |
| 31 | AgentBench's 8 environments split 5 new + 3 adapted from prior benchmarks | "Operating System (OS), Database (DB), Knowledge Graph (KG), Digital Card Game (DCG), Lateral Thinking Puzzles (LTP)" | https://github.com/THUDM/AgentBench | demonstrated | 1 | dropped: background composition detail, secondary to c7 |
| 32 | AgentBench requires about 4k (dev) / 13k (test) LLM generations to run | "The multi-turn interaction requires an LLMs to generate around 4k and 13k times respectively" | https://github.com/THUDM/AgentBench | demonstrated | 4 | dropped: useful CI-cost data point but secondary priority to c1/c4 for sub-Q4 coverage |
| 33 | modl:test automates QA by deploying bots to explore game environments and find bugs | "modl:test automates QA by deploying bots to explore game environments and detect bugs." | https://modl.ai/what-is-modern-game-testing | marketing | 2 | dropped: marketing claim, superseded by the concrete Rare case study (c8) |
| 34 | modl:test integrates as Unity/Unreal engine plugins | "seamless plugins for Unity and Unreal" | https://modl.ai/what-is-modern-game-testing | marketing | 2 | dropped: off-angle, engine-plugin mechanism irrelevant to our TS backend runtime |
| 35 | Rare used bots to simulate complex player interactions and surface edge-case bugs | "Rare deployed bots to simulate complex player interactions, uncovering edge-case bugs human testers might miss." | https://modl.ai/what-is-modern-game-testing | community | 2 | kept (c8) |
| 36 | Rare also used automated screenshot capture plus AI visual analysis for graphical regressions | "automated screenshots and AI-driven analysis" | https://modl.ai/what-is-modern-game-testing | community | 2 | merged-into c8 |
| 37 | Survey: 77% of developers didn't do enough QA on their latest release | "77% of developers didn't conduct enough QA for latest releases" | https://modl.ai/what-is-modern-game-testing | marketing | 2 | dropped: unfalsifiable marketing survey stat, weak sourcing |
| 38 | Survey: 94% of developers believe AI will be critical to QA's future | "94% believe AI will play critical role in future QA" | https://modl.ai/what-is-modern-game-testing | marketing | 2 | dropped: unfalsifiable marketing sentiment stat, not evidence of capability |
| 39 | promptfoo's Simulated User provider runs a scripted back-and-forth between an LLM user-sim and the target agent | "facilitates a back-and-forth conversation between a simulated user (controlled by promptfoo) [and] your AI agent." | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 1,4 | kept (c1) |
| 40 | Simulated-user behavior is driven by Nunjucks-templated instructions referencing test variables | "Template for user instructions. Supports Nunjucks templating with access to test variables." | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 1,4 | merged-into c1 |
| 41 | Conversation length is bounded by a maxTurns config counting only post-seed turns | "`maxTurns` controls the number of **new** conversation turns to simulate AFTER the initial messages." | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 4 | merged-into c1 |
| 42 | Scenarios can be seeded with a pre-defined conversation history (inline or file://) | "Pre-defined conversation history to start from. Can be an array of messages or a `file://` path." | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 4 | merged-into c1 |
| 43 | Conversation can end early via an agent-emitted ###STOP### sentinel | "The agent includes `###STOP###` anywhere in its response." | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 3,4 | merged-into c1 |
| 44 | Conversation quality is scored via LLM-rubric assertions on the transcript | "You can add assertions to automatically evaluate conversation quality" | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 3 | merged-into c1 |
| 45 | The provider requires the target to speak OpenAI-format chat messages | "assumes that the target endpoint accepts messages in OpenAI chat format" | https://www.promptfoo.dev/docs/providers/simulated-user/ | demonstrated | 4 | merged-into c1 |

---

## Unreadable sources

- https://arxiv.org/pdf/2406.12045 -- PDF fetch failed; claims 10-14 above (drawn from the HTML abstract page arxiv.org/abs/2406.12045, which is the same paper but was readable) are treated as unverified duplicates/background relative to c2 and c6, and this PDF URL specifically could not be retrieved for direct quote verification.
