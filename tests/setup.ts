/**
 * Vitest global setup.
 *
 * Test env vars are set here rather than at the top of individual test files.
 * ESM hoists `import` statements above top-level statements, so a file that
 * does `process.env.X = ...` after its imports has already loaded (and possibly
 * cached) any module that reads config at evaluation time. `setupFiles` run
 * before the test module graph is imported, which makes the ordering
 * deterministic regardless of which file the runner picks first.
 *
 * These are test-only values and are not secrets.
 */
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-min-32-chars-long-secret';
process.env.BROKER_TOKEN_SECRET ??= 'test-broker-signing-secret-min-32-chars-long';
