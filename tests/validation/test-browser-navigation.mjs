// Regression for review finding F3 (e7a2175): a required browser visit must prove navigation to
// the selected feature, not only a matching result card.
//
//   node tests/validation/test-browser-navigation.mjs [CHECKOUT]
//
// Drives the actual navigation helper of CHECKOUT (default: this repository) and its own verdict
// through a controlled Playwright page boundary: a search response with known coordinates, result
// cards rendered from it, a viewport center the client reports as bias_lon/bias_lat, and a result
// click that rejects, does nothing, moves to the wrong place or navigates correctly. Older revisions
// (no browser-navigation.mjs) are driven through their inline searchAndOpen. No browser, no network.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const v = (p) => join(root, 'tests', 'validation', p);
const { browserVerdict } = await import(pathToFileURL(v('browser-verdict.mjs')));
const hasNavigator = existsSync(v('browser-navigation.mjs'));

const AZADI = { id: 'osm:r7814369', name: 'برج آزادی', lon: 51.3380, lat: 35.6997 };
const RESULTS = [
  { id: 'osm:n5777098232', name: 'میدان آزادی', category: { key: 'place', value: 'locality' }, coordinate: { lon: 50.84, lat: 28.97 }, admin: 'بوشهر' },
  { id: AZADI.id, name: AZADI.name, category: { key: 'tourism', value: 'attraction' }, coordinate: { lon: AZADI.lon, lat: AZADI.lat }, admin: 'منطقه ۹، تهران' },
];
const ELSEWHERE = { lon: 53.6, lat: 32.4 }; // the initial country view

class FakePage {
  constructor({ click, center = ELSEWHERE, viewKnown = true }) {
    Object.assign(this, { clickMode: click, center, viewKnown, q: '', boxes: [true, true], cards: [], waiters: [], clicks: 0 });
    this.keyboard = { press: async (k) => (k === 'Enter' ? this.submit() : undefined) };
  }
  getByRole() {
    const tb = { fill: async (q) => void (this.q = q), press: async (k) => (k === 'Enter' ? this.submit() : undefined) };
    return { first: () => tb };
  }
  waitFor(kind, pred, opts) {
    return new Promise((res, rej) => {
      const w = { kind, pred, res };
      this.waiters.push(w);
      setTimeout(() => rej(new Error(`fake ${kind} timeout`)), Math.min(opts?.timeout ?? 1000, 1000));
    });
  }
  waitForResponse(pred, opts) {
    return this.waitFor('response', pred, opts);
  }
  waitForRequest(pred, opts) {
    return this.waitFor('request', pred, opts);
  }
  async waitForTimeout() {}
  emit(kind, obj) {
    for (const w of [...this.waiters]) if (w.kind === kind && w.pred(obj)) w.res(obj);
  }
  async submit() {
    const p = new URLSearchParams({ q: this.q, lang: 'fa', limit: '10' });
    if (this.boxes[1] && this.viewKnown) p.set('bias_lon', String(this.center.lon)), p.set('bias_lat', String(this.center.lat));
    const url = `https://127.0.0.1:8443/api/v1/map/search?${p}`;
    this.emit('request', { url: () => url });
    this.cards = RESULTS;
    this.emit('response', { url: () => url, json: async () => ({ results: RESULTS }) });
  }
  async click(i) {
    this.clicks++;
    const r = this.cards[i];
    if (this.clickMode === 'reject') throw new Error('locator.click: element is not attached');
    if (this.clickMode === 'navigate') this.center = { lon: r.coordinate.lon, lat: r.coordinate.lat };
    if (this.clickMode === 'wrong') this.center = { lon: 51.42, lat: 35.75 }; // ~9 km away
  }
  locator(sel) {
    if (sel === 'aside li, aside button.result, aside .result') {
      return {
        count: async () => this.cards.length,
        nth: (i) => ({ innerText: async () => `${this.cards[i].name}\n${this.cards[i].category.key}=${this.cards[i].category.value} · ${this.cards[i].id}\n${this.cards[i].admin}`, click: async () => this.click(i) }),
      };
    }
    if (sel === 'aside input[type=checkbox]') {
      return { nth: (i) => ({ isChecked: async () => this.boxes[i], check: async () => void (this.boxes[i] = true), uncheck: async () => void (this.boxes[i] = false) }) };
    }
    if (sel === '.maplibregl-ctrl-scale') return { first: () => ({ innerText: async () => '100 km' }) };
    return { innerText: async () => this.cards.map((c) => c.name).join('\n') };
  }
}

async function visitWith(page) {
  if (hasNavigator) {
    const { createNavigator } = await import(pathToFileURL(v('browser-navigation.mjs')));
    const nav = createNavigator(page, { settle: async () => {}, timeoutMs: 500 });
    await nav.prepare();
    return nav.searchAndOpen('برج آزادی', 'تهران');
  }
  // Older revisions: the actual inline helper of iran-browser.mjs.
  const src = readFileSync(v('iran-browser.mjs'), 'utf8');
  const a = src.indexOf('const searchAndOpen = async');
  const body = src.slice(a, src.indexOf('// Zoom out', a)).replace('const searchAndOpen =', 'return');
  const searchAndOpen = new Function('page', 'settle', body)(page, async () => {});
  return searchAndOpen('برج آزادی', 'تهران');
}

const verdictOf = (visits, extra = {}) => browserVerdict({ external: [], rtlPlugin: [], failed: [], consoleErrors: [], visits, expectedVisits: 6, ...extra });
const six = (visit) => Array.from({ length: 6 }, () => visit);
const cases = [
  { name: 'rejected result click', page: { click: 'reject' }, expect: false },
  { name: 'click returns but the map does not move (viewport elsewhere)', page: { click: 'noop' }, expect: false },
  { name: 'click moves the map to the wrong place (~9 km off)', page: { click: 'wrong' }, expect: false },
  { name: 'valid navigation to the selected feature', page: { click: 'navigate' }, expect: true },
  { name: 'already on the target; the click changes nothing', page: { click: 'noop', center: { lon: AZADI.lon, lat: AZADI.lat } }, expect: true },
  { name: 'client reports no viewport center', page: { click: 'navigate', viewKnown: false }, expect: false },
];
console.log(`# checkout=${root} helper=${hasNavigator ? 'browser-navigation.mjs' : 'inline searchAndOpen (iran-browser.mjs)'}`);
let failures = 0;
let validVisit = null;
for (const c of cases) {
  const page = new FakePage(c.page);
  const visit = await visitWith(page);
  if (c.page.click === 'navigate' && c.page.viewKnown !== false) validVisit = visit;
  const verdict = verdictOf(six(visit));
  const pass = verdict.ok === c.expect;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c.name}: visit verdict ${verdict.status} (expected ${c.expect ? 'PASS' : 'FAIL'}); recorded ${JSON.stringify({ found: visit.found ?? visit.result_found, reached: visit.reached, click_error: visit.click_error ?? null, distance_m: visit.distance_m ?? null })}`);
}
// Aggregation around valid visits: still fails for a console error, an incomplete list or a crash.
for (const [name, extra, visits] of [
  ['console error with six reached visits', { consoleErrors: ['Failed to load resource: 503'] }, six(validVisit)],
  ['incomplete visit list (4 of 6)', {}, six(validVisit).slice(0, 4)],
  ['script crash after six reached visits', { scriptError: 'TimeoutError: locator.click' }, six(validVisit)],
]) {
  const verdict = verdictOf(visits, extra);
  const pass = verdict.ok === false;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: verdict ${verdict.status} (expected FAIL)`);
}
console.log(`# failures: ${failures}`);
process.exit(failures ? 1 : 0);
