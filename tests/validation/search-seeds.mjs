#!/usr/bin/env node
// Persian search seed runner (tests/validation/search-seeds.json). Measures, never adjusts:
// a result is PASS only when the expected feature identity is in the top k AND (when a reference
// position exists) within its location tolerance. A missing or changed identity is a reviewable
// FAIL with the observed candidates; the seeds file is never rewritten. Province text alone never
// counts. A run against a dataset other than the operator-local binding is SNAPSHOT_CHANGED.
//
//   node tests/validation/search-seeds.mjs --base https://<host>:<port> --ca <ca.crt> --dataset iran|fixture \
//        --binding <operator-local binding.json> --out <dir outside Git> [--only id,id] [--navigate]
//
// binding.json (operator-local): { "dataset_id": "...", "pbf_sha256": "..." }
// --navigate additionally opens each base case flagged "navigate" in the hosted web client and
// requires the viewport to reach the selected feature (tests/validation/browser-navigation.mjs).
// Requests are sequential (one at a time) with a pause; this is a correctness check, not load.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function distanceM(a, b) {
  const R = 6_371_008.8;
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Evaluate one case against the API's result list. Pure; used by the runner and its tests. */
export function evaluateCase(c, results, defaults) {
  const topK = c.top_k ?? defaults.top_k;
  const tol = c.expected.location_tolerance_m ?? defaults.location_tolerance_m;
  const hasPos = Number.isFinite(c.expected.lon) && Number.isFinite(c.expected.lat);
  const top = results.slice(0, topK).map((r, i) => ({
    rank: i + 1,
    id: r.id,
    name: r.name,
    category: r.category ? `${r.category.key}=${r.category.value}` : null,
    distance_m: hasPos && r.coordinate ? Math.round(distanceM(r.coordinate, c.expected)) : null,
  }));
  const out = { id: c.id, query: c.query, change: c.change ?? null, top_k: topK, top };
  if (!c.expected.feature_id && !hasPos) return { ...out, status: 'NOT_EVALUATED', reason: 'no reviewed reference yet; observed candidates recorded for review' };
  const near = hasPos ? top.find((t) => t.distance_m !== null && t.distance_m <= tol) ?? null : null;
  if (!c.expected.feature_id) {
    // Location-only reference: never PASS by identity; record the candidate id for owner review.
    return near
      ? { ...out, status: 'LOCATION_MATCH', rank: near.rank, proposed_feature_id: near.id, reason: `a result within ${tol} m at rank ${near.rank}; identity not yet reviewed` }
      : { ...out, status: 'FAIL', reason: `no result within ${tol} m in the top ${topK}` };
  }
  const hit = top.find((t) => t.id === c.expected.feature_id);
  if (!hit) {
    return {
      ...out,
      status: 'FAIL',
      reason: near ? `expected ${c.expected.feature_id} not in the top ${topK}; ${near.id} at rank ${near.rank} lies ${near.distance_m} m from the reference (possible identity change: review, do not rewrite)` : `expected ${c.expected.feature_id} not in the top ${topK}`,
    };
  }
  if (hasPos && !(hit.distance_m <= tol)) return { ...out, status: 'FAIL', rank: hit.rank, reason: `${hit.id} found at rank ${hit.rank} but ${hit.distance_m} m from the reference (> ${tol} m)` };
  return { ...out, status: 'PASS', rank: hit.rank };
}

/** The active dataset must be the operator-bound one; otherwise nothing is evaluated as PASS. */
export function checkBinding(binding, capabilities) {
  if (!binding?.dataset_id) return { ok: false, status: 'UNBOUND', reason: 'no operator binding (dataset_id); results would not be attributable' };
  if (capabilities.dataset_id !== binding.dataset_id) return { ok: false, status: 'SNAPSHOT_CHANGED', reason: `active dataset ${capabilities.dataset_id} differs from the bound ${binding.dataset_id}; references are not rewritten` };
  return { ok: true };
}

function getJson(base, ca, path) {
  return new Promise((res, rej) => {
    const u = new URL(path, base);
    const r = request(u, { ca, method: 'GET', headers: { accept: 'application/json' }, timeout: 15_000 }, (resp) => {
      let b = '';
      resp.on('data', (d) => (b += d));
      resp.on('end', () => {
        try {
          res({ status: resp.statusCode, body: JSON.parse(b) });
        } catch (e) {
          rej(new Error(`${path}: HTTP ${resp.statusCode}, not JSON`));
        }
      });
    });
    r.on('timeout', () => r.destroy(new Error(`${path}: timeout`)));
    r.on('error', rej);
    r.end();
  });
}

async function main() {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const base = arg('--base');
  const caFile = arg('--ca');
  const dataset = arg('--dataset');
  const out = arg('--out');
  if (!base || !caFile || !dataset || !out) throw new Error('usage: --base URL --ca FILE --dataset iran|fixture --binding FILE --out DIR [--only ids] [--navigate]');
  const seeds = JSON.parse(readFileSync(arg('--seeds') ?? join(here, 'search-seeds.json'), 'utf8'));
  const binding = arg('--binding') ? JSON.parse(readFileSync(arg('--binding'), 'utf8')) : null;
  const only = arg('--only')?.split(',');
  const ca = readFileSync(caFile);
  const cases = seeds.cases.filter((c) => c.dataset === dataset && (!only || only.includes(c.id)));
  const caps = await getJson(base, ca, '/api/v1/map/capabilities');
  const bound = checkBinding(binding, caps.body);
  const report = { schema: 'seyra.search-seed-report/1', started_at: new Date().toISOString(), base, dataset, active_dataset_id: caps.body.dataset_id, binding: bound, defaults: seeds.defaults, cases: [] };
  for (const c of cases) {
    const lang = c.lang ?? seeds.defaults.lang;
    const q = new URLSearchParams({ q: c.query, lang, limit: String(seeds.defaults.limit) });
    const r = await getJson(base, ca, `/api/v1/map/search?${q}`);
    const results = r.status === 200 ? r.body.results : [];
    const ev = r.status === 200 ? evaluateCase(c, results, seeds.defaults) : { id: c.id, query: c.query, status: 'FAIL', reason: `HTTP ${r.status} ${r.body?.error?.code ?? ''}` };
    if (!bound.ok && ev.status === 'PASS') ev.status = bound.status; // never PASS against an unbound or changed snapshot
    report.cases.push({ ...ev, request: { lang, limit: seeds.defaults.limit }, normalized_query: r.body?.normalized_query ?? null, reference: c.reference });
    await new Promise((s) => setTimeout(s, 500));
  }
  if (process.argv.includes('--navigate')) {
    const { chromium } = await import('playwright');
    const { createNavigator } = await import(pathToFileURL(join(here, 'browser-navigation.mjs')));
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ ignoreHTTPSErrors: false })).newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const nav = createNavigator(page, { settle: (ms) => page.waitForTimeout(ms) });
    report.navigation = [];
    for (const c of cases.filter((x) => x.navigate && x.expected.feature_id)) {
      const v = await nav.searchAndOpen(c.query, c.expected.region);
      report.navigation.push({ id: c.id, ...v, status: v.reached && v.target?.id === c.expected.feature_id && bound.ok ? 'PASS' : 'FAIL' });
    }
    await browser.close();
  }
  report.finished_at = new Date().toISOString();
  report.summary = Object.fromEntries(['PASS', 'FAIL', 'LOCATION_MATCH', 'NOT_EVALUATED', 'UNBOUND', 'SNAPSHOT_CHANGED'].map((s) => [s, report.cases.filter((x) => x.status === s).length]));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'search-seed-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const x of report.cases) console.log(`${x.status.padEnd(16)} ${x.id} ${x.rank ? `rank ${x.rank}` : ''} ${x.reason ?? ''}`);
  console.log(`# ${JSON.stringify(report.summary)} -> ${resolve(out, 'search-seed-report.json')}`);
  return report.cases.some((x) => x.status === 'FAIL' || x.status === 'SNAPSHOT_CHANGED' || x.status === 'UNBOUND') || report.navigation?.some((n) => n.status !== 'PASS') ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`search seeds: ${e.message}`);
    process.exit(2);
  });
}
