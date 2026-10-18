// Real-Iran browser audit of the web test client (exploratory views; request audit is asserted).
// Same approach as tests/browser/web-client.mjs, but navigates by real Persian/English searches to
// urban, rural and border areas and takes country, city and street views in light/dark × fa/en.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright node tests/validation/iran-browser.mjs [base] [outDir]
//
// TLS: certificate errors are ignored in this headless profile (the internal CA is not installed);
// the chain is verified separately by the security suite.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = (process.argv[2] ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const out = resolve(process.argv[3] ?? 'iran-browser');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, locale: 'fa-IR' });
const page = await context.newPage();
const requests = [];
const failed = [];
const aborted = [];
const consoleErrors = [];
page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
page.on('requestfailed', (r) => {
  const error = r.failure()?.errorText ?? '';
  (error === 'net::ERR_ABORTED' ? aborted : failed).push({ url: r.url(), error });
});
page.on('response', (r) => {
  if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() });
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('worker', (w) => requests.push({ url: w.url(), type: 'worker' }));

const settle = async (ms = 3000) => {
  await page.waitForLoadState('load');
  await page.waitForTimeout(ms);
};
const shots = [];
const shot = async (name) => {
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 70 });
  shots.push(`${name}.jpg`);
};
const setView = async (theme, lang) => {
  await page.locator('header select').nth(1).selectOption(lang);
  await page.locator('header select').nth(0).selectOption(theme);
  await settle(2500);
};
const searchAndOpen = async (q) => {
  await page.getByRole('textbox').first().fill(q);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const text = (await page.locator('aside').innerText()).slice(0, 300);
  const first = page.locator('aside li, aside button.result, aside .result').first();
  const found = (await first.count()) > 0;
  if (found) await first.click().catch(() => undefined);
  await settle(4500);
  return { q, found, panel_text: text };
};
const zoomOut = async (steps) => {
  for (let i = 0; i < steps; i++) await page.locator('.maplibregl-ctrl-zoom-out').click();
  await settle(3500);
};

await page.goto(base, { waitUntil: 'load' });
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 60_000 });
await settle(5000);
const title = await page.title();
await shot('country-light-fa'); // initial view from the release style (dataset bounds)

const visits = [];
// Capital, street level, all four theme/language combinations.
visits.push({ area: 'Tehran (urban)', ...(await searchAndOpen('میدان آزادی')) });
for (const [theme, lang] of [['light', 'fa'], ['dark', 'fa'], ['light', 'en'], ['dark', 'en']]) {
  await setView(theme, lang);
  await shot(`tehran-azadi-${theme}-${lang}`);
}
await setView('light', 'fa');
await zoomOut(4);
await shot('tehran-city-light-fa');
// Historic centre with dense POIs.
visits.push({ area: 'Isfahan (urban)', ...(await searchAndOpen('میدان نقش جهان')) });
await shot('isfahan-naqshejahan-light-fa');
// Rural village.
visits.push({ area: 'Abyaneh (rural)', ...(await searchAndOpen('ابیانه')) });
await shot('abyaneh-rural-light-fa');
await zoomOut(3);
await shot('abyaneh-region-light-fa');
// Border towns: south-east (Pakistan/Afghanistan side) and north-west (Turkey).
visits.push({ area: 'Zahedan (south-east border province)', ...(await searchAndOpen('زاهدان')) });
await setView('dark', 'en');
await shot('zahedan-dark-en');
await setView('light', 'fa');
visits.push({ area: 'Bazargan (north-west border crossing)', ...(await searchAndOpen('بازرگان')) });
await shot('bazargan-border-light-fa');
await zoomOut(3);
await shot('bazargan-region-light-fa');
// English search on the English map.
await setView('light', 'en');
visits.push({ area: 'Shiraz (English query)', ...(await searchAndOpen('Shiraz')) });
await shot('shiraz-light-en');
await browser.close();

const origin = new URL(base).origin;
const external = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
const rtlPlugin = requests.filter((r) => /rtl-text|mapbox-gl-rtl|rtl_plugin/i.test(r.url));
const report = {
  recorded_at: new Date().toISOString(),
  label: 'EXPLORATORY real-Iran views (screenshots for visual review; request audit asserted)',
  base,
  title,
  total_requests: requests.length,
  external_requests: external,
  rtl_plugin_requests: rtlPlugin,
  font_resources: [...new Set(requests.filter((r) => /\/fonts\//.test(r.url)).map((r) => decodeURIComponent(new URL(r.url).pathname)))],
  failed_requests: failed,
  client_aborted_requests: aborted.length,
  tile_requests: requests.filter((r) => /\/tiles\/\d+\//.test(r.url)).length,
  console_errors: consoleErrors,
  visits,
  screenshots: shots,
};
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const ok = external.length === 0 && rtlPlugin.length === 0 && failed.length === 0;
console.log(`${ok ? 'PASS' : 'FAIL'} requests=${requests.length} external=${external.length} rtl_plugin=${rtlPlugin.length} failed=${failed.length} console_errors=${consoleErrors.length} visits_found=${visits.filter((v) => v.found).length}/${visits.length}`);
process.exit(ok ? 0 : 1);
