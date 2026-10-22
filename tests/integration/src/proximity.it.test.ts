// AC13: proximity ranking of the supplied candidates only, with explicit metric and direction,
// on the real providers (PostGIS geography for straight_line, Valhalla for road metrics).
import { beforeAll, describe, expect, it } from 'vitest';
import { activeDataset, expectFixture, grid, post, writeEvidence } from './harness.js';

let ds = '';
const evidence: Record<string, unknown> = {};
beforeAll(async () => {
  ds = await activeDataset();
});

/** Vincenty inverse on WGS84 — an independent oracle for the geography distances. */
function vincenty(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = (1 - f) * a;
  const rad = Math.PI / 180;
  const L = (lon2 - lon1) * rad;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * rad));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * rad));
  const [sinU1, cosU1, sinU2, cosU2] = [Math.sin(U1), Math.cos(U1), Math.sin(U2), Math.cos(U2)];
  let lambda = L;
  let iter = 0;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  do {
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha ** 2;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) break;
  } while (++iter < 200);
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma = B * sinSigma * (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return b * A * (sigma - dSigma);
}

const prox = (body: Record<string, unknown>) => post('/proximity', body);
const c = (id: string, p: { lon: number; lat: number }) => ({ id, lon: p.lon, lat: p.lat });

describe('straight_line (PostGIS geography)', () => {
  it('matches an independent WGS84 geodesic within 5 cm and ranks ascending with stable ties', async () => {
    const origin = grid(4, 4);
    const candidates = [c('far', grid(8, 6)), c('near', grid(5, 4)), c('tie-a', grid(4, 6)), c('tie-b', grid(4, 6)), c('mid', grid(1, 1))];
    const r = await prox({ metric: 'straight_line', direction: 'origin_to_candidate', origin, candidates, dataset_id: ds });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ provider: 'postgis', profile: null, ranking_scope: 'supplied_candidates_only', ranked_by: 'distance_m', units: { distance: 'm', duration: 's' } });
    expect(r.body.results.length).toBe(candidates.length);
    for (const res of r.body.results) {
      const cand = candidates[res.input_index]!;
      expect(res.id).toBe(cand.id);
      expect(Math.abs(res.distance_m - vincenty(origin.lon, origin.lat, cand.lon, cand.lat))).toBeLessThan(0.05);
      expect(res.duration_s).toBeNull();
    }
    const ranked = r.body.results.map((x: { id: string; rank: number }) => [x.rank, x.id]);
    expect(ranked).toEqual([[1, 'near'], [2, 'tie-a'], [3, 'tie-b'], [4, 'mid'], [5, 'far']]);
    evidence.straight_line = r.body.results;
  });
});

describe('road metrics (Valhalla)', () => {
  // One-way column 4 runs northbound from (0.03,0.02) to (0.03,0.04).
  const north = { lon: expectFixture.routing.oneway.to[0], lat: expectFixture.routing.oneway.to[1] };
  const south = { lon: expectFixture.routing.oneway.from[0], lat: expectFixture.routing.oneway.from[1] };
  const candidates = [c('south-end', south), c('side', grid(2, 2))];

  it('direction changes the ranking on asymmetric roads (car road_distance)', async () => {
    const out = await prox({ metric: 'road_distance', direction: 'origin_to_candidate', profile: 'car', origin: north, candidates });
    const inn = await prox({ metric: 'road_distance', direction: 'candidate_to_origin', profile: 'car', origin: north, candidates });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(inn.status).toBe(200);
    const byId = (b: any) => Object.fromEntries(b.results.map((x: any) => [x.id, x]));
    const o = byId(out.body);
    const i = byId(inn.body);
    // Against the one-way (north → south) is longer than with it (south → north).
    expect(o['south-end'].distance_m).toBeGreaterThan(i['south-end'].distance_m * 1.5);
    // The two-way side street is symmetric.
    expect(Math.abs(o.side.distance_m - i.side.distance_m)).toBeLessThan(5);
    expect(o.side.rank).toBe(1);
    expect(i['south-end'].rank).toBe(1);
    expect(out.body).toMatchObject({ provider: 'valhalla', profile: 'car', ranked_by: 'distance_m' });
    evidence.asymmetry = { origin_to_candidate: out.body.results, candidate_to_origin: inn.body.results };
  });

  it('travel_time ranks by static duration estimate', async () => {
    const r = await prox({ metric: 'travel_time', direction: 'origin_to_candidate', profile: 'car', origin: north, candidates });
    expect(r.status).toBe(200);
    expect(r.body.ranked_by).toBe('duration_s');
    const ranked = [...r.body.results].sort((a: any, b: any) => a.rank - b.rank);
    expect(ranked[0].duration_s).toBeLessThanOrEqual(ranked[1].duration_s);
  });

  it('reports unreachable candidates last with no straight-line fallback, keeping every supplied candidate', async () => {
    const island = { lon: expectFixture.routing.island.point[0], lat: expectFixture.routing.island.point[1] };
    const cands = [c('island', island), c('a', grid(5, 4)), c('b', grid(6, 5))];
    const r = await prox({ metric: 'road_distance', direction: 'origin_to_candidate', profile: 'pedestrian', origin: grid(4, 4), candidates: cands });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results.length).toBe(3);
    const last = r.body.results.at(-1);
    expect(last).toMatchObject({ id: 'island', status: 'unreachable', rank: null, distance_m: null, duration_s: null });
    expect(r.body.results.slice(0, 2).map((x: any) => x.rank)).toEqual([1, 2]);
    evidence.unreachable = r.body.results;
  });

  it('ranks all 50 supplied candidates (the default cap) and rejects 51', async () => {
    const many = Array.from({ length: 50 }, (_, k) => c(`k${k}`, grid(k % 9, 2 + (Math.floor(k / 9) % 5))));
    const r = await prox({ metric: 'road_distance', direction: 'origin_to_candidate', profile: 'pedestrian', origin: grid(4, 4), candidates: many });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
    expect(r.body.results.length).toBe(50);
    const ranks = r.body.results.filter((x: any) => x.status === 'reachable').map((x: any) => x.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    // Equal distances are ordered by input index.
    const sorted = [...r.body.results].filter((x: any) => x.rank !== null).sort((a: any, b: any) => a.rank - b.rank);
    for (let k = 1; k < sorted.length; k++) {
      const [p, q] = [sorted[k - 1], sorted[k]];
      expect(p.distance_m < q.distance_m || (p.distance_m === q.distance_m && p.input_index < q.input_index)).toBe(true);
    }
    const over = await prox({ metric: 'road_distance', direction: 'origin_to_candidate', profile: 'pedestrian', origin: grid(4, 4), candidates: [...many, c('k50', grid(0, 2))] });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('LIMIT_EXCEEDED');
    evidence.cap = { ranked: r.body.results.length, rejected_51: over.body.error.code };
  });
});

describe('explicit parameters are required (no defaults)', () => {
  const origin = grid(4, 4);
  const candidates = [c('a', grid(5, 4))];
  const cases: Array<[string, Record<string, unknown>]> = [
    ['missing metric', { direction: 'origin_to_candidate', origin, candidates }],
    ['missing direction', { metric: 'straight_line', origin, candidates }],
    ['road metric without profile', { metric: 'road_distance', direction: 'origin_to_candidate', origin, candidates }],
    ['profile with straight_line', { metric: 'straight_line', direction: 'origin_to_candidate', profile: 'car', origin, candidates }],
    ['unknown metric', { metric: 'crow_flies', direction: 'origin_to_candidate', origin, candidates }],
    ['duplicate candidate ids', { metric: 'straight_line', direction: 'origin_to_candidate', origin, candidates: [candidates[0], candidates[0]] }],
    ['empty candidate list', { metric: 'straight_line', direction: 'origin_to_candidate', origin, candidates: [] }],
  ];
  it.each(cases)('%s → 400 INVALID_REQUEST', async (_n, body) => {
    const r = await prox(body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_REQUEST');
  });

  it('writes proximity evidence', () => {
    writeEvidence('proximity', { dataset_id: ds, ...evidence });
  });
});
