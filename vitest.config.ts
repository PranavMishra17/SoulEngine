import { defineConfig } from 'vitest/config';

// The source uses NodeNext-style imports with explicit ".js" extensions that actually
// point at ".ts" files. This plugin lets tests import source modules using the same
// specifiers (e.g. `import { x } from '../../src/core/tools.js'`) by resolving .js -> .ts.
const resolveJsToTs = {
  name: 'resolve-js-to-ts',
  enforce: 'pre' as const,
  async resolveId(this: any, source: string, importer: string | undefined) {
    if (importer && source.startsWith('.') && source.endsWith('.js')) {
      const asTs = source.slice(0, -3) + '.ts';
      const resolved = await this.resolve(asTs, importer, { skipSelf: true });
      if (resolved) return resolved.id;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [resolveJsToTs],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    clearMocks: true,
  },
});
