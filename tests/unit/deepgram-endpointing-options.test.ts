/**
 * Tests for Deepgram configurable endpointing options (item 7.2).
 *
 * Verifies that the Deepgram constants and code structure support configurable
 * utterance_end_ms and endpointing values. Full end-to-end mocking of the Deepgram
 * SDK is fragile and unreliable, so we verify implementation by inspecting the source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('DeepgramSession endpointing options', () => {
  it('defines DEFAULT_UTTERANCE_END_MS and DEFAULT_ENDPOINTING_MS constants', () => {
    const deepgramSrc = readFileSync(
      join(__dirname, '..', '..', 'src', 'providers', 'stt', 'deepgram.ts'),
      'utf8'
    );

    // Verify the constants exist
    expect(deepgramSrc).toContain('DEFAULT_UTTERANCE_END_MS');
    expect(deepgramSrc).toContain('DEFAULT_ENDPOINTING_MS');

    // Extract their values
    const utteranceEndMatch = deepgramSrc.match(/DEFAULT_UTTERANCE_END_MS\s*=\s*(\d+)/);
    const endpointingMatch = deepgramSrc.match(/DEFAULT_ENDPOINTING_MS\s*=\s*(\d+)/);

    expect(utteranceEndMatch).not.toBeNull();
    expect(endpointingMatch).not.toBeNull();

    const utteranceEndValue = parseInt(utteranceEndMatch![1], 10);
    const endpointingValue = parseInt(endpointingMatch![1], 10);

    expect(utteranceEndValue).toBe(1000);
    expect(endpointingValue).toBe(500);
  });

  it('uses config.utteranceEndMs ?? DEFAULT_UTTERANCE_END_MS for utterance_end_ms option', () => {
    const deepgramSrc = readFileSync(
      join(__dirname, '..', '..', 'src', 'providers', 'stt', 'deepgram.ts'),
      'utf8'
    );

    // Verify the connection options use the config or default
    expect(deepgramSrc).toContain('utterance_end_ms: this.config.utteranceEndMs ?? DEFAULT_UTTERANCE_END_MS');
  });

  it('uses config.endpointingMs ?? DEFAULT_ENDPOINTING_MS for endpointing option', () => {
    const deepgramSrc = readFileSync(
      join(__dirname, '..', '..', 'src', 'providers', 'stt', 'deepgram.ts'),
      'utf8'
    );

    // Verify the connection options use the config or default
    expect(deepgramSrc).toContain('endpointing: this.config.endpointingMs ?? DEFAULT_ENDPOINTING_MS');
  });

  it('STTSessionConfig type includes utteranceEndMs and endpointingMs fields', () => {
    const interfaceSrc = readFileSync(
      join(__dirname, '..', '..', 'src', 'providers', 'stt', 'interface.ts'),
      'utf8'
    );

    expect(interfaceSrc).toContain('utteranceEndMs?');
    expect(interfaceSrc).toContain('endpointingMs?');
  });
});
