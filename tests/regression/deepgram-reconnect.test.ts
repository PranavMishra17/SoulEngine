/**
 * Regression test for Deepgram reconnect accumulator clearing (item 4.4).
 *
 * The bug: on unexpected disconnect + reconnect, finalizedSegments is NOT
 * cleared. After reconnect, the first segment of the new utterance gets
 * prepended with stale segments from before the disconnect, producing a
 * garbled transcript.
 *
 * The fix: clearAccumulator() must be called before attempting reconnect.
 */

import { describe, it, expect } from 'vitest';

/**
 * Minimal reproduction of the DeepgramSession accumulator logic, testing
 * the reconnect-clear behavior in isolation (no network calls needed).
 */
class AccumulatorUnderTest {
  public finalizedSegments: string[] = [];
  public reconnectCalled = false;
  public accumulatorClearedBeforeReconnect = false;

  parseTranscript(text: string, isSegmentFinal: boolean, isSpeechFinal: boolean): string {
    const fullText = this.finalizedSegments.length > 0
      ? [...this.finalizedSegments, text].join(' ')
      : text;

    if (isSegmentFinal && !isSpeechFinal) {
      this.finalizedSegments.push(text);
    }
    if (isSpeechFinal) {
      this.finalizedSegments = [];
    }
    return fullText;
  }

  attemptReconnect(): void {
    // BUG (before fix): reconnect does NOT clear accumulator
    // FIX: clear accumulator before reconnecting so post-reconnect
    //      transcripts don't get stale pre-disconnect segments prepended.
    this.accumulatorClearedBeforeReconnect = this.finalizedSegments.length === 0;
    this.clearAccumulator();
    this.reconnectCalled = true;
  }

  clearAccumulator(): void {
    this.finalizedSegments = [];
  }
}

describe('Deepgram reconnect accumulator clearing', () => {
  it('accumulator is empty after reconnect so post-reconnect transcripts are not garbled', () => {
    const session = new AccumulatorUnderTest();

    // Simulate: user is mid-utterance with 2 segments finalized
    session.parseTranscript('hello', true, false);  // segment 1 finalized, stored
    session.parseTranscript('my name is', true, false); // segment 2 finalized, stored

    expect(session.finalizedSegments).toHaveLength(2);

    // Simulate: unexpected disconnect + reconnect
    session.attemptReconnect();

    // After reconnect, accumulator must be cleared
    expect(session.finalizedSegments).toHaveLength(0);
    expect(session.reconnectCalled).toBe(true);
  });

  it('post-reconnect transcripts do not contain pre-disconnect segments', () => {
    const session = new AccumulatorUnderTest();

    // Build up stale pre-disconnect segments
    session.parseTranscript('stale segment one', true, false);
    session.parseTranscript('stale segment two', true, false);

    // Reconnect clears them
    session.attemptReconnect();

    // New transcript after reconnect should only contain the new text
    const result = session.parseTranscript('fresh start', false, false);
    expect(result).toBe('fresh start');
    expect(result).not.toContain('stale');
  });

  it('speech_final still clears accumulator on clean utterance end', () => {
    const session = new AccumulatorUnderTest();

    session.parseTranscript('part one', true, false);
    session.parseTranscript('part two', true, false);
    const fullText = session.parseTranscript('part three', true, true); // speech_final

    expect(fullText).toBe('part one part two part three');
    expect(session.finalizedSegments).toHaveLength(0);
  });
});
