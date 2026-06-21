# SoulEngine — Dev Workflow & Orchestration Manual

> The operating manual for how we build SoulEngine from here. Pairs with [`AUDIT.md`](AUDIT.md) (what's wrong), [`NEW-SPEC.md`](NEW-SPEC.md) (what to build), [`backlog.md`](backlog.md) (tracked items), [`ERRORS.md`](ERRORS.md) (bugs + regression tests).

---

## The new direction (post-2026-06 audit)

1. **Spec-Driven Development (SDD), test-first.** Every change starts from a written spec (`specs/<ID>.md`) with verifiable acceptance criteria, then a **failing test**, then the implementation. No spec, no code.
2. **Every bug becomes a permanent regression test.** Surfaced bugs go in [`ERRORS.md`](ERRORS.md); the fix ships with a test that fails before and passes after. We do not re-break the hard parts (voice, Mind, tenancy).
3. **CI gates everything.** GitHub Actions runs typecheck + the full test suite on every push/PR; deploys only on green.
4. **Opus orchestrates, Sonnet implements.** The Opus main session decomposes, dispatches, reviews adversarially, and integrates. Each backlog item (or co-dependent group) is implemented by one **Sonnet `feature-builder`** agent in an isolated worktree.
5. **Mind the dual runtime.** Cognition exists twice — TS (`src/core/*`) and Unity C# (`Unity-SoulEngine/.../Core/*`). Behavioral changes need a shared contract and **conformance tests** so the two don't drift (AUDIT §4.7, backlog 5.2 / NEW-SPEC 2.9).

---

## Orchestration model

```
Opus (this session) = ORCHESTRATOR
  ├─ scopes an item from backlog.md (+ AUDIT file:line, + ERRORS row)
  ├─ dispatches Sonnet feature-builder agent(s)  ── isolation: worktree
  │     • independent items  → parallel agents (separate worktrees)
  │     • co-dependent/same-file items → chained in ONE agent
  ├─ reviews each report adversarially (test added? suite green? minimal diff? fail-closed?)
  ├─ integrates worktree branches in dependency order, re-running tests after each merge
  └─ updates progress, reports to user
        ▲
        │  Sonnet feature-builder = IMPLEMENTER (one item, end-to-end)
        └─ spec → failing test → implement → green → ERRORS+backlog update → commit
```

**Commands** (orchestrator-facing):
- `/execute-feature <ID>` — run one backlog item (auto-bundles its co-dependent group).
- `/orchestrate-tier <N>` — run a whole tier in dependency-ordered waves.

**Why worktrees:** parallel agents that write code will collide on the git index and overlapping files. `isolation: "worktree"` gives each its own checkout; the orchestrator merges. Co-dependent items are chained into one agent precisely to avoid mid-flight conflicts. (See skill `superpowers:using-git-worktrees`.)

---

## The SDD loop (what every feature-builder does)

1. **Restate** the acceptance criteria from the dispatch + backlog row.
2. **Read** the cited `file:line` and neighbours.
3. **Spec** → `specs/<ID>.md` (problem, criteria, approach, test plan).
4. **Failing test** under `tests/` — must fail for the *right* reason (`npm test`).
5. **Implement** the minimal change (CLAUDE.md rules: no hardcoding/emojis, graceful errors, DRY, minimal footprint).
6. **Green** → full `npm test` + `npm run build` (tsc), zero new failures.
7. **Bind the bug** → update [`ERRORS.md`](ERRORS.md) (root cause, test path, `FIXED`).
8. **Update** [`backlog.md`](backlog.md) status → `done`.
9. **Commit** (Conventional Commit `+ Co-Authored-By`), no push/merge to `main`.

Test taxonomy: `tests/unit/` (pure logic) · `tests/regression/` (one per ERRORS row) · `tests/e2e/` (routes via Hono `app.fetch`) · `tests/conformance/` (TS↔C# fixtures).

---

## Custom agents (`.claude/agents/`)

| Agent | Model | Use for |
|---|---|---|
| `feature-builder` | Sonnet | Execute ONE backlog item via the SDD loop. Dispatched by the orchestrator; not invoked directly for planning. |
| `planner` | Sonnet | Decompose a NEW goal (not already in `backlog.md`) into atomic SDD-ready items appended to the backlog. |
| `unity-asset-organization` | — | Unity folder structure / prefab / naming conventions (for Tier 5 Unity work). |

Built-in agents worth using: **Explore** (read-only fan-out search — cheap codebase recon), **Plan** (architect a strategy), **general-purpose** (deep multi-file analysis/audit — the kind used to produce AUDIT.md).

---

## Skills (invoke with the Skill tool / `/name`)

**Process (use first — they set HOW):**
- `superpowers:test-driven-development` — the test-first discipline every item follows.
- `superpowers:writing-plans` / `superpowers:executing-plans` — for multi-step specs.
- `superpowers:subagent-driven-development` / `superpowers:dispatching-parallel-agents` — fan-out execution.
- `superpowers:using-git-worktrees` — isolated parallel implementation.
- `superpowers:systematic-debugging` — before proposing any fix to a failure.
- `superpowers:requesting-code-review` / `superpowers:receiving-code-review` — review gates.
- `superpowers:verification-before-completion` — evidence before claiming done.
- `superpowers:brainstorming` — before designing a NEW-SPEC feature.

**Quality / shipping commands:**
- `/code-review` (or `ultra` for the cloud multi-agent review) — review the current diff.
- `/security-review` — security pass on the branch (mandatory before merging Tier 0 security items 0.3-0.5).
- `/verify` — run the app and confirm a change actually works (use for prod-voice 0.1, UI 3.x).
- `/run` — launch the app for manual checks.
- `/push2git`, `/dump` — project utilities.

**Domain skills available:** `supabase:*` (RLS, migrations — for 0.3/0.4/storage), `engineering:testing-strategy` / `engineering:architecture` / `engineering:tech-debt`, `unity-mcp-skill` (Unity Editor automation for Tier 5), `design:*` (the suite that produced this audit).

---

## Testing & CI

- **Runner:** Vitest (`npm test`, `npm run test:watch`, `npm run test:ci`). Config: `vitest.config.ts`.
- **Typecheck:** `npm run build` (tsc) — must stay clean.
- **Layout:** `tests/{unit,regression,e2e,conformance}/`; fixtures in `tests/fixtures/`.
- **CI:** `.github/workflows/deploy.yml` runs `typecheck` + `test` jobs; `deploy` needs both green. Add no item without a test; CI will (eventually) fail PRs that drop coverage on touched code.
- **First run:** `npm install` (adds Vitest) then `npm test`.

---

## Starting a session (quick start)

1. Read `backlog.md` → pick the lowest-tier `todo` items whose deps are `done`.
2. `/orchestrate-tier 0` (or `/execute-feature 0.6` for a single one).
3. Review each agent's report; ensure ERRORS rows flip to `FIXED` with test paths.
4. For security/UX items, follow with `/security-review` or `/verify`.
5. Keep `backlog.md` and `ERRORS.md` current; commit on the feature branch; push/merge only when the user asks.
