import { statfsSync } from 'node:fs';
import type { Settings } from './layout.js';

/**
 * Import storage admission and measurement.
 *
 * What the check covers: free space on the filesystem holding SEYRA_HOME (statfs). Every byte an
 * import writes goes there: the managed source copy, the new render database (data/postgres), the
 * Valhalla graph, the temporary Nominatim database and Photon input (work/ and the release), the
 * Overpass database including its build-time temporary files, map metadata and logs. It does NOT
 * cover a Docker data root on another filesystem (image layers, container logs) or tmpfs mounts.
 *
 * Reference (run vm2-2026-10-18, docs/validation/iran): importing the owner's 229,845,082-byte Iran
 * PBF on a fresh SEYRA_HOME lowered free space by 21,930,196,992 bytes at its sampled low point
 * (during the Overpass build), i.e. 95.4 x the input, and left 11,083,399,168 bytes retained. Runs
 * that replaced a failed build needed 89.3-89.4 x after that build was removed. The default factor
 * adds ~25 % margin for sampling (10 s interval), snapshot growth and filesystem reserve. It is a
 * guard derived from one extract, not a guarantee for every input or for concurrent disk use.
 */
export const REFERENCE_MIN_FREE_FACTOR = 120;

/** Free-space sampling interval during an import (also at every step boundary). */
export const FREE_SPACE_SAMPLE_MS = 5_000;

export function freeBytes(path: string): number {
  const s = statfsSync(path);
  return Number(s.bavail) * Number(s.bsize);
}

export interface CapacityCheck {
  ok: boolean;
  filesystem_path: string;
  free_bytes: number;
  /** Bytes of a failed build of the same dataset id that the import would replace. */
  reclaimable_bytes: number;
  available_bytes: number;
  required_bytes: number;
  input_bytes: number;
  min_free_factor: number;
  min_free_bytes: number;
  reference_min_free_factor: number;
}

/** required = max(minFreeBytes, minFreeFactor x input); available = free + reclaimable. Pure. */
export function capacityCheck(path: string, free: number, reclaimable: number, inputBytes: number, s: Pick<Settings, 'minFreeFactor' | 'minFreeBytes'>): CapacityCheck {
  const required = Math.max(s.minFreeBytes, Math.ceil(s.minFreeFactor * inputBytes));
  const available = free + reclaimable;
  return {
    ok: available >= required,
    filesystem_path: path,
    free_bytes: free,
    reclaimable_bytes: reclaimable,
    available_bytes: available,
    required_bytes: required,
    input_bytes: inputBytes,
    min_free_factor: s.minFreeFactor,
    min_free_bytes: s.minFreeBytes,
    reference_min_free_factor: REFERENCE_MIN_FREE_FACTOR,
  };
}

export function describeCapacity(c: CapacityCheck): string {
  const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
  return `available ${c.available_bytes} B (${gb(c.available_bytes)}: free ${c.free_bytes} + reclaimable ${c.reclaimable_bytes}) ${c.ok ? '>=' : '<'} required ${c.required_bytes} B (${gb(c.required_bytes)}: max(minFreeBytes ${c.min_free_bytes}, minFreeFactor ${c.min_free_factor} x input ${c.input_bytes}))`;
}

/**
 * Low-water mark of free space, sampled on a timer and at step boundaries. Finite polling can miss
 * a shorter dip and cannot prevent another process from filling the disk; it records what it saw.
 */
export class FreeSpaceMonitor {
  min = Number.POSITIVE_INFINITY;
  minAt: string | null = null;
  samples = 0;
  private stepMin = Number.POSITIVE_INFINITY;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sampleFn: () => number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  sample(): number {
    let v: number;
    try {
      v = this.sampleFn();
    } catch {
      return Number.NaN; // a failed statfs is not a measurement
    }
    if (!Number.isFinite(v)) return Number.NaN;
    this.samples++;
    if (v < this.min) {
      this.min = v;
      this.minAt = this.now().toISOString();
    }
    if (v < this.stepMin) this.stepMin = v;
    return v;
  }

  /** Start a step: its own minimum begins with a fresh sample. */
  beginStep(): void {
    this.stepMin = Number.POSITIVE_INFINITY;
    this.sample();
  }

  /** End a step: take a closing sample and return the step's observed minimum. */
  endStep(): number | null {
    this.sample();
    return Number.isFinite(this.stepMin) ? this.stepMin : null;
  }

  start(intervalMs = FREE_SPACE_SAMPLE_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  minimum(): number | null {
    return Number.isFinite(this.min) ? this.min : null;
  }
}
