# Tests

Vitest. Run `npm install` once, then `npm test` (or `npm run test:watch`).

Layout:
- `unit/` — pure logic, no I/O.
- `regression/` — one test per bug in [`../ERRORS.md`](../ERRORS.md). Each must fail before its fix and pass after.
- `e2e/` — route/integration tests against the Hono app via `app.fetch(...)`.
- `conformance/` — fixture-driven tests asserting the TS runtime and the Unity C# runtime make the same decisions (prevents dual-runtime drift).
- `fixtures/` — shared input/golden-output data.

Rules: every change ships with a test (see [`../WORKFLOW.md`](../WORKFLOW.md)). Importing source uses the project's `.js` specifier convention (e.g. `from '../../src/core/tools.js'`); the resolver in `vitest.config.ts` maps it to the `.ts` file.
