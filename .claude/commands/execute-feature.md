---
description: Orchestrate ONE backlog item end-to-end via a Sonnet feature-builder agent (spec -> failing test -> implement -> green -> commit), then review and integrate.
argument-hint: <backlog-id>  e.g. 0.4
---

You are the **Opus orchestrator**. Execute backlog item **$ARGUMENTS** by delegating implementation to a Sonnet `feature-builder` agent. You do NOT write the feature yourself — you scope, dispatch, verify, and integrate.

## Steps

1. **Load the item.** Read the row for `$ARGUMENTS` in [`backlog.md`](../../backlog.md), the AUDIT finding it cites in [`AUDIT.md`](../../AUDIT.md), and its `ERRORS.md` row if one exists. Confirm its `Depends-on` items are already `done` — if not, stop and tell the user which blocker to run first.
2. **Check for co-dependence.** If `backlog.md`'s dispatch plan groups `$ARGUMENTS` with other items (shared files or hard dependency), execute the WHOLE group in a single agent (chained), not just this item. Note that to the user.
3. **Dispatch one `feature-builder`** (subagent_type: `feature-builder`, which runs Sonnet) with `isolation: "worktree"` so it can commit without colliding with other parallel work. Hand it: the backlog ID(s), the verbatim acceptance criteria, the AUDIT `file:line` refs, and the instruction to follow its SDD loop (spec -> failing regression test -> implement -> `npm test` + `npm run build` green -> update ERRORS.md + backlog.md -> commit, do not push/merge).
4. **Review the report adversarially.** When it returns, verify: (a) a regression test was added that actually guards this bug; (b) the full suite + tsc are green; (c) the diff is minimal and matches the spec; (d) for security items, the hole is provably closed (fail-closed). If anything is missing or wrong, send it back via SendMessage with specifics — do not rubber-stamp.
5. **Integrate.** Merge the agent's worktree branch into the working branch (resolve conflicts; re-run `npm test` after merge). If the worktree was isolated, bring the commit over. Confirm `backlog.md` shows the item `done` and `ERRORS.md` shows it `FIXED`.
6. **Report to the user:** item, what changed, the new test(s), suite status, commit hash, and any follow-up ERRORS rows the agent filed.

## Guardrails
- One item (or one co-dependent group) per invocation.
- Never mark done without seeing a passing suite and a guarding regression test — evidence before assertions.
- Do not push to remote or merge to `main` unless the user explicitly asks.
- If the agent reports `BLOCKED`, relay the exact blocker and proposed unblock to the user; do not improvise a workaround that needs reverting.
