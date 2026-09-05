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

## Decisions waiting on this

| ID | Decision | State after passes A and B |
|---|---|---|
| D2 | Runtime topology | **DECIDED — Option B** (fat client + developer-run key broker), 2026-09-05 |
| D6 | Multi-engine scope and timing | Still blocked — Q3 returned nothing |
| D11 | Deployment shape to optimize for | Still open — no per-shape budgets survived |
| D12 | **Pass C** | **Done.** C1: marketplace rules. C2: action layer. |
| D13 | **Pass D, commercial half** — multi-engine SDK architecture, comparable pricing, middleware licence enforcement | **Open.** C1 exhausted its 200/200 search budget before reaching these. Re-run by direct URL: `photonengine`, PlayFab SDKs, `RevenueCat/purchases-unity`, AudioKinetic/FMOD integration layers, `Steamworks.NET`, and vendor pricing pages. |
| D14 | **Pass D, evolution half** — bounded, designer-controlled character change | **Open, and failed twice.** Diagnosed as sourcing, not absence. Target by name: Monolith's GDC Nemesis talks, Tynan Sylvester's RimWorld writing and *Designing Games*, Paradox CK3 dev diaries, Sims 4 emotion GDC material, AI and Games essays on Nemesis and Radiant AI. **Explicitly permit community wikis and video essays, labelled as such** — these systems are documented far better there than in first-party engineering sources, which is why two first-party-only passes found nothing. |
| D15 | Action-layer architecture | **Proposed** in `PRODUCT.md` §3.7 from Pass C2, awaiting confirmation |

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
