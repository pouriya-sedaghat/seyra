// AC08 / AC04 / AC09 (data side): decode real Tegola MVT through the ingress with an independent
// decoder (@mapbox/vector-tile), compare each catalog family against the fixture expectation
// manifest by stable OSM identity (deduplicated across tiles), and validate the four generated
// styles with MapLibre's own style-spec validator.
import { VectorTile } from '@mapbox/vector-tile';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { PbfReader } from 'pbf';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASE, activeDataset, expectFixture, http, lonLatToTile, writeEvidence } from './harness.js';

const GEOM = { 1: 'Point', 2: 'LineString', 3: 'Polygon' } as const;
const EXPECTED_GEOMETRY: Record<string, string> = {
  water: 'Polygon',
  landcover: 'Polygon',
  buildings: 'Polygon',
  waterways: 'LineString',
  boundaries: 'LineString',
  transport: 'LineString',
  places: 'Point',
  pois: 'Point',
};
// Families whose expectation list is exhaustive for the fixture (transport lists notable ways only).
const EXHAUSTIVE = ['water', 'waterways', 'landcover', 'pois', 'buildings', 'places', 'boundaries'];

interface Feat {
  key: string;
  props: Record<string, unknown>;
  geom: string;
}

let ds = '';
const byLayer = new Map<string, Map<string, Feat>>();
const tileLog: Array<{ z: number; x: number; y: number; status: number; bytes: number; layers: string[] }> = [];

function identity(p: Record<string, unknown>): string {
  return `${String(p.osm_type).toLowerCase()}${p.osm_id}`;
}

async function fetchTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  const r = await http<Buffer>(`${BASE}/maps/${ds}/tiles/${z}/${x}/${y}.pbf`);
  if (r.status === 204 || r.raw.length === 0) {
    tileLog.push({ z, x, y, status: r.status, bytes: 0, layers: [] });
    return null;
  }
  expect(r.status).toBe(200);
  expect(r.headers.get('x-seyra-dataset')).toBe(ds);
  const vt = new VectorTile(new PbfReader(r.raw));
  tileLog.push({ z, x, y, status: r.status, bytes: r.raw.length, layers: Object.keys(vt.layers).sort() });
  return vt;
}

/** Decode every tile over the fixture extent (~0..0.095°) at zoom z, deduplicated by OSM identity. */
async function collect(z: number): Promise<Map<string, Map<string, Feat>>> {
  const out = new Map<string, Map<string, Feat>>();
  const [x0, y1] = lonLatToTile(-0.001, -0.001, z);
  const [x1, y0] = lonLatToTile(0.096, 0.096, z);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const vt = await fetchTile(z, x, y);
      if (!vt) continue;
      for (const [name, layer] of Object.entries(vt.layers)) {
        const m = out.get(name) ?? new Map<string, Feat>();
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const key = identity(f.properties);
          // Features crossing tile edges appear in several tiles: deduplicate, never sum.
          if (!m.has(key)) m.set(key, { key, props: f.properties, geom: GEOM[f.type as 1 | 2 | 3] ?? 'Unknown' });
        }
        out.set(name, m);
      }
    }
  }
  return out;
}

let z14 = new Map<string, Map<string, Feat>>();

beforeAll(async () => {
  ds = await activeDataset();
  // z16 is the dataset max zoom: every catalogued object is present there (minor POIs start at 16).
  for (const [k, v] of await collect(16)) byLayer.set(k, v);
  z14 = await collect(14);
}, 240_000);

describe('vector tiles (real Tegola via ingress)', () => {
  it('serves every catalog family with the documented geometry type', () => {
    const summary: Record<string, unknown> = {};
    for (const [layer, geom] of Object.entries(EXPECTED_GEOMETRY)) {
      const feats = [...(byLayer.get(layer)?.values() ?? [])];
      summary[layer] = { distinct_features: feats.length, geometry_types: [...new Set(feats.map((f) => f.geom))] };
      expect(feats.length, `layer ${layer} decoded`).toBeGreaterThan(0);
      for (const f of feats) expect(f.geom, `${layer} ${f.key}`).toBe(geom);
    }
    writeEvidence('tiles-catalog', { dataset_id: ds, zoom: 16, tiles_fetched: tileLog.length, empty_tiles: tileLog.filter((t) => t.bytes === 0).length, layers: summary, z14_layers: Object.fromEntries([...z14].map(([k, v]) => [k, v.size])) });
  });

  it('matches the fixture expectation manifest by stable OSM identity', () => {
    const mismatches: string[] = [];
    for (const [layer, expected] of Object.entries(expectFixture.layers)) {
      const got = byLayer.get(layer) ?? new Map();
      for (const e of expected) {
        const key = `${String(e.type)}${e.id}`;
        const f = got.get(key);
        if (!f) {
          mismatches.push(`${layer}: missing ${key}`);
          continue;
        }
        // Tag mappings: every non-identity expectation field must equal the tile attribute.
        for (const [k, v] of Object.entries(e)) {
          if (k === 'type' || k === 'id' || k === 'multipolygon') continue;
          const attr = k === 'highway' || k === 'railway' ? f.props.type : f.props[k];
          if (String(attr) !== String(v)) mismatches.push(`${layer} ${key}: ${k}=${String(attr)} expected ${String(v)}`);
        }
      }
      if (EXHAUSTIVE.includes(layer)) {
        const extra = [...got.keys()].filter((k) => !expected.some((e) => `${String(e.type)}${e.id}` === k));
        if (extra.length) mismatches.push(`${layer}: unexpected ${extra.join(',')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('keeps documented exclusions out of every layer and keeps unlisted POI values for the generic icon', () => {
    for (const u of expectFixture.uncatalogued) {
      for (const [layer, feats] of byLayer) expect(feats.has(`${u.type}${u.id}`), `${u.key} ${u.id} in ${layer}`).toBe(false);
    }
    const g = expectFixture.generic_icon_poi;
    const poi = byLayer.get('pois')?.get(`${g.type}${g.id}`);
    expect(poi?.props.value).toBe(g.value);
  });

  it('carries original names for label fallback (English-only POI, Persian-only place)', () => {
    const enOnly = byLayer.get('pois')?.get(`n${expectFixture.label_fallback.en_only}`);
    expect(enOnly?.props.name_en).toBeTruthy();
    expect(enOnly?.props.name_fa ?? null).toBeNull();
    const faOnly = byLayer.get('places')?.get(`n${expectFixture.label_fallback.fa_only_place}`);
    expect(faOnly?.props.name).toBeTruthy();
    expect(faOnly?.props.name_en ?? null).toBeNull();
  });

  it('applies POI zoom rules: z14 carries only major POIs, minor ones appear from z16', () => {
    const at14 = [...(z14.get('pois')?.values() ?? [])];
    expect(at14.length).toBeGreaterThan(0);
    for (const f of at14) expect(f.props.major, `${f.key} at z14`).toBe(true);
    expect(byLayer.get('pois')!.size).toBeGreaterThan(at14.length);
  });

  it('applies zoom rules: no buildings below z14, places present at low zoom', async () => {
    const [x, y] = lonLatToTile(0.03, 0.03, 10);
    const vt = await fetchTile(10, x, y);
    expect(vt).not.toBeNull();
    expect(Object.keys(vt!.layers)).not.toContain('buildings');
    expect(Object.keys(vt!.layers)).toContain('places');
  });

  it('rejects tiles for a dataset that is not active and zooms outside the served range', async () => {
    const wrong = await http(`${BASE}/maps/ds-19990101-000000000000/tiles/14/8192/8191.pbf`);
    expect(wrong.status).toBe(404);
    expect(JSON.stringify(wrong.body)).toContain('DATASET_MISMATCH');
    const tooDeep = await http(`${BASE}/maps/${ds}/tiles/17/0/0.pbf`);
    expect(tooDeep.status).toBe(404);
  });
});

describe('styles, glyphs and sprites (local assets only)', () => {
  const variants = ['light-fa', 'light-en', 'dark-fa', 'dark-en'];

  it.each(variants)('style %s is valid MapLibre style JSON that references only the ingress origin', async (v) => {
    const r = await http<Record<string, any>>(`${BASE}/maps/${ds}/styles/${v}.json`);
    expect(r.status).toBe(200);
    const text = r.raw.toString('utf8');
    expect(text).not.toContain('__SEYRA_BASE__');
    const errors = validateStyleMin(r.body as never);
    expect(errors.map((e: { message: string }) => e.message)).toEqual([]);
    const urls = [...text.matchAll(/"(https?:\/\/[^"]+)"/g)].map((m) => m[1]!);
    const foreign = urls.filter((u) => !u.startsWith(`${BASE}/`) && !u.startsWith('https://www.openstreetmap.org/copyright'));
    expect(foreign).toEqual([]);
  });

  it('serves Arabic-script glyph ranges and the woff2 font faces locally', async () => {
    for (const stack of ['Vazirmatn Regular', 'Vazirmatn Bold']) {
      const g = await http(`${BASE}/maps/${ds}/fonts/${encodeURIComponent(stack)}/1536-1791.pbf`);
      expect(g.status).toBe(200);
      expect(g.raw.length).toBeGreaterThan(10_000);
    }
    const w = await http(`${BASE}/maps/${ds}/fonts/files/Vazirmatn-Regular.woff2`);
    expect(w.status).toBe(200);
    expect(w.raw.subarray(0, 4).toString('latin1')).toBe('wOF2');
  });

  it('serves sprites for both themes at 1x and 2x', async () => {
    for (const theme of ['light', 'dark']) {
      for (const suffix of ['', '@2x']) {
        const j = await http<Record<string, unknown>>(`${BASE}/maps/${ds}/sprites/${theme}${suffix}.json`);
        expect(j.status).toBe(200);
        expect(Object.keys(j.body)).toContain('poi-generic');
        const p = await http(`${BASE}/maps/${ds}/sprites/${theme}${suffix}.png`);
        expect(p.status).toBe(200);
        expect(p.raw.subarray(1, 4).toString('latin1')).toBe('PNG');
      }
    }
  });
});
