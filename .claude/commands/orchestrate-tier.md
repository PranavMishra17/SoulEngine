---
description: Orchestrate a whole AUDIT tier — dispatch independent items as parallel Sonnet agents (in worktrees), chain co-dependent ones, then review, integrate in dependency order, and verify the full suite.
argument-hint: <tier-number>  e.g. 0
---

You are the **Opus orchestrator** running **Tier $ARGUMENTS** from [`backlog.md`](../../backlog.md). You decompose, dispatch Sonnet `feature-builder` agents, verify their work adversarially, and integrate — you never implement features yourself.

## Steps

1. **Read the Tier $ARGUMENTS dispatch plan** in [`backlog.md`](../../backlog.md): the items, their `Depends-on`, and the grouping (which run in parallel vs which are chained because they share files or depend on each other). Cross-check the AUDIT findings each cites.
2. **Confirm the wave order.** Items with unmet dependencies run in a later wave. Within a wave, independent items run in parallel; co-dependent/file-overlapping items are bundled into one agent. State the wave plan to the user before dispatching (how many agents, what each owns).
3. **Dispatch the wave.** Launch one `feature-builder` agent (subagent_type: `feature-builder`, Sonnet) per independent item/group, **each with `isolation: "worktree"`** so parallel agents don't collide on git or files. Send them in a single message so they run concurrently. Give each: its backlog ID(s), verbatim acceptance criteria, AUDIT `file:line` refs, and the SDD loop instruction. If two items touch the same file, do NOT parallelize them — chain them in one agent.
4. **Collect + review adversarially.** For each returned report verify: a guarding regression test was added; full `npm test` + `npm run build` are green; the diff is minimal and on-spec; security items are provably fail-closed. Bounce anything deficient back via SendMessage with specifics.
5. **Integrate in dependency order.** Merge each worktree branch into the working branch one at a time, lowest dependency first; after each merge re-run `npm test` to catch cross-item regressions. Resolve conflicts deliberately (two agents editing nearby code is expected).
6. **Run later waves** once their dependencies are merged and green. Repeat 3-5.
7. **Tier close-out — consolidate meta ONCE.** Feature agents do not touch `backlog.md`/`ERRORS.md`; you own them. After the whole wave/tier is merged and green, do a single consolidated pass: set every shipped item to `done` in `backlog.md`, flip each fixed bug to `FIXED` in `ERRORS.md` (test path + one-line detail), file any new bugs the agents reported, and update the progress table. Commit this meta update once with a clean message. Then confirm the full suite + tsc pass on the integrated branch and summarize to the user: items shipped, tests added, net diff, deferred/blocked items, recommended next tier.

## Guardrails
- Respect dependencies and file-overlap: wrong parallelization causes merge hell. When unsure, chain.
- Cap concurrency to what's sane for the machine; large tiers can run in two waves rather than 8-at-once.
- Evidence before assertions: no item is "done" without a passing suite and a regression test that guards it.
- Do not push to remote or merge to `main` unless the user explicitly asks. Keep work on the feature branch.
- This is an expensive operation. Before launching, give the user the wave plan and a one-line cost/scope heads-up; proceed once they confirm (or if they already said "run tier $ARGUMENTS").
