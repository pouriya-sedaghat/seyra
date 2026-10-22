// AC10 / AC11 / AC12 on the real Valhalla graph built from the synthetic fixture.
//  - every supported routing-table cell, and typed rejection of every unsupported combination
//  - profile restrictions: motorcycle=no motorway, pedestrian-only footway, motor_vehicle=no lane,
//    one-way asymmetry, disconnected island
//  - optimized order: Held–Karp result compared with an INDEPENDENT brute-force enumeration over
//    the same directed pair costs, measured here through two-point ordered routes
import { beforeAll, describe, expect, it } from 'vitest';
import { activeDataset, expectFixture, grid, post, writeEvidence } from './harness.js';

type Profile = 'car' | 'pedestrian' | 'motorcycle';
type Objective = 'time' | 'distance';
const PROFILES: Profile[] = ['car', 'pedestrian', 'motorcycle'];
const OBJECTIVES: Objective[] = ['time', 'distance'];

interface Pt {
  id: string;
  lon: number;
  lat: number;
}
const pt = (id: string, p: { lon: number; lat: number }): Pt => ({ id, lon: p.lon, lat: p.lat });

let ds = '';
const evidence: Record<string, unknown> = {};

beforeAll(async () => {
  ds = await activeDataset();
});

async function route(body: Record<string, unknown>) {
  return post('/route', body);
}

/** Geometry points strictly inside the motorway span on row 0 (lat 0.01). */
const onMotorway = (coords: [number, number][]) => coords.filter(([lon, lat]) => Math.abs(lat - 0.01) < 0.0004 && lon > 0.012 && lon < 0.048).length;

describe('supported routing-table cells (all profiles × objectives)', () => {
  const two = [pt('a', grid(0, 2)), pt('b', grid(8, 4))];
  const three = [pt('a', grid(0, 2)), pt('m', grid(4, 3)), pt('b', grid(8, 4))];
  const four = [pt('s', grid(0, 2)), pt('x', grid(6, 5)), pt('y', grid(2, 5)), pt('e', grid(8, 2))];
  const cells: Array<{ name: string; order: 'ordered' | 'optimized'; points: Pt[]; alternatives?: number }> = [
    { name: 'ordered 2 points + 2 alternatives', order: 'ordered', points: two, alternatives: 2 },
    { name: 'ordered 3 points', order: 'ordered', points: three },
    { name: 'optimized 2 points', order: 'optimized', points: two },
    { name: 'optimized 4 points', order: 'optimized', points: four },
  ];
  const results: unknown[] = [];

  for (const profile of PROFILES) {
    for (const objective of OBJECTIVES) {
      for (const cell of cells) {
        it(`${profile} / ${objective} / ${cell.name}`, async () => {
          const r = await route({ profile, objective, order: cell.order, points: cell.points, ...(cell.alternatives ? { alternatives: cell.alternatives } : {}), dataset_id: ds });
          expect(r.status, JSON.stringify(r.body)).toBe(200);
          const b = r.body;
          expect(b).toMatchObject({ dataset_id: ds, provider: 'valhalla', profile, objective, order: cell.order, route_optimality: 'not_guaranteed', duration_semantics: 'static_estimate', units: { distance: 'm', duration: 's' }, coordinate_order: 'lon,lat' });
          expect(b.routes.length).toBe(1 + b.alternatives_returned);
          expect(b.alternatives_returned).toBeLessThanOrEqual(cell.alternatives ?? 0);
          const primary = b.routes[0];
          expect(primary.rank).toBe(0);
          expect(primary.legs.length).toBe(cell.points.length - 1);
          expect(primary.geometry.type).toBe('LineString');
          // Visit order: every input point exactly once, endpoints fixed.
          const idx = b.visit_order.map((v: { input_index: number }) => v.input_index);
          expect([...idx].sort((x: number, y: number) => x - y)).toEqual(cell.points.map((_, i) => i));
          expect(idx[0]).toBe(0);
          expect(idx.at(-1)).toBe(cell.points.length - 1);
          if (cell.order === 'optimized') {
            expect(b.optimization).toMatchObject({ method: 'held_karp_directed_pair_costs', visit_order_optimal_for_pair_costs: true, modeled_cost_unit: objective === 'time' ? 's' : 'm' });
            expect(b.optimization.final_route_cost).toBe(objective === 'time' ? primary.duration_s : primary.distance_m);
            // ≥3 points: exactness scoped to the pair table; 2 points: input order, no reordering.
            expect(String(b.optimization.note)).toMatch(cell.points.length >= 3 ? /road-route optimality is not guaranteed/ : /no reordering/);
          } else {
            expect(b.optimization).toBeUndefined();
          }
          results.push({ profile, objective, cell: cell.name, status: r.status, distance_m: primary.distance_m, duration_s: primary.duration_s, alternatives_returned: b.alternatives_returned, visit_order: idx, optimization: b.optimization ? { modeled_cost: b.optimization.modeled_cost, final_route_cost: b.optimization.final_route_cost } : null });
        });
      }
    }
  }

  it('records the cell evidence', () => {
    evidence.cells = results;
    expect(results.length).toBe(PROFILES.length * OBJECTIVES.length * cells.length);
  });
});

describe('typed rejections (AC10)', () => {
  const base = { profile: 'car', objective: 'time' };
  const p = (n: number) => Array.from({ length: n }, (_, i) => pt(`p${i}`, grid(i % 9, Math.floor(i / 9) % 7)));
  const cases: Array<[string, Record<string, unknown>, number, string]> = [
    ['alternatives with 3 points', { ...base, points: p(3), alternatives: 1 }, 422, 'UNSUPPORTED_COMBINATION'],
    ['alternatives with optimized order', { ...base, order: 'optimized', points: p(2), alternatives: 1 }, 422, 'UNSUPPORTED_COMBINATION'],
    ['date_time', { ...base, points: p(2), date_time: { type: 1, value: '2026-10-14T08:00' } }, 422, 'UNSUPPORTED_COMBINATION'],
    ['live_traffic', { ...base, points: p(2), live_traffic: true }, 422, 'UNSUPPORTED_COMBINATION'],
    ['26 ordered points', { ...base, points: p(26) }, 400, 'LIMIT_EXCEEDED'],
    ['11 optimized points', { ...base, order: 'optimized', points: p(11) }, 400, 'LIMIT_EXCEEDED'],
    ['3 alternatives', { ...base, points: p(2), alternatives: 3 }, 400, 'LIMIT_EXCEEDED'],
    ['unknown profile', { ...base, profile: 'bicycle', points: p(2) }, 400, 'INVALID_REQUEST'],
    ['unknown objective', { ...base, objective: 'scenic', points: p(2) }, 400, 'INVALID_REQUEST'],
    ['duplicate point ids', { ...base, points: [pt('a', grid(0, 2)), pt('a', grid(8, 2))] }, 400, 'INVALID_REQUEST'],
    ['out-of-range latitude', { ...base, points: [pt('a', { lon: 0.01, lat: 91 }), pt('b', grid(8, 2))] }, 400, 'INVALID_REQUEST'],
    ['unknown field', { ...base, points: p(2), avoid_tolls: true }, 400, 'INVALID_REQUEST'],
    ['mismatched dataset_id', { ...base, points: p(2), dataset_id: 'ds-19990101-000000000000' }, 409, 'DATASET_MISMATCH'],
  ];
  it.each(cases)('%s → %s %s', async (_name, body, status, code) => {
    const r = await route(body);
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    expect(r.body.error.code).toBe(code);
    expect(typeof r.body.error.request_id).toBe('string');
  });
});

describe('profile restrictions on the fixture graph (AC10)', () => {
  it('motorcycle avoids the motorcycle=no motorway that the car uses', async () => {
    const pts = [pt('w', grid(0, 0)), pt('e', grid(8, 0))];
    const car = await route({ profile: 'car', objective: 'time', points: pts });
    const moto = await route({ profile: 'motorcycle', objective: 'time', points: pts });
    expect(car.status).toBe(200);
    expect(moto.status).toBe(200);
    const carOn = onMotorway(car.body.routes[0].geometry.coordinates);
    const motoOn = onMotorway(moto.body.routes[0].geometry.coordinates);
    expect(carOn).toBeGreaterThan(0);
    expect(motoOn).toBe(0);
    expect(moto.body.routes[0].distance_m).toBeGreaterThan(car.body.routes[0].distance_m);
    evidence.motorcycle_no = { car: { distance_m: car.body.routes[0].distance_m, motorway_points: carOn }, motorcycle: { distance_m: moto.body.routes[0].distance_m, motorway_points: motoOn } };
  });

  it('one-way column is asymmetric for car and symmetric for pedestrians', async () => {
    const { from, to } = expectFixture.routing.oneway;
    const n = pt('n', { lon: to[0], lat: to[1] });
    const s = pt('s', { lon: from[0], lat: from[1] });
    const out: Record<string, number> = {};
    for (const profile of ['car', 'pedestrian'] as const) {
      const north = await route({ profile, objective: 'distance', points: [s, n] });
      const south = await route({ profile, objective: 'distance', points: [n, s] });
      expect(north.status).toBe(200);
      expect(south.status).toBe(200);
      out[`${profile}_with_oneway_m`] = north.body.routes[0].distance_m;
      out[`${profile}_against_oneway_m`] = south.body.routes[0].distance_m;
    }
    expect(out.car_against_oneway_m!).toBeGreaterThan(out.car_with_oneway_m! * 1.2);
    expect(Math.abs(out.pedestrian_against_oneway_m! - out.pedestrian_with_oneway_m!)).toBeLessThan(50);
    evidence.oneway = out;
  });

  it('pedestrian uses the footway shortcut that is closed to cars', async () => {
    const { from, to } = expectFixture.routing.footway;
    const pts = [pt('a', { lon: from[0], lat: from[1] }), pt('b', { lon: to[0], lat: to[1] })];
    const foot = await route({ profile: 'pedestrian', objective: 'distance', points: pts });
    const car = await route({ profile: 'car', objective: 'distance', points: pts });
    expect(foot.status).toBe(200);
    expect(car.status).toBe(200);
    expect(foot.body.routes[0].distance_m).toBeLessThan(car.body.routes[0].distance_m * 0.85);
    // The footway's interior vertex (0.025, 0.03) lies on the pedestrian route only.
    const near = (c: [number, number][]) => c.some(([lon, lat]) => Math.abs(lon - 0.025) < 0.0003 && Math.abs(lat - 0.03) < 0.0003);
    expect(near(foot.body.routes[0].geometry.coordinates)).toBe(true);
    expect(near(car.body.routes[0].geometry.coordinates)).toBe(false);
    evidence.footway = { pedestrian_m: foot.body.routes[0].distance_m, car_m: car.body.routes[0].distance_m };
  });

  it('motor_vehicle=no lane is walkable but not drivable', async () => {
    const pts = [pt('a', grid(1, 3)), pt('b', grid(1, 4))];
    const out: Record<string, number> = {};
    for (const profile of PROFILES) {
      const r = await route({ profile, objective: 'distance', points: pts });
      expect(r.status).toBe(200);
      out[profile] = r.body.routes[0].distance_m;
    }
    expect(out.pedestrian!).toBeLessThan(700);
    expect(out.car!).toBeGreaterThan(out.pedestrian! * 1.5);
    expect(out.motorcycle!).toBeGreaterThan(out.pedestrian! * 1.5);
    evidence.motor_vehicle_no = out;
  });

  it('time and distance objectives choose different car routes where they should', async () => {
    const pts = [pt('a', grid(0, 1)), pt('b', grid(8, 1))];
    const t = await route({ profile: 'car', objective: 'time', points: pts });
    const d = await route({ profile: 'car', objective: 'distance', points: pts });
    expect(t.status).toBe(200);
    expect(d.status).toBe(200);
    expect(t.body.routes[0].duration_s).toBeLessThan(d.body.routes[0].duration_s);
    expect(d.body.routes[0].distance_m).toBeLessThan(t.body.routes[0].distance_m);
    evidence.objectives = { time: { distance_m: t.body.routes[0].distance_m, duration_s: t.body.routes[0].duration_s }, distance: { distance_m: d.body.routes[0].distance_m, duration_s: d.body.routes[0].duration_s } };
  });

  it('disconnected island: NO_ROUTE for ordered and optimized requests (no stop dropped)', async () => {
    const island = pt('isl', { lon: expectFixture.routing.island.point[0], lat: expectFixture.routing.island.point[1] });
    const ordered = await route({ profile: 'car', objective: 'time', points: [pt('a', grid(4, 4)), island] });
    expect(ordered.status).toBe(422);
    expect(['NO_ROUTE', 'POINT_NOT_ROUTABLE']).toContain(ordered.body.error.code);
    const opt = await route({ profile: 'car', objective: 'time', order: 'optimized', points: [pt('a', grid(0, 2)), island, pt('m', grid(4, 4)), pt('b', grid(8, 2))] });
    expect(opt.status).toBe(422);
    expect(opt.body.error.code).toBe('NO_ROUTE');
    expect(opt.body.error.details.unreachable_pairs).toBeGreaterThan(0);
    evidence.island = { ordered: ordered.body.error.code, optimized: opt.body.error };
  });
});

// ---------------------------------------------------------------------------------------------
// AC12: Held–Karp vs brute force over the same directed pair costs
// ---------------------------------------------------------------------------------------------

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}
const lexLess = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

describe('optimized order vs independent brute force (AC12)', () => {
  // Start/end fixed; stops include one-way column points (directed costs) and a duplicated
  // coordinate (two ids at one position, zero cost between them → a genuine tie).
  const points: Pt[] = [
    pt('start', grid(0, 2)),
    pt('ow-low', grid(4, 3)),
    pt('ow-high', grid(4, 5)),
    pt('west', grid(2, 6)),
    pt('dup-1', grid(6, 4)),
    pt('dup-2', grid(6, 4)),
    pt('east', grid(8, 6)),
    pt('end', grid(8, 2)),
  ];
  const n = points.length;
  const records: unknown[] = [];

  for (const profile of PROFILES) {
    for (const objective of OBJECTIVES) {
      it(`${profile} / ${objective}: Held–Karp order and cost equal the brute-force optimum`, async () => {
        const cost = new Map<string, number>();
        const same = (a: Pt, b: Pt) => a.lon === b.lon && a.lat === b.lat;
        const pairs: [number, number][] = [];
        for (let k = 1; k < n - 1; k++) pairs.push([0, k], [k, n - 1]);
        for (let j = 1; j < n - 1; j++) for (let k = 1; k < n - 1; k++) if (j !== k) pairs.push([j, k]);
        for (const [i, j] of pairs) {
          if (same(points[i]!, points[j]!)) {
            cost.set(`${i}:${j}`, 0);
            continue;
          }
          const r = await route({ profile, objective, points: [points[i], points[j]] });
          if (r.status === 422 && r.body.error.code === 'NO_ROUTE') {
            cost.set(`${i}:${j}`, Infinity);
            continue;
          }
          expect(r.status, JSON.stringify(r.body)).toBe(200);
          const leg = r.body.routes[0];
          cost.set(`${i}:${j}`, objective === 'time' ? Math.round(leg.duration_s * 1000) : Math.round(leg.distance_m));
        }
        let best = Infinity;
        let bestOrder: number[] | null = null;
        let ties = 0;
        for (const perm of permutations(Array.from({ length: n - 2 }, (_, i) => i + 1))) {
          const order = [0, ...perm, n - 1];
          let c = 0;
          for (let s = 0; s < order.length - 1; s++) c += cost.get(`${order[s]}:${order[s + 1]}`)!;
          if (c < best) {
            best = c;
            bestOrder = order;
            ties = 1;
          } else if (c === best) {
            ties++;
            if (bestOrder && lexLess(order, bestOrder)) bestOrder = order;
          }
        }
        const r = await route({ profile, objective, order: 'optimized', points });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const got = r.body.visit_order.map((v: { input_index: number }) => v.input_index);
        const modeledUnits = objective === 'time' ? Math.round(r.body.optimization.modeled_cost * 1000) : r.body.optimization.modeled_cost;
        expect(modeledUnits).toBe(best);
        expect(got).toEqual(bestOrder);
        // Duplicate coordinates are visited consecutively (zero-cost tie) in input-index order.
        const d1 = got.indexOf(4);
        expect(got[d1 + 1]).toBe(5);
        expect(r.body.visit_order.map((v: { id: string }) => v.id)).toEqual(got.map((i: number) => points[i]!.id));
        records.push({ profile, objective, pair_routes: pairs.length, brute_force_optimum: best, optimal_orders: ties, held_karp_order: got, modeled_cost: r.body.optimization.modeled_cost, final_route_cost: r.body.optimization.final_route_cost, unit: r.body.optimization.modeled_cost_unit });
      }, 300_000);
    }
  }

  it('writes routing evidence', () => {
    evidence.held_karp_vs_brute_force = records;
    writeEvidence('routing', { dataset_id: ds, ...evidence });
    expect(records.length).toBe(PROFILES.length * OBJECTIVES.length);
  });
});
