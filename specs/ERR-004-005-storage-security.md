# ERR-004 + ERR-005: Storage Security - IDOR Prevention & Unified Selector

## Problem
Two co-dependent security issues in the storage layer:

1. **ERR-005 (Split-brain selector)**: Storage backend selection is inconsistent. Routes use `hybrid.ts` to pick per-request (based on `userId`), but core cognition (`mind.ts`, `context.ts`) imports from static `storage/index.ts` (based on `NODE_ENV` at module load). A request can write to Supabase but read from local filesystem, causing data loss.

2. **ERR-004 (IDOR - Insecure Direct Object Reference)**: Service-role Supabase client bypasses RLS. Routes only check project existence via `getProject(projectId)` without verifying ownership. Any authenticated user can read/modify/delete another tenant's projects, API keys, transcripts, and consume their LLM credits.

## Threat Model
- **IDOR Impact**: Authenticated user A can:
  - Read user B's project settings, API keys (via `/api/projects/:projectId/api-keys`)
  - Modify user B's project configuration
  - Delete user B's projects, NPCs, instances
  - Consume user B's LLM budget by triggering conversations
  - Read user B's conversation transcripts (PII leakage)
- **Split-brain Impact**:
  - Request writes NPC definition to Supabase (route), but Mind reads from local filesystem (returns 404)
  - Conversely, local writes + Supabase reads = data loss
  - Non-prod authenticated users bypass Supabase storage unintentionally

## Acceptance Criteria
1. **Unified selector**: ONE request-scoped selector governs entire request for both routes AND core. Remove static `NODE_ENV` switch from `storage/index.ts`.
2. **Consistent backend**: Logged-out/local and logged-in/Supabase each read+write a single consistent backend end-to-end (no split-brain).
3. **Ownership enforcement**: `getProject` returns `user_id`; ownership guard rejects cross-tenant access on project/instance routes with 404 (fail-closed).
4. **Green suite**: `npm run build` clean; `npm test` passes.

## Chosen Approach
1. **Replace static selector with request-scoped factory**:
   - Deprecate `storage/index.ts` static exports
   - Create `storage/factory.ts` with `getStorage(userId?)` that returns `local` or `supabase` storage namespaces
   - Thread `userId` from routes → core functions (via existing parameters or new optional arg)

2. **Add `user_id` to Project type and ownership guard**:
   - Extend `Project` interface with optional `user_id: string | null`
   - Supabase `getProject` selects `user_id` column (already exists in DB)
   - Create middleware/helper `requireProjectOwnership(project, userId)` that:
     - In local mode (no auth): always pass
     - In Supabase mode: return 404 if `project.user_id !== userId`
   - Apply guard on all project-scoped routes (`GET/PUT/DELETE /api/projects/:projectId`, `/api/projects/:projectId/*`)

3. **Propagate guard to instance routes**:
   - Instance routes must first load project, verify ownership, then proceed
   - Routes: `/api/projects/:projectId/npcs/:npcId/instances/*`, `/api/projects/:projectId/history`, `/api/projects/:projectId/cycles`

## Files to Touch
- `src/types/project.ts` — add `user_id?: string | null` to `Project`
- `src/storage/factory.ts` — NEW, create request-scoped storage selector
- `src/storage/supabase/projects.ts` — select `user_id` in `getProject`
- `src/storage/local/projects.ts` — return `user_id: null` in `getProject`
- `src/middleware/ownership.ts` — NEW, create ownership guard middleware
- `src/core/mind.ts` — import from factory, pass `userId` to `getDefinition` calls
- `src/core/context.ts` — import from factory, pass `userId` to `getDefinition` calls
- `src/routes/projects.ts` — apply ownership guard
- `src/routes/npcs.ts` — apply ownership guard (project-scoped)
- `src/routes/history.ts` — apply ownership guard (project-scoped)
- `src/routes/cycles.ts` — apply ownership guard (project-scoped)
- `src/routes/conversation.ts` — use factory
- `src/routes/session.ts` — use factory
- Other routes importing from `storage/index.ts` — migrate to factory

## Test Plan
### Regression Tests (TDD - write FIRST, must fail before fix)
1. **`tests/regression/err-004-idor.test.ts`**: Prove user B cannot access user A's project
   - Mock/stub storage layer with two projects (different owners)
   - Test ownership guard rejects cross-tenant `getProject` with 404
   - Test ownership guard allows owner access
   - Test local mode (no auth) allows all access

2. **`tests/regression/err-005-storage-selector.test.ts`**: Prove single selector decides backend
   - For a given `userId`, verify routes and core resolve to SAME backend
   - Test: `userId=null` → both resolve to `local`
   - Test: `userId='user123'` + hasSupabase → both resolve to `supabase`
   - Guard against static-vs-per-request split

### Integration
- Existing tests (once added) must remain green
- `npm run build` must succeed (TypeScript typecheck)

## Implementation Notes
- **Fail-closed**: When auth is enabled and ownership check fails, return 404 (not 403, to avoid leaking existence)
- **Local mode unchanged**: Logged-out users continue using local filesystem
- **Minimal diff**: Thread `userId` through existing function signatures where possible; avoid large refactors
- **No RLS bypass**: Continue using service-role client but enforce ownership in application code (alternative: switch to user-scoped client, but that's larger change)
