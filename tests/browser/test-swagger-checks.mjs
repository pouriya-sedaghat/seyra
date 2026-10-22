// Focused regression for the Swagger UI harness helpers (review c73db85 evidence items):
//  - external requests are judged by exact origin, not a string prefix;
//  - an operation request sent while the operation is opened or at "Try it out" (before Execute) is
//    detected; Execute's own request is counted separately.
// tryOutAndExecute runs against a scripted stand-in page (no browser): its click handlers emit the
// requests a misbehaving UI would send.
//
//   node tests/browser/test-swagger-checks.mjs
import { isExternal, tryOutAndExecute } from './swagger-checks.mjs';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const ORIGIN = 'https://127.0.0.1:8443';
// The pre-fix expression, kept only to show what it accepted (structural: it had no helper).
const prefixExternal = (url) => !url.startsWith(ORIGIN) && !url.startsWith('data:') && !url.startsWith('blob:');

for (const [url, want, label] of [
  [`${ORIGIN}/api/docs/`, false, 'same origin'],
  [`${ORIGIN}/api/v1/map/capabilities?x=1`, false, 'same origin with a query'],
  ['data:image/png;base64,AAAA', false, 'data: URL'],
  ['blob:https://127.0.0.1:8443/1b2c', false, 'blob: URL'],
  ['https://127.0.0.1:8443.attacker.example/x.js', true, 'prefix-extended host'],
  ['https://127.0.0.1:84430/x.js', true, 'prefix-extended port'],
  ['https://127.0.0.1:8443@attacker.example/x.js', true, 'userinfo trick'],
  ['http://127.0.0.1:8443/x', true, 'other scheme'],
  ['https://localhost:8443/x', true, 'other host name'],
  ['not a url', true, 'unparsable'],
]) {
  check(`isExternal: ${label} -> ${want ? 'external' : 'same origin'}`, isExternal(url, ORIGIN) === want, url);
}
check('the pre-fix prefix check accepted a prefix-extended host and port as same origin (defect reproduced)', !prefixExternal('https://127.0.0.1:8443.attacker.example/x.js') && !prefixExternal('https://127.0.0.1:84430/x.js'));

/** A scripted page: clicking a selector runs its handler, which may record requests. */
function fakePage(handlers) {
  const log = [];
  const req = (url, method = 'GET') => log.push({ url: `${ORIGIN}${url}`, method });
  const click = (sel) => async () => handlers[sel]?.(req);
  const locator = (sel) => ({ first: () => ({ click: click(sel) }), click: click(sel), locator: (child) => locator(child) });
  let pending = null;
  return {
    log,
    req,
    page: {
      locator,
      waitForTimeout: async () => {},
      waitForResponse: (pred) => new Promise((res) => { pending = { pred, res }; }),
      _respond(url, method, status, body) {
        const r = { url: () => `${ORIGIN}${url}`, request: () => ({ method: () => method }), status: () => status, json: async () => body };
        if (pending?.pred(r)) pending.res(r);
      },
    },
  };
}
const op = { tag: 'map', operationId: 'getCapabilities', path: '/api/v1/map/capabilities', method: 'get' };
async function scenario(name, tryOutEmits, openEmits, want) {
  const f = fakePage({
    '.opblock-summary': (req) => openEmits && req(op.path),
    'button.try-out__btn': (req) => tryOutEmits && req(op.path),
    'button.execute': (req) => { req(op.path); f.page._respond(op.path, 'GET', 200, { api_version: 'v1' }); },
  });
  const opRequests = () => f.log.filter((r) => new URL(r.url).pathname.startsWith('/api/v1/'));
  const x = await tryOutAndExecute(f.page, opRequests, op);
  check(`${name}: requests before Execute=${x.beforeExecute.length}, sent by Execute=${x.sent}`, x.beforeExecute.length === want.before && x.sent === want.sent && x.status === 200, JSON.stringify(x));
}
await scenario('clean UI', false, false, { before: 0, sent: 1 });
await scenario('request emitted at Try it out (detected)', true, false, { before: 1, sent: 1 });
await scenario('request emitted while opening the operation (detected)', false, true, { before: 1, sent: 1 });

for (const c of results) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : ` -- ${c.detail}`}`);
const failed = results.filter((c) => !c.ok).length;
console.log(`# swagger checks: checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
