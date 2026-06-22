# SoulEngine — System Audit

> **Audited:** 2026-06-21 · **Branch:** `claude/exciting-knuth-2949fc` (worktree off `main`)
> **Method:** Full-codebase read by the orchestrator, then 7 parallel deep-dive subagents (one per subsystem), each classifying findings as `BROKEN` / `DOESN'T-MAKE-SENSE` / `NEEDS-POLISH` / `GAME-ENGINE-GAP` with `file:line` evidence. Several critical findings were independently corroborated by 2–3 subagents.
> **Codebase size:** ~20.8k LOC TypeScript (78 files) · ~10.6k LOC frontend JS (16 files) · ~8.9k LOC CSS (6 files) · 5 SQL migrations · 5 docs (~3.7k lines).
> **Scope note:** this audit covers the **TypeScript webapp**. A companion **Unity 6000.3.11f1 project lives at `E:/Evolve-NPC/Unity-SoulEngine/SoulEngine`** and is *not* a thin client — `Assets/SoulEngine/` is a **full C# re-implementation** of the cognition stack (`MindAgent`, `MemorySystem`, `CycleRunner`, `PersonalityEngine`, `ContextAssembler`, `ConversationSummarizer`), all providers (LLM: Anthropic/Gemini/Grok/OpenAI; STT: Deepgram; TTS: Cartesia/ElevenLabs/**Piper**), security, session, MCP, **plus a CloudSync layer** (`CloudSyncService`, `SyncQueue`, `SyncJob`). It has no nested `.git` (local to the workspace, likely gitignored from the webapp repo). Deep C# code-quality is out of scope, but the **two-runtime reality reframes every integration finding** — see §4.7 and the **Dual-Runtime** note.

---

## 1. Executive Summary

SoulEngine is an **ambitious, conceptually strong NPC-intelligence backend** — a dual-instance "Mind" (instant Speaker + parallel tool-using thinker), five memory/personality "pillars," multi-provider LLM/STT/TTS, definition + mind-state versioning, dual local/cloud storage, and a web authoring studio. The **vision is excellent** (a credible "Firebase/PlayFab for living NPCs"). The **execution is a high-velocity solo prototype** that is not yet production-safe, not yet secure for multi-tenant use, and not yet an SDK.

The commit history tells the story plainly: a relentless build-out of the hardest parts (the voice transcript pipeline and the Mind architecture were each re-stabilized many times), followed by a recent pivot toward *product* (landing page, Unity waitlist, branding). The pivot is the right instinct — but the gap between the marketing surface and the shippable reality is currently large.

### Overall score: **52 / 100**

| Dimension | Score | One-line rationale |
|---|---|---|
| Architecture & vision | 80 | Genuinely differentiated design; dual-Mind, pillars, versioning, BYOK. |
| Correctness (core cognition) | 55 | Weekly Whisper silently deletes memories; Core Anchor immutability never enforced. |
| Security & tenancy | 30 | Cross-tenant IDOR via service-role; auth tied to `NODE_ENV`; CSP `unsafe-eval`. |
| Production readiness | 35 | **Voice is dead in prod** (WS on `port+1`); in-memory sessions; no horizontal scaling. |
| Data integrity | 45 | Dual backend selectors split-brain; no locking; secrets non-portable + unrotatable. |
| Frontend / UX | 40 | Strong token layer wasted under a 5,389-line monster; 9-tab editor; rewrite-grade IA debt. |
| SDK / game-engine readiness | 25 | **The Unity SDK does not exist**; no API versioning; no sync API; no event channel. |

### The 6 critical blockers (P0) — fix before any demo, launch, or SDK work

1. **Production voice is non-functional.** The server opens a *second* `WebSocketServer` on `PORT+1`; Render exposes only one port; the browser then dials `wss://host:444`. Confirmed by 3 independent subagents. — `src/index.ts:306`, `web/js/api.js:344-346`, `render.yaml`
2. **Cross-tenant IDOR on every project-scoped route.** The server talks to Supabase with the **service-role key (bypasses RLS)** and routes authorize with a mere existence check, so any authenticated user can read/modify/delete *any* project, its API keys, and its transcripts, and spend its LLM budget. — `src/storage/supabase/projects.ts:97-135`, `src/routes/projects.ts` (passim)
3. **Storage split-brain.** Two contradictory backend selectors — a *static* `NODE_ENV` switch (`src/storage/index.ts:14-18`) used by the core, and a *per-request* `userId` switch (`src/storage/hybrid.ts:13-18`) used by routes — can write data to one backend and read it from another, silently dropping NPC cross-references and bypassing RLS.
4. **The webapp can't serve the Unity SDK it already has.** The Unity project is real and *fat* — a full C# re-implementation with offline cognition and a `CloudSync` layer that expects `/api/sync/*`. But **this webapp branch exposes no `/api/sync/*` route** (no `src/routes/sync.ts`, not registered), so `CloudSyncService`/`SyncQueue` have nothing to talk to — and there are now **two cognition implementations (TS + C#) that will silently drift** (the Weekly-Whisper and anchor bugs below may get fixed in one runtime and not the other). The gap is a *contract + conformance* problem, not "build the SDK."
5. **BYOK secrets are unrotatable and non-portable.** Changing `ENCRYPTION_KEY` permanently bricks every stored key; the local and Supabase backends use *different* ciphertext formats, so secrets can't migrate. — `src/storage/local/secrets.ts`, `src/storage/supabase/secrets.ts`
6. **Design-token bugs ship visible breakage.** `--accent-primary-rgb` is never defined, so the landing page renders the *old indigo* brand instead of the current ember; `conversation-modes.css` references five tokens (`--bg-secondary`, …) that don't exist. — `web/css/pages.css`, `web/css/conversation-modes.css:6,8,19,21`

### Verdict

- **Keep:** the core architecture, the design-token layer, `web/js/api.js` (the de-facto API contract), and the `VoiceClient` WS message taxonomy. These are assets.
- **Fix hard:** security/tenancy, prod transport, storage coherence, the Weekly Whisper memory bug. These are existential.
- **Rewrite:** the authoring UI/UX information architecture (not the CSS tokens — the *floor plan*).
- **Build:** the actual game-engine SDK, an API version + event contract, and the sync layer the SDK needs.

---

## 2. The Shape & The Story (from 40 commits)

1. **Authoring tool first** — JSON editor, draft NPCs, starter packs, personality presets, LLM-assist.
2. **Multi-provider + cloud** — per-project LLM routing, model sync, hybrid local/Supabase storage, definition history + diff + rollback.
3. **Security wave** — strict auth, CORS lockdown, hashed Game Client API Key, XSS hardening, dependency patching.
4. **Observability** — token/voice usage tracking, transcript storage, dashboard, graceful session termination.
5. **Voice, the long war** — repeated STT transcript-accumulation fixes, chunk-accumulation bugs, barge-in added (`ce4b17a`) then removed; the most-iterated subsystem in the repo.
6. **The parallel Mind** — implemented as parallel (`8c09d6b`), flipped to sequential (`63459b8`), restored to parallel (`13261fe`), then follow-up-repetition fixes. The second-most-iterated subsystem.
7. **The product pivot (most recent)** — landing page, sign-in, **Unity waitlist modal**, logo/branding. The repo is mid-transition from "personal research project" to "importable Unity asset / product."

**What the story implies for this audit:** the hardest *runtime* systems (voice, Mind) absorbed most of the effort and are feature-rich but fragile; the *cross-cutting* concerns (tenancy, deployment topology, data-contract stability, UX coherence) were never given a dedicated hardening pass — which is exactly where the P0s cluster.

---

## 3. Tiered Remediation Roadmap

Tiers are **dependency-ordered**. Each item is sized `S`/`M`/`L`/`XL` and tagged with primary files. A later session/agent can pick up any single item cold.

### Tier 0 — Critical Blockers (the product is broken/insecure *right now*)

| # | Item | Size | Files |
|---|---|---|---|
| 0.1 | **Move the WebSocket onto the main HTTP port** via `Upgrade` handling (`WebSocketServer({noServer:true})` + `server.on('upgrade')`, or adopt the already-written-but-unmounted `createVoiceWebSocketHandler`). Delete the `port+1` server. | M | `src/index.ts:306`, `src/ws/handler.ts:163-218` |
| 0.2 | **Drop client `port+1` math**; connect to `` `${proto}//${location.host}/ws/voice` `` (or serve the WS URL from `/api/config`). | S | `web/js/api.js:343-346` |
| 0.3 | **Enforce project ownership.** Carry `user_id` on `getProject`, add an ownership middleware on `/api/projects/:projectId/*` and `/api/instances/:id/*` (404 on mismatch), **or** route authed calls through the unused `createUserClient(token)` so RLS actually applies. | L | `src/storage/supabase/projects.ts:97`, `src/middleware/auth.ts`, all `src/routes/*` |
| 0.4 | **Collapse the dual storage selector** into one request-scoped path; thread `storage`/`userId` into `src/core/mind.ts` and `src/core/context.ts` (kill the static `NODE_ENV` switch). Removes split-brain *and* the non-prod RLS bypass. | L | `src/storage/index.ts:14`, `src/storage/hybrid.ts`, `src/core/mind.ts:163,319`, `src/core/context.ts:334,503` |
| 0.5 | **Make secrets rotatable & portable.** One shared crypto envelope with a `key_version` tag; a documented re-encrypt routine; identical format across backends. | M | `src/storage/local/secrets.ts`, `src/storage/supabase/secrets.ts` |
| 0.6 | **Fix the two visible token bugs.** Define `--accent-primary-rgb: 224,120,80`; rename the 5 phantom `--*` tokens in `conversation-modes.css` to their `--color-*` equivalents. Add a CI grep that fails on undefined `var(--…)`. | S | `web/css/pages.css`, `web/css/conversation-modes.css:6,8,19,21` |
| 0.7 | **Reconcile the Unity docs with reality.** The SDK is substantially *built* (full C# runtime + CloudSync), yet README says "coming soon" and `UNITY_REPACKAGE.md` reads as a future plan. State what exists, and flag the one true blocker: the `/api/sync/*` backend (Tier 5.1) is missing. | S | `documentation/UNITY_REPACKAGE.md`, `README.md:42` |
| 0.8 | **Serialize the local usage append** (async mutex / append-only events) so concurrent turns stop losing token/cost data. | S | `src/storage/local/usage.ts:41-66` |

### Tier 1 — Stabilize the Core (make the advertised behavior true)

| # | Item | Size | Files |
|---|---|---|---|
| 1.1 | **Fix Weekly Whisper retention.** Promote *all* `salience ≥ threshold` (not just top-3); retain STM up to `maxStmMemories`, not a hardcoded `retainCount=3`. Today most high-salience memories are silently deleted. | M | `src/core/cycles.ts:195-241` |
| 1.2 | **Actually enforce Core Anchor immutability.** `enforceAnchorImmutability` exists but is never called; the session-end guard only logs. Make it a hard restore/reject. | M | `src/security/anchor-guard.ts`, `src/session/manager.ts:286-290` |
| 1.3 | **Persist & transactionally clear deferred recall context** in both text and voice (voice stores it on a non-persisted instance field → lost on reconnect; stale re-injection possible). | M | `src/routes/conversation.ts:297-329`, `src/voice/pipeline.ts:925-928` |
| 1.4 | **Add optimistic locking on instance saves** (`WHERE version = expected`, retry on conflict) in both backends — currently last-write-wins + duplicate version rows. | M | `src/storage/{local,supabase}/instances.ts` |
| 1.5 | **Make session state durable + resumable.** Persist (or reconstruct) sessions; support `resume(session_id)`; stop losing in-flight conversation on restart. | L | `src/session/store.ts`, `src/session/manager.ts` |
| 1.6 | **Externalize rate-limit / cooldown / tool-registry state** (Redis) and key the limiter on an authenticated principal, not client-supplied `player_id`. Add limits to `generate-npc-content` and cycle endpoints. | L | `src/security/rate-limiter.ts`, `src/mcp/registry.ts`, `src/mcp/exit-handler.ts` |
| 1.7 | **Close the worst local↔cloud drift:** stop hardcoding knowledge `description:''` on Supabase; unify NPC/project ID regexes; unify the instance `version` scheme (pick monotonic int); implement local definition history or remove it from the shared interface (today `rollbackDefinition` is a silent no-op locally). | L | `src/storage/supabase/knowledge.ts:19,338`, `src/storage/{local,supabase}/definitions.ts`, `src/storage/{local,supabase}/instances.ts` |
| 1.8 | **Enforce a token budget on prompt assembly.** `checkContextBounds` is dead code; knowledge resolution concatenates all tiers uncapped — per-turn cost is unbounded. | M | `src/core/context.ts:679-714`, `src/core/knowledge.ts` |

### Tier 2 — Harden the API into an SDK-grade Contract (the bridge to the game-engine goal)

| # | Item | Size | Files |
|---|---|---|---|
| 2.1 | **Introduce `/api/v1`** and commit to stability + deprecation headers. A shipped Unity asset must pin a versioned contract. | M | `src/index.ts:108-213` |
| 2.2 | **Standardize the response envelope:** one error shape `{error:{code,message}}`, a stable error-code enum, consistent list wrappers, no leaking internal `details` in prod, real pagination cursors. | M | all `src/routes/*` |
| 2.3 | **Define a server→client event channel** (same-port WS or SSE) for `npc_speak`, `tool_call`, `npc_follow_up`, `mind_activity`, `mood_change`, with ordering + idempotency keys + ack. Game-event tools currently have no reliable push path. | L | `src/mcp/registry.ts`, `src/ws/handler.ts`, `src/routes/conversation.ts` |
| 2.4 | **Authenticate the whole conversation lifecycle** (messages, history, end, voice WS), not just session start; raise session-id entropy to ≥128 bits; support multiple revocable game-client keys with `timingSafeEqual`. | M | `src/routes/session.ts:71-83`, `src/routes/conversation.ts`, `src/index.ts:336-351` |
| 2.5 | **Publish a versioned data contract.** One source of truth (zod) → generate TS + JSON Schema + SQL; stamp `schemaVersion`; validate on read/write in both backends (also fixes several drift bugs by construction). | L | `src/types/*`, `src/storage/*`, `sql/*` |
| 2.6 | **Build `migrateLocalToSupabase(projectId,userId)`** so a dev can prototype logged-out and promote to cloud without losing projects/secrets/knowledge/history. | M | `src/storage/*` |
| 2.7 | **Add batch create/update** for NPCs and knowledge (starter-pack import is N round-trips today). | S | `src/routes/npcs.ts`, `src/routes/knowledge.ts` |
| 2.8 | **Publish a versioned `/ws/voice` protocol spec** with `protocol_version` and an authoritative `audio_format` (sample rate/encoding/channels) in the `ready` message — the client currently *guesses* TTS sample rate by provider name. | M | `src/ws/handler.ts`, `web/js/api.js`, `web/js/pages/playground.js:1240` |

### Tier 3 — Frontend / UX Rewrite: the Authoring Studio

> Verdict: **rewrite the JS/UX layer, keep the design tokens.** The full UX audit — including the **live running-app walkthrough**, the **4 runtime bugs (L1–L4)**, the **reusable workflow map**, and the **design direction** — is in §5. Phases below; build only after goahead.

| # | Item | Size | Dep |
|---|---|---|---|
| 3.0 | Tech-decision spike (reactive-vanilla vs Preact/Vite); lock tokens; extract one `utils.js` (`escapeHtml` ×7, `resolveAvatarUrl` ×5, etc.); add router teardown hooks | M | — |
| 3.1 | **App shell** — project switcher, section nav, resolved project name; remove the marketing header from in-app | L | 3.0 |
| 3.2 | **Shared components** — ARIA Tabs, Collection, Modal/focus-trap, Drawer, StatusPill, Slider; delete the 4 parallel tab systems + duplicate cards/chips | L | 3.0 |
| 3.3 | **Settings** rebuild with graceful key-status (fixes L1) + per-provider test/status | M | 3.2 |
| 3.4 | **Collections** — Knowledge + Tools on one component; raw JSON behind Advanced | M | 3.2 |
| 3.5 | **NPC Studio** — 3 guided stages (Identity → Personality & Voice → Knowledge & Behavior) + Advanced drawer + AI-seed + in-place dependency creation (replaces the 9-tab, ~91-control editor) | XL | 3.2, 3.4 |
| 3.6 | **Playground** — one chat column + one drawer; voice on demand; uses WS `audio_format`; no 500 pre-flight (degrades L2) | L | 3.2, 3.3 |
| 3.7 | **Project Home** + first-run checklist + 60-second path; Version history as a top-bar action (fixes the diff-modal binding bug) | M | 3.1, 3.5 |
| 3.8 | **Accessibility + responsive** pass — focus-visible, ARIA, contrast, reduced-motion, <1024px | M | 3.1–3.7 |
| L1 | Backend: `GET /:id/keys` must not 500 on unreadable secrets — graceful key-status (breaks Settings + Playground today) | S | — |
| L2 | Backend: `GET /:id/voices` must not 500 without a TTS key — empty list + prompt (breaks Voice tab today) | S | — |
| L3 | Single coherent auth state in local mode (no simultaneous Sign In + Sign Out) | S | 3.1 |
| L4 | Breadcrumb/app-shell always resolves the real project name (never literal "Project") | S | 3.1 |

### Tier 4 — Voice / Realtime Productization

| # | Item | Size | Files |
|---|---|---|---|
| 4.1 | **Delete `src/voice/interruption.ts`** — 188 lines of orphaned barge-in machinery imported nowhere, contradicting the "barge-in removed" design. | S | `src/voice/interruption.ts` |
| 4.2 | **Collapse ~3 s of stacked endpointing latency** (`utterance_end_ms:1500` + `AGGREGATION_WINDOW_MS:1500`) to one short settle driven off client `commit`. | M | `src/providers/stt/deepgram.ts:83`, `src/voice/pipeline.ts:124` |
| 4.3 | **Replace the fragile `pendingSTTFinal` boolean** with a per-utterance monotonic ID to robustly prevent double-processing; stop half-resetting the dedup state. | M | `src/voice/pipeline.ts:129,354-365,621-634` |
| 4.4 | **Harden providers:** clear the Deepgram accumulator + don't drop audio during reconnect backoff; make Cartesia event-driven (not 50 ms polling); pipeline TTS instead of awaiting serially per sentence; add outbound-audio backpressure (`bufferedAmount`). | L | `src/providers/stt/deepgram.ts:315`, `src/providers/tts/cartesia.ts:193`, `src/voice/pipeline.ts:826`, `src/ws/handler.ts:676` |
| 4.5 | **Use binary WS frames for audio** (today: float32→pcm16→base64→JSON every ~30 ms = +33% bandwidth + per-frame JSON parse). | M | `web/js/api.js:444`, `src/ws/handler.ts:281` |
| 4.6 | **Emit latency instrumentation** (commit→first-transcript→first-token→first-audio) and set a documented turn-latency budget. | S | `src/voice/pipeline.ts` |

### Tier 5 — Connect & reconcile the two runtimes (the actual product)

> The Unity client already exists and is *fat*. Tier 5 is about making the webapp **serve** it and keeping the two runtimes **honest** — not building an SDK from scratch.

| # | Item | Size | Files |
|---|---|---|---|
| 5.1 | **Implement the `/api/sync/*` backend** the Unity `CloudSync` layer calls (push/pull instance + definition state, history, rollback); reconcile shapes with `CloudSyncService`/`SyncQueue`/`SyncJob`. | L | new `src/routes/sync.ts`, `src/index.ts` |
| 5.2 | **Cross-runtime conformance tests + shared contract.** One canonical spec (prompts, pillar/salience rules, data schemas, `schemaVersion`); fixture-driven tests asserting TS and C# make the same decisions. Stops the dual-runtime drift (§4.7). | L | `src/core/*`, `Unity-SoulEngine/.../Core/*`, `tests/conformance/` |
| 5.3 | **NPC-as-Asset binding:** importer turning server NPC definitions into versioned Unity ScriptableObjects with a stable `GUID ↔ npcId` link (a web rename/delete must not silently break a scene). | L | Unity side + `src/routes/*` |
| 5.4 | **Cycle scheduler + deterministic/offline mode** — game-time hooks + seeded/rules-based fallback so studios ship reproducible, offline-tolerant builds. The C# `CycleRunner` already attempts offline — make it canonical. | L | `src/core/cycles.ts`, `Unity-SoulEngine/.../Core/CycleRunner.cs` |
| 5.5 | **Mind pre-gate for cost** — skip the always-on second LLM call on trivial turns; document a per-turn/per-session cost model; allow per-NPC "Mind off." | M | `src/routes/conversation.ts:208`, `src/core/mind.ts` |
| 5.6 | **BYOK quota/usage/billing surface** — enforce the `limits` JSONB that is modeled but ignored. | L | `src/storage/*/usage.ts`, `sql/01-schema.sql` |
| 5.7 | **Package & publish the Unity client** (UPM / `.unitypackage`) pinned to the versioned API (Tier 2.1) so the waitlist has a real download. | M | Unity side, `documentation/` |

### Tier 6 — Polish, Hygiene & Docs

| # | Item | Size |
|---|---|---|
| 6.1 | Delete `bun.lock` (keep `package-lock.json`); drop the "Bun" badge/install lines or commit to Bun; add `"engines": {"node":">=20"}`. | S |
| 6.2 | Single source of truth for version (import `package.json` version into `/health`; reconcile `1.0.0` vs `2.0.0`). | S |
| 6.3 | Fix `SDK_REFERENCE.md` Gemini imports (`GoogleGenerativeAI`, not `GoogleGenAI`/`Type`); reconcile "Gemini 2.0 Flash" vs code default `gemini-2.5-flash`. | S |
| 6.4 | Relocate `tts-test.ts` out of repo root; delete the contradictory `.env.example` and point README at the canonical templates. | S |
| 6.5 | Tighten CSP (drop `unsafe-eval`, move to nonce/hash for scripts); replace input-mutating sanitizer with output-encoding; treat the keyword moderator as a weak heuristic only. | M |
| 6.6 | Embedding-based recall for knowledge/memories (today: naive `includes()` substring — "art" matches "Bartertown"). | M |
| 6.7 | Settle the dual brand (`evolve-npc` package / "Evolve.NPC" logs vs "SoulEngine" product). | S |

---

## 4. Subsystem Findings (detailed appendix, with `file:line`)

> Severity: **P0** = broken/insecure in prod · **P1** = high · **P2** = medium · **P3** = low.

### 4.1 Core Cognition (`src/core/*`)

**Pillar status:** all five exist as real code (no pure stubs), but **Core Anchor enforcement** and **Weekly Whisper correctness** are broken.

- **[P1] BROKEN — Weekly Whisper drops high-salience memories** — `src/core/cycles.ts:195-241`. `retained = sorted.slice(0, retainCount)` keeps only top-3 by salience and discards the rest regardless of salience; promoted memories are also removed from STM even though `maxStmMemories=20`. The "layered memory" pillar silently forgets most of a busy week. `retainCount=3` contradicts `maxStmMemories=20`.
- **[P1] BROKEN — Core Anchor immutability never enforced** — `src/security/anchor-guard.ts:6-25`, `src/session/manager.ts:286-290`. `validateAnchorIntegrity` only returns a boolean and the save continues on violation; `enforceAnchorImmutability` is never imported. The real mutation surface (definition edits) is ungated.
- **[P2] BROKEN — Deferred recall context lost on voice reconnect** — `src/voice/pipeline.ts:925-928` stores it on a per-pipeline field (not session state), while `src/routes/conversation.ts:297-329` persists it → divergent durability + possible stale double-injection.
- **[P2] DOESN'T-MAKE-SENSE — Mind sends conversation as a system string with `messages:[]`** — `src/core/mind.ts:82-95,335-340`. Defeats provider prefix-caching (system prompt changes every turn).
- **[P2] DOESN'T-MAKE-SENSE — recall-tool exclusion reimplemented inline** (`name in {…}`) instead of the existing `isRecallTool()` — `src/core/mind.ts:99-100`. Plus two drifting tool-context formatters — `mind.ts:425-437` vs `conversation.ts:281-294`.
- **[P2] NEEDS-POLISH — naive substring recall, no ranking** — `src/core/mind.ts:202-206,244-247` ("art" matches "Bartertown").
- **[P2] NEEDS-POLISH — uncapped knowledge/memory token cost**; `checkContextBounds` never called — `src/core/context.ts:679-714`.
- **[P2] NEEDS-POLISH — Persona Shift parses arbitrary LLM JSON with a greedy regex, no schema** — `src/core/cycles.ts:364-380`.
- **[P1] GAME-ENGINE-GAP — cycles are manual HTTP only**, no scheduler/determinism — `src/routes/cycles.ts`, `src/index.ts:402`.
- **[P1] GAME-ENGINE-GAP — ≥2 LLM calls per turn always** (Speaker + always-on Mind, +1 for MCP follow-up); no cheap path — `src/routes/conversation.ts:208-238,304-321`.

### 4.2 Voice & Realtime (`src/voice/*`, `src/ws/*`, providers)

- **[P0] BROKEN — prod voice dead: WS binds `PORT+1`, never attached to HTTP server** — `src/index.ts:306`. No `upgrade` handling; Render routes one port. *Definitive: voice cannot work in production.*
- **[P0] BROKEN — client dials unreachable `wss://host:444`** — `web/js/api.js:344-346` (`httpPort+1`, and `location.port` is `''` on HTTPS).
- **[P1] DOESN'T-MAKE-SENSE — the correct single-port handler exists but is never mounted** — `src/ws/handler.ts:163-218` (`createVoiceWebSocketHandler`). The dead path is the right one.
- **[P1] DOESN'T-MAKE-SENSE — `src/voice/interruption.ts` is 188 lines of dead, contradictory code** (imported nowhere; barge-in is a documented no-op).
- **[P1] NEEDS-POLISH — fragile `pendingSTTFinal` double-processing guard** — `src/voice/pipeline.ts:129,354-365`; `resetTranscriptState` half-resets dedup — `pipeline.ts:621-634`.
- **[P2] BROKEN — Deepgram reconnect drops mid-utterance audio + concatenates stale segments** — `src/providers/stt/deepgram.ts:315-336,167-179`.
- **[P2] DOESN'T-MAKE-SENSE — `finalize()` is a no-op so `commit()` flush does nothing** — `deepgram.ts:362-368`; **~3 s stacked endpointing latency** — `deepgram.ts:83` + `pipeline.ts:124`.
- **[P1] GAME-ENGINE-GAP — no versioned wire protocol; `audio_format` undiscoverable; base64-JSON audio framing** — `src/ws/handler.ts:23-130`, `web/js/pages/playground.js:1240`, `web/js/api.js:444`.
- **[P2] GAME-ENGINE-GAP — WS accepts any existing `session_id`, no auth, unbounded provider sockets** — `src/index.ts:336-351`.

### 4.3 Storage & Data Model (`src/storage/*`, `sql/*`, `data/*`)

- **[P0] BROKEN — dual contradictory backend selectors → split-brain** — `src/storage/index.ts:14-18` (static `NODE_ENV`) vs `src/storage/hybrid.ts:13-18` (per-request `userId`); core reads use the static one (`mind.ts:163,319`, `context.ts:334,503`).
- **[P0] BROKEN — local usage append is an unlocked read-modify-write** — `src/storage/local/usage.ts:41-66` (concurrent turns lose token/cost data; Supabase uses an atomic RPC).
- **[P0] BROKEN — secrets unrotatable + non-portable** — `src/storage/local/secrets.ts:61-96` vs `src/storage/supabase/secrets.ts:49-85` (different formats; `ENCRYPTION_KEY` change = permanent loss; no `key_version`).
- **[P0] BROKEN — local definition history is fully stubbed** — `src/storage/local/definitions.ts:415-437` (`getDefinitionHistory→[]`, `rollbackDefinition` = no-op returning current) while Supabase is real → the interface lies.
- **[P1] BROKEN — ID-validation regexes diverge** (`local/definitions.ts:405` anchored two-segment vs `supabase/definitions.ts:396` unanchored); same for projects.
- **[P1] BROKEN — Supabase silently destroys knowledge `description`** — `src/storage/supabase/knowledge.ts:19,338` (hardcodes `''`).
- **[P1] BROKEN — instance `version` is a timestamp locally, an int in Supabase** — `local/instances.ts:259` vs `supabase/instances.ts:174,224`; snapshot keys aren't portable.
- **[P1] BROKEN — no optimistic locking on instance saves** — both backends; Supabase additionally inserts duplicate version rows.
- **[P1] DOESN'T-MAKE-SENSE — reads cast DB/JSON straight to types, zero runtime validation** — e.g. `supabase/definitions.ts:149-170`.
- **[P1] NEEDS-POLISH — definition history is unbounded in Supabase** (`stateHistoryMaxVersions` enforced for instances only); **O(n) full-scan listings, no pagination**.
- **[P0] GAME-ENGINE-GAP — no documented, versioned data contract; YAML ↔ TS ↔ SQL shapes differ**; **no local→cloud migration path**.

### 4.4 API, Session, Security & MCP (`src/routes/*`, `src/session/*`, `src/security/*`, `src/mcp/*`, `src/index.ts`)

- **[P0] BROKEN — cross-tenant IDOR on every project-scoped endpoint** — server uses `getSupabaseAdmin()` (service-role, bypasses RLS); routes authorize via existence check only; `Project` type lacks `user_id`. Read/modify/delete any tenant. — `src/storage/supabase/projects.ts:97-135`, `src/routes/projects.ts:140,185,402` (+ `npcs.ts`, `knowledge.ts`, `mcp-tools.ts`, `session.ts`).
- **[P0] BROKEN — theft of API keys / transcripts / LLM billing** follows from the IDOR — `src/routes/projects.ts:213-389,938-1009,1058-1100` (`import-keys`, `api-key`, `transcripts`, `generate-npc-content`).
- **[P0] BROKEN — instance-level IDOR + backend confusion on unauth instance routes** — `src/routes/history.ts:213-235`, `src/routes/cycles.ts:285-307`.
- **[P1] BROKEN — 503 catch-all shadows history routes** registered after it — `src/index.ts:202-213`.
- **[P1] DOESN'T-MAKE-SENSE — "optional auth" tied to `NODE_ENV`** → self-host defaults to no auth, shared local files — `src/middleware/auth.ts:7-9,51-56`.
- **[P1] DOESN'T-MAKE-SENSE — game-client key gates only `session/start`**, not messages/history/end/WS; session IDs are low-entropy base36 — `src/routes/session.ts:71-83`, `src/session/manager.ts:76-78`.
- **[P1] NEEDS-POLISH — rate limiter in-memory, per-process, bypassable via client `player_id`**; expensive endpoints unlimited — `src/security/rate-limiter.ts:11-66`.
- **[P2] NEEDS-POLISH — sanitizer mutates content + misses injection; moderator is a 19-phrase substring list**; input-length limits disagree (500 vs 2000) — `src/security/sanitizer.ts:7-44`, `src/security/moderator.ts:15-45`.
- **[P1] NEEDS-POLISH — inconsistent REST envelopes/status codes; `details` leaks internals** — across routes.
- **[P0] GAME-ENGINE-GAP — no API versioning** (`/api/...`) — `src/index.ts:108-213`.
- **[P1] GAME-ENGINE-GAP — no server→client callback channel for game-event tools; no idempotent session resume; multi-instance unsupported** — `src/mcp/registry.ts:132-142`, `src/session/store.ts`.
- **[P1] CORS/CSP — `origin→'*'` for credentialed model is a smell; CSP allows `unsafe-inline` *and* `unsafe-eval`** — `src/index.ts:47,55-69`.

### 4.5 Frontend JS Architecture (`web/js/*`) — **verdict: REWRITE**

No build, no framework; **state = global mutable vars + the DOM**; every page is `renderTemplate → fetch → innerHTML string → re-query → addEventListener`; the router never tears anything down.

- **[P1] BROKEN — `/projects/new` route unregistered** → primary landing CTA silently falls through to `:projectId='new'` and 404s — `web/js/app.js:52-74`, `landing.js:158,166`.
- **[P1] BROKEN — diff-modal buttons wired in a module-load `DOMContentLoaded`** before the template exists → never bound — `web/js/pages/npc-editor.js:2476-2494`.
- **[P2] BROKEN — voice WS port+1 assumption** (mirror of 4.2) — `web/js/api.js:343-346`.
- **[P1] DOESN'T-MAKE-SENSE — no router teardown; `landing.js` `cleanup()` never called** → `requestAnimationFrame` + listeners leak on every navigation — `web/js/router.js:58-85`, `landing.js:36-41`, `BrainVisualization.js:437`.
- **[P1] DOESN'T-MAKE-SENSE — three disagreeing "missing key" pathways; 503 inferred by regex on error text** — `web/js/pages/playground.js:209-216,411-426,547`.
- **[P1] NEEDS-POLISH — duplication tax:** `escapeHtml` ×7, avatar resolver ×5, import/export triplet ×3; FormData uploads bypass the API client.
- **Reusable assets for the SDK:** `web/js/api.js:96-304` (endpoint catalog) and `VoiceClient` `api.js:309-477` (WS taxonomy + audio/VAD constants) — **port these, discard the rest.**

| File | LOC | ~% duplicated boilerplate |
|---|---|---|
| `npc-editor.js` | 2,523 | ~45% |
| `playground.js` | 2,183 | ~35% |
| `mcp-tools.js` | 816 | ~40% |
| `dashboard.js` | 723 | ~30% |
| `knowledge.js` | 548 | ~40% |

### 4.6 CSS / Design System / UX (`web/css/*`, `web/index.html`) — **verdict: keep tokens, REWRITE the IA**

- **[P0] BROKEN — undefined tokens render breakage:** `--accent-primary-rgb` undefined → landing renders old indigo, not ember (`web/css/pages.css:542+`, 9 sites); five phantom `--bg-secondary/-border-primary/…` in `web/css/conversation-modes.css:6,8,19,21`.
- **[P1] DOESN'T-MAKE-SENSE — `pages-app.css` (5,389 lines) re-defines components instead of extending** — `.npc-card`, `.tool-card`, knowledge accordion, `.mood-bar` each defined 2–3×; dead `display:none` "compat" classes (`:113-119`); abandoned `.flowchart-v2` family (`~780-894`).
- **[P1] DOESN'T-MAKE-SENSE — token bypass:** ~80 raw hex + ~159 `rgba()` across files; `unity-cloud.css` uses **zero** tokens.
- **Component scores (lowest):** Tabs **3/10** (4 parallel systems, not ARIA), Panel **4/10**, Slider **5/10** (no Firefox thumb, no focus ring), Input **6/10** (no error/disabled).
- **[P0] A11y — no component `:focus-visible`** (only one global rule); tabs aren't real tabs; `--color-text-tertiary` ≈3.6:1 and `--color-text-muted` ≈1.9:1 on `#0d0d0d` (WCAG fail); 9–10px content text; no `prefers-reduced-motion`.
- **[P1] No mobile story <1024px** for the authoring app (editor is fixed 3-column; playground multi-panel).
- **UX-IA:** NPC editor crams **~100–120 controls across 9 tabs** with no onboarding, circular cross-screen dependencies (Knowledge/Tools/Network must be built elsewhere first), duplicate Personality sliders, and an *inverted, unexplained* memory-retention slider. See §5.

### 4.7 Integration / SDK / Packaging / Deployment

- **[P0] BROKEN — the `/api/sync/*` backend the Unity `CloudSync` layer needs is absent from this webapp** — no `src/routes/sync.ts`, no `/api/sync` registration in this branch, despite the Unity SDK (`CloudSyncService`/`SyncQueue`/`SyncJob` at `E:/Evolve-NPC/Unity-SoulEngine/SoulEngine/Assets/SoulEngine/CloudSync/`) and a 2026-03 MEMORY note assuming it. The fat client has no server to sync against here.
- **[P0] DOESN'T-MAKE-SENSE — Dual-Runtime drift (the new headline integration risk).** The cognition stack is implemented **twice** — TS (`src/core/*`) and C# (`Unity-SoulEngine/.../Assets/SoulEngine/Core/*`: `MindAgent`, `MemorySystem`, `CycleRunner`, `PersonalityEngine`, `ContextAssembler`). There is no shared spec, no conformance test, no schema version tying them together, so behavior (and the bugs in 4.1) can diverge per platform. **Fix:** declare ONE canonical contract (prompts, pillar rules, data shapes, salience math) and add cross-runtime conformance tests (same input fixture → same decision in TS and C#). See NEW-SPEC 2.9.
- **[P0] BROKEN — voice dead in prod** (mirror of 4.2) — `render.yaml` single port vs `src/index.ts:306`.
- **[P1] DOESN'T-MAKE-SENSE — `SDK_REFERENCE.md` Gemini import is wrong** (`GoogleGenAI`/`Type` vs installed `GoogleGenerativeAI`).
- **[P2] DOESN'T-MAKE-SENSE — Bun front-and-center, project runs on Node/tsx**; dual lockfiles; `1.0.0` vs `2.0.0`; `.env.example` contradictory; `tts-test.ts` in root.

**Doc-vs-Reality drift (top rows):**

| Claim | Reality | Sev |
|---|---|---|
| "Runtime: Bun" + `bun add` everywhere | Node/tsx; CI + Render use `npm ci`; Bun never invoked | P2 |
| `ws://localhost:3001/ws/voice` | unreachable in production (single port) | P0 |
| Unity C# SDK "coming soon" | **already substantially built** (~full C# runtime + CloudSync) at `E:/Evolve-NPC/Unity-SoulEngine/SoulEngine`; README undersells it | P2 |
| `POST /api/sync/instance`, `SyncManager` (Unity `CloudSync` depends on it) | **no `/api/sync` route in this webapp branch** — the fat client has no server to sync against | P0 |
| package `1.0.0` | `/health` reports `2.0.0` | P2 |
| default "Gemini 2.0 Flash" | code default `gemini-2.5-flash` | P3 |

---

## 5. Frontend UI/UX Audit & Proposed Redesign

**The core problem is information architecture, not styling.** The design-token layer (~115 custom properties, full type/space/radius/shadow scales, a light-theme block) is genuinely good and worth keeping. What sits on top of it is the issue: a 5,389-line page stylesheet that bypasses the tokens, four parallel tab systems, abandoned in-place redesigns, and an authoring flow that dumps ~120 controls across 9 tabs on a first-time user with zero scaffolding.

### Live audit (running app, 2026-06-21)

The app was run locally (`npm run dev`, local mode) and **every page driven in a real browser via the Claude-in-Chrome extension** (screenshots + live DOM, computed styles, console, network): landing, projects, dashboard, NPC editor (Basic + Voice), settings (Project + API Keys), playground, knowledge. **Overall UX score: 52/100** — a genuinely competent visual foundation (dark `#0d0d0d`, DM Sans + JetBrains Mono, ember accent, geometric-glyph icons, a **3-pane NPC editor with a live preview**, organized reference sidebars) held back by **brand inconsistency, two silent-failure bugs, authoring density, cross-page dependencies, and accessibility gaps.** *(An earlier DOM-only pass overstated several issues — see "Visual-pass corrections" below; this section reflects the real screenshots.)*

**Runtime bugs found by driving the app:**

| # | Sev | Bug | Fix |
|---|---|---|---|
| L1 | P1 | `GET /:id/keys` → **500** (secret decrypt failure) handled silently → the API-keys form shows **empty / "not set" even when keys exist-but-unreadable**; the dashboard "API Keys Not Set" banner is then wrong, with no recovery prompt | return a recoverable status (`{configured, readable:false, reason:"encryption_key_changed"}`) and surface "re-enter keys" — never a silent 500 |
| L2 | P2 | `GET /:id/voices` → **500** → editor Voice tab shows a **dead-end red "Failed to load voices"** with no recovery path (Speed/Preview still render) | degrade to an empty list + "add a TTS key in Settings" prompt; don't 500 |
| L3 | P2 | Header shows **Sign In + Sign Out + avatar simultaneously** in local mode | one coherent auth state (hide auth in local mode) |
| L4 | P2 | Breadcrumb renders literal **"Project"** on Knowledge/MCP/Playground but "BLAST" on Settings | resolve the project name once in the app shell |

*(L1/L2 surfaced here via a key mismatch on existing data, but the graceful-degradation gap is real: a fresh project with no TTS key still 500s `/voices`, and any `ENCRYPTION_KEY` change bricks Settings.)*

**Density confirmed live:** NPC editor = **9 tabs, ~91 controls** (33 inputs, 15 sliders, 5 selects, 36 buttons), **no ARIA tab semantics**, an emoji `🔊` mixed into the geometric-glyph tabs. Playground = **8 panels at idle** + a 2×2 input/output mode matrix. Dashboard = **8+ stacked sections**. No app shell (marketing header reused in-app); raw project ids shown on cards; `{ } Edit JSON` surfaced to newcomers; Knowledge & MCP Tools are duplicate CRUD pages.

### Visual-pass corrections (what the screenshots changed)

The real UI is more competent than a DOM-only read implied — corrected here:
- **In-project section nav exists** (`Projects · Dashboard · NPCs · Knowledge · MCP Tools · Playground · Settings`, active-underlined) — *not* "no app shell." Real gaps: the nav still carries the **marketing GitHub/heart**, there's **no project switcher** (only a "Projects" link back), and the **project-list page uses only the marketing header**.
- **The NPC editor is a clean 3-pane** (left rail · form · **LIVE PREVIEW** with personality bars + mood) — worth keeping. The issue is the **count** (9 rail sections / ~91 controls + cross-page deps), not layout chaos.
- **The Playground is a clean 3-pane** (NPC selector · chat/setup · WORLD CONTEXT reference sidebar) — *not* "8 competing panels." Real friction = the **2×2 Text/Voice mode matrix** (4 buttons for one concept).
- **L1/L2 degrade silently / dead-end, not white-screen** (severities refined above).

**New finding — brand inconsistency (visual):** the **landing page uses a pastel-rainbow palette** (pink/teal/purple hero words, pastel pillar circles) that clashes with the **ember "Instrument Panel" identity** of the authoring app. Unify on one palette in the Tier 3 design direction.

### Reusable workflow map (re-run after fixes for the round-2 re-audit)

Walk these against the live app and confirm each friction point is gone:
- **W1 — Zero-to-talking NPC:** land → create project → create NPC → talk. *Friction:* blank 9-tab editor, blocked by no API keys, Settings 500s (L1). **Target: talking NPC in <60s.**
- **W2 — Personality & voice:** Personality (6 sliders + preset) → Voice. *Friction:* Voice tab 500s (L2); raw Big Five, no archetype-first; inverted "Memory Retention" slider.
- **W3 — Knowledge + tools + relationships:** *Friction:* each must be built on a separate page first (circular dependency); target = create inline from the Studio.
- **W4 — Test a conversation:** pick NPC → 2×2 mode → identity → start. *Friction:* 8 competing panels; pre-flight 500 (L1). Target = one chat column + one drawer.
- **W5 — Providers / keys:** Settings → API Keys. *Friction:* key-status 500 (L1); emoji tabs; no per-provider "test key".
- **W6 — Iterate / roll back:** History tab. *Friction:* diff-modal buttons unbound; versioning bolted onto the editor → make it a top-bar action.

### The Authoring Studio — design direction

Commit to one aesthetic: **"the Instrument Panel"** — a calm, high-contrast dark control room for cognition, built on the existing tokens (near-black canvas, warm ink, ember accent reserved for *state and action*, DM Sans UI + JetBrains Mono data + one distinctive display face for titles). One glyph language (drop the stray `🔊`/`⚙`/`🔑` emojis), accent discipline, motion behind `prefers-reduced-motion`. Not a generic dashboard template.

### Where config is "all over the place"
1. **Circular cross-screen dependencies.** Setting an NPC's Knowledge Access requires leaving to build categories on the Knowledge page first; same for MCP Tools and Network. The editor assumes the rest of the project already exists.
2. **Expert concepts exposed raw** — trauma flags, salience threshold (surfaced as an *inverted* "Memory Retention %"), Big Five psychometrics, familiarity-tier weighting, version diffing — no tooltips, no defaults explained.
3. **Duplicate/parallel controls** — Personality sliders exist in two places; player-recognition appears in both editor and playground; conversation mode is configured apart from the Start button it gates.
4. **No "first NPC" path** — the editor opens on a blank 9-tab form (despite starter packs + AI-generate existing but un-stitched).

### Proposed IA — "keep the paint, rebuild the floor plan"

```
Project
 └─ Create NPC  (guided)
     1. Identity*            name · concept · [Generate with AI] → fills backstory + traits
     2. Personality & Voice  8 preset cards · (Fine-tune ▸ sliders) · voice + Preview
     3. Knowledge & Behavior add-in-place: knowledge tiers · tools · relationships
     ▸ Advanced (off)        schedule · trauma flags · memory presets (Forgetful/Normal/Sharp) · raw JSON
     → drops into a Playground preview with the NPC already talking
 └─ Playground   single text chat by default
     ▸ right drawer (one at a time): NPC State · Cycles · World Context · Mind
     ▸ Voice mode unlocks VAD + pipeline trace on demand
 └─ Version history  (top-bar action, not a creation step)
```

**Target experience:** a developer should be *talking to a working NPC within 60 seconds* (Identity → "Generate with AI" → live preview), opening stages 2–3 only to customize, with everything advanced hidden until asked for.

**Refactor-vs-rewrite:** CSS tokens + `components.css` → **refactor** (fix 3 token bugs, consolidate primitives, a11y, mobile). Authoring UX/IA + the 2,500-line page JS → **rewrite** on top of the existing tokens.

---

## 6. How to Use This Document (for the next session/agent)

1. **Start at Tier 0.** Every item there is independently shippable and most are `S`/`M`. The two highest-leverage single fixes: **0.1+0.2 (prod voice)** and **0.3 (IDOR)**.
2. **Each finding carries a `file:line`** — open it cold and the context is self-contained.
3. **Don't start the UI rewrite (Tier 3) before freezing the contract (3.1).** `web/js/api.js` + `VoiceClient` are the SDK's source of truth and must stop drifting first.
4. **The forward-looking product features live in [`NEW-SPEC.md`](NEW-SPEC.md).** AUDIT.md = fix what exists; NEW-SPEC.md = build what makes it a product.
5. When this is promoted to execution, spin a `backlog.md` from the Tier tables (one row → one tracked task).
