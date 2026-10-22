import { execFileSync } from 'node:child_process';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapacityRefusal, FreeSpaceMonitor, REFERENCE_MIN_FREE_FACTOR, admitImport, capacityCheck, reclaimableBytes } from './capacity.js';
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

describe('conservative reclaim estimate (review F1)', () => {
  const MiB = 1024 ** 2;
  const fsDevOf = (p: string) => lstatSync(p, { bigint: true }).dev;
  const fresh = () => mkdtempSync(join(tmpdir(), 'seyra-reclaim-'));

  it('credits a sparse file only for its allocated blocks', () => {
    const d = fresh();
    const f = join(d, 'partial-store.bin');
    writeFileSync(f, '');
    truncateSync(f, 8 * GiB);
    const r = reclaimableBytes(d, fsDevOf(d));
    expect(r.logical_bytes).toBe(8 * GiB);
    expect(r.bytes).toBeLessThan(MiB); // apparent length is never credited
    rmSync(d, { recursive: true, force: true });
  });

  it('never follows a symlink to credit its target', () => {
    const d = fresh();
    const outside = fresh();
    writeFileSync(join(outside, 'store.bin'), Buffer.alloc(4 * MiB, 1));
    symlinkSync(join(outside, 'store.bin'), join(d, 'linked-store'));
    const r = reclaimableBytes(d, fsDevOf(d));
    expect(r.not_credited.symlinks).toBe(1);
    expect(r.bytes).toBeLessThan(MiB);
    rmSync(d, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('gives no credit to a hard-linked file whose other link survives, and counts an inside pair once', () => {
    const d = fresh();
    const outside = fresh();
    writeFileSync(join(d, 'shared.bin'), Buffer.alloc(4 * MiB, 2));
    linkSync(join(d, 'shared.bin'), join(outside, 'kept-link.bin'));
    const shared = reclaimableBytes(d, fsDevOf(d));
    expect(shared.not_credited.shared_inodes).toBe(1);
    expect(shared.bytes).toBeLessThan(MiB);
    rmSync(join(outside, 'kept-link.bin'));
    linkSync(join(d, 'shared.bin'), join(d, 'second-name.bin'));
    const pair = reclaimableBytes(d, fsDevOf(d));
    expect(pair.not_credited.shared_inodes).toBe(0);
    expect(pair.bytes).toBeGreaterThanOrEqual(4 * MiB);
    expect(pair.bytes).toBeLessThan(5 * MiB); // once, not twice
    rmSync(d, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('credits an ordinary allocated file', () => {
    const d = fresh();
    mkdirSync(join(d, 'valhalla'));
    writeFileSync(join(d, 'valhalla', 'tiles.bin'), Buffer.alloc(16 * MiB, 3));
    const r = reclaimableBytes(d, fsDevOf(d));
    expect(r.bytes).toBeGreaterThanOrEqual(16 * MiB);
    expect(r.files).toBe(1);
    rmSync(d, { recursive: true, force: true });
  });

  it('gives no credit for another filesystem, special files or unreadable subtrees', () => {
    const d = fresh();
    writeFileSync(join(d, 'a.bin'), Buffer.alloc(MiB, 4));
    expect(reclaimableBytes(d, fsDevOf(d) + 1n).bytes).toBe(0); // as if the tree were on another device
    expect(reclaimableBytes(d, fsDevOf(d) + 1n).not_credited.other_filesystem).toBe(1);
    execFileSync('mkfifo', [join(d, 'pipe')]);
    const withFifo = reclaimableBytes(d, fsDevOf(d)); // must not open (and block on) the FIFO
    expect(withFifo.not_credited.special).toBe(1);
    if (process.getuid?.() !== 0) {
      mkdirSync(join(d, 'locked'));
      writeFileSync(join(d, 'locked', 'hidden.bin'), Buffer.alloc(MiB, 5));
      chmodSync(join(d, 'locked'), 0o000);
      const r = reclaimableBytes(d, fsDevOf(d));
      expect(r.not_credited.unreadable).toBe(1);
      chmodSync(join(d, 'locked'), 0o755);
    }
    rmSync(d, { recursive: true, force: true });
  });
});

describe('import admission with a failed build (review F1)', () => {
  const MiB = 1024 ** 2;
  const settings = { minFreeFactor: 120, minFreeBytes: 0 };
  const input = 4 * 1024 ** 2; // requirement 480 MiB
  const required = 120 * input;
  const fresh = () => mkdtempSync(join(tmpdir(), 'seyra-admit-'));
  const run = (o: { free: number[]; failedDir?: string; dbBytes?: number }) => {
    const calls: string[] = [];
    let i = 0;
    const p = admitImport({
      path: '/srv/seyra',
      datasetId: 'ds-20261019-000000000000',
      inputBytes: input,
      settings,
      free: () => o.free[Math.min(i++, o.free.length - 1)]!,
      log: () => undefined,
      failedBuild: o.failedDir
        ? {
            estimate: () => reclaimableBytes(o.failedDir!, lstatSync(o.failedDir!, { bigint: true }).dev),
            renderDbLogicalBytes: async () => o.dbBytes ?? 0,
            cleanup: async () => {
              calls.push('cleanup');
            },
          }
        : null,
    });
    return { p, calls };
  };

  it('refuses near the boundary when the failed build is sparse, without cleanup (old credit admitted this)', async () => {
    const d = fresh();
    writeFileSync(join(d, 'store.bin'), '');
    truncateSync(join(d, 'store.bin'), 8 * GiB);
    const { p, calls } = run({ free: [required - 64 * MiB], failedDir: d, dbBytes: 2 * GiB });
    await expect(p).rejects.toThrow(/nothing was changed \(the failed build of ds-20261019-000000000000 was kept\)/);
    expect(calls).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });

  it('does not credit the render DB size', async () => {
    const { p, calls } = run({ free: [required - 1], failedDir: fresh(), dbBytes: 50 * GiB });
    await expect(p).rejects.toBeInstanceOf(CapacityRefusal);
    expect(calls).toEqual([]);
  });

  it('admits near the boundary when the failed build holds allocated data, then rechecks observed free space', async () => {
    const d = fresh();
    writeFileSync(join(d, 'store.bin'), Buffer.alloc(96 * MiB, 7));
    const { p, calls } = run({ free: [required - 64 * MiB, required + 32 * MiB], failedDir: d });
    const a = await p;
    expect(calls).toEqual(['cleanup']);
    expect(a.admission.ok).toBe(true);
    expect(a.reclaim!.bytes).toBeGreaterThanOrEqual(96 * MiB);
    expect(a.after_cleanup!.ok).toBe(true);
    expect(a.render_db_credit_bytes).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });

  it('stops before any new write when the cleanup released less than estimated', async () => {
    const d = fresh();
    writeFileSync(join(d, 'store.bin'), Buffer.alloc(96 * MiB, 8));
    const { p, calls } = run({ free: [required - 64 * MiB, required - 64 * MiB], failedDir: d });
    await expect(p).rejects.toThrow(/after removing its failed build: observed .*; no new import data was written/);
    expect(calls).toEqual(['cleanup']);
    rmSync(d, { recursive: true, force: true });
  });

  it('without a failed build only observed free space counts', async () => {
    await expect(run({ free: [required] }).p).resolves.toMatchObject({ reclaim: null, after_cleanup: null });
    await expect(run({ free: [required - 1] }).p).rejects.toThrow(/nothing was changed\. /);
  });
});
