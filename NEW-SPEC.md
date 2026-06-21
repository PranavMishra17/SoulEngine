# SoulEngine — Product Spec (NEW-SPEC)

> **What this is:** a forward-looking feature spec for turning SoulEngine from a sophisticated prototype into a *product*. This is the **build-what-makes-it-great** companion to [`AUDIT.md`](AUDIT.md) (which is fix-what-exists). Where a feature depends on an audit fix, it is cross-referenced as `→ AUDIT Tier N`.
> **Lens:** every feature is evaluated twice — as a *web/backend capability* and as its *in-engine translation*, because the destination is "an importable asset package for game engines."

---

## North Star

> **Give any game living, memory-bearing NPCs — authored once on the web, dropped into any engine as first-class project assets, running with predictable cost and graceful offline behavior.**

Three promises that should be true for every feature below:
- **Authored once, used anywhere** — a designer builds an NPC on the web; it appears in Unity/Unreal/Godot as a versioned asset, not a hand-copied ID string.
- **Predictable & safe** — a studio can see and cap cost, reproduce behavior in a build, and trust the safety layer.
- **Alive, not scripted** — NPCs remember, evolve, relate to each other, and *act* — and the engine can react to that (animation, VO, world state).

The current model — `project → NPC definition → instance(per player)` — is a solid spine. The product is the **integration, predictability, and depth** layered on top of it.

---

## Horizon 1 — "Make it a usable product" (Now)

These convert the existing backend into something a studio can actually adopt.

### 1.1 The Engine SDK (Unity-first, protocol-portable)

**Problem.** A separate `Unity-SoulEngine/` client project exists (out of scope for the webapp audit), but **this webapp exposes no stable, versioned contract for it to bind to** — the API is unversioned, prod voice is broken, and the `/api/sync/*` backend the SDK assumes is absent from this branch (`→ AUDIT Tier 5.1, 5.2`). From a game dev's seat, there is no clean, supported adoption path yet.

**Proposal.** Don't build a client from scratch — **the Unity client largely exists** (`SoulEngineBootstrapper`, `NPCConversationController`, `GameToolHandler`, `SoulEngineConfig`, full `Core/` cognition, `CloudSync/`). The work is to make it *serviceable and shippable*:
- Stand up the `/api/sync/*` backend it calls (`→ AUDIT Tier 5.1`) and pin both sides to a **versioned protocol** (`→ AUDIT Tier 2.1, 2.7`).
- Decide the client's posture: **fat/offline-first** (current — full C# runtime) vs **thin** (delegate cognition to the server). Document it; don't leave it accidental.
- Package as UPM / `.unitypackage` with a Setup wizard (`→ AUDIT Tier 5.7`).

**In-engine translation.** The drop-in MonoBehaviours already exist — `SoulEngineBootstrapper` (project/scene singleton), `NPCConversationController` (per-NPC), `GameToolHandler` (game-event tools). Finish the loop: a designer adds the component, picks an NPC, hits play, and it talks — online or offline.

**Why it's the keystone.** The client is 80% there; the missing 20% (sync backend, versioned contract, packaging) is what blocks every game dev today.

---

### 1.2 NPC-as-Asset binding & editor sync

**Problem.** NPC identity is an opaque string (`npc_abc123`) hand-copied into scenes. A web rename/delete silently breaks the game; there's no compile-time link.

**Proposal.** An importer that materializes server NPC definitions as **versioned ScriptableObjects** with a stable `GUID ↔ npcId` binding, plus a one-click "Sync from SoulEngine" that diff-updates assets (showing what changed: backstory, voice, traits). Definitions become real project assets that live in version control alongside the game.

**In-engine translation.** `Assets/SoulEngine/NPCs/*.asset` — browsable in the Project window, referenceable by drag-and-drop, diffable in the engine's own version control. The "designed on web, played in engine" loop finally closes.

**Depends on** `→ AUDIT Tier 2.5` (versioned data contract), `Tier 5.3`.

---

### 1.3 Unified real-time Event Bus

**Problem.** Conversation text comes over HTTP; Mind/tool/voice events come over a (broken) WS; game-event tools have no reliable push path. A game can't currently learn "the NPC just invoked `lock_door`" in a dependable, ordered way.

**Proposal.** One versioned, server-push channel (same-port WS or SSE — `→ AUDIT Tier 2.3`) carrying a typed event envelope:
`npc_speak` · `npc_follow_up` · `tool_call` · `mind_activity` · `mood_change` · `memory_formed` · `cycle_completed` — each with sequence numbers, idempotency keys, and acks.

**In-engine translation.** C# events on `NPCCharacter`: `OnSpeak`, `OnToolCall`, `OnMoodChanged`, `OnMemoryFormed`. The game subscribes once and reacts — play VO, trigger an animation, actuate a door, update a quest. This is the seam where "the NPC is alive" becomes visible in gameplay.

---

### 1.4 Cost & Usage Dashboard (and per-turn cost model)

**Problem.** Usage is *tracked* but never *surfaced* or *enforced*; the `limits` JSONB is modeled and ignored (`→ AUDIT Tier 5.6`). A studio can't predict spend, and every turn silently costs ≥2 LLM calls (`→ AUDIT Tier 5.5`).

**Proposal.** A dashboard showing tokens + $ per NPC / per session / per cycle, with projections ("at current rate, 10k DAU ≈ $X/mo"), plan limits, and alerts. Pair with a documented **per-turn cost model** and a **Mind pre-gate** so trivial turns ("hi") don't pay for the second LLM call.

**In-engine translation.** A `SoulEngine Inspector` panel in the editor surfaces live cost while play-testing, so designers feel the cost of "chatty" NPCs before shipping.

---

### 1.5 Guided authoring — "First NPC in 60 seconds"

**Problem.** The editor opens on a blank 9-tab, ~120-control form with circular cross-screen dependencies and no onboarding (`→ AUDIT Tier 3.2`, §5).

**Proposal.** An AI-seeded wizard: **Identity → "Generate personality & backstory" → live playground preview with the NPC already talking.** Presets as cards; advanced config hidden until asked. In-place creation of knowledge/tools/relationships (no round-trips).

**In-engine translation.** The same wizard can run inside the engine's setup window, so a solo dev never leaves the editor to make their first NPC.

---

### 1.6 Semantic memory & knowledge recall (RAG)

**Problem.** Recall is naive `includes()` substring matching ("art" matches "Bartertown"); the central "layered memory" pillar feels broken at any real scale (`→ AUDIT Tier 6.6`).

**Proposal.** Embed memories + knowledge entries; retrieve by semantic similarity with a documented relevance contract. Keep the salience/tier model on top (what's *eligible* to recall) but rank by meaning. Cache embeddings; make the provider BYOK like everything else.

**In-engine translation.** None visible to the game — but it's the difference between "NPC vaguely remembers" and "NPC recalls the *relevant* thing you told it three sessions ago," which is the entire pitch.

---

## Horizon 2 — "Make it compelling & differentiated" (Next)

These are what make SoulEngine *worth* adopting over rolling your own LLM wrapper.

### 2.1 NPC-to-NPC propagation ("gossip")

**Problem.** The social graph exists but is inert context — NPCs know *of* each other but nothing flows between them.

**Proposal.** Memories propagate along the network during cycles: what NPC A learned about the player can reach NPC B at a fidelity gated by their familiarity tier and the memory's salience. A rumor degrades and distorts as it travels. Make it observable and capped.

**In-engine translation.** Emergent world reactivity: rob the merchant, and the guard *already knows* when you reach the gate. Designers configure propagation rules per relationship; the engine just sees the resulting dialogue. This is a genuine "wow" that scripted dialogue trees cannot do.

---

### 2.2 Goals, desires & proactive behavior

**Problem.** NPCs are purely reactive — they only respond when spoken to.

**Proposal.** A lightweight goal/agenda layer: each NPC has standing desires (protect the shop, find their sibling, climb the guild) that bias tool use and dialogue, and can trigger **proactive** events ("the NPC initiates" when conditions are met). Bounded, observable, designer-authored.

**In-engine translation.** `OnNPCInitiative` events let NPCs start conversations, leave, or act on the world unprompted — turning a talking statue into an agent with its own arc.

---

### 2.3 Emotion → engine hooks (animation / VO / expression)

**Problem.** Mood is computed but only affects text; the game can't *show* it.

**Proposal.** A normalized affect signal (valence/arousal/dominance + discrete emotion) emitted on `mood_change`, mapped to engine-side rigs.

**In-engine translation.** Drive blendshapes, animation blend trees, and VO emphasis from live mood; expose an `EmotionState` the Animator can read. An NPC that *looks* angry because it *is* angry is the visible payoff of the whole cognition stack.

---

### 2.4 Group conversations & scenes

**Problem.** One player ↔ one NPC only.

**Proposal.** Multi-party sessions: several NPCs + player(s) in one conversation, with turn-taking, addressing, and shared scene memory. The Mind arbitrates who speaks.

**In-engine translation.** Tavern scenes, council meetings, party banter — a `GroupSession` with multiple `NPCCharacter`s. Hard but high-ceiling.

---

### 2.5 Deterministic & offline mode

**Problem.** Every turn and cycle is a live LLM call; nothing is reproducible or offline-tolerant (`→ AUDIT Tier 5.4`). Studios need reproducible builds and graceful degradation.

**Proposal.** A seeded/cached mode: rules-based fallbacks for recall and cycles, cached last-good outputs, and a "degraded" flag. A record/replay harness so a conversation can be re-run identically in CI.

**In-engine translation.** Ship a build that behaves predictably in a demo with no network; run automated personality regression tests ("given this player input, the guard still refuses") in the studio's CI.

---

### 2.6 Behavior test harness ("unit tests for personalities")

**Problem.** There's no way to assert an NPC behaves as designed; tuning is vibes-based and regressions are invisible.

**Proposal.** Scripted player-turn scenarios with assertions on outcomes (tool fired, exit triggered, sentiment stayed in range, a fact was recalled). Runs against the deterministic mode (2.5).

**In-engine translation.** A `SoulEngine.Tests` assembly; designers lock in "the merchant never reveals the vault code" as a test that fails loudly if a prompt change breaks it.

---

### 2.7 NPC marketplace & shareable packs

**Problem.** Starter packs exist (fishing/office/space) but aren't a system — no sharing, no community.

**Proposal.** Turn packs into first-class, versioned, importable bundles (NPCs + knowledge + tools) with a browse/share surface. Studios publish and remix.

**In-engine translation.** "Import the Medieval Village pack" populates a project with a cast of related, networked NPCs in one click — instant content for jams and prototypes.

---

### 2.8 Multi-engine via the published protocol

**Problem.** Unity-only thinking; the value is engine-agnostic.

**Proposal.** Once the wire protocol + REST contract are versioned and published (`→ AUDIT Tier 2.1–2.3`), ship thin Unreal (C++/Blueprint) and Godot (GDScript) clients against the *same* spec. The protocol is the product; SDKs are ports.

**In-engine translation.** The same authored NPC asset drives a Unity prototype and an Unreal vertical slice without re-authoring.

---

### 2.9 Dual-runtime conformance harness ("keep TS and C# honest")

**Problem.** Cognition is implemented **twice** — TS (`src/core/*`) and C# (`Unity-SoulEngine/.../Core/*`). With no shared spec or tests, the two will drift: a bug fixed in the webapp (e.g. Weekly-Whisper retention) can stay broken in the engine, and an NPC will *behave differently online vs offline* (`→ AUDIT §4.7, Tier 5.2`).

**Proposal.** A canonical, language-neutral contract — pillar rules, salience math, prompt templates, data schemas (`schemaVersion`) expressed as fixtures + golden outputs in `tests/conformance/`. Both runtimes load the same fixtures and must produce the same decisions; CI fails on divergence. New bugs become shared fixtures (ties into the ERRORS.md → regression rule).

**In-engine translation.** A studio trusts that "what I tested on the web is what ships in the build." Determinism (2.5) and offline (1.x) are only credible if the two runtimes provably agree. This is the connective tissue that makes a dual-runtime product viable instead of a maintenance trap.

---

## Horizon 3 — "Make it a platform" (Later)

### 3.1 Managed cloud + plan tiers
Hosted SoulEngine (no self-deploy), managed keys as an alternative to BYOK, usage-based billing, per-project quotas (`→ AUDIT Tier 5.6`). Self-host stays free/OSS; managed is the business.

### 3.2 Safety & governance layer
Replace the 19-phrase substring moderator (`→ AUDIT Tier 6.5`) with a real, configurable classifier; per-project content policies; an audit log of NPC actions and flagged turns; a kill-switch. Selling to studios with brand risk requires this.

### 3.3 Director / world view
A live operational view of every NPC mind in a running world — moods, recent memories, last tool calls, propagation flow. Part debug tool, part "holy cow this is alive" demo.

### 3.4 Localization & multi-voice
NPCs converse in the player's language with locale-appropriate voices; knowledge/backstory authored once, surfaced translated. A large adoption unlock outside English markets.

### 3.5 Analytics
Which NPCs get engaged, sentiment trends over a playerbase, conversation drop-off, "most-recalled facts." Product analytics for *characters*.

### 3.6 MCP authoring server
Expose authoring/inspection as an MCP server so external AI agents (including Claude) can create, tune, and test NPCs programmatically — leaning into the system's existing MCP framing, and a natural fit for AI-native studios.

---

## Prioritization

**Impact × effort, with dependencies.** Do nothing here before AUDIT Tier 0 (the product is broken/insecure until then).

| Feature | Impact | Effort | Gate / depends on |
|---|---|---|---|
| 1.1 Engine SDK | ★★★★★ | XL | AUDIT T0 (voice), T2.1 (versioning), T3.1 (freeze contract) |
| 1.3 Event Bus | ★★★★★ | L | AUDIT T2.3 |
| 1.2 NPC-as-Asset | ★★★★☆ | L | AUDIT T2.5 |
| 1.5 Guided authoring | ★★★★☆ | L | AUDIT T3.2 |
| 1.4 Cost dashboard | ★★★★☆ | M | AUDIT T1.6/T5.5 |
| 1.6 Semantic memory | ★★★★☆ | M | AUDIT T1.1 (memory fix first) |
| 2.1 NPC gossip | ★★★★★ | L | 1.6, social graph |
| 2.3 Emotion→engine | ★★★★☆ | M | 1.3 |
| 2.5 Determinism/offline | ★★★★☆ | L | AUDIT T5.4 |
| 2.2 Goals/agendas | ★★★★☆ | L | 1.3 |
| 2.6 Behavior tests | ★★★☆☆ | M | 2.5 |
| 2.4 Group conversations | ★★★★☆ | XL | 1.3 |
| 2.7 Marketplace | ★★★☆☆ | M | 1.2 |
| 2.8 Multi-engine | ★★★★☆ | L | 1.1, T2.1 |
| 2.9 Dual-runtime conformance | ★★★★★ | L | AUDIT T5.2; gates 2.5/offline credibility |
| 3.x Platform | ★★★★☆ | XL | Horizon 1–2 |

### Recommended first three (after AUDIT Tier 0–1)
1. **1.1 Engine SDK** + **1.3 Event Bus** — without these, "importable asset for game engines" is just a slogan.
2. **1.2 NPC-as-Asset** — makes integration *seamless via project hierarchy*, the user's explicit goal.
3. **2.1 NPC gossip** + **2.3 Emotion→engine** — the two features that make a demo audibly/visibly different from a scripted dialogue tree, i.e. the reason to choose SoulEngine at all.

### The one-sentence strategy
**Fix the foundation (AUDIT Tier 0–2), ship the SDK + event bus + asset binding (Horizon 1), then lean hard into the two things competitors can't fake — NPCs that gossip and NPCs that visibly feel (Horizon 2).**
