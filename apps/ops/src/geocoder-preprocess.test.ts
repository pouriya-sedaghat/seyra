import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { normalizeForSearch } from '@seyra/contracts';
import { addNameVariants, preprocessDump, tokens } from './geocoder-preprocess.js';

const dir = mkdtempSync(join(tmpdir(), 'seyra-pre-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('geocoder dump preprocessing', () => {
  it('adds normalized name variants without touching display names', () => {
    const c = { name: { name: 'خيابان اصلي آزمايشي', 'name:en': 'Synthetic Main Street' } };
    const r = addNameVariants(c);
    expect(r.added).toBe(1);
    expect(c.name.name).toBe('خيابان اصلي آزمايشي');
    expect(Object.values(c.name)).toContain(normalizeForSearch('خیابان اصلی آزمایشی'));
  });

  it('tokenizes for single-word synonyms', () => {
    expect(tokens('خیابان‌ شمالی, No.12-B')).toEqual(['خیابان', 'شمالی', 'No', '12', 'B']);
  });

  it('streams the dump, records originals, builds synonyms and appends the release marker', async () => {
    const input = join(dir, 'in.jsonl');
    writeFileSync(
      input,
      [
        JSON.stringify({ type: 'NominatimDumpFile', content: { version: '0.1.0', data_timestamp: '2026-10-01T00:00:00Z' } }),
        JSON.stringify({
          type: 'Place',
          content: [{ place_id: '1', object_type: 'N', object_id: 7, name: { name: 'داروخانه كوثر', 'name:en': 'Kowsar' }, address: { street: 'خيابان اصلي' }, housenumber: '۱۲', extra: { 'seyra:fixture': 'synthetic' }, centroid: [0, 0] }],
        }),
      ].join('\n'),
    );
    const out = join(dir, 'out.jsonl');
    const syn = join(dir, 'syn.json');
    const stats = await preprocessDump(input, out, syn, 'seyra-release-ds-x');
    const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    const place = lines[1].content[0];
    expect(place.extra).toEqual({ seyra_name: 'داروخانه كوثر', seyra_name_en: 'Kowsar', seyra_housenumber: '۱۲' });
    expect(place.housenumber).toBe('12');
    expect(place.name.name).toBe('داروخانه كوثر');
    expect(lines[2].content[0].categories).toEqual(['seyra.release_marker']);
    expect(lines[2].content[0].name.name).toBe('seyra-release-ds-x');
    const synonyms = JSON.parse(readFileSync(syn, 'utf8')).search_synonyms as string[];
    expect(synonyms).toContain('کوثر,كوثر');
    expect(synonyms).toContain('اصلی,اصلي');
    expect(synonyms).toContain('12,۱۲');
    expect(stats.places).toBe(1);
  });
});
