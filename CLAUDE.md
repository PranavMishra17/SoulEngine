# CLAUDE.md — Project Rules

> After every correction from the user, end with: "Update your CLAUDE.md so you don't make that mistake again."
> Ruthlessly edit this file over time. Keep iterating until mistake rate measurably drops.

---

## Operating Model (post-2026-06 audit) — READ FIRST

The project runs against a tracked backlog using spec-driven, test-first development. Full manual: [`WORKFLOW.md`](WORKFLOW.md). Short version:

- **Source docs:** [`AUDIT.md`](AUDIT.md) (what's broken, tiered) · [`NEW-SPEC.md`](NEW-SPEC.md) (what to build) · [`backlog.md`](backlog.md) (tracked items + status) · [`ERRORS.md`](ERRORS.md) (bug → regression-test ledger).
- **Opus orchestrates, Sonnet implements.** This main session decomposes, dispatches, reviews, integrates. Each backlog item is built by one Sonnet `feature-builder` agent in an isolated git worktree. Commands: `/execute-feature <ID>`, `/orchestrate-tier <N>`.
- **SDD + test-first, always.** Spec (`specs/<ID>.md`) → failing test → implement → green suite → commit. Never code without a spec and a test.
- **Every bug → a regression test** logged in `ERRORS.md`; the fix ships with a test that fails before and passes after. Bugs in BOTH runtimes also get a `tests/conformance/` fixture.
- **Dual runtime:** cognition exists in TS (`src/core/*`) AND Unity C# (`Unity-SoulEngine/.../Core/*`); behavioral changes need conformance tests so they don't drift.
- **CI gates merges:** typecheck + full Vitest suite must be green (`.github/workflows/deploy.yml`).

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- Append "use subagents" to any request where you want Claude to throw more compute at the problem

### 3. Self-Improvement Loop
- After ANY correction from the user: update CLAUDE.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review this file at session start for any relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing tests without being told how

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update CLAUDE.md after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

---

## Code Standards

- **No hardcoding**: No secrets, API keys, magic strings, or environment-specific values inline
- **No emojis**: Anywhere in the codebase — not in logs, comments, print statements, or UI
- **Graceful error handling**: Every external call wrapped in try/except with logged errors
- **Comprehensive logs**: try/catch on all API calls, log request/response context on failure
- **Reusable code**: DRY — extract shared logic. No copy-paste duplication
- **Tests are required, not optional (SDD)**: Every change ships with a test under `tests/` (see [`WORKFLOW.md`](WORKFLOW.md)). Tests live in `tests/` only, are excluded from the prod build (`dist/`), and never ship in the runtime bundle. "No test code in production" means *not in the shipped artifact* — it does NOT mean skip tests.

---

## Git Conventions

- **Commit on a feature branch**, never directly on `main`.
- **Tests run on every commit** via the pre-commit hook (`npm run precommit` = typecheck + Vitest). A red suite blocks the commit — fix it, don't bypass it.
- **Human-readable messages**: a commit or PR must make sense to someone with zero project context. Describe the behavior change. Do NOT reference backlog/tier IDs (no `[0.4]`, no "Tier 0").
- **No AI attribution anywhere**: never add Claude/AI as author, co-author, or any mention in commit messages, PR titles/bodies, or code comments. Author is the human git identity.
- Conventional Commit prefixes (`fix:`, `feat:`, `refactor:`, `test:`, `chore:`) encouraged for readability.

---

## Context Window Management

- Run `/context` regularly — never exceed 60% usage
- Disable unused MCPs: navigate to `/plugins` or run `/mcp` and disable anything not actively in use
- Too many enabled tools can shrink effective context from 200k to 70k — performance degrades significantly
- At ~50% context: use `/dump` command, then `/clear`, then resume with `@.claude/progress/dumpN.md`
- Use the built-in Explore subagent (Haiku, read-only) for codebase search — don't burn main context

---

## Status Bar
- Use `/statusline` to show: git branch, context usage %, current model, todo count
- Color-code terminal tabs per task/worktree for easy Claude-juggling

---

## Subagent Usage Pattern
- `/planner` — use first. Creates detailed plan + ordered feature list
- Each feature is executed by a fresh `feature-builder` subagent instance with zero ambient context
- Main agent resumes after verification, passes next feature to next subagent instance
- Never chain subagents — orchestrator delegates, subagents execute, orchestrator verifies

---

## Lessons Learned
<!-- Claude appends new rules here after corrections -->
