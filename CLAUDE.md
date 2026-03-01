# CLAUDE.md — Project Rules

> After every correction from the user, end with: "Update your CLAUDE.md so you don't make that mistake again."
> Ruthlessly edit this file over time. Keep iterating until mistake rate measurably drops.

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
- **No testing code in production**: Test files only when explicitly asked

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
