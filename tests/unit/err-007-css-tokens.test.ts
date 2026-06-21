/**
 * ERR-007: CSS design-token regression test
 * Prevents undefined CSS custom properties from being referenced without fallbacks.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('CSS Design Tokens', () => {
  it('should not reference undefined CSS custom properties without fallbacks', () => {
    const webCssDir = path.join(process.cwd(), 'web', 'css');
    const cssFiles = fs
      .readdirSync(webCssDir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => path.join(webCssDir, f));

    expect(cssFiles.length).toBeGreaterThan(0);

    // Collect all defined custom properties across all CSS files
    const definedTokens = new Set<string>();

    // Collect all references without fallbacks
    const referencesWithoutFallback = new Map<string, Array<{ file: string; line: number; token: string }>>();

    for (const file of cssFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(webCssDir, file);

      // Strip CSS comments (both /* */ and //)
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* ... */
        .replace(/\/\/.*/g, ''); // Remove // comments

      const lines = stripped.split('\n');

      // Find all defined custom properties (--property-name: value;)
      const definitionRegex = /--([\w-]+)\s*:/g;
      let match;
      while ((match = definitionRegex.exec(stripped)) !== null) {
        definedTokens.add(match[1]);
      }

      // Find all var() references
      // Pattern: var(--token-name) or var(--token-name, fallback)
      // We want to catch references WITHOUT fallbacks
      const varRegex = /var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)/g;

      lines.forEach((line, idx) => {
        let varMatch;
        const varRegexPerLine = /var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)/g;

        while ((varMatch = varRegexPerLine.exec(line)) !== null) {
          const tokenName = varMatch[1];
          const hasFallback = varMatch[2] !== undefined;

          // Only track references without fallbacks
          if (!hasFallback) {
            if (!referencesWithoutFallback.has(tokenName)) {
              referencesWithoutFallback.set(tokenName, []);
            }
            referencesWithoutFallback.get(tokenName)!.push({
              file: relativePath,
              line: idx + 1,
              token: tokenName
            });
          }
        }
      });
    }

    // Check for undefined tokens
    const undefinedTokens: Array<{ token: string; references: Array<{ file: string; line: number }> }> = [];

    for (const [token, refs] of referencesWithoutFallback.entries()) {
      if (!definedTokens.has(token)) {
        undefinedTokens.push({
          token,
          references: refs.map(r => ({ file: r.file, line: r.line }))
        });
      }
    }

    if (undefinedTokens.length > 0) {
      const errorMessage = [
        'Found undefined CSS custom properties referenced without fallbacks:',
        '',
        ...undefinedTokens.map(({ token, references }) => {
          const refList = references
            .map(r => `  - ${r.file}:${r.line}`)
            .join('\n');
          return `--${token}:\n${refList}`;
        })
      ].join('\n');

      throw new Error(errorMessage);
    }

    expect(undefinedTokens).toEqual([]);
  });
});
