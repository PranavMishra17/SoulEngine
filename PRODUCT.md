# Product Definition — target state

> **What this is.** The decided shape of the finished product: what is sold, what runs where, what the
> backend is responsible for, and what it is deliberately not responsible for. This is the "north star"
> document. [`NEW-SPEC.md`](NEW-SPEC.md) is the feature roadmap; [`AUDIT.md`](AUDIT.md) is the defect
> register; [`backlog.md`](backlog.md) is the tracked work. This doc sits above all three and tells them
> what they are building toward.
>
> **Status: PROPOSAL.** Sections marked `DECIDED` are settled. Sections marked `OPEN — research` are
> deliberately unresolved pending the industry-research pass, and are the input to it.
>
> **Name: SoulEngine.** `DECIDED 2026-09-05.` This settles backlog 6.7 (the dual-brand item): SoulEngine
> is the product name everywhere. The `evolve-npc` npm package name and the "Evolve.NPC" string in log
> output and `documentation/SDK_REFERENCE.md` are legacy and must be retired, not carried alongside.

---

## 1. Ground truth (verified 2026-09-05)

Everything in this section was checked against the code, not the docs.

### 1.1 The TypeScript backend is healthy

- `tsc --noEmit` clean; **257 tests passing** across 39 files, 0 failures.
- 98 TS files. Audit Tier 0 (8/8) and Tier 1 (14/14) complete; Tier 2 API contract 11/12.
- Versioned API is live: one Hono sub-app mounted at both `/api/v1` (canonical) and `/api`
  (legacy, with `Deprecation`/`Sunset` headers).
- Secrets are properly handled: AES-256-GCM with a versioned envelope and a rotate routine.

### 1.2 The backend has zero commercial layer

Confirmed by exhaustive grep of `src/` and `sql/` for
`entitlement|license|purchase|subscription|seat|billing|stripe|quota|plan_id|activation`:

- No purchase or order record. No payment integration of any kind.
- No entitlement, license, seat, plan, or org/team concept. Multi-tenancy is exactly one level:
  `projects.user_id -> profiles.id`.
- No quota enforcement. `project_usage` accumulates totals and is **read by exactly one route, for
  display**. Nothing ever gates on it.
- No concept of a shipped build, a release, or a per-install activation.

The nearest existing seams to build a commercial layer onto:

| Seam | What it already has | What it needs |
|---|---|---|
| `ProjectSettings.game_client_api_keys[]` | `id`, `name`, `hash` | `created_at`, `expires_at`, `entitlement_id`, `last_used_at` |
| `project_usage` | accumulates the exact metric a quota would gate on | a reader that enforces |
| `checkSessionLifecycleAuth` | the single funnel every game-client request passes through | nothing — this is the right chokepoint |

### 1.3 The backend's auth has real holes

These are not blockers for this proposal, but they must not survive into a paid product.

- **All auth and all ownership enforcement is disabled unless `NODE_ENV === 'production'`**
  (`src/middleware/auth.ts:9-11`; `ownership.ts:33` short-circuits to `true`).
- **Ownership is opt-in per handler, not middleware.** The single-NPC routes
  (`GET/PUT/DELETE /projects/:projectId/npcs/:npcId`, avatar, history, rollback, reset — `npcs.ts:511`
  through `:1030`) never call it.
- The Supabase client is the **service-role** client, which bypasses every RLS policy in
  `sql/02-rls-policies.sql`. So for those unchecked routes, RLS is not a backstop.
- Game-client key enforcement is **opt-in per project**: `session.ts:74` only enforces
  `if (hasLegacyKey || hasNamedKeys)`. A project with no key configured accepts anonymous session starts.
- Issued `session_token`s **survive key revocation** — nothing re-checks mid-session.
- The rate limiter's `key:` tier is dead: the one call site passes `gameKeyHash: undefined`
  (`conversation.ts:113`), so every game client keys on `ip:`. Two clients behind one NAT share a bucket.
- **The voice WebSocket does not use BYOK.** `src/index.ts:392-430` pulls Deepgram/Cartesia/ElevenLabs
  and the LLM key from **server env vars**. Text conversations bill the developer's key; voice
  conversations bill yours.

### 1.4 The Unity SDK is large, real, and not runnable as configured

59 `.cs` files, 12,772 lines, one asmdef (`SoulEngine.Runtime`), namespace `SoulEngine`. Substantial
implementations: 4 LLM providers with SSE streaming, Deepgram STT, Cartesia + ElevenLabs TTS, a
773-line voice pipeline orchestrator, a 564-line Mind agent, 521-line cycle runner. Exactly one true
stub file (`PiperSession.cs`).

**Compile state: clean.** Settled 2026-09-05 by a headless
`Unity.exe -batchmode -quit -nographics` run against Unity 6000.3.11f1: **zero `error CS` lines,
exit code 0**. The `CS0101`/`CS0708`/`CS0722` errors on `SoulEngine.ToolResult` found in the
2026-03-18 editor log were stale. The code builds today.

Runtime blockers, in severity order:

| # | Blocker | Evidence |
|---|---|---|
| B1 | **Default config throws on first conversation.** `UseBackendProxy` defaults `true`; `GetLLMConfig()` unconditionally throws in that mode; every caller invokes it unguarded. | `SoulEngineConfig.cs:49`, `:203-205`; `NPCConversationController.cs:127-128` |
| B2 | **Backend Proxy mode has no implementation.** No proxy provider class exists. `RuntimeLlmProvider`/`RuntimeTtsProvider` are populated and read by nothing. **Superseded by the D2 decision:** do not build proxy mode. Build *broker-token mode* instead — the SDK fetches a short-lived credential from the developer's broker and calls the provider directly (§3.3 Option B). | grep for `proxy` returns only flags, tooltips, and doc comments |
| B3 | **The paywall does not exist.** `StartSessionAsync` has zero auth checks and zero network calls. `Config.IsReady` is never read. A 401 bootstrap only logs. | `SessionManager.cs:40-125`; `SoulEngineBootstrapper.cs:112` |
| B4 | **NPC social network never reaches the prompt.** The `byTier` dictionary is built, never populated (a `TODO`), and the function always returns `string.Empty`. Every NPC with a network logs a warning per entry per turn. | `ContextAssembler.cs:357-359`, `:396-401` |
| B5 | **MCP tools are never loaded into sessions.** `McpTools` is hardcoded to an empty list; `McpToolLoader` is never called; `GetToolDefinitions()` returns empty by construction. | `SessionManager.cs:98`; `McpToolRegistry.cs:131-141` |
| B6 | **Rate limiting is `return true`.** The real 90-line `RateLimiter.cs` and 104-line `CooldownTracker.cs` are referenced by nothing. | `VoicePipeline.cs:690-691` |
| B7 | **Voice cannot run as shipped.** `StreamingAssets/SoulEngine/Models/` is empty; `silero_vad.onnx` is required and absent. | `NPCConversationController.cs:150-151` |
| B8 | **CloudSync URLs are probably wrong.** Code builds `{SyncEndpointUrl}/sync/instance`; the documented route is `/api/sync/instance`. The shipped config asset leaves `SyncEndpointUrl` empty, so sync silently never initializes. | `CloudSyncService.cs:65`, `:109`; `SoulEngineBootstrapper.cs:274` |
| B9 | `SyncQueue.Dispose()` logs "Discarding remaining job" instead of flushing. Any sync from the last 5 s before quit is lost. | `SyncQueue.cs:89-93` |
| B10 | Not packaged. No `package.json`, no `.unitypackage`, no samples, no LICENSE, no editor tooling. | — |
| **B13** | **SUBMISSION-BLOCKING. `SoulEngineConfig.asset` carries `LlmApiKey`/`MindApiKey`/`TtsApiKey`/`SttApiKey` as fields on a ScriptableObject that ships in the build.** Unity Submission Guidelines §1.5.b: *"Third-party API keys are not stored in ways that would incorporate the key into project builds (for example, inside any script or GameObject that would be included in a scene)."* The package as it stands would fail submission. Fixed by broker-token mode (W2b). | `SoulEngineConfig.cs:34` and the shipped `Assets/SoulEngineConfig.asset`; [`research/03-marketplace-and-multi-engine.md`](research/03-marketplace-and-multi-engine.md) §Q4 |

**Process problem, now fixed:** until 2026-09-05 this entire 12.7k-line body of code was **untracked by
git** — no history, no CI, no PR path, no review, no protection against loss. It now has its own
repository; see §4 W0.

### 1.5 The sync backend does not exist on `main`

There is no `src/routes/sync.ts` on `main`. A local-only branch `feat/unity-sdk-sync-endpoints`
(one commit, 2026-08-25, +304 lines, never pushed) adds:

- `POST /api/sync/instance` — **completely unauthenticated.** No key, no JWT, no ownership check. It is
  an arbitrary write into `npc_instances` for any known project/definition/player triple. It also uses
  the deprecated module-scoped storage selector rather than `getStorage(userId)`.
- `GET /api/projects/:id/unity-config` and `/unity-bundle` — key-gated, but the hash comparison is a
  plain `!==` rather than `timingSafeEqual`, they ignore the named-key array entirely, and both call
  `getStorage(undefined)`, which **always resolves to local file storage** — so on a Supabase
  deployment they read from the wrong backend.

That branch is a prototype. It should be treated as a sketch of intent, not as work to merge.

---

## 2. The three contradictions

This is the grand sanity check. Each of these is a place where the code, the docs, and the stated
business model give three different answers to the same question.

### Contradiction 1 — Where do the developer's provider keys live?

| Source | Answer |
|---|---|
| TS backend code | **Proxy.** Keys never leave the server; every LLM/TTS/STT call is made server-side. |
| Unity SDK docs | **Proxy.** "Your API keys never reach the player's device." |
| Unity SDK code | **Direct.** Every key is read from a `ScriptableObject` that ships in the build and sent in a request header — Gemini's is in the **query string**, Cartesia's is in the **WebSocket URL**. |
| Stated business model | **Direct.** "Nothing wires through my website but this authentication layer." |

This must be resolved before anything else, because it determines the entire topology.

**The consequence that has not been priced in:** in the direct model, the *developer's* Anthropic /
OpenAI / ElevenLabs keys ship inside every copy of their game. Those are extractable in minutes. A
leaked license key of yours is a piracy problem; a leaked provider key of theirs is **an uncapped bill
charged to your customer**. That is a far worse failure mode, it is the customer's money rather than
yours, and it is the reason every commercial vendor in this space proxies.

`OPEN — research.` See §5, Q1 and Q2.

### Contradiction 2 — One cognition runtime, or one per engine?

Cognition is implemented **twice today** (TS `src/core/*`, C# `Assets/SoulEngine/Core/*`) with **no
shared spec and no conformance tests**. This is already flagged P0 in the audit. The stated goal adds
Unreal and Godot, which under the current model means a **third** implementation in C++ and a **fourth**
in GDScript.

Four hand-maintained implementations of the same memory/personality/cycle logic, by one person, is not
a maintainable product. It is also directly at odds with "I want to play with the agent infra" — every
change to the mind would need porting four times.

`OPEN — research.` See §5, Q3 and Q6.

### Contradiction 3 — The agent infrastructure has been overhauled twice on feel

Stated history: an NPC infra was built, overhauled into parallel Mind+Speaker (two concurrent turns:
memory fetching and direct answering), then partially overhauled back. Current documented behavior is
that Mind and Speaker run in parallel and **recall results are deferred to the next turn's speaker
prompt** — meaning if a player asks a memory question, the NPC answers it one turn late.

That deferral is the most likely source of "outdated and a bit slow." But it has never been measured.

**A third overhaul without measurement will land where the first two did.** Before changing the mind
again, there must be a way to say "turn latency went from X ms to Y ms" and "recall accuracy went from
A to B" with numbers. That harness is cheap and it is a prerequisite, not a nice-to-have.

`DECIDED` — see §3.6.

---

## 3. Recommendations

### 3.1 What the license key should do — `DECIDED`

**Signed offline license, plus an optional non-blocking heartbeat.** Not a per-launch online check.

Mechanism:
1. The developer requests a license for a project from the web studio. The backend issues an
   **Ed25519-signed blob**: project id, bundle identifier, feature flags, issue date, expiry.
2. The blob ships in the build as an asset. The SDK verifies it **offline** against a public key
   embedded in the SDK.
3. Optionally and asynchronously, the SDK fires one anonymous telemetry ping. It never blocks, never
   gates, and its failure is invisible to the player.

Why, rather than the obvious "phone home at startup":

- **A key in a shipped binary is extractable regardless of the mechanism.** Anything built on the
  assumption of secrecy is theatre. Design for a deterrent, and be honest about it.
- **A per-launch online check makes your uptime your customers' uptime.** If your Render instance is
  down, every game shipped by every customer has broken NPCs. That is an unacceptable liability to take
  on for a one-time asset sale.
- **The cost shape is wrong.** One-time revenue, perpetual per-player traffic, growing with your
  customers' success. You would be paying more the better they do.
- **Offline works.** Games get played on planes, at LAN parties, in demo booths with no wifi, and by
  QA on air-gapped build machines.
- Revocation still exists — it applies at the customer's *next build*, which is the right granularity
  for a licensing decision anyway.

### 3.2 Move the moat off the runtime and onto the studio — `DECIDED`

The strongest version of this business is not DRM on a DLL. It is:

> **The engine SDK is the client. The web authoring studio is the product.**

The SDK on a player's machine is inherently unprotectable. The authoring studio — where NPCs are
written, personalities tuned, knowledge bases built, versions diffed and rolled back, and packs shared
— is **server-side, genuinely gateable, and already built**. It is also the thing that is actually hard
to replicate.

This reframing is worth taking seriously because it makes the licensing problem *much* cheaper: you
already have working auth on the studio. You do not need to build DRM at all; you need to build
entitlements on an account, which is a normal SaaS problem with normal solutions.

It also means the Tier 3 Authoring Studio rewrite (currently 0/13, "awaiting goahead") stops being
optional polish and becomes the primary product surface.

### 3.3 Topology — `DECIDED 2026-09-05: Option B`

> **RESEARCH COMPLETE 2026-09-05.** See [`research/01-commercial-and-topology.md`](research/01-commercial-and-topology.md).
> **Option A is out.** A fourth option was surfaced by the research and is added below.

**Option A — Fat client, direct to providers.** What the C# code does today. **RULED OUT.**
- Ruled out because: OpenAI prohibits it in writing ("Never deploy your key in client-side
  environments", plus "Requests should always be routed through your own backend server"); ElevenLabs
  prohibits it in guidance; **Convai — the nearest peer vendor — shipped this mode, then documented that
  the key is recoverable from the build and engineered an Auth Token mode to replace it**; ACM CCS 2025
  work confirms such keys are extracted from distributed binaries and frequently never revoked; and a
  tooled resale market for harvested AI credentials means exposure is unbounded — landing on the
  *customer's* account, not yours.
- The original objections stand too: N runtimes for N engines, permanent TS↔C# drift.

**Option B — Fat client, developer-run key broker. ← DECIDED.** Cognition stays in-engine; a small
stateless token-vending endpoint the developer deploys (or that you host as a paid managed tier) holds
the provider keys and mints short-lived scoped credentials.
- **Validated as the industry-standard pattern**, documented first-party by OpenAI (ephemeral keys via
  `POST /v1/realtime/client_secrets`), ElevenLabs (15-minute signed URLs), and Convai (self-hosted HTTPS
  token endpoint, credential resolved fresh per connection).
- For: solves key exfiltration without you paying for inference; identical wire protocol whether the dev
  self-hosts or buys managed, so managed hosting is a natural upsell — and a recurring-revenue path a
  one-time asset sale does not have.
- Against: still N runtimes. **And the cost the research made explicit: the server dependency is not
  removed, it is relocated onto every customer**, who must operate and secure a token endpoint for the
  life of their shipped game. That is sharp adoption friction for a solo Asset Store buyer. It also
  mitigates key *exfiltration*, not *abuse* — a scraped ephemeral token still authorizes real spend for
  its session.

**Option C — Thin engine plugin, developer-run engine server.** You ship the existing TS engine as a
container the developer runs. Engine plugins become transport shims (roughly 1,500 lines each).
- For: **one runtime, one test suite, no drift**; Unreal and Godot ports become genuinely small; your
  cloud does only licensing and authoring; the developer pays their own compute; provider keys never
  leave their infrastructure.
- Against: a network hop per turn (fine on localhost/LAN, a real adoption tax for a solo dev shipping
  to players); no offline mode; the existing 12.7k lines of C# cognition become dead weight.

**Option D — On-device weights (NVIDIA ACE shape).** Surfaced by the research; not previously
considered. Depend on open-weight models running on the player's own GPU, so **no model-provider API key
exists in the build at all**.
- Demonstrably shipping, not aspirational: PUBG Ally runs Mistral-NeMo-Minitron-8B locally; also inZOI
  "Smart Zoi" and NARAKA: BLADEPOINT's AI teammate.
- For: the only option where the key problem **disappears** rather than moves. No broker, no vendor
  runtime cost, no customer operational burden, fully offline.
- Against: changes the product — weight distribution and licensing, a hard GPU requirement that excludes
  much of the player base, and a quality ceiling well below frontier models. Voice/TTS still needs an
  answer.

> **Over-determined by Pass C1 (2026-09-05).** Unity's Submission Guidelines **§1.5.b independently
> require** this shape: *"Third-party API keys are not stored in ways that would incorporate the key into
> project builds."* Option B was chosen on security grounds; it turns out to also be the only shape that
> passes Unity submission. See [`research/03-marketplace-and-multi-engine.md`](research/03-marketplace-and-multi-engine.md).

**Decision: Option B**, with the broker shipped as a one-command deployable that is also offered as a
hosted paid tier. That turns the adoption friction the research identified into the upsell, and it is
the only shape giving recurring revenue against a one-time marketplace sale.

**Correction to an earlier draft of this section.** It claimed C carries the *same* customer-operated-
server cost as B. That was overstated: B's broker is a ~200-line stateless service deployable to a free
Cloudflare Worker, while C asks the customer to operate the entire backend with storage and upgrades.
B's burden on the buyer is materially lighter, which matters because the buyer is a solo indie.

**What B costs, stated plainly so it is not forgotten:** the cognition stack must be maintained in C#
*and* TypeScript indefinitely, plus C++ and GDScript if Unreal and Godot happen. Cross-runtime
conformance testing (backlog 5.2) stops being optional hygiene and becomes the thing that keeps the
product honest. Revisit **Option D** if the target ever becomes offline-first or console.

### 3.4 Evolution is per-subsystem, not a single flag — `DECIDED`

Developers must be able to toggle **each subsystem that changes an NPC over time**, independently.
Memory is never one of them — memory is always on. The switchable set:

| Subsystem | What it changes | Exists today |
|---|---|---|
| Personality trait drift | Traits recalibrating within bounds (the Persona Shift pillar) | yes, both runtimes |
| Relationship / sentiment | Trust, familiarity, sentiment toward a player or another NPC | yes, per-instance |
| Opinions and beliefs | What the NPC holds to be true, and how it judges things — distinct from remembering that something happened | no |
| Goals and agendas | Standing desires that bias behavior and shift with experience | no (NEW-SPEC 2.2) |

> **Status after two research passes: no verified prior art.** Passes B and C2 both returned zero
> surviving claims on bounded, designer-controlled character evolution. Pass C2 diagnosed this as a
> *sourcing* failure, not absence of evidence, and named the targets — Monolith's GDC Nemesis talks,
> Tynan Sylvester's RimWorld writing and *Designing Games*, Paradox CK3 dev diaries, the Sims 4 emotion
> GDC material. Tracked as `D14`.

Design consequence: "evolution" is not a boolean on the NPC definition. Every subsystem that mutates
state on interaction needs its own switch, its own bounds, and its own audit trail — otherwise a
studio cannot ship a character whose personality is authored and fixed but whose memory still works.

**Memory pruning must also be a designer-facing control**, not a hidden heuristic. Today it is a
`salience_threshold` float per NPC, which is not an interface a designer can reason about.

### 3.5 The "MCP" layer is function-calling, and gets renamed — `DECIDED`

There is no Model Context Protocol here. No `@modelcontextprotocol` dependency, no JSON-RPC — it is
plain LLM function-calling against a project-scoped tool registry (`src/mcp/registry.ts:14`). The MCP
branding is inaccurate in the code, in the docs, and in the pitch, and it will mislead buyers who know
what MCP is.

Rename it to what it is: a tool/action registry. Real MCP interop is a separate question that can be
revisited later on its own merits, not inherited by accident from a naming choice.

### 3.6 Make the mind swappable — `DECIDED`

Regardless of which topology wins, the cognition layer must sit behind one interface:

```
CognitionRuntime:
  turn(input, state)  ->  { speech, toolCalls, memoryOps, latencyBreakdown }
```

The current parallel Mind+Speaker becomes one implementation of it. Transport, storage, licensing, and
the engine SDK all bind to the interface, never to the implementation. This is the modularity you asked
for, and it is what makes a fourth overhaul a contained change instead of another rewrite.

---

### 3.7 The action layer — `DECIDED 2026-09-05`

[`research/04-game-prior-art-actions-and-evolution.md`](research/04-game-prior-art-actions-and-evolution.md)
found that three independently-built shipped toolchains converged on the same architecture. This is the
shape it implies for the "show anger while talking, then throw the wallet, then hand over the key" case.

**1. The action travels on a channel separate from the prose.** Yarn Spinner (`<<command args>>` bound to
a typed C# method, with an inspectable registry), ink (`# hashtags` read via `story.currentTags`, kept out
of the visible text) and Valve's `.vcd` choreography (world triggers as timeline events on the spoken
line) all do this. Yarn's typed, registry-listed commands are the closest analogue to a tool schema; ink
is prior art for the *channel* only, since its tags carry no schema or validation.

**2. Compose-vs-terminate is a property of the executor, not a field in the schema.** Yarn has **no
blocking flag anywhere in its API** — a handler returning `void` lets dialogue continue; one returning an
awaitable pauses it until the task completes. So `show_anger` is written to return immediately and
composes; `walk_away` returns an awaitable and gates the next line. **This removes the need for a
`terminates: true` field on every tool definition.**

**3. Declare the side-effect on the line; dispatch it to the world subsystem.** A Valve choreo event only
fires an *output* — the actual effect is executed by the entity I/O graph elsewhere. Keep the authoring
locus and timing separate from the effect implementation.

**4. Termination gets both mechanisms, because both ship.** An explicit declared terminator (ink's
`-> END`, statically checked with a loose-ends warning) **and** late revalidation (Valve re-queries each
follow-up line at the moment the next speaker begins, so a conversation whose preconditions have gone
false simply finds no match — *"you don't need any kind of explicit interruption mechanism"*). The second
is why `exit_convo` over-triggering has been a recurring problem: revalidation makes most explicit exits
unnecessary.

**5. Any blocking tool needs a guaranteed completion signal.** Bethesda's scene scheduler blocks by
default with **no timeout**, and their own docs warn *"be careful that your scenes don't get stuck
forever!"* A shipped AAA system chose deadlock over timeout and pushed completability onto the action
author. Every gating tool needs a completion signal or a designer-set completion condition.

**6. Legality is one predicate, checked before commitment, gating every issue path.** The Sims' per-
interaction Check Tree removes an unavailable interaction from *both* the player's pie menu and the AI's
autonomous candidate set. One validator, not two.

**7. Results come back as authored facts merged into the next query.** Valve's matched rules write named
key-value facts into a persistent store that is concatenated into every subsequent query. Note the limit:
their per-fact expiry is a hard TTL for anti-repetition **pacing**, not memory decay — it is not prior art
for salience or decay curves.

**Caveat worth keeping:** The Sims 1 shipped with no tool-result-to-belief loop at all; its designers
proposed one as an exercise. Returning tool results into the next turn's context has **no shipped prior
art to copy** — only stated design intent.

---

## 4. Workstreams

Ordered. W0 gates everything.

### W0 — Get the Unity project into version control — `DONE 2026-09-05`

The Unity client now lives in its own standalone repository (working name `SoulEngine-Unity`), rooted at
the Unity project directory. `Unity-SoulEngine/` is ignored in the backend repo.

Scope decision: **254 files, 883 KB tracked.** The SDK source is under 1 MB; the remaining ~326 MB of
the project is licensed third-party art (Synty SidekickCharacters 217 MB, Unity Starter Assets 86 MB,
a 23 MB Sidekicks download cache), which is excluded — not ours to redistribute, and re-downloadable.
`VENDOR-ASSETS.md` in that repo records the provenance and restore path for each piece.

Remaining under W0: a CI job running the headless compile, so "does it build" is never again a question
answered by reading a log file.

### W1 — Decide the target

This document, plus the industry research pass in §5, plus a decision on each `OPEN` item. Output: this
file with every `OPEN` resolved to `DECIDED`, and `NEW-SPEC.md` re-pointed at the outcome.

### W2 — Make the Unity SDK actually run

Not "finish it" — **make one text-text conversation work end to end, recorded**. Compile state is
already settled (clean). That means: fix B1 (default config throws), B3 (the paywall no-op), B4 (social
network dead code), B5 (tools never loaded), ship the VAD model or gate voice behind a clear error, and
package as UPM.

**Changed by the D2 decision:** B2 is no longer "implement proxy mode." Delete the proxy concept and
replace `UseBackendProxy` with **broker-token mode** — the SDK requests a short-lived credential from
the developer's broker endpoint and calls the provider directly with it, never holding a long-lived key.
That also fixes B1, because the throwing `GetLLMConfig()` path disappears with the mode it belonged to.

### W2b — Build the key broker `NEW, from the D2 decision`

The ~200-line stateless token-vending service the buyer deploys. Requirements from
[`research/01-commercial-and-topology.md`](research/01-commercial-and-topology.md) §Q2: holds the
buyer's provider keys server-side; mints short-lived scoped credentials per connection, never cached;
HTTPS enforced; resolves fresh per connection. Ship it as a one-command deploy (container plus a
Cloudflare Worker variant) and run the identical code as the hosted paid tier, so self-host and managed
speak the same protocol.

**Carry the known limit into the design:** token vending mitigates key *exfiltration*, not *abuse* — a
scraped short-lived token still authorizes real spend for its lifetime. Scope, quota and rate-limit each
minted credential.

**The broker is two mechanisms, not one** (found during implementation recon, 2026-09-05). Token vending
only works where the provider ships an ephemeral-credential API:

| Provider | Ephemeral credential? | Broker mode |
|---|---|---|
| OpenAI Realtime | yes — `POST /v1/realtime/client_secrets` | **vend** — client then calls the provider directly |
| ElevenLabs | yes — server-minted signed URLs, 15-minute expiry | **vend** |
| Deepgram | yes — temporary keys API | **vend** |
| Anthropic, Gemini, OpenAI chat completions | **no such API exists** | **proxy** — the broker forwards the request |

So text LLM traffic necessarily routes through the buyer's broker. That is still their infrastructure and
not ours, so the commercial boundary is unchanged — but it makes the broker larger than a pure
token-vendor, and it puts their hosting on the latency path for every turn. Design it as a
**credential-strategy interface** with `vend` and `proxy` implementations behind one contract, so a
provider can move between modes when its API changes.

**Distribution constraint from Unity §1.5.a** ([`research/03-marketplace-and-multi-engine.md`](research/03-marketplace-and-multi-engine.md)
§Q4): the store accepts no submissions including executables *"embedded inside the package or as separate
dependencies located on other websites."* No enforcement precedent was found for server-side binaries,
but the safe reading is clear — **ship the broker as source plus a documented deploy, never as a prebuilt
binary the package points at.** Note this is not a DLL ban; the store hosts thousands of DLL-shipping
assets.

### W3b — Store-listing obligations `NEW, from Pass C1`

Not code, but submission-blocking if missed:

- **§1.5.c** — third-party API terms and costs must appear **at the top of the listing description** and
  in the documentation. The OpenAI/ElevenLabs/Deepgram metered costs get front-loaded, not buried.
- **§1.4.a** — any account-registration requirement and subscription cost must be *"clearly and
  transparently disclosed"* in both the package description and the documentation.
- **§1.5.d** — Unity points SaaS-connected SDKs with login walls or metered usage at its **Verified
  Solutions** program. The verb is "consider", so it reads as a channel suggestion rather than a gate —
  worth testing before submission.
- **Open action:** read the Unity Provider Agreement end-to-end by hand. Pass C1 could not resolve what
  it says about service-dependent SDKs — two opposing readings were both refuted, and the URLs 404
  inconsistently. Only §4.3 (the 70% split) is confirmed.

### W3 — The licensing seam, without billing

Per your answer: model it, do not monetize it yet. Schema for `entitlements` and `licenses`, the
signing/verification path from §3.1, and the redemption endpoint stubbed. Also fold in the §1.3 auth
holes, because shipping a paid product on auth that is disabled outside production is not viable.

### W4 — Agent infrastructure

**Harness first, overhaul second.** A conversation replay and evaluation harness that produces numbers
for turn latency (broken down by stage), recall accuracy, and cost per turn. Then measure the current
parallel Mind+Speaker. Then, and only then, change it — behind the §3.6 interface.

---

## 5. Research questions

Run as **two focused passes**, launched 2026-09-05. Output lands in [`research/`](research/).

### Pass A — commercial model and runtime topology

1. **Topology.** What do Inworld AI, Convai, NVIDIA ACE, Charisma.ai, AI People, and Ubisoft's NEO NPC
   actually do — in-engine inference, cloud inference, or hybrid? Who holds the provider keys? Has any
   of them shipped a model where the developer's own API keys live in the game binary?
2. **Key handling.** What is the accepted practice for a game client that needs LLM inference? Is there
   a standard "key broker" pattern? What happens in practice when keys ship in builds?
3. **One core, N engines.** How do multi-engine SDK vendors (Photon, PlayFab, RevenueCat, Firebase,
   Wwise) structure a shared core against thin per-engine ports? Native core + bindings, or full
   reimplementation per engine? What does that cost to maintain?
4. **Marketplace mechanics.** Unity Asset Store: what does the publisher Verify Invoice API actually
   permit, and what do the submission guidelines say about assets that phone home or depend on a paid
   external service? Same questions for Fab (Unreal) and the Godot Asset Library — do equivalents exist?
5. **Pricing.** For developer tooling with a server dependency, what works — one-time asset purchase,
   subscription, usage-based, or a free SDK with a paid studio? What do comparable assets charge?
6. **Cognition architecture.** Is "parallel Mind + Speaker" a recognized pattern in shipping LLM-NPC
   systems, or a local invention? What do current systems do about the memory-recall latency problem
   specifically — the one that produced the deferred-recall compromise here?
7. **Licensing enforcement.** What do commercial Unity assets that require a backend actually do for
   license enforcement, and what is the observed piracy/support-cost tradeoff?

### Pass B — agent architecture, in-world actions, designer-controlled evolution

8. **Cognition architecture.** Is a parallel "fast responder + slow background reasoner" split a
   recognized pattern, or unusual? How do shipping systems get retrieved memory into the reply
   *without* paying serial latency — speculative retrieval, prefetch on utterance start, retrieval
   during ASR, small local recall models? This is the question behind the deferred-recall compromise.
9. **Action / tool layer design.** How are in-world actions classified and scheduled? What separates
   actions that **terminate** a conversation (walk away, call guards) from actions that **compose**
   with speech and with each other (show anger while talking, throw a wallet, hand over a key)? Is
   there an established taxonomy — blocking vs non-blocking, atomic vs compound? How are conflicting
   simultaneous actions arbitrated, and how does an abstract tool call bind to a concrete engine
   capability and get validated against world state? Includes the pre-LLM prior art — behavior trees,
   GOAP, utility AI, The Sims' smart objects — which likely still applies.
10. **Actions in dialogue.** How does a performed action feed back so the NPC's next line acknowledges
    it? How is success/failure reported into context? How do systems stop the model from *narrating*
    stage directions instead of emitting structured actions?
11. **Evolution as a designer control.** Prior art for bounded, configurable, auditable character
    change; how shipping systems stop agents drifting out of character over long sessions.
12. **Memory pruning and deployment shapes.** Designer-facing pruning controls, and how every answer
    above shifts across three shapes: few-and-deep (~1-2s budget), many-and-ambient (cost per NPC-hour
    dominates), and real-time (<500ms, cognition cannot block the frame).

### Pass C — the questions A and B failed to answer

Launched 2026-09-05 after passes A and B returned nothing on these. Both failures looked like framing
rather than absent evidence, so both halves were re-aimed:

- **C1 — commercial (Q3-Q7), reframed as documentation retrieval.** Unity Provider Agreement and
  Submission Guidelines wording on assets that require an external service, a third-party account, or a
  buyer-operated server — **now business-critical, because Option B requires the buyer to deploy one**.
  Plus the Verify Invoice API, Fab and Godot equivalents, multi-engine SDK architecture, revenue splits
  and comparable pricing, and licence-enforcement practice in game middleware.
- **C2 — game design (Q10-Q11), re-aimed at game-industry prior art** rather than agent papers: how
  shipped games separate conversation-terminating actions from composing ones, animation layering for
  "act while talking", action arbitration (GOAP, utility AI, HTN, Sims smart objects), action results
  flowing back into dialogue (Source response rules, Nemesis system), and bounded designer-controlled
  character change (Sims traits and aspirations, Crusader Kings, RimWorld, Nemesis, OCEAN/PAD).

**Status:** A and B complete. C1 and C2 launched 2026-09-05, running. Deployment shape (`D11`)
deliberately left open — the research covers the range rather than assuming one.

---

## 6. Open decisions

| # | Decision | Status |
|---|---|---|
| D1 | Product name | **DECIDED** — SoulEngine; retire `evolve-npc` / "Evolve.NPC" (closes backlog 6.7) |
| D2 | Runtime topology | **DECIDED** — Option B, fat client + developer-run key broker (§3.3). A ruled out by research; D held in reserve for offline-first/console. |
| D3 | License mechanism | DECIDED §3.1 — **still unvalidated for games.** Ed25519 offline licensing is productized commercially (Keygen), but Pass C1 found zero game-middleware evidence and specifically refuted the client-embedded-public-key detail. |
| D4 | Studio is the moat; Tier 3 promoted to primary product surface | **DECIDED** — §3.2 |
| D5 | Entitlement source | **Partly answered.** Unity's Invoice API is sanctioned by name (§1.4.a) but its endpoint/auth/response were not retrieved. **Fab and Godot have no seller entitlement API at all** — vendor-run gating is the only option there, and Fab cannot host a subscription. Still deferred by choice; model the seam. |
| D6 | Multi-engine scope and timing | OPEN — Pass C1 Q3 was **un-researched** (search budget exhausted), not answered. Needs Pass D. |
| D7 | Cognition behind a swappable interface | DECIDED §3.6 |
| D8 | Unity project into git | **DONE** — separate private repo, §4 W0 |
| D9 | Evolution is per-subsystem toggles, memory always on | **DECIDED** — §3.4 |
| D10 | Rename the "MCP" layer to a tool/action registry | **DECIDED** — §3.5 |
| D11 | Deployment shape to optimize for | OPEN — Pass C2 gave real numbers for the ambient and real-time tiers (GOAP <1 plan/sec/NPC, ≤4 actions; AI LOD scheduler 57 µs/frame = 0.17% frame time, 48 B/entity) but **nothing for deep conversational NPCs**, the tier that matters most here |
| D12 | Pass C | **Done.** C1 answered the marketplace rules; C2 answered the action layer. Both left gaps, tracked as D13/D14. |
| D13 | Pass D (commercial half): multi-engine SDK architecture, comparable pricing, middleware licence enforcement | **OPEN** — C1's search budget hit 200/200 before these ran; re-run by direct URL, not search |
| D14 | Pass D (evolution half): bounded designer-controlled character change | **OPEN** — failed twice as a sourcing problem; target named game-design sources, permit community wikis and video essays with labelling |
| D15 | Action-layer architecture (§3.7) | **DECIDED** — confirmed 2026-09-05 |
