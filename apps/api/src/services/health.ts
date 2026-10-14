import { existsSync } from 'node:fs';
import { MapServiceError, PROVIDER_IDS, type ProviderHealth, type ProviderId, type Readiness } from '@seyra/contracts';
import type { ActiveRelease } from '../release.js';
import { geocoderMarkerName, tegolaMapName } from '../release.js';

export interface ProviderProbes {
  tiles(expectedMap: string, signal: AbortSignal): Promise<{ identity: string | null }>;
  routing(signal: AbortSignal): Promise<{ identity: string | null }>;
  geocoder(markerName: string, signal: AbortSignal): Promise<{ identity: string | null }>;
  overpass(signal: AbortSignal): Promise<{ identity: string | null }>;
  controlDb(signal: AbortSignal): Promise<void>;
}

const IMPLEMENTATION: Record<ProviderId, string> = {
  tiles: 'tegola',
  routing: 'valhalla',
  geocoder: 'photon',
  overpass: 'overpass',
};

/**
 * Readiness = every required provider answers a real probe AND reports the identity recorded
 * for the active release. Nothing here is hardcoded green; unknown means not ready.
 */
export class HealthService {
  private snapshot: Readiness | null = null;
  private inflight: Promise<Readiness> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly release: ActiveRelease,
    private readonly probes: ProviderProbes,
    private readonly opts: { cacheMs: number; probeTimeoutMs: number; maintenanceFlagFile: string },
  ) {}

  get datasetId(): string {
    return this.release.dataset_id;
  }

  inMaintenance(): boolean {
    return existsSync(this.opts.maintenanceFlagFile);
  }

  start(): void {
    void this.refresh().catch(() => undefined);
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), this.opts.cacheMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async readiness(maxAgeMs = this.opts.cacheMs): Promise<Readiness> {
    const snap = this.snapshot;
    if (snap && Date.now() - Date.parse(snap.checked_at) < maxAgeMs) return this.withMaintenance(snap);
    return this.withMaintenance(await this.refresh());
  }

  /** Refuse to serve from a provider whose last observed revision disagrees with the release. */
  gate(provider: ProviderId): void {
    if (this.inMaintenance()) throw new MapServiceError('MAINTENANCE', 'map services are in a maintenance window; retry later');
    const entry = this.snapshot?.providers.find((p) => p.provider === provider);
    if (entry?.status === 'revision_mismatch') {
      throw new MapServiceError('PROVIDER_REVISION_MISMATCH', `${provider} serves a different dataset revision than the active release`, {
        provider: IMPLEMENTATION[provider],
        details: { expected: entry.expected_identity, observed: entry.observed_identity },
      });
    }
  }

  private withMaintenance(r: Readiness): Readiness {
    return this.inMaintenance() ? { ...r, status: 'maintenance' } : r;
  }

  refresh(): Promise<Readiness> {
    this.inflight ??= this.probeAll().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private expected(provider: ProviderId): string {
    return this.release.identities[provider];
  }

  private async probeAll(): Promise<Readiness> {
    const ds = this.release.dataset_id;
    const run = async (provider: ProviderId, fn: (s: AbortSignal) => Promise<{ identity: string | null }>): Promise<ProviderHealth> => {
      const started = Date.now();
      const expected = this.expected(provider);
      const base = { provider, implementation: IMPLEMENTATION[provider], expected_identity: expected, checked_at: new Date().toISOString() };
      try {
        const { identity } = await fn(AbortSignal.timeout(this.opts.probeTimeoutMs));
        const latency = Date.now() - started;
        if (identity === expected) return { ...base, status: 'ok', observed_identity: identity, latency_ms: latency };
        return {
          ...base,
          status: 'revision_mismatch',
          observed_identity: identity,
          latency_ms: latency,
          error: identity === null ? 'release identity marker not found in the served data' : 'served data identity differs from the active release',
        };
      } catch (err) {
        return { ...base, status: 'unavailable', observed_identity: null, latency_ms: null, error: err instanceof Error ? err.message : 'probe failed' };
      }
    };
    const [tiles, routing, geocoder, overpass] = await Promise.all([
      run('tiles', (s) => this.probes.tiles(tegolaMapName(ds), s)),
      run('routing', (s) => this.probes.routing(s)),
      run('geocoder', (s) => this.probes.geocoder(geocoderMarkerName(ds), s)),
      run('overpass', (s) => this.probes.overpass(s)),
    ]);
    let db: Readiness['dependencies'][number];
    try {
      await this.probes.controlDb(AbortSignal.timeout(this.opts.probeTimeoutMs));
      db = { name: 'control_db', status: 'ok' };
    } catch (err) {
      db = { name: 'control_db', status: 'unavailable', error: err instanceof Error ? err.message : 'probe failed' };
    }
    const providers = [tiles, routing, geocoder, overpass];
    const allOk = providers.every((p) => p.status === 'ok') && db.status === 'ok';
    const snap: Readiness = {
      status: allOk ? 'ready' : 'not_ready',
      dataset_id: ds,
      providers,
      dependencies: [db],
      checked_at: new Date().toISOString(),
    };
    if (snap.providers.length !== PROVIDER_IDS.length) throw new Error('internal: provider list incomplete');
    this.snapshot = snap;
    return snap;
  }
}
