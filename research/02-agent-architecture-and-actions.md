# 02 — Agent architecture, in-world actions, designer-controlled evolution

**Pass B.** Run 2026-09-05. 106 agents, 5 search angles, 24 sources fetched, 120 claims extracted,
top 25 put through 3-vote adversarial verification. **8 findings survived.**

Covers [`../PRODUCT.md`](../PRODUCT.md) §5 Q8-Q12.

---

## How to read this

The verification stage killed most of what the search stage found. That is the headline, and the
direction of the collapse is itself the answer to the main question.

**One critical reading rule, carried from the harness:** *refuted* here means **"not established by
this pass"** — it does **not** mean "the opposite is true." Several refutations are of the form "no
verifier could substantiate the source," which is a statement about evidence, not about reality.
Do not read a 0-3 vote as proof of a negative.

---

## Q8 — Cognition architecture: is parallel fast-responder / slow-reasoner a real pattern?

### The research does not validate the current design. It names its failure class.

**Finding 1 — `high` confidence, 3-0 unanimous.** Altera's PIANO paper (Project Sid,
[arXiv 2411.00114](https://arxiv.org/abs/2411.00114)) documents concurrent cognition modules
primarily as a **coherence hazard**, not a recommended pattern. Verified verbatim in two independent
renderings:

> "An immediate challenge with concurrent modules is that they can produce independent outputs, making
> the agent incoherent. For instance, agents say one thing but actually do something else."

Their worked example: agent Abby's chat module replies "Sure thing!" to a request for a pickaxe while
her independent function-calling module selects `explore`. Their fix is a **Cognitive Controller** that
makes the high-level decision through an information bottleneck and then strongly conditions the
talk-related modules on it — **coherence is bought by inserting a serial dependency**, not by leaving
modules independent.

**Three qualifications that must travel with this finding:**

1. **The mapping to SoulEngine is inference, not the paper's claim.** PIANO's symptom is *within-turn
   contradiction* (say A, do B). SoulEngine's symptom is *staleness* (the memory answer arrives a turn
   late). The shared root cause — an output not conditioned on a concurrent module's state — makes the
   mapping defensible, but it is analyst inference and is labelled as such.
2. PIANO does **not** solve the latency problem. It solves coherence, at the cost of serialization.
3. PIANO is a research system in Minecraft, not a shipped real-time conversational product.

### Everything asserting the opposite was refuted, and one source appears not to exist

**Finding 2 — NEGATIVE RESULT.** Seven claims asserting that a parallel fast/slow split is an
established, published, or shipped architecture for real-time conversational agents were refuted, six
of them unanimously. So were all claims of a working technique for getting retrieved memory into the
reply without serial latency — speculative retrieval, prefetch on utterance start, retrieval during
ASR, small local recall models.

**The strongest signal in the entire pass:** three separate claims traced to a single source,
`arXiv 2603.02206`, and **all three failed because no verifier could substantiate that source.** The
specific numbers that collapsed with it — a "75% prefetch hit rate," "110ms to 0.35ms," a "316x
speedup" — should be treated as **unsupported**. Do not design against them.

> **What this means for the third overhaul:** the literature will not make this decision for you. It
> does not endorse the current parallel design, and it does not supply a validated alternative. This is
> the strongest argument yet for building the W4 measurement harness *first* — you cannot borrow
> someone else's answer here, so you have to generate your own numbers.

### Stanford Generative Agents is history, not a template

**Finding 3 — `high`, 3-0.** Not viable as-is for the ambient shape or the real-time shape, by the
authors' own disclosure ([arXiv 2304.03442](https://arxiv.org/abs/2304.03442), §8.2, verbatim):

> "The present study required substantial time and resources to simulate 25 agents for two days,
> costing thousands of dollars in token credits and taking multiple days to complete."

Multiple days of wall clock for two sandbox days is roughly **three orders of magnitude off real
time**. The same section places real-time interactivity in *future work*, not in what was built. This
is a peer-reviewed primary source disclosing a limitation against its own interest — no secondary
source can unsay it.

---

## Q9 — Action / tool layer design

### The seminal prototype's action layer is obsolete

**Finding 4 — `high`, 3-0.** In Generative Agents, in-world actions were emitted as **free-form natural
language** and bound to world state by a **post-hoc LLM translation pass** — not a structured
tool/function schema. A model converted the action string into emojis above the avatar, decided the
resulting object-state mutation ("idle" → "brewing coffee"), and picked a destination by flattening
part of a stored environment tree into natural language and prompting the model to traverse it.
Classical pathfinding handled locomotion only.

This predates function calling by roughly two months. **Read it as history, not as practice.** Anyone
citing it as the model for a modern action layer is citing a workaround for a capability that now
exists.

### The transferable prior art is pre-LLM, and it is a status taxonomy

**Finding 5 — `high`, 3-0.** Behavior trees supply a minimal fixed taxonomy that directly answers the
blocking-vs-non-blocking question. Every node — LLM-backed or classical — is ticked by its parent and
returns exactly one of `SUCCESS`, `FAILURE`, `RUNNING`, where `RUNNING` means the node is still working,
possibly asynchronously. **Concurrency is expressed in the return value, not in a separate
action-scheduling subsystem.** Dendron
([arXiv 2404.07439](https://arxiv.org/abs/2404.07439)) organizes nodes as action / condition / control,
with two control primitives (sequence, fallback), and structurally forbids condition nodes from
returning `RUNNING`.

> **Sharp caveat, and it is the one that matters for your question.** `RUNNING` buys **resumable
> long-running actions**. It does **not** buy **concurrent composition**. "Show anger *while* talking"
> is not what this taxonomy solves. Your `throw_wallet` + `show_anger` + speech-at-the-same-time case
> is not answered by behavior-tree status alone.

**Finding 6 — `medium`, 2-1.** Blackboard-mediated composition is the prior art for wiring model output
into concrete engine capabilities. LLM invocations are wrapped as ordinary action nodes whose `tick()`
reads input from and writes output to a shared key-value blackboard; the blackboard, rather than
direct node-to-node calls, is the primary channel for state beyond the tick/status interface. Adding a
new modality requires only a blackboard slot plus a processor.

### Do not dump complete world state into the NPC's context

**Finding 7 — `medium`, 3-0.** Counter-intuitive and directly actionable. On the GroundAct benchmark
([arXiv 2508.05614](https://arxiv.org/abs/2508.05614) — 1,500 scenarios, 16,592 task instances, 11
domains, 15 models from 3B to 671B), providing **complete** environment graphs:

| Task type | Effect of complete world state |
|---|---|
| Tool use | **+27.6 pp** (Qwen2.5-72B: 56.4% → 84.0%) |
| Implicit collaboration | **−22.9 pp** (Qwen2.5-72B: 65.4% → 42.5%; −9.0 pp on DeepSeek-V3) |

The authors' mechanism: *"complete state surfaces task-irrelevant attributes that obscure whether
collaboration is physically required"* — **agents bottleneck on filtering state, not only on retrieving
it.** Direction holds at every model scale; magnitude varies. Both headline figures come from the model
that maximizes each effect.

> This says the action layer needs a **relevance filter over world state**, not a firehose — and that
> "give the NPC more context" can actively make social reasoning worse.

### On-device small models: real deployment, unquantified claims

**Finding 8 — `low`, 2-1.** NVIDIA's ACE GDC 2025 session on Meaning Machine's *Dead Meat* is a
demonstrated on-device deployment of a fine-tuned SLM for NPC dialogue on a consumer-grade GPU. But the
character-depth-parity assertion is **unquantified vendor marketing**: no latency, token, tokens/sec,
VRAM, or A/B quality measurement appears in the public session abstract or any secondary coverage, and
the game was unreleased as of verification. NVIDIA's own SLM blog gives ~2 GB VRAM for an INT4
Nemotron-4 4B but never mentions this game; the Minitron 1.2× throughput figure is measured on an H100,
a datacenter part, not the consumer GPU under discussion.

---

## Q10 and Q11 — NOT ANSWERED

**Zero claims survived verification** for actions-in-dialogue (Q10) and designer-controlled evolution
(Q11). This pass did not answer them.

That is a real gap, not a soft one — Q11 is the question behind the per-subsystem evolution toggles
(`PRODUCT.md` §3.4), which is a decided feature with no external prior art behind it yet. Likely cause:
the search angles collapsed both questions into one ("Bounded, auditable character evolution and memory
pruning controls"), and the surviving evidence base skewed toward architecture papers.

**Recommended follow-up (Pass C), framed differently:**
- Q10 as a *structured-output* problem — constrained decoding, JSON-mode tool emission alongside
  streaming prose, and the specific failure of models narrating stage directions instead of emitting
  actions. (You already ship `stripNarration()` as a band-aid for exactly this.)
- Q11 aimed at *game-industry* prior art rather than agent papers — The Sims' trait and aspiration
  systems, Crusader Kings character traits, Shadow of Mordor's Nemesis system, RimWorld traits/moods —
  all of which solved bounded, designer-authored, auditable character change without LLMs.

---

## Q12 — Memory pruning and deployment shapes

Partially answered, and only in the negative: Generative Agents is confirmed non-viable for the ambient
and real-time shapes (Finding 3). No surviving source supplied token/cost/latency budgets per
deployment shape. **`D11` remains open.**

---

## What this changes

| PRODUCT.md | Effect |
|---|---|
| §2 Contradiction 3 (mind overhauled twice on feel) | **Reinforced, and sharpened.** The literature neither endorses the parallel split nor supplies a validated alternative — and the numbers that looked like an alternative came from a source that could not be substantiated. There is nothing to copy. Build the harness. |
| §4 W4 (harness before overhaul) | **Promoted from "recommended" to "the only defensible path."** |
| §3.6 swappable cognition interface | **Supported.** PIANO's remedy is a serial bottleneck conditioning downstream modules; that is a different `CognitionRuntime` implementation, not a different product. The interface is what lets you try it. |
| Action layer design (backlog 6.8 rename, and beyond) | Adopt the behavior-tree status taxonomy (`SUCCESS`/`FAILURE`/`RUNNING`) plus a blackboard as the composition channel — **but note it does not solve concurrent composition**, which is the case you actually asked about. Add a relevance filter over world state rather than injecting it whole (Finding 7). |
| §3.4 per-subsystem evolution toggles | **Unvalidated.** Q11 returned nothing. Needs Pass C against game-industry prior art. |
| `D11` deployment shape | Still open. |

## Sources that survived verification

- Altera, *Project Sid / PIANO* — https://arxiv.org/abs/2411.00114
- Park et al., *Generative Agents* (UIST 2023) — https://arxiv.org/abs/2304.03442
- Kelley, *Behavior Trees Enable Structured Programming of Language Model Agents* (Dendron) — https://arxiv.org/abs/2404.07439
- *GroundAct: Can LLM Agents Ground Actions in Environmental States?* — https://arxiv.org/abs/2508.05614
- NVIDIA ACE GDC 2025 session (Meaning Machine, *Dead Meat*) — https://www.nvidia.com/en-us/on-demand/session/gdc25-gdc1010/ — *treat as marketing*

## Source that could NOT be substantiated

- `arXiv 2603.02206` — carried three claims, all refuted, no verifier could confirm it. **Any figure
  sourced to it is unsupported.**
