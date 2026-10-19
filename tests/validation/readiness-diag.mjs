// Bounded readiness diagnostic for the unresolved /health/ready 503 observation (run vm2-2026-10-18).
// Polls readiness and per-provider health while, optionally, a browser-like client requests
// uncached tiles and cancels part of them. Records timestamps, per-provider status, latency and a
// truncated error message. It never records coordinates, tile x/y or query text (zoom only).
//
//   node readiness-diag.mjs --base https://127.0.0.1:8443 --seconds 150 --out diag.json \
//     [--sample-ms 250] [--tile-clients 6] [--cancel-ms 150-1500] [--zooms 3-12] [--label text]
//
// Run it inside the offline host's network namespace (e.g. `docker run --network host` against the
// offline daemon, or `--network container:<offline-host>` from the VM), trusting the generated CA
// via NODE_EXTRA_CA_CERTS. Exit status 0 when the run completed (the verdict is in the JSON).
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const base = (args.base ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const seconds = Number(args.seconds ?? 120);
const sampleMs = Number(args['sample-ms'] ?? 250);
const clients = Number(args['tile-clients'] ?? 0);
const [cancelMin, cancelMax] = (args['cancel-ms'] ?? '150-1500').split('-').map(Number);
const [zMin, zMax] = (args.zooms ?? '3-12').split('-').map(Number);
const out = args.out ?? 'readiness-diag.json';
const t0 = Date.now();
const end = t0 + seconds * 1000;
const iso = () => new Date().toISOString();
const safe = (s) => (s == null ? null : String(s).replace(/-?\d{1,3}\.\d{3,}/g, '<num>').slice(0, 160));

const timeline = []; // only changes of state are kept
const series = { ready_codes: {}, provider_latency_ms: {} };
let last = '';
let firstReadyAt = null;
let postReadyNotReady = 0;
const notReadyEvents = [];
let polls = 0;

async function poll() {
  while (Date.now() < end) {
    polls++;
    const at = iso();
    let code = 'ERR';
    let readyErr = null;
    try {
      const r = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(10_000) });
      await r.arrayBuffer();
      code = String(r.status);
    } catch (e) {
      readyErr = safe(e?.cause?.code ?? e?.name ?? e?.message);
    }
    let providers = [];
    try {
      const h = await (await fetch(`${base}/api/v1/map/health`, { signal: AbortSignal.timeout(10_000) })).json();
      providers = (h.providers ?? []).map((p) => ({ provider: p.provider, status: p.status, latency_ms: p.latency_ms ?? null, error: safe(p.error), checked_at: p.checked_at ?? null }));
    } catch (e) {
      providers = [{ provider: 'health-endpoint', status: 'unreachable', error: safe(e?.cause?.code ?? e?.name ?? e?.message) }];
    }
    series.ready_codes[code] = (series.ready_codes[code] ?? 0) + 1;
    for (const p of providers) if (p.latency_ms != null) (series.provider_latency_ms[p.provider] ??= []).push(p.latency_ms);
    if (code === '200' && !firstReadyAt) firstReadyAt = at;
    if (firstReadyAt && code !== '200') {
      postReadyNotReady++;
      notReadyEvents.push({ at, ready: code, ready_error: readyErr, providers: providers.filter((p) => p.status !== 'ok') });
    }
    const state = `${code}|${providers.map((p) => `${p.provider}:${p.status}:${p.error ?? ''}`).join(',')}`;
    if (state !== last) {
      timeline.push({ at, t_s: Math.round((Date.now() - t0) / 100) / 10, ready: code, ready_error: readyErr, providers });
      last = state;
    }
    await new Promise((res) => setTimeout(res, sampleMs));
  }
}

const tiles = { requested: 0, completed: 0, cancelled: 0, by_status: {}, by_zoom: {} };
async function tileClient(seed) {
  let caps;
  try {
    caps = await (await fetch(`${base}/api/v1/map/capabilities`)).json();
  } catch {
    return; // not up yet: the poller records that
  }
  const tpl = caps?.map?.tiles;
  if (!tpl) return;
  let tj = null;
  try {
    tj = await (await fetch(`${base}${caps.map.tilejson}`)).json();
  } catch {
    /* fall back to world bounds */
  }
  const [w, s, e, n] = tj?.bounds ?? [-180, -85, 180, 85];
  let k = seed * 7919;
  const rnd = () => ((k = (k * 1103515245 + 12345) % 2147483648) / 2147483648);
  while (Date.now() < end) {
    const z = zMin + Math.floor(rnd() * (zMax - zMin + 1));
    const lon = w + rnd() * (e - w);
    const lat = s + rnd() * (n - s);
    const N = 2 ** z;
    const x = Math.min(N - 1, Math.floor(((lon + 180) / 360) * N));
    const r = (lat * Math.PI) / 180;
    const y = Math.min(N - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N)));
    const zs = (tiles.by_zoom[z] ??= { requested: 0, completed: 0, cancelled: 0, ms: [] });
    const cancelAfter = rnd() < 0.35 ? cancelMin + rnd() * (cancelMax - cancelMin) : null; // ~35 % abandoned, as when panning
    const ac = new AbortController();
    const timer = cancelAfter ? setTimeout(() => ac.abort(), cancelAfter) : null;
    const started = performance.now();
    tiles.requested++;
    zs.requested++;
    try {
      const res = await fetch(base + tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: ac.signal });
      await res.arrayBuffer();
      tiles.completed++;
      zs.completed++;
      zs.ms.push(Math.round(performance.now() - started));
      tiles.by_status[res.status] = (tiles.by_status[res.status] ?? 0) + 1;
    } catch {
      tiles.cancelled++;
      zs.cancelled++;
    }
    if (timer) clearTimeout(timer);
  }
}

const stats = (v) => {
  if (!v?.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

await Promise.all([poll(), ...Array.from({ length: clients }, (_, i) => tileClient(i + 1))]);
const report = {
  label: args.label ?? null,
  started_at: new Date(t0).toISOString(),
  config: { base, seconds, sample_ms: sampleMs, tile_clients: clients, cancel_ms: [cancelMin, cancelMax], zooms: [zMin, zMax] },
  polls,
  ready_codes: series.ready_codes,
  first_ready_at: firstReadyAt,
  not_ready_after_first_ready: postReadyNotReady,
  not_ready_events_after_first_ready: notReadyEvents.slice(0, 50),
  provider_latency_ms: Object.fromEntries(Object.entries(series.provider_latency_ms).map(([k, v]) => [k, stats(v)])),
  tiles: { ...tiles, by_zoom: Object.fromEntries(Object.entries(tiles.by_zoom).map(([z, v]) => [z, { requested: v.requested, completed: v.completed, cancelled: v.cancelled, ms: stats(v.ms) }])) },
  timeline,
};
writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ label: report.label, polls, ready_codes: report.ready_codes, first_ready_at: firstReadyAt, not_ready_after_first_ready: postReadyNotReady, tiles_requested: tiles.requested, tiles_cancelled: tiles.cancelled, tile_status: tiles.by_status }));
