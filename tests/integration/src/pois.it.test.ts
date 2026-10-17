// AC15: bounded Overpass POI presets on the real Overpass base built from the fixture.
// Only catalog presets/allowlisted key=value pairs; raw QL, regex, URLs, oversized bbox/results
// and injection-shaped values are rejected; truncation is explicit; the gateway's bounded queue
// rejects excess concurrent work with a typed OVERLOADED instead of queueing without limit.
import { beforeAll, describe, expect, it } from 'vitest';
import { API, activeDataset, get, http, qs, writeEvidence } from './harness.js';

let ds = '';
const evidence: Record<string, unknown> = {};
const BBOX = '0,0,0.095,0.095'; // fixture extent, ~111 km² → just above the 100 km² cap
const SMALL = '0.005,0.005,0.06,0.06'; // ~37 km²

beforeAll(async () => {
  ds = await activeDataset();
});

const pois = (params: Record<string, string | number | undefined>) => get(`/pois?${qs(params)}`);

describe('catalog presets and allowlisted key/value', () => {
  const cases: Array<[string, Record<string, string>, string[]]> = [
    ['hospitals', { preset: 'hospitals' }, ['osm:n1109']],
    ['pharmacies', { preset: 'pharmacies' }, ['osm:n1110']],
    ['police', { preset: 'police' }, ['osm:n1111']],
    ['fire_stations', { preset: 'fire_stations' }, ['osm:n1112']],
    ['fuel', { preset: 'fuel' }, ['osm:n1113']],
    ['parking (way, centre point)', { preset: 'parking' }, ['osm:w5034']],
    ['schools (way, centre point)', { preset: 'schools' }, ['osm:w5035']],
    ['food (several filters)', { preset: 'food' }, ['osm:n1122', 'osm:n1123', 'osm:n1124']],
    ['key/value tourism=museum', { key: 'tourism', value: 'museum' }, ['osm:n1128']],
  ];
  it.each(cases)('%s', async (_n, sel, ids) => {
    const r = await pois({ bbox: SMALL, ...sel, lang: 'fa', dataset_id: ds });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ dataset_id: ds, provider: 'overpass', truncated: false });
    expect(r.body.bbox_area_km2).toBeLessThan(100);
    const got = r.body.features.map((f: { id: string }) => f.id).sort();
    expect(got).toEqual([...ids].sort());
    for (const f of r.body.features) {
      expect(Number.isFinite(f.coordinate.lon) && Number.isFinite(f.coordinate.lat)).toBe(true);
      expect(typeof f.key).toBe('string');
    }
  });

  it('reports truncation explicitly when more objects match than the limit', async () => {
    const r = await pois({ bbox: SMALL, preset: 'food', limit: 2 });
    expect(r.status).toBe(200);
    expect(r.body.truncated).toBe(true);
    expect(r.body.features.length).toBe(2);
    expect(r.body.limit).toBe(2);
    evidence.truncation = { limit: 2, returned: r.body.features.length, truncated: r.body.truncated };
  });
});

describe('rejections (no raw QL, regex, URLs or unbounded areas)', () => {
  const cases: Array<[string, Record<string, string | number>, number, string]> = [
    ['bbox above 100 km²', { bbox: BBOX, preset: 'hospitals' }, 400, 'BBOX_TOO_LARGE'],
    ['country-sized bbox', { bbox: '44,25,63,40', preset: 'hospitals' }, 400, 'BBOX_TOO_LARGE'],
    ['inverted bbox', { bbox: '0.06,0.06,0.005,0.005', preset: 'hospitals' }, 400, 'INVALID_REQUEST'],
    ['malformed bbox', { bbox: '0,0,0.1', preset: 'hospitals' }, 400, 'INVALID_REQUEST'],
    ['limit above 200', { bbox: SMALL, preset: 'hospitals', limit: 201 }, 400, 'INVALID_REQUEST'],
    ['unknown preset', { bbox: SMALL, preset: 'everything' }, 400, 'INVALID_REQUEST'],
    ['preset and key together', { bbox: SMALL, preset: 'hospitals', key: 'amenity', value: 'pharmacy' }, 400, 'INVALID_REQUEST'],
    ['key without value', { bbox: SMALL, key: 'amenity' }, 400, 'INVALID_REQUEST'],
    ['key outside catalog', { bbox: SMALL, key: 'power', value: 'tower' }, 400, 'INVALID_REQUEST'],
    ['value outside allowlist', { bbox: SMALL, key: 'amenity', value: 'bench_secret' }, 400, 'UNKNOWN_PRESET'],
    ['QL injection in value', { bbox: SMALL, key: 'amenity', value: 'hospital"];node(1);out;//' }, 400, 'INVALID_REQUEST'],
    ['regex in value', { bbox: SMALL, key: 'amenity', value: '^hosp.*' }, 400, 'INVALID_REQUEST'],
    ['raw QL parameter', { bbox: SMALL, data: '[out:json];node;out;' }, 400, 'INVALID_REQUEST'],
    ['provider URL parameter', { bbox: SMALL, preset: 'hospitals', url: 'http://overpass:8080/api/interpreter' }, 400, 'INVALID_REQUEST'],
  ];
  it.each(cases)('%s → %s %s', async (_n, params, status, code) => {
    const r = await pois(params);
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    expect(r.body.error.code).toBe(code);
  });
});

describe('bounded concurrency', () => {
  it('excess simultaneous POI requests get typed OVERLOADED, never an unbounded queue or a crash', async () => {
    const n = 120;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        http<any>(`${API}/pois?${qs({ bbox: `0.005,0.005,${(0.06 + i * 1e-6).toFixed(6)},0.06`, preset: 'food' })}`, {}, 120_000).then((r) => ({ status: r.status, code: r.body?.error?.code ?? null })),
      ),
    );
    const tally: Record<string, number> = {};
    for (const r of results) tally[`${r.status}${r.code ? ` ${r.code}` : ''}`] = (tally[`${r.status}${r.code ? ` ${r.code}` : ''}`] ?? 0) + 1;
    evidence.concurrency = { requests: n, tally };
    for (const r of results) expect([200, 503]).toContain(r.status);
    for (const r of results.filter((x) => x.status === 503)) expect(r.code).toBe('OVERLOADED');
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
    // The stack stays healthy afterwards.
    const after = await pois({ bbox: SMALL, preset: 'hospitals' });
    expect(after.status).toBe(200);
  });

  it('writes POI evidence', () => {
    writeEvidence('pois', { dataset_id: ds, ...evidence });
  });
});
