import { describe, expect, it } from 'vitest';
import { FreeSpaceMonitor, REFERENCE_MIN_FREE_FACTOR, capacityCheck } from './capacity.js';
import { DEFAULT_SETTINGS } from './layout.js';

const IRAN = 229_845_082; // bytes of the owner's Iran PBF in run vm2-2026-10-18
const GiB = 1024 ** 3;

describe('import capacity admission', () => {
  it('defaults to the measured reference factor with a 2 GiB floor', () => {
    expect(DEFAULT_SETTINGS.minFreeFactor).toBe(REFERENCE_MIN_FREE_FACTOR);
    expect(REFERENCE_MIN_FREE_FACTOR).toBeGreaterThan(95.4); // measured peak multiple on a fresh home
    const c = capacityCheck('/srv/seyra', 0, 0, IRAN, DEFAULT_SETTINGS);
    expect(c.required_bytes).toBe(Math.ceil(120 * IRAN)); // 27,581,409,840 B
    expect(capacityCheck('/srv/seyra', 0, 0, 1000, DEFAULT_SETTINGS).required_bytes).toBe(2 * GiB);
  });

  it('rejects when free space is below the requirement', () => {
    const c = capacityCheck('/srv/seyra', 21_930_196_992, 0, IRAN, DEFAULT_SETTINGS);
    expect(c.ok).toBe(false);
    expect(c.available_bytes).toBe(21_930_196_992);
  });

  it('passes at and above the requirement', () => {
    const need = Math.ceil(120 * IRAN);
    expect(capacityCheck('/srv/seyra', need, 0, IRAN, DEFAULT_SETTINGS).ok).toBe(true);
    expect(capacityCheck('/srv/seyra', need - 1, 0, IRAN, DEFAULT_SETTINGS).ok).toBe(false);
  });

  it('counts the bytes of a failed build that would be replaced', () => {
    const need = Math.ceil(120 * IRAN);
    const c = capacityCheck('/srv/seyra', need - 10 * 1e9, 10 * 1e9, IRAN, DEFAULT_SETTINGS);
    expect(c.ok).toBe(true);
    expect(c.reclaimable_bytes).toBe(10 * 1e9);
  });

  it('honours an operator setting (the old 40x default admits what the measured run needed more than)', () => {
    const old = { minFreeFactor: 40, minFreeBytes: 2 * GiB };
    expect(capacityCheck('/srv/seyra', 10e9, 0, IRAN, old).ok).toBe(true); // 9.19 GB required < 21.9 GB measured
    expect(capacityCheck('/srv/seyra', 10e9, 0, IRAN, DEFAULT_SETTINGS).ok).toBe(false);
  });
});

describe('within-step free-space measurement', () => {
  it('records a dip between step boundaries as the step and run minimum', () => {
    const values = [100, 100, 40, 90, 95, 95, 96];
    let i = 0;
    let t = 0;
    const m = new FreeSpaceMonitor(
      () => values[i++]!,
      () => new Date(Date.UTC(2026, 9, 19, 0, 0, t++)),
    );
    m.sample(); // run start: 100
    m.beginStep(); // boundary: 100
    m.sample(); // timer tick inside the step: 40 (the dip)
    m.sample(); // timer tick: 90
    const stepMin = m.endStep(); // boundary: 95 -> a boundary-only sampler would report 95
    expect(stepMin).toBe(40);
    expect(m.minimum()).toBe(40);
    expect(m.minAt).toBe('2026-10-19T00:00:01.000Z'); // the clock is read only when a new minimum is recorded
    m.beginStep(); // next step starts fresh: 95
    expect(m.endStep()).toBe(95);
    expect(m.minimum()).toBe(40);
    expect(m.samples).toBe(7);
  });

  it('ignores non-finite readings', () => {
    const vals = [Number.NaN, 50];
    let k = 0;
    const m = new FreeSpaceMonitor(() => vals[k++]!);
    expect(Number.isNaN(m.sample())).toBe(true);
    expect(m.sample()).toBe(50);
    expect(m.samples).toBe(1);
    expect(m.minimum()).toBe(50);
  });

  it('ignores a failed sample instead of recording it', () => {
    const m = new FreeSpaceMonitor(() => {
      throw new Error('statfs failed');
    });
    expect(Number.isNaN(m.sample())).toBe(true);
    expect(m.minimum()).toBeNull();
    expect(m.samples).toBe(0);
  });

  it('samples on a timer until stopped', async () => {
    let n = 0;
    const m = new FreeSpaceMonitor(() => 1000 - n++);
    m.start(5);
    await new Promise((r) => setTimeout(r, 60));
    m.stop();
    const after = m.samples;
    expect(after).toBeGreaterThan(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(m.samples).toBe(after);
  });
});
