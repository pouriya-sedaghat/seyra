// Offline tests for the search seed runner's evaluation (no network, no live queries).
//   node tests/validation/test-search-seeds.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { evaluateCase, checkBinding } = await import(pathToFileURL(join(here, 'search-seeds.mjs')));
const seeds = JSON.parse(readFileSync(join(here, 'search-seeds.json'), 'utf8'));
const D = seeds.defaults;
const byId = Object.fromEntries(seeds.cases.map((c) => [c.id, c]));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const r = (id, lon, lat, name = 'x', cat = ['place', 'city']) => ({ id, name, category: { key: cat[0], value: cat[1] }, coordinate: { lon, lat } });

// ---- seeds file structure (brief v0.3 §7.1) ------------------------------------------------------
check('every case id is unique', new Set(seeds.cases.map((c) => c.id)).size === seeds.cases.length);
check('every variant names an existing base case', seeds.cases.filter((c) => c.kind === 'variant').every((c) => byId[c.variant_of]?.kind === 'base'));
const changes = (c) => c.change ?? null;
check('yeh and diacritic variants are independent (one change each)', changes(byId.abyaneh_arabic_yeh) === 'arabic_yeh' && byId.abyaneh_arabic_yeh.query === 'ابيانه' && changes(byId.abyaneh_diacritic) === 'diacritic_kasra' && byId.abyaneh_diacritic.query === 'ابیانِه');
check('isolated kaf coverage exists on observed data (Iran location reference, fixture identity)', byId.karaj_arabic_kaf.query === 'كرج' && byId.karaj_arabic_kaf.reference.measurement === 'location_only' && byId.fixture_arabic_kaf.query === 'داروخانه كوثر');
check('isolated ZWNJ coverage exists (fixture measured; Iran pending, never PASS without a reference)', byId.fixture_zwnj_name_space_query.reference.measurement === 'identity' && byId.khorramabad_zwnj.query.includes('‌') && byId.khorramabad_zwnj.reference.measurement === 'pending');
check('Persian Shiraz is not marked validated by identity', byId.shiraz_city_fa.reference.measurement !== 'identity');
check('no operational binding is committed in the seeds file', !/ds-20\d{6}-[0-9a-f]{12}|[0-9a-f]{64}/.test(readFileSync(join(here, 'search-seeds.json'), 'utf8')));

// ---- evaluation ------------------------------------------------------------------------------------
const az = byId.tehran_azadi;
check('identity in the top 5 within tolerance: PASS (rank 3 is fine; rank 1 is not forced)', evaluateCase(az, [r('osm:n1', 50, 30), r('osm:n2', 50, 30), r('osm:r7814369', 51.33806, 35.69974)], D).status === 'PASS');
const six = [1, 2, 3, 4, 5].map((i) => r(`osm:n${i}`, 50, 30)).concat([r('osm:r7814369', 51.33806, 35.69974)]);
check('identity only at rank 6: FAIL', evaluateCase(az, six, D).status === 'FAIL');
const moved = evaluateCase(az, [r('osm:r9999999', 51.3381, 35.6998)], D);
check('a different id at the reference position: FAIL with a reviewable identity-change note, no rewrite', moved.status === 'FAIL' && /possible identity change/.test(moved.reason) && az.expected.feature_id === 'osm:r7814369');
const far = evaluateCase(az, [r('osm:r7814369', 45.9, 37.4)], D);
check('the right id far from the reference: FAIL', far.status === 'FAIL' && /m from the reference/.test(far.reason));
const province = evaluateCase(byId.shiraz_city_fa, [{ ...r('osm:n5', 45.909407, 37.4352186, 'شیراز', ['place', 'village']), address: { state: 'استان فارس' } }], D);
check('province or name text alone never passes (same-named village elsewhere)', province.status === 'FAIL');
const karaj = evaluateCase(byId.karaj_arabic_kaf, [r('osm:r111', 50.9904681, 35.8224892, 'کرج', ['place', 'county'])], D);
check('location-only reference: LOCATION_MATCH with a proposed id for review, never PASS', karaj.status === 'LOCATION_MATCH' && karaj.proposed_feature_id === 'osm:r111');
check('no reviewed reference: NOT_EVALUATED, candidates recorded', evaluateCase(byId.khorramabad_zwnj, [r('osm:r5', 48.35, 33.48)], D).status === 'NOT_EVALUATED');
check('fixture identity-only case: PASS by id without a position', evaluateCase(byId.fixture_zwnj_name_space_query, [r('osm:w5010', 0, 0), r('osm:w5011', 0, 0), r('osm:w5012', 0, 0)], D).status === 'PASS');

// ---- snapshot binding ------------------------------------------------------------------------------
check('unbound run is not attributable', checkBinding(null, { dataset_id: 'ds-x' }).status === 'UNBOUND');
check('a different active dataset is SNAPSHOT_CHANGED', checkBinding({ dataset_id: 'ds-a' }, { dataset_id: 'ds-b' }).status === 'SNAPSHOT_CHANGED');
check('the bound dataset is accepted', checkBinding({ dataset_id: 'ds-a' }, { dataset_id: 'ds-a' }).ok === true);

for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.name}${x.ok ? '' : ` -- ${x.detail}`}`);
const failed = results.filter((x) => !x.ok).length;
console.log(`# checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
