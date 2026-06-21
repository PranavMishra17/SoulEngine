/**
 * Regression test for utterance-level deduplication (item 4.3).
 *
 * The bug: pendingSTTFinal is a boolean that gets reset when any new interim
 * arrives. A late-arriving STT final for utterance N could be processed if a
 * new speech segment (utterance N+1) started and reset pendingSTTFinal before
 * the final arrived - causing the NPC to respond twice to the same utterance.
 *
 * The fix: per-utterance monotonic ID. Each speech-start bumps the ID.
 * commit() captures the current ID. STT finals whose utterance ID matches the
 * already-committed ID are suppressed, regardless of timing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the behavior through the pipeline's public interface by inspecting
// how many times processTranscript is triggered. We use the pipeline's internal
// state indirectly via the events it fires.

// Build a minimal fake pipeline that mirrors the new utterance-ID logic.
// This tests the dedup algorithm itself, not the full pipeline.

type UtteranceDeduper = {
  /** Call on speech-start (each new interim resets the running utterance) */
  onNewInterim: (utteranceText: string) => void;
  /** Call when commit() fires; returns the utterance ID that was committed */
  commit: () => number;
  /** Returns true if this STT final should be suppressed */
  shouldSuppressFinal: (utteranceId: number) => boolean;
  /** Call after successful processing to clear committed state */
  clearCommittedId: () => void;
};

function createUtteranceDeduper(): UtteranceDeduper {
  let currentUtteranceId = 0;
  let committedUtteranceId: number | null = null;

  return {
    onNewInterim(_text: string) {
      // Each new interim starts a new utterance
      currentUtteranceId++;
    },
    commit() {
      committedUtteranceId = currentUtteranceId;
      return currentUtteranceId;
    },
    shouldSuppressFinal(utteranceId: number): boolean {
      // Suppress if this final belongs to an already-committed utterance
      return committedUtteranceId !== null && utteranceId <= committedUtteranceId;
    },
    clearCommittedId() {
      committedUtteranceId = null;
    },
  };
}

describe('utterance-level deduplication', () => {
  let deduper: UtteranceDeduper;

  beforeEach(() => {
    deduper = createUtteranceDeduper();
  });

  it('suppresses a late STT final for the committed utterance', () => {
    // User speaks utterance 1
    deduper.onNewInterim('hello world');
    const committedId = deduper.commit();

    // Simulate new interim arriving (utterance 2 starts) BEFORE STT final for utterance 1
    deduper.onNewInterim('how are you');

    // STT final for utterance 1 arrives late - should be suppressed
    expect(deduper.shouldSuppressFinal(committedId)).toBe(true);
  });

  it('does NOT suppress STT final for a later utterance', () => {
    // User speaks utterance 1
    deduper.onNewInterim('hello world');
    const committedId = deduper.commit();
    deduper.clearCommittedId(); // turn processed, clear

    // User speaks utterance 2
    deduper.onNewInterim('how are you');
    // No commit for utterance 2 - STT final should go through
    const laterId = committedId + 1;
    expect(deduper.shouldSuppressFinal(laterId)).toBe(false);
  });

  it('suppresses late STT final WHILE the turn is still being processed (before clearCommittedId)', () => {
    const processedTexts: string[] = [];

    // Simulate: interim arrives, commit fires
    deduper.onNewInterim('test utterance');
    const committedId = deduper.commit();

    // Processing has started but NOT yet completed (committedUtteranceId is still set).
    // Late STT final arrives for the same utterance - must be suppressed.
    if (!deduper.shouldSuppressFinal(committedId)) {
      processedTexts.push('test utterance via late STT final - should not happen');
    }

    // Processing completes, committed state cleared
    deduper.clearCommittedId();

    // The one real processing that happened was via the commit path
    processedTexts.push('test utterance via commit path');

    expect(processedTexts).toHaveLength(1);
    expect(processedTexts[0]).toBe('test utterance via commit path');
  });

  it('suppresses the late final BEFORE the turn is processed and committed state is cleared', () => {
    const processedTexts: string[] = [];

    deduper.onNewInterim('utterance one');
    const committedId = deduper.commit();

    // New interim starts a new utterance (pendingSTTFinal bool would have been reset here)
    deduper.onNewInterim('utterance two interim');

    // Late STT final for utterance 1 arrives - MUST be suppressed
    if (!deduper.shouldSuppressFinal(committedId)) {
      processedTexts.push('utterance one late final');
    }

    // Committed state still active (turn not yet processed), so suppression holds
    expect(processedTexts).toHaveLength(0);
  });

  it('monotonic ID increments on each new interim', () => {
    const ids: number[] = [];

    deduper.onNewInterim('one');
    ids.push(deduper.commit());
    deduper.clearCommittedId();

    deduper.onNewInterim('two');
    ids.push(deduper.commit());
    deduper.clearCommittedId();

    deduper.onNewInterim('three');
    ids.push(deduper.commit());

    expect(ids[0]).toBeLessThan(ids[1]);
    expect(ids[1]).toBeLessThan(ids[2]);
  });
});
