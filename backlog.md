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
| 1.1 | Fix Weekly Whisper retention (promote all ≥ threshold; retain to `maxStm`) | M | — | A | `src/core/cycles.ts` | reg + unit | done |
| 1.2 | Actually enforce Core Anchor immutability (call `enforceAnchorImmutability`) | M | — | B | `src/security/anchor-guard.ts`, `src/session/manager.ts` | reg | done |
| 1.3 | Persist + transactionally clear deferred recall context (text + voice) | M | 0.4 | C | `src/routes/conversation.ts`, `src/voice/pipeline.ts` | reg | done |
| 1.4 | Optimistic locking on instance saves (both backends) | M | 0.4 | D | `src/storage/{local,supabase}/instances.ts` | reg | done |
| 1.5 | Durable + resumable sessions (`resume(session_id)`) | L | — | E | `src/session/manager.ts`, `src/storage/{local,supabase}/sessions.ts` | e2e | done |
| 1.6 | Externalize rate-limit/cooldown/registry; key limiter on principal | L | — | F | `src/security/rate-limiter.ts`, `src/mcp/*` | reg | done |
| 1.7 | Close worst local↔cloud drift (knowledge desc, ID regex, version scheme, def history) | L | 0.4 | G | `src/storage/supabase/knowledge.ts`, `src/storage/{local,supabase}/definitions.ts`, `src/storage/validation.ts` | conf + reg | done |
| 1.8 | Enforce token budget on prompt assembly | M | — | H | `src/core/context.ts`, `src/core/knowledge.ts` | unit | done |
| 1.9 | Thread `userId` through session + voice state | M | 0.4 | I | `src/session/manager.ts`, `src/routes/conversation.ts`, `src/voice/pipeline.ts`, `src/types/session.ts` | reg | done |
| 1.10 | Wire the trusted principal into rate-limit/cooldown CALL SITES (1.6 added the param; callers still pass only `player_id`) | S | 1.6 | — | `src/routes/conversation.ts`, `src/voice/pipeline.ts`, `src/mcp/exit-handler.ts`, `src/security/principal.ts` | reg | done |
| 1.11 | Supabase session persistence + resume (1.5 shipped local only; cloud path is stubbed) | M | 1.5 | — | `src/storage/supabase/sessions.ts`, `sql/07-session-and-integrity.sql` | e2e | done |
| 1.12 | SQL: add `npc_instance_history` UNIQUE (instance_id, version) + knowledge `description` column | S | 1.4, 1.7 | — | `sql/07-session-and-integrity.sql` | reg | done |
| 1.13 | Wire principal into the WS `canStartConversation` cooldown check | S | 1.10 | — | `src/ws/handler.ts` | reg | done |
| 1.14 | Map the knowledge `description` column in the Supabase TS layer | S | 1.12 | — | `src/storage/supabase/knowledge.ts` | reg | done |

---

## Tier 2 — SDK-grade API Contract  `(see AUDIT §3 Tier 2 for detail)`

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 2.1 | Introduce `/api/v1` + deprecation headers (legacy `/api/*` aliased) | M | — | e2e | done |
| 2.2 | Standard response/error envelope + stable error-code enum + pagination | M | 2.1 | e2e | done |
| 2.3 | Server→client event channel (WS + SSE `/api/v1/events`) for game-event tools + Mind follow-ups | L | 0.1 | e2e | done |
| 2.4 | Authenticate full conversation lifecycle; high-entropy session ids; revocable named keys | M | 0.3 | reg | done |
| 2.5 | Versioned data contract (zod schemas + `SCHEMA_VERSION`) | L | — | unit | done |
| 2.6 | `migrateLocalToSupabase(projectId,userId)` | M | 0.5, 2.5 | reg | done |
| 2.7 | Batch create/update for NPCs + knowledge | S | 2.1 | e2e | done |
| 2.8 | Versioned `/ws/voice` protocol spec + `audio_format` in `ready` | M | 0.1 | unit | done |
| 2.9 | WS voice **lifecycle** auth (session-token verify on init, opt-in) + `resumeSession` token minting | S | 2.4 | reg | done |
| 2.10 | Pagination on the NPC list (additive, non-breaking) + tested params helper | S | 2.2 | unit | done |
| 2.11 | Frontend tolerates the paginated list shape (`{items}` / `{projects}`) so the webapp keeps working | S | 2.2 | manual | done |
| 2.12 | Extend pagination/envelope to the remaining list routes (knowledge, transcripts, instances) — keep legacy keys until Tier 3 | S | 2.10 | e2e | todo |

---

## Tier 3 — Frontend / UX Rewrite: the Authoring Studio

> **Full plan + live audit + workflow map:** see [`AUDIT.md`](AUDIT.md) §5 (Frontend UI/UX) and the §3 Tier 3 table. Verdict: rewrite the JS/UX layer, keep the design tokens. **Awaiting goahead before building.**

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 3.0 | Tech decision spike (vanilla-reactive vs Preact/Vite); lock tokens; extract `utils.js`; router teardown hooks | M | — | unit | todo |
| 3.1 | App shell (project switcher, section nav, resolved project name); remove marketing header in-app | L | 3.0 | e2e+manual | todo |
| 3.2 | Shared components (ARIA Tabs, Collection, Modal/focus-trap, Drawer, StatusPill, Slider); delete the 4 tab systems + dup cards | L | 3.0 | unit+manual | todo |
| 3.3 | Settings rebuild with graceful key-status (fixes L1) + per-provider test/status | M | 3.2 | reg | todo |
| 3.4 | Collections (Knowledge + Tools on one component; JSON behind Advanced) | M | 3.2 | e2e | todo |
| 3.5 | NPC Studio — 3 guided stages + Advanced drawer + AI-seed + inline dependency creation | XL | 3.2, 3.4 | e2e+manual | todo |
| 3.6 | Playground — one chat column + one drawer; voice on demand; uses WS `audio_format`; no 500 pre-flight | L | 3.2, 3.3 | e2e+manual | todo |
| 3.7 | Project Home + first-run checklist + 60s path; Version history as top-bar action (fixes ERR-015) | M | 3.1, 3.5 | e2e | todo |
| 3.8 | Accessibility + responsive pass (focus-visible, ARIA, contrast, reduced-motion, <1024px) | M | 3.1-3.7 | manual(a11y) | todo |

### Live UI bugs found by the running-app audit (fix before/with the relevant phase)

| ID | Title | Size | Test req | Status |
|---|---|---|---|---|
| L1 | `GET /:id/keys` 500s on unreadable secrets → graceful key-status state (breaks Settings + Playground) | S | reg(e2e) | todo |
| L2 | `GET /:id/voices` 500s without a readable TTS key → degrade to empty list + prompt (breaks Voice tab) | S | reg(e2e) | todo |
| L3 | Header shows Sign In + Sign Out simultaneously in local mode → single coherent auth state | S | manual | todo |
| L4 | Breadcrumb renders literal "Project" on some pages → always resolve the real project name | S | manual | todo |

---

## Tier 4 — Voice / Realtime Productization  `(AUDIT Tier 4)`

| ID | Title | Size | Depends-on | Test req | Status |
|---|---|---|---|---|---|
| 4.1 | Delete dead `src/voice/interruption.ts` | S | — | unit | done |
| 4.2 | Collapse ~3s stacked endpointing latency (aggregation 1500→400ms, DG utterance_end 1500→1000ms; ~1.4s budget) | M | 0.1 | unit | done |
| 4.3 | Per-utterance ID dedup (replaced `pendingSTTFinal` boolean) | M | — | reg | done |
| 4.4 | Harden providers (DG reconnect accumulator clear, Cartesia event-driven, TTS pipelining) | L | — | reg | done |
| 4.5 | Binary WS audio frames (deferred — needs `ws/handler.ts` + client; pairs with Tier 3) | M | 0.1, 2.8 | manual | todo |
| 4.6 | Latency instrumentation + budget (`LatencyTracker`: commit→firstTranscript→firstToken→firstAudio) | S | — | unit | done |
| 4.7 | WS outbound-audio backpressure (`handler.ts` `bufferedAmount`) — not covered by 4.4 (provider-only) | S | — | reg | todo |

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
| 1 | 14 | 14 | **complete** |
| 2 | 12 | 11 | **contract shipped**; remaining-routes pagination open (2.12) |
| 3 | 13 | 0 | **planned** (Authoring Studio) — awaiting goahead; incl. 4 live UI bugs (L1-L4) |
| 4 | 7 | 5 | **voice hardened**; binary frames + backpressure open (4.5, 4.7) |
| 5 | 7 | 0 | not started (deferred per request — features/testing first) |
| 6 | 7 | 0 | not started |
| **Total** | **68** | **38** | — |

> **Local-mode guarantee:** verified + guarded by `tests/regression/local-mode-no-supabase.test.ts` — with no Supabase env, every storage selector falls back to local (even with a userId), so the webapp runs fully offline.

> Update the relevant row's `Status` and this table as items complete. Each `done` item must have a matching `FIXED` row in [`ERRORS.md`](ERRORS.md) with a regression-test path.
