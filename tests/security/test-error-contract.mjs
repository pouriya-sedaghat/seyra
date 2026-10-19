// Regression for review H5 (6602199): every JSON error the ingress itself generates must satisfy
// the exported OpenAPI error schema it is documented under (route/proximity 413), without
// weakening that schema. Compares the checkout's proxy template literals with the checkout's
// exported docs/openapi/map-services-v1.json using a JSON-schema validator.
//
//   node tests/security/test-error-contract.mjs [checkout-root]
// (API-generated bodies are validated against the served schema in apps/api/src/docs.test.ts.)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '..', '..'));
const Ajv = createRequire(join(here, '..', '..', 'package.json'))('ajv');
const ajv = new (Ajv.default ?? Ajv)({ strict: false, allErrors: true });
const spec = JSON.parse(readFileSync(join(root, 'docs', 'openapi', 'map-services-v1.json'), 'utf8'));
const tpl = readFileSync(join(root, 'infra', 'images', 'proxy', 'locations.conf.template'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const sample = '0123456789abcdef0123456789abcdef'; // what nginx puts in $request_id
const bodies = [...tpl.matchAll(/return (\d{3}) '(\{"error"[^']+)';/g)].map((m) => ({ status: m[1], body: JSON.parse(m[2].replaceAll('$request_id', sample)) }));
check('the proxy template generates JSON errors', bodies.length >= 5, bodies.length);
const errorSchema = spec.paths['/api/v1/map/route'].post.responses['413'].content['application/json'].schema;
const validate = ajv.compile(errorSchema);
for (const b of bodies) check(`ingress ${b.status} ${b.body.error.code} satisfies the documented error schema`, validate(b.body), JSON.stringify(validate.errors));
for (const path of ['/api/v1/map/route', '/api/v1/map/proximity']) {
  const v = ajv.compile(spec.paths[path].post.responses['413'].content['application/json'].schema);
  const ingress413 = bodies.find((b) => b.status === '413');
  check(`ingress 413 satisfies the exported ${path} 413 schema`, ingress413 && v(ingress413.body), JSON.stringify(v.errors));
  check(`the exported ${path} 413 schema still requires request_id`, v.schema.properties.error.required.includes('request_id'));
}
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# checkout=${root} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
