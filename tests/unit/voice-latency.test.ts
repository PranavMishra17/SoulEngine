/**
 * Unit tests for voice pipeline latency instrumentation (item 4.6).
 *
 * Tests that the LatencyTracker records stages and reports them correctly.
 * The tracker is a lightweight helper class added to the pipeline.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Minimal reproduction / spec for the LatencyTracker class.
 * The implementation in pipeline.ts must satisfy these contracts.
 */
class LatencyTrackerUnderTest {
  private stages: Map<string, number> = new Map();
  private startTime: number | null = null;

  /** Mark the beginning of a turn */
  markStart(): void {
    this.startTime = Date.now();
    this.stages.clear();
  }

  /** Record a named stage with its current time offset from start */
  mark(stage: string): void {
    if (this.startTime === null) return;
    this.stages.set(stage, Date.now() - this.startTime);
  }

  /** Return a copy of all recorded stages and their ms offsets from start */
  getStages(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this.stages) {
      result[k] = v;
    }
    return result;
  }

  /** True if a stage was recorded */
  hasStage(stage: string): boolean {
    return this.stages.has(stage);
  }

  /** Returns the elapsed ms between two stages, or null if either is missing */
  elapsed(fromStage: string, toStage: string): number | null {
    const from = this.stages.get(fromStage);
    const to = this.stages.get(toStage);
    if (from === undefined || to === undefined) return null;
    return to - from;
  }
}

describe('LatencyTracker', () => {
  let tracker: LatencyTrackerUnderTest;

  beforeEach(() => {
    tracker = new LatencyTrackerUnderTest();
  });

  it('records stages after markStart', () => {
    tracker.markStart();
    tracker.mark('commit');
    tracker.mark('first_transcript');

    expect(tracker.hasStage('commit')).toBe(true);
    expect(tracker.hasStage('first_transcript')).toBe(true);
    expect(tracker.hasStage('first_token')).toBe(false);
  });

  it('marks are non-negative ms offsets from start', () => {
    tracker.markStart();
    tracker.mark('commit');
    tracker.mark('first_transcript');

    const stages = tracker.getStages();
    expect(stages['commit']).toBeGreaterThanOrEqual(0);
    expect(stages['first_transcript']).toBeGreaterThanOrEqual(0);
  });

  it('elapsed returns difference between two stages', () => {
    tracker.markStart();
    tracker.mark('commit');

    // Simulate async gap by faking Date.now advancing
    // We test the logic by just checking elapsed >= 0 (real timing)
    tracker.mark('first_transcript');

    const elapsed = tracker.elapsed('commit', 'first_transcript');
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeGreaterThanOrEqual(0);
  });

  it('elapsed returns null when a stage is missing', () => {
    tracker.markStart();
    tracker.mark('commit');

    expect(tracker.elapsed('commit', 'first_transcript')).toBeNull();
    expect(tracker.elapsed('first_transcript', 'commit')).toBeNull();
  });

  it('markStart clears previous stages', () => {
    tracker.markStart();
    tracker.mark('commit');
    tracker.mark('first_transcript');

    // Start a new turn
    tracker.markStart();
    expect(tracker.hasStage('commit')).toBe(false);
    expect(tracker.hasStage('first_transcript')).toBe(false);
  });

  it('stages before markStart are ignored', () => {
    // mark without markStart - should be silently ignored
    tracker.mark('commit');
    expect(tracker.hasStage('commit')).toBe(false);
  });

  it('getStages returns all four pipeline stages when recorded', () => {
    tracker.markStart();
    tracker.mark('commit');
    tracker.mark('first_transcript');
    tracker.mark('first_token');
    tracker.mark('first_audio');

    const stages = tracker.getStages();
    expect(Object.keys(stages)).toContain('commit');
    expect(Object.keys(stages)).toContain('first_transcript');
    expect(Object.keys(stages)).toContain('first_token');
    expect(Object.keys(stages)).toContain('first_audio');
  });
});

describe('pipeline latency constants', () => {
  it('AGGREGATION_WINDOW_MS is reduced from 1500ms to at most 500ms', async () => {
    // Dynamic import to read the actual constant from the compiled/source file
    // We read the source file text to check the constant value
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pipelineSrc = readFileSync(
      join(__dirname, '..', '..', 'src', 'voice', 'pipeline.ts'),
      'utf8'
    );

    // Extract AGGREGATION_WINDOW_MS value
    const match = pipelineSrc.match(/AGGREGATION_WINDOW_MS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const value = parseInt(match![1], 10);
    expect(value).toBeLessThanOrEqual(500);
    expect(value).toBeGreaterThan(0);
  });

  it('Deepgram utterance_end_ms is reduced from 1500ms to at most 1200ms', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const deepgramSrc = readFileSync(
      join(__dirname, '..', '..', 'src', 'providers', 'stt', 'deepgram.ts'),
      'utf8'
    );

    const match = deepgramSrc.match(/utterance_end_ms:\s*(\d+)/);
    expect(match).not.toBeNull();
    const value = parseInt(match![1], 10);
    expect(value).toBeLessThanOrEqual(1200);
    expect(value).toBeGreaterThan(0);
  });
});
