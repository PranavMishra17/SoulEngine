import { describe, it, expect, beforeEach } from 'vitest';
import { StageTimer } from '../../src/eval/timer.js';

describe('StageTimer', () => {
  let timer: StageTimer;

  beforeEach(() => {
    timer = new StageTimer();
  });

  it('records stages with elapsed ms from start', async () => {
    timer.markStart();

    await new Promise(resolve => setTimeout(resolve, 10));
    timer.mark('stage1');

    await new Promise(resolve => setTimeout(resolve, 10));
    timer.mark('stage2');

    const stages = timer.getStages();
    expect(stages.stage1).toBeGreaterThanOrEqual(10);
    expect(stages.stage2).toBeGreaterThanOrEqual(20);
    expect(stages.stage2).toBeGreaterThan(stages.stage1);
  });

  it('only records first occurrence of each stage', () => {
    timer.markStart();
    timer.mark('duplicate');
    const firstValue = timer.getStages().duplicate;

    timer.mark('duplicate');
    const secondValue = timer.getStages().duplicate;

    expect(firstValue).toBe(secondValue);
  });

  it('clears previous stages on markStart', () => {
    timer.markStart();
    timer.mark('old');
    expect(timer.hasStage('old')).toBe(true);

    timer.markStart();
    expect(timer.hasStage('old')).toBe(false);
  });

  it('returns true for hasStage when stage exists', () => {
    timer.markStart();
    timer.mark('exists');

    expect(timer.hasStage('exists')).toBe(true);
    expect(timer.hasStage('missing')).toBe(false);
  });

  it('calculates elapsed time between two stages', () => {
    timer.markStart();
    timer.mark('a');
    timer.mark('b');

    const elapsed = timer.elapsed('a', 'b');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('returns null when calculating elapsed between missing stages', () => {
    timer.markStart();
    timer.mark('a');

    expect(timer.elapsed('a', 'missing')).toBeNull();
    expect(timer.elapsed('missing', 'a')).toBeNull();
    expect(timer.elapsed('missing1', 'missing2')).toBeNull();
  });

  it('ignores marks before markStart is called', () => {
    timer.mark('before-start');
    expect(timer.hasStage('before-start')).toBe(false);

    timer.markStart();
    timer.mark('after-start');
    expect(timer.hasStage('after-start')).toBe(true);
  });
});
