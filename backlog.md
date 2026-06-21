# SoulEngine — Execution Backlog

> **Source of truth for *what* and *status*.** Rationale + `file:line` evidence live in [`AUDIT.md`](AUDIT.md); the dev loop lives in [`WORKFLOW.md`](WORKFLOW.md); bugs + their regression tests live in [`ERRORS.md`](ERRORS.md).
> **How work flows:** Opus orchestrates → one Sonnet `feature-builder` per item (or per co-dependent group) → spec → failing test → implement → green → commit. Dispatch with `/execute-feature <ID>` (one item) or `/orchestrate-tier <N>` (a whole tier).

**Status legend:** `todo` · `in-progress` · `in-review` · `done` · `blocked` · `deferred`
**Size:** S (<½ day) · M (~1 day) · L (~2-3 days) · XL (multi-session)
**Test requirement:** every item ships with at least one test; `reg` = regression test guarding the exact bug, `unit` = pure-logic test, `conf` = cross-runtime conformance, `e2e` = route/integration test, `manual` = documented manual check (only where automated is impractical, e.g. prod WS, CSS render).

---

## Dispatch model (read before running a tier)

- **Independent items** → parallel `feature-builder` agents, **each in its own git worktree** (`isolation: "worktree"`), then orchestrator merges in dependency order.
- **Co-dependent or same-file items** → **chain** into ONE agent/worktree to avoid merge conflicts.
- **Wave order** → an item only dispatches once its `Depends-on` items are `done`.
- The "Group" column encodes this: same letter = run together (chained); distinct letters in the same tier = parallelizable (subject to file overlap noted in `Files`).

---

## Tier 0 — Critical Blockers  `(broken/insecure right now — do first)`

| ID | Title | Size | Depends-on | Group | Files | Test req | Status |
|---|---|---|---|---|---|---|---|
| 0.1 | Move WebSocket onto the main HTTP port (Upgrade handler); delete `port+1` server | M | — | **A** | `src/index.ts`, `src/ws/handler.ts` | e2e + manual | done |
| 0.2 | Drop client `port+1` WS-URL math; use page origin | S | 0.1 | **A** | `web/js/api.js` | manual | done |
| 0.3 | Enforce project ownership (kill cross-tenant IDOR) | L | — | **B** | `src/middleware/ownership.ts`, `src/storage/supabase/projects.ts`, `src/routes/*`, `src/types/project.ts` | reg(e2e) | done |
| 0.4 | Collapse dual storage selector into one request-scoped path; thread storage into core | L | — | **B** | `src/storage/factory.ts`, `src/core/mind.ts`, `src/core/context.ts` | reg + unit | done |
| 0.5 | Rotatable + portable secrets (shared envelope, `keyVersion`, rotate routine) | M | — | **C** | `src/storage/crypto/secrets.ts`, `src/storage/{local,supabase}/secrets.ts` | reg | done |
| 0.6 | Fix visible token bugs (`--accent-primary-rgb`; phantom tokens) + undefined-var guard | S | — | **D** | `web/css/design-system.css`, `web/css/conversation-modes.css` | unit | done |
| 0.7 | Reconcile Unity docs with reality (SDK is built; `/api/sync` is the real blocker) | S | — | **E** | `documentation/UNITY_REPACKAGE.md`, `README.md` | manual | done |
| 0.8 | Serialize local usage append (lock/append-only) — stop losing token/cost data | S | — | **F** | `src/storage/local/usage.ts` | reg | done |

**Tier 0 dispatch plan (waves):**
- **Wave 1 (parallel, 6 agents in 6 worktrees):** A `{0.1→0.2}` · B `{0.3→0.4}` · C `{0.5}` · D `{0.6}` · E `{0.7}` · F `{0.8}`.
  - File-overlap caution: B, C, F all touch `src/storage/*` but **disjoint files** (`projects.ts`+core / `secrets.ts` / `local/usage.ts`) — safe to parallelize; orchestrator merges sequentially.
  - 0.1+0.2 chained (server+client of one transport). 0.3+0.4 chained (both rewire the storage/auth tenancy path; 0.3's ownership checks rely on 0.4's request-scoped storage).
- No Wave 2 — Tier 0 has no internal cross-group dependency. Merge order: E, F, D, C, A, B (docs/trivial first, security/transport last so the suite stabilizes around them).

---

## Tier 1 — Stabilize the Core

| ID | Title | Size | Depends-on | Group | Files | Test req | Status |
|---|---|---|---|---|---|---|---|
| 1.1 | Fix Weekly Whisper retention (promote all ≥ threshold; retain to `maxStm`) | M | — | A | `src/core/cycles.ts:195-241` | reg + unit | todo |
| 1.2 | Actually enforce Core Anchor immutability (call `enforceAnchorImmutability`) | M | — | B | `src/security/anchor-guard.ts`, `src/session/manager.ts:286` | reg | todo |
| 1.3 | Persist + transactionally clear deferred recall context (text + voice) | M | 0.4 | C | `src/routes/conversation.ts:297`, `src/voice/pipeline.ts:925` | reg | todo |
| 1.4 | Optimistic locking on instance saves (both backends) | M | 0.4 | D | `src/storage/{local,supabase}/instances.ts` | reg | todo |
| 1.5 | Durable + resumable sessions (`resume(session_id)`) | L | — | E | `src/session/store.ts`, `src/session/manager.ts` | e2e | todo |
| 1.6 | Externalize rate-limit/cooldown/registry; key limiter on principal; limit LLM endpoints | L | — | F | `src/security/rate-limiter.ts`, `src/mcp/registry.ts` | reg(e2e) | todo |
| 1.7 | Close worst local↔cloud drift (knowledge desc, ID regex, version scheme, def history) | L | 0.4 | G | `src/storage/supabase/knowledge.ts:19`, `src/storage/{local,supabase}/definitions.ts` | conf + unit | todo |
| 1.8 | Enforce token budget on prompt assembly (`checkContextBounds`) | M | — | H | `src/core/context.ts:679`, `src/core/knowledge.ts` | unit | todo |
| 1.9 | Thread `userId` through session + voice state so authenticated sessions use the right backend end-to-end (follow-up surfaced by 0.4: conversation/voice currently pass `userId=null`) | M | 0.4 | I | `src/session/manager.ts`, `src/routes/conversation.ts`, `src/voice/pipeline.ts`, `src/core/mind.ts` | reg | todo |

---

## Tier 2 — SDK-grade API Contract  `(see AUDIT §3 Tier 2 for detail)`

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 2.1 | Introduce `/api/v1` + deprecation headers | M | — | e2e | todo |
| 2.2 | Standard response/error envelope + stable error-code enum + pagination | M | 2.1 | e2e | todo |
| 2.3 | Server→client event channel (WS/SSE) for game-event tools + Mind follow-ups | L | 0.1 | e2e | todo |
| 2.4 | Authenticate full conversation lifecycle; high-entropy session ids; revocable keys | M | 0.3 | reg(e2e) | todo |
| 2.5 | Versioned data contract (zod → TS+JSON Schema+SQL, `schemaVersion`) | L | — | unit+conf | todo |
| 2.6 | `migrateLocalToSupabase(projectId,userId)` | M | 0.5, 2.5 | e2e | todo |
| 2.7 | Batch create/update for NPCs + knowledge | S | 2.1 | e2e | todo |
| 2.8 | Versioned `/ws/voice` protocol spec + `audio_format` in `ready` | M | 0.1 | manual+e2e | todo |

---

## Tier 3 — Frontend / UX Rewrite  `(verdict: rewrite UI, keep tokens — AUDIT §5)`

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 3.1 | Freeze reusable contract (extract `api.js` + `VoiceClient` to a documented client spec) | M | — | unit | todo |
| 3.2 | Rewrite NPC-editor IA → 3 guided stages + Advanced drawer + "first NPC in 60s" | XL | 3.1 | e2e+manual | todo |
| 3.3 | Consolidate design system (one tabs/accordion/card/chip; delete `-v2`/dead) | L | — | manual | todo |
| 3.4 | Accessibility pass (focus-visible, ARIA tabs, contrast, reduced-motion) | M | 3.3 | manual(a11y) | todo |
| 3.5 | Mobile/tablet story (<1024px) + breakpoint tokens | M | 3.3 | manual | todo |
| 3.6 | Kill duplication (one `utils.js`; router teardown hook) | M | 3.1 | unit | todo |
| 3.7 | Fix boot bugs: register `/projects/new`; move diff-modal wiring out of `DOMContentLoaded` | S | — | reg | todo |

---

## Tier 4 — Voice / Realtime Productization  `(AUDIT Tier 4)`

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 4.1 | Delete dead `src/voice/interruption.ts` | S | — | unit | todo |
| 4.2 | Collapse ~3s stacked endpointing latency to one short settle | M | 0.1 | manual | todo |
| 4.3 | Per-utterance ID dedup (replace `pendingSTTFinal` boolean) | M | — | reg | todo |
| 4.4 | Harden providers (DG reconnect, Cartesia events, TTS pipeline, backpressure) | L | — | reg | todo |
| 4.5 | Binary WS audio frames | M | 0.1, 2.8 | manual | todo |
| 4.6 | Latency instrumentation + budget | S | — | unit | todo |

---

## Tier 5 — Connect & reconcile the two runtimes  `(AUDIT Tier 5 — the product)`

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 5.1 | Implement `/api/sync/*` backend the Unity `CloudSync` calls | L | 2.1, 2.5 | e2e | todo |
| 5.2 | Cross-runtime conformance tests + shared contract (TS vs C#) | L | 2.5 | conf | todo |
| 5.3 | NPC-as-Asset binding (ScriptableObjects, GUID↔npcId) | L | 5.1 | conf | todo |
| 5.4 | Cycle scheduler + deterministic/offline mode | L | 1.1, 1.8 | unit+conf | todo |
| 5.5 | Mind pre-gate for cost + per-NPC Mind-off | M | — | unit | todo |
| 5.6 | BYOK quota/usage/billing (enforce `limits`) | L | — | reg(e2e) | todo |
| 5.7 | Package + publish Unity client (UPM/.unitypackage) pinned to `/api/v1` | M | 2.1 | manual | todo |

---

## Tier 6 — Polish, Hygiene & Docs  `(AUDIT Tier 6)`

| ID | Title | Size | Test req | Status |
|---|---|---|---|---|
| 6.1 | Remove `bun.lock`; resolve Bun-vs-Node; add `engines` | S | manual | todo |
| 6.2 | Single version source (`package.json` → `/health`) | S | unit | todo |
| 6.3 | Fix `SDK_REFERENCE.md` Gemini imports + model default | S | manual | todo |
| 6.4 | Relocate `tts-test.ts`; delete contradictory `.env.example` | S | manual | todo |
| 6.5 | Tighten CSP (drop `unsafe-eval`); output-encode instead of input-mutate; classifier moderation | M | reg | todo |
| 6.6 | Embedding-based recall (knowledge/memories) | M | 1.8 | unit | todo |
| 6.7 | Settle dual brand (`evolve-npc` vs SoulEngine) | S | manual | todo |

---

## Progress

| Tier | Items | Done | Status |
|---|---|---|---|
| 0 | 8 | 8 | **complete** |
| 1 | 9 | 0 | not started |
| 2 | 8 | 0 | not started |
| 3 | 7 | 0 | not started |
| 4 | 6 | 0 | not started |
| 5 | 7 | 0 | not started |
| 6 | 7 | 0 | not started |
| **Total** | **52** | **8** | — |

> Update the relevant row's `Status` and this table as items complete. Each `done` item must have a matching `FIXED` row in [`ERRORS.md`](ERRORS.md) with a regression-test path.
