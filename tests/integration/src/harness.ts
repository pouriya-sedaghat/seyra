// Shared harness for the real-provider integration suite.
//
// The suite talks to a RUNNING stack only through the public TLS ingress (Nginx proxy), exactly as
// the web client and mobile clients do. Trust for the internal CA comes from NODE_EXTRA_CA_CERTS.
//
//   SEYRA_IT_BASE      ingress origin (default https://127.0.0.1:8443)
//   SEYRA_IT_EVIDENCE  directory for JSON evidence files (default docs/evidence/integration)
//   NODE_EXTRA_CA_CERTS  path to the generated CA certificate (seyra-maps tls init)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');
export const BASE = (process.env.SEYRA_IT_BASE ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
export const API = `${BASE}/api/v1/map`;
const evidenceDir = resolve(process.env.SEYRA_IT_EVIDENCE ?? join(repoRoot, 'docs', 'evidence', 'integration'));

export interface FixtureExpect {
  layers: Record<string, Array<Record<string, string | number>>>;
  routing: {
    oneway: { way: number; from: [number, number]; to: [number, number] };
    footway: { way: number; from: [number, number]; to: [number, number] };
    motor_vehicle_no: { way: number };
    island: { way: number; point: [number, number] };
  };
  search: Array<{ query: string; lang: 'fa' | 'en'; expect_osm: string; note?: string }>;
  uncatalogued: Array<{ type: string; id: number; key: string }>;
  generic_icon_poi: { type: string; id: number; value: string };
  label_fallback: { en_only: number; fa_only_place: number };
  counts: { nodes: number; ways: number; relations: number };
}

export const expectFixture: FixtureExpect = JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'osm', 'synthetic-v1.expect.json'), 'utf8'));

export interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  raw: Buffer;
}

export async function http<T = unknown>(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<HttpResult<T>> {
  const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  const raw = Buffer.from(await res.arrayBuffer());
  let body: unknown = raw;
  if ((res.headers.get('content-type') ?? '').includes('json')) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = raw.toString('utf8');
    }
  }
  return { status: res.status, headers: res.headers, body: body as T, raw };
}

export const get = <T = any>(path: string) => http<T>(path.startsWith('http') ? path : `${API}${path}`);
export const post = <T = any>(path: string, payload: unknown) =>
  http<T>(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

export function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v));
  return u.toString();
}

/** Readiness of the active release, asserted ready by the caller. */
export async function activeDataset(): Promise<string> {
  const r = await http<{ status: string; dataset_id: string | null }>(`${BASE}/health/ready`);
  if (r.status !== 200 || r.body.status !== 'ready' || !r.body.dataset_id) {
    throw new Error(`stack is not ready (HTTP ${r.status}): run seyra-maps activate first`);
  }
  return r.body.dataset_id;
}

export function writeEvidence(name: string, data: unknown): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, `${name}.json`), `${JSON.stringify({ recorded_at: new Date().toISOString(), base: BASE, ...((data as object) ?? {}) }, null, 2)}\n`);
}

/** Fixture grid (generate-synthetic.mjs): columns i 0..8 lon, rows j 0..6 lat, step 0.005°. */
export const grid = (i: number, j: number) => ({ lon: Number((0.01 + i * 0.005).toFixed(6)), lat: Number((0.01 + j * 0.005).toFixed(6)) });

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}
