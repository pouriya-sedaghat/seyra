// Record real request/response pairs from a running stack into docs/mobile-fixtures/ for mobile
// contract tests (AC20). Uses the active synthetic fixture release; responses are stored as
// returned except `request_id`, which is replaced by a placeholder so files are stable.
//
//   NODE_EXTRA_CA_CERTS=$SEYRA_HOME/secrets/tls/ca.crt node tests/integration/capture-mobile-fixtures.mjs [base]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'mobile-fixtures');
mkdirSync(out, { recursive: true });
const g = (i, j) => ({ lon: Number((0.01 + i * 0.005).toFixed(6)), lat: Number((0.01 + j * 0.005).toFixed(6)) });

const cases = [
  ['capabilities', 'GET', '/api/v1/map/capabilities'],
  ['health', 'GET', '/api/v1/map/health'],
  ['search-fa', 'GET', `/api/v1/map/search?q=${encodeURIComponent('داروخانه کوثر')}&lang=fa&limit=3`],
  ['search-en', 'GET', '/api/v1/map/search?q=Synthetic%20Main%20Street&lang=en&limit=3'],
  ['autocomplete-fa', 'GET', `/api/v1/map/autocomplete?q=${encodeURIComponent('رستوران لال')}&lang=fa&limit=3`],
  ['reverse-fa', 'GET', '/api/v1/map/reverse?lon=0.0325&lat=0.0275&lang=fa&limit=2&radius_m=200'],
  ['route-ordered-alternatives', 'POST', '/api/v1/map/route', { profile: 'car', objective: 'time', points: [{ id: 'a', ...g(0, 2) }, { id: 'b', ...g(8, 4) }], alternatives: 2, language: 'fa' }],
  ['route-optimized', 'POST', '/api/v1/map/route', { profile: 'pedestrian', objective: 'distance', order: 'optimized', points: [{ id: 'start', ...g(0, 2) }, { id: 'x', ...g(6, 5) }, { id: 'y', ...g(2, 5) }, { id: 'end', ...g(8, 2) }] }],
  ['proximity-road', 'POST', '/api/v1/map/proximity', { metric: 'road_distance', direction: 'origin_to_candidate', profile: 'car', origin: g(4, 6), candidates: [{ id: 'south', ...g(4, 2) }, { id: 'side', ...g(2, 2) }] }],
  ['pois-preset', 'GET', '/api/v1/map/pois?bbox=0.005,0.005,0.06,0.06&preset=food&lang=fa&limit=2'],
  ['error-unsupported-combination', 'POST', '/api/v1/map/route', { profile: 'car', objective: 'time', points: [{ id: 'a', ...g(0, 2) }, { id: 'm', ...g(4, 3) }, { id: 'b', ...g(8, 4) }], alternatives: 1 }],
  ['error-no-route', 'POST', '/api/v1/map/route', { profile: 'car', objective: 'time', order: 'optimized', points: [{ id: 'a', ...g(0, 2) }, { id: 'island', lon: 0.085, lat: 0.08 }, { id: 'b', ...g(8, 2) }] }],
  ['error-bbox-too-large', 'GET', '/api/v1/map/pois?bbox=44,25,63,40&preset=hospitals'],
  ['error-dataset-mismatch', 'GET', '/api/v1/map/search?q=Synthetic&dataset_id=ds-19990101-000000000000'],
];

const index = [];
for (const [name, method, path, body] of cases) {
  const res = await fetch(`${base}${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const json = await res.json();
  if (json?.error?.request_id) json.error.request_id = '<request-id>';
  const file = `${name}.json`;
  writeFileSync(join(out, file), `${JSON.stringify({ request: { method, path, ...(body ? { body } : {}) }, response: { status: res.status, body: json } }, null, 2)}\n`);
  index.push(`| \`${file}\` | ${method} \`${path.split('?')[0]}\` | ${res.status} |`);
}
writeFileSync(
  join(out, 'README.md'),
  `# Mobile contract fixtures

Real request/response pairs recorded from the running Seyra stack with the **synthetic** fixture release
(\`fixtures/osm/synthetic-v1.osm\`, fictional objects near 0°E 0°N). Regenerate with
\`tests/integration/capture-mobile-fixtures.mjs\`. \`request_id\` values are replaced by a placeholder.
Dataset ids and provider identities are those of the recording run.

| File | Request | Status |
| --- | --- | --- |
${index.join('\n')}
`,
);
console.log(`wrote ${cases.length} fixtures to ${out}`);
