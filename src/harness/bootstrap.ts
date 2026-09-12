/**
 * Environment defaults that must be set before anything else loads.
 *
 * ESM hoists `import` statements above top-level statements, so assigning
 * process.env at the top of the CLI would run *after* the logger and config
 * modules had already read it. Putting it in its own module and importing that
 * first is the only ordering that works.
 *
 * pino writes to stdout at info level, which would interleave with the
 * diagnostic block the harness prints.
 */
// The play command speaks JSON lines on stdout, so its logs must go to stderr.
if (process.argv[2] === 'play' && !process.env.LOG_DESTINATION) {
  process.env.LOG_DESTINATION = 'stderr';
}

if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'warn';
}
