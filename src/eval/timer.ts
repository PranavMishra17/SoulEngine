/**
 * General-purpose stage timer for measuring elapsed time between named stages.
 *
 * Not voice-specific — can be used for any multi-stage process.
 * Records stages as millisecond offsets from a start point.
 */

export class StageTimer {
  private stages: Map<string, number> = new Map();
  private startTime: number | null = null;

  /**
   * Mark the beginning of a new measurement; clears all previous stages.
   */
  markStart(): void {
    this.startTime = Date.now();
    this.stages.clear();
  }

  /**
   * Record a named stage with its elapsed ms offset from the last markStart().
   * Only the FIRST occurrence of each stage is recorded.
   */
  mark(stage: string): void {
    if (this.startTime === null) return;
    if (!this.stages.has(stage)) {
      this.stages.set(stage, Date.now() - this.startTime);
    }
  }

  /**
   * Return all recorded stages and their elapsed-ms values.
   */
  getStages(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this.stages) {
      result[k] = v;
    }
    return result;
  }

  /**
   * True if a stage was recorded this turn.
   */
  hasStage(stage: string): boolean {
    return this.stages.has(stage);
  }

  /**
   * Elapsed ms between two stages; null if either is missing.
   */
  elapsed(fromStage: string, toStage: string): number | null {
    const from = this.stages.get(fromStage);
    const to = this.stages.get(toStage);
    if (from === undefined || to === undefined) return null;
    return to - from;
  }
}
