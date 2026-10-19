// Regression for review finding V2: the browser audit's exit status must cover every condition it
// claims (external requests, RTL plugin, failed requests, console errors, required visits).
//
//   node tests/validation/test-browser-verdict.mjs [path/to/old/iran-browser.mjs]
//
// Without an argument it checks tests/validation/browser-verdict.mjs. With the path of an older
// iran-browser.mjs it evaluates that file's inline `const ok = ...` predicate on the same cases,
// to show what the old exit status accepted. Exit status 0 only if every expectation holds.
import { readFileSync } from 'node:fs';
import { browserVerdict } from './browser-verdict.mjs';

const ok = { external: [], rtlPlugin: [], failed: [], consoleErrors: [] };
const six = Array.from({ length: 6 }, (_, i) => ({ area: `area ${i + 1}`, found: true, rank_of_expected_area: 1 }));
const cases = [
  { name: 'successful report shape', input: { ...ok, visits: six }, expect: true },
  { name: 'console error', input: { ...ok, consoleErrors: ['Failed to load resource: 503'], visits: six }, expect: false },
  { name: 'missing required visit', input: { ...ok, visits: six.map((v, i) => (i === 0 ? { ...v, found: false, rank_of_expected_area: null } : v)) }, expect: false },
  { name: 'declared visits not all recorded', input: { ...ok, visits: six.slice(0, 4) }, expect: false },
  { name: 'failed request (503)', input: { ...ok, failed: [{ url: 'https://127.0.0.1:8443/health/ready', status: 503 }], visits: six }, expect: false },
  { name: 'external request', input: { ...ok, external: [{ url: 'https://example.com/x' }], visits: six }, expect: false },
  { name: 'script crashed after recording all visits', input: { ...ok, visits: six, scriptError: 'TimeoutError: locator.click' }, expect: false },
];

const old = process.argv[2];
let evaluate;
if (old) {
  const expr = /^const ok = (.+);$/m.exec(readFileSync(old, 'utf8'))?.[1];
  if (!expr) throw new Error(`no inline predicate in ${old}`);
  const fn = new Function('external', 'rtlPlugin', 'failed', 'consoleErrors', 'visits', `return ${expr};`);
  // The old script had no crash path: a crash exited without a report. Its predicate is applied as is.
  evaluate = (i) => ({ ok: Boolean(fn(i.external, i.rtlPlugin, i.failed, i.consoleErrors, i.visits)) });
  console.log(`# evaluating the inline predicate of ${old}: ${expr}`);
} else {
  evaluate = (i) => browserVerdict({ ...i, expectedVisits: 6 });
  console.log('# evaluating browserVerdict (tests/validation/browser-verdict.mjs)');
}

let failures = 0;
for (const c of cases) {
  const r = evaluate(c.input);
  const pass = r.ok === c.expect;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c.name}: verdict=${r.ok ? 'PASS' : 'FAIL'} expected=${c.expect ? 'PASS' : 'FAIL'}${r.checks ? ` ${JSON.stringify(Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, v.ok])))}` : ''}`);
}
if (!old) {
  let threw = false;
  try {
    browserVerdict({ ...ok, visits: six });
  } catch {
    threw = true;
  }
  if (!threw) failures++;
  console.log(`${threw ? 'PASS' : 'FAIL'} expectedVisits must be declared`);
}
console.log(`# failures: ${failures}`);
process.exit(failures ? 1 : 0);
