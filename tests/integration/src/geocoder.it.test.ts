// AC14: real Photon (built through Nominatim → export → Seyra preprocessing → Photon import).
// Forward search, autocomplete and reverse for fa/en fixtures. Quality is MEASURED and recorded
// (hit@1 / hit@5 per case); the assertion floor is "expected object within the top 5", which is
// what the fixture was designed for. The original display text must survive normalization.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { activeDataset, expectFixture, get, qs, repoRoot, writeEvidence } from './harness.js';

let ds = '';
const nodes = new Map<number, { lon: number; lat: number; name?: string }>();
const quality: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  ds = await activeDataset();
  const osm = readFileSync(join(repoRoot, 'fixtures', 'osm', 'synthetic-v1.osm'), 'utf8');
  for (const m of osm.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"(\/?)>([\s\S]*?)(?:<\/node>|(?=<node|<way))/g)) {
    const name = /<tag k="name" v="([^"]*)"/.exec(m[5] ?? '')?.[1];
    nodes.set(Number(m[1]), { lat: Number(m[2]), lon: Number(m[3]), ...(name ? { name } : {}) });
  }
});

const osmId = (e: string) => `osm:${e[0]!.toLowerCase()}${e.slice(1)}`;
const rankOf = (results: Array<{ id: string }>, id: string) => results.findIndex((r) => r.id === id) + 1;

describe('forward search (fa/en fixtures)', () => {
  it.each(expectFixture.search.map((s) => [s.query, s]))('%s', async (_q, s) => {
    const r = await get(`/search?${qs({ q: s.query, lang: s.lang, limit: 5, dataset_id: ds })}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ dataset_id: ds, provider: 'photon', operation: 'search', language: s.lang });
    const rank = rankOf(r.body.results, osmId(s.expect_osm));
    quality.push({ op: 'search', query: s.query, lang: s.lang, expect: s.expect_osm, note: s.note ?? null, rank: rank || null, top: r.body.results.slice(0, 3).map((x: any) => `${x.id} ${x.name}`), normalized_query: r.body.normalized_query });
    expect(rank, `rank of ${s.expect_osm}`).toBeGreaterThan(0);
    // No result may be the internal release marker.
    for (const res of r.body.results) expect(res.category.key).not.toBe('seyra');
  });
});

describe('autocomplete (prefixes)', () => {
  // Typing in progress: every word but the last is complete, the last word is ~60% typed.
  // Cases whose last word is too short to cut (e.g. a 2-digit house number) are skipped, since
  // the cut would remove the only distinguishing token.
  const cases = expectFixture.search
    .map((s) => {
      const words = s.query.split(' ');
      const last = [...words.at(-1)!];
      if (last.length < 3) return null;
      const typed = last.slice(0, Math.max(2, Math.ceil(last.length * 0.6))).join('');
      return { ...s, prefix: [...words.slice(0, -1), typed].join(' ') };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  it.each(cases.map((c) => [c.prefix, c]))('%s', async (_p, c) => {
    const r = await get(`/autocomplete?${qs({ q: c.prefix, lang: c.lang, limit: 5 })}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.operation).toBe('autocomplete');
    const rank = rankOf(r.body.results, osmId(c.expect_osm));
    quality.push({ op: 'autocomplete', query: c.prefix, lang: c.lang, expect: c.expect_osm, rank: rank || null, top: r.body.results.slice(0, 3).map((x: any) => `${x.id} ${x.name}`) });
  });
});

describe('display text is the original OSM text', () => {
  it('returns the Arabic-letter original for a Persian-letter query (normalization is index/query-side only)', async () => {
    const r = await get(`/search?${qs({ q: 'خیابان اصلی آزمایشی', lang: 'fa', limit: 5 })}`);
    const hit = r.body.results.find((x: any) => x.id === 'osm:w5004');
    expect(hit).toBeTruthy();
    // U+064A ARABIC LETTER YEH as stored in the fixture; the query used U+06CC FARSI YEH.
    expect(hit.name).toContain('ي');
    expect(hit.name).not.toContain('ی');
  });

  it('returns the stored house number text (Persian digits), not the normalized index form', async () => {
    const r = await get(`/search?${qs({ q: 'خیابان اصلی آزمایشی 12', lang: 'fa', limit: 5 })}`);
    const hit = r.body.results.find((x: any) => x.id === 'osm:w5030');
    expect(hit).toBeTruthy();
    expect(hit.address.housenumber).toBe('۱۲');
  });

  it('applies language fallback for display names', async () => {
    const en = await get(`/search?${qs({ q: 'Synthetic Main Street', lang: 'en', limit: 3 })}`);
    expect(en.body.results.find((x: any) => x.id === 'osm:w5004')?.name).toBe('Synthetic Main Street');
    const fa = await get(`/search?${qs({ q: 'Synthetic Main Street', lang: 'fa', limit: 3 })}`);
    expect(fa.body.results.find((x: any) => x.id === 'osm:w5004')?.name).toContain('آزمايشي');
  });
});

describe('reverse geocoding', () => {
  const targets = [
    { id: 1110, label: 'pharmacy (Arabic Kaf name)' },
    { id: 1122, label: 'restaurant (lam-alef)' },
    { id: 1140, label: 'city place' },
  ];
  it.each(targets.map((t) => [t.label, t]))('%s', async (_l, t) => {
    const n = nodes.get(t.id)!;
    expect(n).toBeTruthy();
    const r = await get(`/reverse?${qs({ lon: n.lon, lat: n.lat, lang: 'fa', limit: 5, radius_m: 200 })}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.operation).toBe('reverse');
    const rank = rankOf(r.body.results, `osm:n${t.id}`);
    quality.push({ op: 'reverse', query: `${n.lon},${n.lat}`, expect: `N${t.id}`, rank: rank || null, top: r.body.results.slice(0, 3).map((x: any) => `${x.id} ${x.name}`) });
    expect(rank).toBeGreaterThan(0);
  });

  it('reverse far from any data returns no_results, not an error', async () => {
    const r = await get(`/reverse?${qs({ lon: 10.5, lat: 10.5, radius_m: 100 })}`);
    expect(r.status).toBe(200);
    expect(r.body.result_status).toBe('no_results');
    expect(r.body.results).toEqual([]);
  });
});

describe('input limits (AC15 side)', () => {
  it('rejects a query above 256 code points with QUERY_TOO_LONG', async () => {
    const r = await get(`/search?${qs({ q: 'آ'.repeat(257) })}`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUERY_TOO_LONG');
  });
  it.each([
    ['empty query', { q: '' }],
    ['limit 21', { q: 'Synthetic', limit: 21 }],
    ['unknown language', { q: 'Synthetic', lang: 'de' }],
    ['unknown parameter', { q: 'Synthetic', url: 'http://example.invalid' }],
  ])('%s → 400', async (_n, params) => {
    const r = await get(`/search?${qs(params as Record<string, string | number>)}`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_REQUEST');
  });
  it('never exposes the release marker even when asked for it by name', async () => {
    const r = await get(`/search?${qs({ q: `seyra-release-${ds}`, limit: 20 })}`);
    expect(r.status).toBe(200);
    expect(r.body.results.some((x: any) => String(x.name).startsWith('seyra-release-'))).toBe(false);
  });
});

describe('quality summary', () => {
  it('records hit@1 / hit@5 by operation and language', () => {
    const summary: Record<string, { cases: number; hit_at_1: number; hit_at_5: number }> = {};
    for (const q of quality) {
      const key = `${q.op}${q.lang ? `:${q.lang}` : ''}`;
      const s = (summary[key] ??= { cases: 0, hit_at_1: 0, hit_at_5: 0 });
      s.cases++;
      if (q.rank === 1) s.hit_at_1++;
      if (typeof q.rank === 'number' && q.rank <= 5) s.hit_at_5++;
    }
    writeEvidence('geocoder-quality', { dataset_id: ds, note: 'Synthetic fixture only; not a measure of real Iranian address search quality.', summary, cases: quality });
    expect(Object.keys(summary).length).toBeGreaterThan(0);
  });
});
