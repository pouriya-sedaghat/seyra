// Swagger UI check in a real browser against a running Seyra ingress (fixture stack).
//
//   PLAYWRIGHT_MODULE=… AJV_MODULE=… node tests/browser/swagger-ui.mjs <base> <outDir> <exported-spec.json> [normal|provider-down]
//
// normal: the docs page and every asset load from the ingress origin only (zero external requests),
//   with zero console errors / CSP violations / failed or aborted requests; no operation request is
//   sent before Execute; the served /api/docs/json equals the exported specification; GET
//   (getCapabilities) and POST (computeRoute, first body example) execute exactly one request each
//   through Try it out + Execute; a real API error body validates against its documented schema.
// provider-down (the caller has stopped the geocoder provider): the docs still load and render the
//   same specification, and Execute on searchPlaces returns the typed 503 envelope validating against
//   the documented 503 schema.
// The verdict also fails on a script crash or a missing required step. TLS: like web-client.mjs, the
// headless profile ignores certificate errors (chain verified by the security suite).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const AjvMod = require(process.env.AJV_MODULE ?? 'ajv');
const ajv = new (AjvMod.default ?? AjvMod)({ strict: false, allErrors: true });
const base = (process.argv[2] ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const out = resolve(process.argv[3] ?? 'swagger-evidence');
const exported = JSON.parse(readFileSync(process.argv[4], 'utf8'));
const mode = process.argv[5] ?? 'normal';
mkdirSync(out, { recursive: true });
const origin = new URL(base).origin;
const steps = [];
const step = (name, ok, detail = '') => steps.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
const requests = [];
const failed = [];
const aborted = [];
const consoleErrors = [];
const expectedConsole = [];
const opRequests = () => requests.filter((r) => /\/api\/v1\/|\/health\//.test(new URL(r.url).pathname));
const schemaFor = (path, method, status) => exported.paths[path][method].responses[String(status)].content['application/json'].schema;
let crash = null;

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  page.on('requestfailed', (r) => {
    const error = r.failure()?.errorText ?? '';
    (error === 'net::ERR_ABORTED' ? aborted : failed).push({ url: r.url(), error });
  });
  page.on('response', (r) => {
    const expected = mode === 'provider-down' && r.status() === 503 && r.url().includes('/api/v1/map/search');
    if (r.status() >= 400 && !expected) failed.push({ url: r.url(), status: r.status() });
  });
  page.on('console', (m) => {
    // Chromium logs every non-2xx resource load; in provider-down mode exactly the documented 503
    // of the search request is expected (recorded separately, never a CSP or script error).
    const expected503 = mode === 'provider-down' && /^Failed to load resource: the server responded with a status of 503/.test(m.text()) && (m.location()?.url ?? '').includes('/api/v1/map/search');
    if (expected503) expectedConsole.push({ text: m.text(), url: m.location()?.url });
    else if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const resp = await page.goto(`${base}/api/docs/`, { waitUntil: 'load' });
  step('docs page answers 200', resp?.status() === 200, resp?.status());
  await page.waitForSelector('.swagger-ui .opblock', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const opCount = await page.locator('.swagger-ui .opblock').count();
  step('the UI renders every documented operation', opCount === Object.values(exported.paths).reduce((n, m) => n + Object.keys(m).length, 0), opCount);
  step('no operation request before Execute', opRequests().length === 0, JSON.stringify(opRequests()));
  const served = await (await page.request.get(`${base}/api/docs/json`)).json();
  step('served /api/docs/json equals the exported specification', JSON.stringify(served) === JSON.stringify(exported));

  const execute = async (tag, operationId, path, method) => {
    const block = page.locator(`#operations-${tag}-${operationId}`);
    await block.locator('.opblock-summary').first().click();
    await block.locator('button.try-out__btn').click();
    const before = opRequests().length;
    const responded = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === method.toUpperCase(), { timeout: 60_000 });
    await block.locator('button.execute').click();
    const r = await responded;
    await page.waitForTimeout(500);
    const sent = opRequests().slice(before).filter((x) => new URL(x.url).pathname === path);
    return { status: r.status(), body: await r.json().catch(() => null), sent: sent.length };
  };

  if (mode === 'normal') {
    const caps = await execute('map', 'getCapabilities', '/api/v1/map/capabilities', 'get');
    step('GET getCapabilities via Try it out + Execute: 200, exactly one request', caps.status === 200 && caps.sent === 1 && caps.body?.api_version === 'v1', `${caps.status} sent=${caps.sent}`);
    const route = await execute('routing', 'computeRoute', '/api/v1/map/route', 'post');
    step('POST computeRoute (first body example) via Execute: 200, exactly one request', route.status === 200 && route.sent === 1 && Array.isArray(route.body?.routes), `${route.status} sent=${route.sent} ${JSON.stringify(route.body)?.slice(0, 120)}`);
    const v200 = ajv.compile(schemaFor('/api/v1/map/route', 'post', 200));
    step('the route response validates against its documented 200 schema', v200(route.body), JSON.stringify(v200.errors));
    const bad = await page.request.get(`${base}/api/v1/map/reverse?lon=500&lat=0`);
    const badBody = await bad.json();
    const v400 = ajv.compile(schemaFor('/api/v1/map/reverse', 'get', 400));
    step('a real 400 error body validates against the strict documented schema', bad.status() === 400 && v400(badBody), `${bad.status()} ${JSON.stringify(v400.errors)}`);
  } else {
    const s = await execute('geocoding', 'searchPlaces', '/api/v1/map/search', 'get');
    const v503 = ajv.compile(schemaFor('/api/v1/map/search', 'get', 503));
    step('provider down: Execute searchPlaces returns the typed 503 envelope', s.status === 503 && s.sent === 1 && v503(s.body) && ['PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'PROVIDER_TIMEOUT'].includes(s.body?.error?.code), `${s.status} ${JSON.stringify(s.body)?.slice(0, 160)}`);
  }
  await page.screenshot({ path: join(out, `swagger-${mode}.jpg`), type: 'jpeg', quality: 70 });
} catch (e) {
  crash = String(e?.stack ?? e).split('\n').slice(0, 3).join(' ');
} finally {
  await browser.close();
}

const external = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
step('zero external requests (all from the ingress origin)', external.length === 0, JSON.stringify(external.slice(0, 5)));
step('zero console errors or CSP violations', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
step('zero failed requests', failed.length === 0, JSON.stringify(failed.slice(0, 5)));
step('zero aborted requests', aborted.length === 0, JSON.stringify(aborted.slice(0, 5)));
step('script completed without a crash', crash === null, crash);
const required = mode === 'normal' ? 13 : 10; // every step above, so a skipped one fails the run (the expected-503 step follows)
step(`all ${required} required steps recorded`, steps.length === required, steps.length);
if (mode === 'provider-down') step('the expected 503 was logged by the browser exactly once for the search request', expectedConsole.length === 1, JSON.stringify(expectedConsole));
const report = { mode, base, requests: requests.length, external, failed, aborted, consoleErrors, expectedConsole, crash, steps };
writeFileSync(join(out, `swagger-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.ok ? '' : ` -- ${s.detail}`}`);
const bad = steps.filter((s) => !s.ok).length;
console.log(`# swagger-ui ${mode}: requests=${requests.length} steps=${steps.length} failed=${bad}`);
process.exit(bad ? 1 : 0);
