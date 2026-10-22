// Exploratory real-Iran smoke checks against a running Seyra stack (sequential; no load).
//
//   NODE_EXTRA_CA_CERTS=$SEYRA_HOME/secrets/tls/ca.crt node tests/validation/iran-smoke.mjs [base] [out.json]
//
// The owner has not yet supplied approved queries, locations or quality targets
// (docs/validation/IRAN_VALIDATION_INPUTS.md). Every expectation below is therefore an
// EXPLORATORY reference: an approximate, widely published coordinate of a well-known place,
// written here before the run and never taken from the endpoint under test. A miss can be an
// OSM data gap, an indexing defect or a relevance issue; this script only records what it saw.
// Latencies are single sequential requests on the validation host, not an SLA or capacity figure.
import { writeFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const outFile = process.argv[3] ?? 'iran-smoke.json';

// [lon, lat] reference points (approximate public coordinates) and the radius treated as a hit.
const P = {
  tehran: [51.389, 35.6892],
  azadi: [51.338, 35.6997],
  milad: [51.3753, 35.7448],
  bazaar: [51.4214, 35.6726],
  tajrish: [51.4339, 35.8044],
  mehrabad: [51.3134, 35.6892],
  ika: [51.1522, 35.4161],
  karaj: [50.9915, 35.84],
  isfahan: [51.666, 32.6539],
  naqshejahan: [51.6777, 32.6575],
  siosepol: [51.6676, 32.6444],
  shiraz: [52.5837, 29.5918],
  persepolis: [52.8916, 29.9355],
  mashhad: [59.6168, 36.2605],
  tabriz: [46.2919, 38.08],
  zahedan: [60.8629, 29.4963],
  chabahar: [60.643, 25.2919],
  bandarabbas: [56.2666, 27.1832],
  rasht: [49.5832, 37.2808],
  yazd: [54.3569, 31.8974],
  abyaneh: [51.6025, 33.5767],
  masuleh: [48.9867, 37.1553],
  bazargan: [44.386, 39.3925],
  astara: [48.872, 38.429],
  kish: [53.98, 26.53],
};

const SEARCH = [
  { q: 'تهران', lang: 'fa', ref: 'tehran', km: 20 },
  { q: 'Tehran', lang: 'en', ref: 'tehran', km: 20 },
  { q: 'برج آزادی', lang: 'fa', ref: 'azadi', km: 2 },
  { q: 'Azadi Tower', lang: 'en', ref: 'azadi', km: 2 },
  { q: 'برج میلاد', lang: 'fa', ref: 'milad', km: 2 },
  { q: 'Milad Tower', lang: 'en', ref: 'milad', km: 2 },
  { q: 'اصفهان', lang: 'fa', ref: 'isfahan', km: 20 },
  { q: 'Isfahan', lang: 'en', ref: 'isfahan', km: 20 },
  { q: 'میدان نقش جهان', lang: 'fa', ref: 'naqshejahan', km: 2 },
  { q: 'شیراز', lang: 'fa', ref: 'shiraz', km: 20 },
  { q: 'Shiraz', lang: 'en', ref: 'shiraz', km: 20 },
  { q: 'تخت جمشید', lang: 'fa', ref: 'persepolis', km: 5 },
  { q: 'مشهد', lang: 'fa', ref: 'mashhad', km: 20 },
  { q: 'تبریز', lang: 'fa', ref: 'tabriz', km: 20 },
  { q: 'Tabriz', lang: 'en', ref: 'tabriz', km: 20 },
  { q: 'زاهدان', lang: 'fa', ref: 'zahedan', km: 20 },
  { q: 'چابهار', lang: 'fa', ref: 'chabahar', km: 20 },
  { q: 'بندرعباس', lang: 'fa', ref: 'bandarabbas', km: 20 },
  { q: 'بندر عباس', lang: 'fa', ref: 'bandarabbas', km: 20, note: 'space variant' },
  { q: 'رشت', lang: 'fa', ref: 'rasht', km: 20 },
  { q: 'یزد', lang: 'fa', ref: 'yazd', km: 20 },
  { q: 'ابیانه', lang: 'fa', ref: 'abyaneh', km: 5, note: 'village' },
  { q: 'ماسوله', lang: 'fa', ref: 'masuleh', km: 5, note: 'village' },
  { q: 'بازرگان', lang: 'fa', ref: 'bazargan', km: 10, note: 'border town' },
  { q: 'آستارا', lang: 'fa', ref: 'astara', km: 10, note: 'border town' },
  { q: 'فرودگاه مهرآباد', lang: 'fa', ref: 'mehrabad', km: 4 },
  { q: 'فرودگاه امام خمینی', lang: 'fa', ref: 'ika', km: 8 },
  // Normalization variants: Arabic Yeh/Kaf and a ZWNJ/space variant of the same names.
  { q: 'تهران', lang: 'fa', ref: 'tehran', km: 20, bias: 'isfahan', note: 'bias towards Isfahan' },
  { q: 'برج ميلاد', lang: 'fa', ref: 'milad', km: 2, note: 'Arabic Yeh (ي)' },
  { q: 'شيراز', lang: 'fa', ref: 'shiraz', km: 20, note: 'Arabic Yeh (ي)' },
  { q: 'كرج', lang: 'fa', ref: 'karaj', km: 20, note: 'Arabic Kaf (ك)' },
  { q: 'کرج', lang: 'fa', ref: 'karaj', km: 20 },
  { q: 'تهران۱', lang: 'fa', ref: 'tehran', km: 30, note: 'trailing Persian digit (noise)' },
];
const AUTOCOMPLETE = [
  { q: 'تهر', lang: 'fa', ref: 'tehran', km: 30 },
  { q: 'Teh', lang: 'en', ref: 'tehran', km: 30 },
  { q: 'اصف', lang: 'fa', ref: 'isfahan', km: 30 },
  { q: 'برج آز', lang: 'fa', ref: 'azadi', km: 3 },
  { q: 'Mash', lang: 'en', ref: 'mashhad', km: 30 },
  { q: 'شیرا', lang: 'fa', ref: 'shiraz', km: 30 },
];
const REVERSE = [
  { at: 'azadi', expect_any: ['تهران', 'Tehran'] },
  { at: 'naqshejahan', expect_any: ['اصفهان', 'Isfahan', 'Esfahan'] },
  { at: 'shiraz', expect_any: ['شیراز', 'Shiraz'] },
  { at: 'tabriz', expect_any: ['تبریز', 'Tabriz'] },
  { at: 'zahedan', expect_any: ['زاهدان', 'Zahedan'] },
  { at: 'abyaneh', expect_any: ['ابیانه', 'Abyaneh', 'نطنز', 'Natanz'] },
  { at: 'desert', point: [54.0, 34.5], expect_any: [], note: 'Dasht-e Kavir; sparse data expected' },
];

const km = (a, b) => {
  const R = 6371.0088;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b[1] - a[1]);
  const dLon = r(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const log = [];
async function call(op, method, path, body) {
  const t0 = performance.now();
  let status = 0;
  let json = null;
  let bytes = 0;
  let error = null;
  let contentType = null;
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(130_000),
    });
    status = res.status;
    contentType = res.headers.get('content-type');
    const buf = Buffer.from(await res.arrayBuffer());
    bytes = buf.length;
    if (contentType?.includes('json')) json = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    error = String(e?.cause?.code ?? e?.message ?? e);
  }
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  log.push({ op, ms, status });
  return { status, json, bytes, ms, error, contentType };
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

function rankWithin(results, ref, radiusKm) {
  const ranked = (results ?? []).map((r, i) => ({ i, d: km([r.coordinate.lon, r.coordinate.lat], ref) }));
  const hit = ranked.find((x) => x.d <= radiusKm);
  return { rank: hit ? hit.i + 1 : null, nearest_km: ranked.length ? Math.round(Math.min(...ranked.map((x) => x.d)) * 10) / 10 : null };
}
const brief = (r) => ({ name: r.name, category: r.category ? `${r.category.key}=${r.category.value}` : null, lon: r.coordinate?.lon, lat: r.coordinate?.lat, city: r.address?.city ?? null, state: r.address?.state ?? null });

const report = { recorded_at: new Date().toISOString(), base, label: 'EXPLORATORY real-Iran smoke (no owner-approved fixtures yet)', reference_points: P };

const ready = await call('ready', 'GET', '/health/ready');
const caps = await call('capabilities', 'GET', '/api/v1/map/capabilities');
const health = await call('health', 'GET', '/api/v1/map/health');
report.ready = { status: ready.status, body: ready.json };
report.dataset_id = caps.json?.dataset_id ?? null;
report.health = health.json;

report.search = [];
for (const c of SEARCH) {
  const bias = c.bias ? { bias_lon: P[c.bias][0], bias_lat: P[c.bias][1] } : {};
  const r = await call('search', 'GET', `/api/v1/map/search?${qs({ q: c.q, lang: c.lang, limit: 10, ...bias })}`);
  const results = r.json?.results ?? [];
  report.search.push({ ...c, status: r.status, ms: r.ms, result_status: r.json?.result_status ?? r.json?.error?.code ?? r.error, normalized_query: r.json?.normalized_query, count: results.length, ...rankWithin(results, P[c.ref], c.km), top3: results.slice(0, 3).map(brief) });
}
report.autocomplete = [];
for (const c of AUTOCOMPLETE) {
  const r = await call('autocomplete', 'GET', `/api/v1/map/autocomplete?${qs({ q: c.q, lang: c.lang, limit: 10 })}`);
  const results = r.json?.results ?? [];
  report.autocomplete.push({ ...c, status: r.status, ms: r.ms, result_status: r.json?.result_status ?? r.json?.error?.code ?? r.error, count: results.length, ...rankWithin(results, P[c.ref], c.km), top3: results.slice(0, 3).map(brief) });
}
report.reverse = [];
for (const c of REVERSE) {
  const pt = c.point ?? P[c.at];
  for (const lang of ['fa', 'en']) {
    const r = await call('reverse', 'GET', `/api/v1/map/reverse?${qs({ lon: pt[0], lat: pt[1], lang, limit: 3, radius_m: 1000 })}`);
    const results = r.json?.results ?? [];
    const text = JSON.stringify(results);
    report.reverse.push({ at: c.at, lang, point: pt, status: r.status, ms: r.ms, result_status: r.json?.result_status ?? r.json?.error?.code ?? r.error, count: results.length, expected_name_seen: c.expect_any.length ? c.expect_any.some((n) => text.includes(n)) : null, top3: results.slice(0, 3).map((x) => ({ ...brief(x), address: x.address ?? null, distance_km: Math.round(km([x.coordinate.lon, x.coordinate.lat], pt) * 1000) / 1000 })), note: c.note ?? null });
  }
}

const pt = (id, k) => ({ id, lon: P[k][0], lat: P[k][1] });
const ROUTES = [
  { name: 'Tehran Azadi -> Karaj (car, time, 2 alternatives)', body: { profile: 'car', objective: 'time', order: 'ordered', alternatives: 2, points: [pt('azadi', 'azadi'), pt('karaj', 'karaj')] }, expect_km: [30, 70] },
  { name: 'Tehran Azadi -> Karaj (car, distance)', body: { profile: 'car', objective: 'distance', order: 'ordered', points: [pt('azadi', 'azadi'), pt('karaj', 'karaj')] }, expect_km: [30, 70] },
  { name: 'Tehran -> Isfahan (car, time)', body: { profile: 'car', objective: 'time', order: 'ordered', points: [pt('tehran', 'tehran'), pt('isfahan', 'isfahan')] }, expect_km: [400, 520] },
  { name: 'Tehran -> Mashhad (car, time)', body: { profile: 'car', objective: 'time', order: 'ordered', points: [pt('tehran', 'tehran'), pt('mashhad', 'mashhad')] }, expect_km: [850, 1050] },
  { name: 'Tabriz -> Zahedan (car, time; cross-country)', body: { profile: 'car', objective: 'time', order: 'ordered', points: [pt('tabriz', 'tabriz'), pt('zahedan', 'zahedan')] }, expect_km: [1900, 2600] },
  { name: 'Azadi -> Milad (motorcycle, time, 2 alternatives)', body: { profile: 'motorcycle', objective: 'time', order: 'ordered', alternatives: 2, points: [pt('azadi', 'azadi'), pt('milad', 'milad')] }, expect_km: [4, 15] },
  { name: 'Azadi -> Milad (motorcycle, distance)', body: { profile: 'motorcycle', objective: 'distance', order: 'ordered', points: [pt('azadi', 'azadi'), pt('milad', 'milad')] }, expect_km: [4, 15] },
  { name: 'Naqsh-e Jahan -> Si-o-se-pol (pedestrian, distance)', body: { profile: 'pedestrian', objective: 'distance', order: 'ordered', points: [pt('naqsh', 'naqshejahan'), pt('siosepol', 'siosepol')] }, expect_km: [1, 3.5] },
  { name: 'Naqsh-e Jahan -> Si-o-se-pol (pedestrian, time, 2 alternatives)', body: { profile: 'pedestrian', objective: 'time', order: 'ordered', alternatives: 2, points: [pt('naqsh', 'naqshejahan'), pt('siosepol', 'siosepol')] }, expect_km: [1, 3.5] },
  { name: 'Tehran ordered 4 stops (car, time)', body: { profile: 'car', objective: 'time', order: 'ordered', points: [pt('azadi', 'azadi'), pt('milad', 'milad'), pt('tajrish', 'tajrish'), pt('bazaar', 'bazaar')] }, expect_km: [20, 70] },
  { name: 'Tehran optimized 5 stops (car, time; fixed first/last)', body: { profile: 'car', objective: 'time', order: 'optimized', points: [pt('azadi', 'azadi'), pt('bazaar', 'bazaar'), pt('tajrish', 'tajrish'), pt('milad', 'milad'), pt('mehrabad', 'mehrabad')] }, expect_km: [20, 90] },
  { name: 'Tehran optimized 5 stops (motorcycle, distance)', body: { profile: 'motorcycle', objective: 'distance', order: 'optimized', points: [pt('azadi', 'azadi'), pt('bazaar', 'bazaar'), pt('tajrish', 'tajrish'), pt('milad', 'milad'), pt('mehrabad', 'mehrabad')] }, expect_km: [20, 90] },
  { name: 'Tehran -> Kish Island (car; island, ferry handling observed only)', body: { profile: 'car', objective: 'time', order: 'ordered', points: [pt('tehran', 'tehran'), pt('kish', 'kish')] }, expect_km: null },
  { name: 'Rejected: 3-point alternatives (UNSUPPORTED_COMBINATION expected)', body: { profile: 'car', objective: 'time', order: 'ordered', alternatives: 1, points: [pt('a', 'azadi'), pt('b', 'milad'), pt('c', 'tajrish')] }, expect_status: 422 },
];
report.routing = [];
for (const c of ROUTES) {
  const r = await call('route', 'POST', '/api/v1/map/route', c.body);
  const routes = r.json?.routes ?? [];
  const d = routes[0]?.distance_m ?? null;
  const inRange = c.expect_km && d !== null ? d / 1000 >= c.expect_km[0] && d / 1000 <= c.expect_km[1] : null;
  report.routing.push({
    name: c.name, status: r.status, ms: r.ms,
    error: r.json?.error?.code ?? r.error ?? null,
    route_optimality: r.json?.route_optimality ?? null, duration_semantics: r.json?.duration_semantics ?? null,
    visit_order: r.json?.visit_order?.map((v) => v.id) ?? null,
    optimization: r.json?.optimization ?? null,
    alternatives_requested: r.json?.alternatives_requested ?? null, alternatives_returned: r.json?.alternatives_returned ?? null,
    routes: routes.map((x) => ({ rank: x.rank, distance_km: Math.round(x.distance_m / 100) / 10, duration_min: Math.round(x.duration_s / 6) / 10 })),
    expected_distance_km: c.expect_km ?? null, distance_in_expected_range: inRange, expected_status: c.expect_status ?? 200,
  });
}

const cands = ['milad', 'mehrabad', 'bazaar', 'tajrish', 'ika'].map((k) => pt(k, k));
report.proximity = [];
for (const metric of ['straight_line', 'road_distance', 'travel_time']) {
  for (const direction of ['origin_to_candidate', 'candidate_to_origin']) {
    const body = { metric, direction, origin: { lon: P.azadi[0], lat: P.azadi[1] }, candidates: cands, ...(metric === 'straight_line' ? {} : { profile: 'car' }) };
    const r = await call('proximity', 'POST', '/api/v1/map/proximity', body);
    report.proximity.push({ metric, direction, status: r.status, ms: r.ms, error: r.json?.error?.code ?? r.error ?? null, ranked_by: r.json?.ranked_by ?? null, ranking: (r.json?.results ?? []).map((x) => ({ id: x.id, rank: x.rank, status: x.status, distance_km: x.distance_m == null ? null : Math.round(x.distance_m / 100) / 10, duration_min: x.duration_s == null ? null : Math.round(x.duration_s / 6) / 10 })) });
  }
}

const BOXES = {
  tehran_center: [51.38, 35.68, 51.43, 35.72],
  isfahan_center: [51.65, 32.64, 51.7, 32.67],
  zahedan_center: [60.84, 29.48, 60.89, 29.52],
  rural_kavir: [54.0, 34.5, 54.05, 34.54],
};
report.pois = [];
for (const [box, bbox] of Object.entries(BOXES)) {
  for (const preset of ['hospitals', 'pharmacies', 'police', 'fire_stations', 'fuel', 'parking', 'schools', 'food']) {
    const r = await call('pois', 'GET', `/api/v1/map/pois?${qs({ bbox: bbox.join(','), preset, limit: 200, lang: 'fa' })}`);
    report.pois.push({ box, preset, status: r.status, ms: r.ms, error: r.json?.error?.code ?? r.error ?? null, count: r.json?.features?.length ?? null, truncated: r.json?.truncated ?? null, named: (r.json?.features ?? []).filter((f) => f.name).length });
  }
}

// Tiles: status and size only (vector content is checked by the staging validation and AC08 suite).
const tileXY = (lon, lat, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rr = (lat * Math.PI) / 180;
  return [x, Math.floor(((1 - Math.log(Math.tan(rr) + 1 / Math.cos(rr)) / Math.PI) / 2) * n)];
};
report.tiles = [];
const tilesPath = caps.json?.map?.tiles;
if (tilesPath) {
  for (const [place, zooms] of [['tehran', [0, 4, 6, 8, 10, 12, 14, 16]], ['isfahan', [8, 12, 14]], ['zahedan', [8, 12, 14]], ['bazargan', [10, 14]], ['chabahar', [10, 14]], ['abyaneh', [12, 14, 16]], ['kish', [10, 14]]]) {
    for (const z of zooms) {
      const [x, y] = tileXY(P[place][0], P[place][1], z);
      const r = await call('tile', 'GET', tilesPath.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      report.tiles.push({ place, z, x, y, status: r.status, ms: r.ms, bytes: r.bytes, content_type: r.contentType });
    }
  }
  for (const s of Object.values(caps.json.map.styles)) {
    const r = await call('style', 'GET', s);
    report.tiles.push({ style: s, status: r.status, bytes: r.bytes });
  }
}

const stats = {};
for (const e of log) (stats[e.op] ??= []).push(e.ms);
report.latency_ms = Object.fromEntries(Object.entries(stats).map(([op, v]) => {
  const s = [...v].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return [op, { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1] }];
}));
report.latency_method = 'one sequential client on the validation host via the TLS ingress; wall time per request (performance.now); no concurrency';
report.summary = {
  search_hit_at_1: report.search.filter((s) => s.rank === 1).length,
  search_hit_at_5: report.search.filter((s) => s.rank !== null && s.rank <= 5).length,
  search_cases: report.search.length,
  autocomplete_hit_at_5: report.autocomplete.filter((s) => s.rank !== null && s.rank <= 5).length,
  autocomplete_cases: report.autocomplete.length,
  reverse_expected_seen: report.reverse.filter((r) => r.expected_name_seen === true).length,
  reverse_cases_with_expectation: report.reverse.filter((r) => r.expected_name_seen !== null).length,
  routing_status_as_expected: report.routing.filter((r) => r.status === r.expected_status).length,
  routing_cases: report.routing.length,
  routing_distance_in_range: report.routing.filter((r) => r.distance_in_expected_range === true).length,
  proximity_ok: report.proximity.filter((p) => p.status === 200).length,
  pois_ok: report.pois.filter((p) => p.status === 200).length,
  pois_cases: report.pois.length,
  tiles_ok: report.tiles.filter((t) => t.status === 200 || t.status === 204).length,
  tiles_requests: report.tiles.length,
  transport_errors: log.filter((e) => e.status === 0).length,
};
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ dataset_id: report.dataset_id, ready: ready.status, ...report.summary }));
