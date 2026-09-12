# research/

Industry research backing the decisions in [`../PRODUCT.md`](../PRODUCT.md). Everything here is
reference material to develop against — read it before re-litigating a decision it already answered.

## Conventions

- One file per research pass: `NN-<topic>.md`.
- Every claim carries its source. Vendor marketing is labelled as marketing, demonstrated results are
  labelled as demonstrated, and research-only techniques that nobody has shipped are labelled as such.
- Each file ends with **"What this changes"** — the specific `PRODUCT.md` decisions the findings
  support, contradict, or unblock. That section is the point of the document; the rest is evidence.
- When a pass resolves an `OPEN` decision, update `PRODUCT.md` and link back to the file here.

## Index

| File | Pass | Covers | Status |
|---|---|---|---|
| `01-commercial-and-topology.md` | A | Competitor topology, API-key handling, one-core-many-engines, marketplace rules, pricing, licence enforcement (`PRODUCT.md` §5 Q1-Q7) | **done** — Q1-Q2 answered decisively, Q3-Q7 returned nothing |
| `03-marketplace-and-multi-engine.md` | C1 | Unity/Fab/Godot marketplace rules, Verify Invoice, multi-engine SDK architecture, pricing and revenue splits, licence enforcement (re-run of Q3-Q7) | **done** — Unity/Fab/Godot rules answered decisively; multi-engine, pricing comparables and middleware enforcement **un-researched** (search budget exhausted) |
| `04-game-prior-art-actions-and-evolution.md` | C2 | Composing vs terminating actions, action arbitration, results flowing back into dialogue, bounded designer-controlled evolution, memory pruning (re-run of Q10-Q11 against game-industry prior art) | **done** — action layer answered with shipped precedent; **character evolution returned nothing for the second time** (sourcing failure, targets named) |
| `02-agent-architecture-and-actions.md` | B | Cognition architecture and recall latency, action/tool layer design, actions in dialogue, designer-controlled evolution, memory pruning, deployment shapes (`PRODUCT.md` §5 Q8-Q12) | **done** — Q8-Q9 answered, Q10-Q12 returned nothing |

| `05-multi-engine-sdk-architecture.md` | D1 | How PlayFab, RevenueCat and Steamworks share a core across platforms, and what that means for porting cognition to Unreal/Godot | **done** — answered; pricing and licence enforcement failed for the third time |

| `06-bounded-evolution-and-memory-pruning.md` | D2 | What changes vs what is fixed in RimWorld, CK3, Dwarf Fortress and The Sims; what bounds drift; whether subsystem toggles exist; memory pruning as authored data | **done** — answered on the third attempt, after permitting community wikis as provenance-labelled evidence |

| `07-pricing-and-comparables.md` | manual | Convai, Inworld, Charisma, Photon pricing and Unity Asset Store comparables, fetched by hand in a rendered browser | **done** — answered after three harness failures |

| `08-middleware-licence-enforcement.md` | manual | What FMOD, Wwise, SpeedTree and Simplygon actually require for licence enforcement | **done** — closes the last research gap; revises `D3` |

| [`09-npc-runtime/`](09-npc-runtime/) | E | Replacement for the parallel Mind+Speaker cognition (single streamed turn), knowledge tiers and world events as a scoped fact table, quest-state tool gating, patience ladder, role-play persona practice, LLM player simulators and the playground harness — six angle files (`a-` to `f-`), four code diagnoses in `diagnosis/`, claim ledgers in `raw/`, verdict in [`PROPOSAL.md`](09-npc-runtime/PROPOSAL.md), measured baseline of the parallel runtime in [`BASELINE.md`](09-npc-runtime/BASELINE.md) | **done** 2026-09-12 — 35/48 claims survived a three-lens adversarial check; empty sub-questions are listed per file under "Coverage gaps" as manual browser fetches |

## Decisions waiting on this

| ID | Decision | State after passes A and B |
|---|---|---|
| D2 | Runtime topology | **DECIDED — Option B** (fat client + developer-run key broker), 2026-09-05 |
| D6 | Multi-engine scope and timing | **Answered by D1.** No vendor shares behavioural logic across engines. Decision still open. |
| D11 | Deployment shape to optimize for | **Answered 2026-09-12 in Pass E scoping:** few-and-deep (quest-giver / companion, 1-2s) with voice first-class and text as fallback. Record in `PRODUCT.md` §6 when the Pass E proposal is approved. |
| D12 | **Pass C** | **Done.** C1: marketplace rules. C2: action layer. |
| D13 | **Pass D, commercial half** | **Split.** Multi-engine **answered** in `05-...md`. Pricing and licence enforcement **failed a third time** — and this time budget was not the cause. Pricing pages are JS shells and bot-protected (Fab 403'd automated fetches in C1). **Stop using the research harness for these**: it is a bounded list of about a dozen URLs, so fetch them by hand in a browser session. |
| D14 | **Pass D, evolution half** — bounded, designer-controlled character change | **ANSWERED.** Previously failed twice. Diagnosed as sourcing, not absence. Target by name: Monolith's GDC Nemesis talks, Tynan Sylvester's RimWorld writing and *Designing Games*, Paradox CK3 dev diaries, Sims 4 emotion GDC material, AI and Games essays on Nemesis and Radiant AI. **Explicitly permit community wikis and video essays, labelled as such** — these systems are documented far better there than in first-party engineering sources, which is why two first-party-only passes found nothing. |
| D15 | Action-layer architecture | **Proposed** in `PRODUCT.md` §3.7 from Pass C2, awaiting confirmation |
| D16 | Cognition runtime v2 — one streamed LLM call owning speech, tools and recall, behind `PRODUCT.md` §3.6 | **Proposed** in [`09-npc-runtime/PROPOSAL.md`](09-npc-runtime/PROPOSAL.md) §2 from Pass E; closes §5 Q8. Awaiting approval |
| D17 | Playground harness surface — JSON-lines `play` mode on the existing `npm run npc` CLI | **Proposed** in [`09-npc-runtime/PROPOSAL.md`](09-npc-runtime/PROPOSAL.md) §4. Awaiting approval |

## Pass C — the unanswered questions

Both passes failed on the same *kind* of question, which points at framing rather than absence of
evidence. Q3-Q7 (multi-engine architecture, Unity/Fab/Godot marketplace rules, pricing, licence
enforcement) are **documentation-retrieval** problems that were searched as though they were open
research questions. Q10-Q11 (actions in dialogue, designer-controlled evolution) need **game-industry**
prior art — The Sims traits and aspirations, Crusader Kings, Shadow of Mordor's Nemesis system, RimWorld
— rather than agent papers.

**Resolved by C1.** Unity's Submission Guidelines not only permit Option B, §1.5.b **requires** it — API
keys may not be stored in a way that puts them in the build. The Provider Agreement remains unresolved
and needs a manual end-to-end read.
