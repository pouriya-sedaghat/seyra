// AC09 / AC04 (client side): drive the real web test client in Chromium against the running stack.
// Records every network request (must all target the ingress origin; no CDN, font service or
// RTL-text plugin), console errors, and screenshots of light/dark × fa/en at street zoom after a
// real search. Screenshots are for visual review; the request audit is asserted.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/web-client.mjs [base] [outDir]
//
// TLS: the browser context ignores certificate errors because the internal CA is not installed
// in this headless profile; the chain itself is verified separately (tests/security, AC16.6).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = (process.argv[2] ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const out = resolve(process.argv[3] ?? 'docs/evidence/browser');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, locale: 'fa-IR' });
const page = await context.newPage();
const requests = [];
const failed = [];
const consoleErrors = [];
page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
page.on('requestfailed', (r) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
page.on('response', (r) => {
  if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() });
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('worker', (w) => requests.push({ url: w.url(), type: 'worker' }));

const settle = async (ms = 2500) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
};
const shot = async (name) => {
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 70 });
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 30_000 });
await settle();
const title = await page.title();

// Search in Persian (Farsi Yeh/Kaf input against Arabic-letter data) and open the result.
await page.getByRole('textbox').first().fill('خیابان اصلی آزمایشی');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const resultText = await page.locator('aside').innerText();
const firstResult = page.locator('aside li, aside button.result, aside .result').first();
if (await firstResult.count()) await firstResult.click().catch(() => undefined);
await settle(4000);
await shot('search-light-fa');

const views = [];
for (const theme of ['light', 'dark']) {
  for (const lang of ['fa', 'en']) {
    await page.locator('header select').nth(1).selectOption(lang);
    await page.locator('header select').nth(0).selectOption(theme);
    await settle(3000);
    await shot(`${theme}-${lang}`);
    views.push({ theme, lang, html_lang: await page.evaluate(() => document.documentElement.lang), dir: await page.evaluate(() => document.documentElement.dir) });
  }
}
await browser.close();

const origin = new URL(base).origin;
const external = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
const rtlPlugin = requests.filter((r) => /rtl-text|mapbox-gl-rtl|rtl_plugin/i.test(r.url));
const fontRequests = [...new Set(requests.filter((r) => /\/fonts\//.test(r.url)).map((r) => decodeURIComponent(new URL(r.url).pathname)))];
const report = {
  recorded_at: new Date().toISOString(),
  base,
  title,
  total_requests: requests.length,
  external_requests: external,
  rtl_plugin_requests: rtlPlugin,
  font_resources: fontRequests,
  failed_requests: failed,
  console_errors: consoleErrors,
  search_panel_text: resultText.slice(0, 400),
  views,
  screenshots: ['search-light-fa.jpg', 'light-fa.jpg', 'light-en.jpg', 'dark-fa.jpg', 'dark-en.jpg'],
};
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const ok = external.length === 0 && rtlPlugin.length === 0 && failed.length === 0;
console.log(`${ok ? 'PASS' : 'FAIL'} requests=${requests.length} external=${external.length} rtl_plugin=${rtlPlugin.length} failed=${failed.length} console_errors=${consoleErrors.length}`);
process.exit(ok ? 0 : 1);
