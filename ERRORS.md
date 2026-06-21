# SoulEngine — Error & Regression Ledger

> **The rule (non-negotiable):** every bug we surface gets an entry here, and every fix leaves behind a **regression test** that fails before the fix and passes after. No fix is "done" until its row is `FIXED` with a test path. This is how we stop the dual-runtime drift and stop re-breaking the hard parts (voice, Mind).
>
> Seeded from the 2026-06-21 audit ([`AUDIT.md`](AUDIT.md)). Linked to [`backlog.md`](backlog.md) items. Workflow in [`WORKFLOW.md`](WORKFLOW.md).

**Status:** `OPEN` (reproduced, no fix) · `IN-PROGRESS` · `FIXED` (fix merged + regression test green) · `WONTFIX` (with reason)

---

## Ledger

| ID | Sev | Area | Bug (one line) | Root cause | Backlog | Regression test | Status |
|---|---|---|---|---|---|---|---|
| ERR-001 | P1 | core | Weekly Whisper silently deletes high-salience memories | `retainCount=3` slice discards rank>3 regardless of salience; promoted items dropped from STM | 1.1 | `tests/regression/err-001-weekly-whisper.test.ts` (pending) | OPEN |
| ERR-002 | P1 | core/security | Core Anchor immutability never enforced (only logged) | `enforceAnchorImmutability` never called; save continues on violation | 1.2 | `tests/regression/err-002-anchor-immutability.test.ts` (pending) | OPEN |
| ERR-003 | P0 | voice/deploy | Production voice dead — WS binds `PORT+1`, unreachable behind single-port PaaS | 2nd `WebSocketServer({port:port+1})`; no HTTP upgrade; client dials `host:444` | 0.1, 0.2 | `tests/e2e/err-003-ws-same-port.test.ts` + manual prod check (pending) | OPEN |
| ERR-004 | P0 | security | Cross-tenant IDOR on every project-scoped route | server uses service-role key (bypasses RLS); routes only existence-check, no `user_id` | 0.3 | `tests/regression/err-004-idor.test.ts` (pending) | OPEN |
| ERR-005 | P0 | storage | Storage split-brain — static vs per-request backend selectors disagree | `index.ts` `NODE_ENV` switch (core) vs `hybrid.ts` `userId` switch (routes) | 0.4 | `tests/regression/err-005-storage-selector.test.ts` (pending) | OPEN |
| ERR-006 | P0 | storage/security | BYOK secrets unrotatable + non-portable across backends | no `key_version`; different ciphertext formats; `ENCRYPTION_KEY` change bricks all keys | 0.5 | `tests/regression/err-006-secrets-roundtrip.test.ts` (pending) | OPEN |
| ERR-007 | P0 | frontend/css | Landing renders old indigo brand; session panel tokens transparent | `--accent-primary-rgb` undefined (falls back to indigo); 5 phantom `--*` tokens | 0.6 | `tests/unit/err-007-css-tokens.test.ts` (grep undefined `var(--…)`) (pending) | OPEN |
| ERR-008 | P0 | storage | Concurrent local usage appends lose token/cost data | unlocked read-modify-write in `appendProjectUsage` | 0.8 | `tests/regression/err-008-usage-append-race.test.ts` | FIXED |
| ERR-009 | P2 | core/voice | Deferred recall context lost on voice reconnect; stale double-injection possible | stored on per-pipeline field, not session state; cleared late | 1.3 | `tests/regression/err-009-deferred-recall.test.ts` (pending) | OPEN |
| ERR-010 | P1 | storage | Supabase silently destroys knowledge category `description` | hardcoded `description:''` on read + write | 1.7 | `tests/regression/err-010-knowledge-desc.test.ts` (pending) | OPEN |
| ERR-011 | P1 | storage | Instance `version` is timestamp locally, int in Supabase — snapshots non-portable | divergent version schemes across backends | 1.7 | `tests/conformance/err-011-version-scheme.test.ts` (pending) | OPEN |
| ERR-012 | P1 | storage | No optimistic locking on instance saves → lost updates + duplicate version rows | read-modify-write with no `WHERE version=expected` | 1.4 | `tests/regression/err-012-instance-locking.test.ts` (pending) | OPEN |
| ERR-013 | P1 | api | 503 catch-all shadows history routes (registered after it) | route order in `index.ts:202-213` | 1.5 (or new) | `tests/e2e/err-013-history-no-llm.test.ts` (pending) | OPEN |
| ERR-014 | P1 | frontend | `/projects/new` route unregistered → landing CTA 404s | anchored route regex falls through to `:projectId='new'` | 3.7 | `tests/regression/err-014-projects-new-route.test.ts` (pending) | OPEN |
| ERR-015 | P1 | frontend | Diff-modal buttons never bound (wired at module-load before template exists) | `DOMContentLoaded` handler runs before `renderTemplate` | 3.7 | `tests/regression/err-015-diff-modal-binding.test.ts` (pending) | OPEN |
| ERR-016 | P1 | voice | `src/voice/interruption.ts` is 188 lines of dead, contradictory code | barge-in removed but module never deleted; imported nowhere | 4.1 | `tests/unit/err-016-no-dead-interruption.test.ts` (assert not imported) (pending) | OPEN |
| ERR-017 | P1 | voice | Transcript double-processing via fragile `pendingSTTFinal` boolean | boolean reset by new interim; dedup half-reset across turns | 4.3 | `tests/regression/err-017-utterance-dedup.test.ts` (pending) | OPEN |
| ERR-018 | P1 | security | Rate limiter bypassable by rotating client-supplied `player_id` | limiter keyed on untrusted `player_id`; in-memory only | 1.6 | `tests/regression/err-018-ratelimit-bypass.test.ts` (pending) | OPEN |
| ERR-019 | P1 | storage | Local definition history stubbed; `rollbackDefinition` is a silent no-op | interface implemented in Supabase only; local returns current | 1.7 | `tests/regression/err-019-local-def-history.test.ts` (pending) | OPEN |
| ERR-020 | P2 | packaging | Version mismatch: `package.json` 1.0.0 vs `/health` 2.0.0 | hardcoded version string in `index.ts` | 6.2 | `tests/unit/err-020-version-source.test.ts` (pending) | OPEN |

---

## Template for new entries

```
| ERR-NNN | P? | <area> | <one-line bug> | <root cause> | <backlog ID> | tests/regression/err-NNN-<slug>.test.ts | OPEN |
```

When fixing:
1. Write the regression test FIRST; confirm it fails for the right reason.
2. Implement the fix; confirm the test passes and the full suite stays green.
3. Update the row: fill the test path, flip to `FIXED`, and (optional) add a one-line root-cause note below.
4. For a bug present in BOTH runtimes (TS + C#), add a `tests/conformance/` fixture so neither side can regress silently.

## Resolved (FIXED) — detail log

### ERR-008: Concurrent local usage appends lose token/cost data

**What broke:** `appendProjectUsage` in `src/storage/local/usage.ts` performed an unlocked read-modify-write: read current totals via `getProjectUsage()`, merge with session usage, then `fs.writeFile`. When multiple concurrent conversation turns called this function for the same project, they all read the same stale totals, calculated their individual increments, and the last write clobbered all previous writes. Result: silently undercounted token and cost accounting.

**Root cause:** No synchronization mechanism for the read-modify-write operation. The Supabase backend implements this atomically via database RPC; only the local backend was broken.

**Fix:** Added a per-project async lock (`Map<projectId, Promise<void>>`) that chains appends sequentially for each project while allowing different projects to run concurrently. Each append awaits the previous one for its project, ensuring serialized writes. The lock is cleaned up after each append to prevent unbounded Map growth. Also fixed a testability bug: changed `DATA_DIR` from a module-level constant to a function that reads `process.env.DATA_DIR` dynamically, allowing tests to override the data directory.

**Test guard:** `tests/regression/err-008-usage-append-race.test.ts` fires 20 concurrent `appendProjectUsage` calls for the same project, each adding distinct token amounts. The test asserts the final total equals the sum of all increments (fails before the fix due to lost updates, passes after).
