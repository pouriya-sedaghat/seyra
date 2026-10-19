// Tests for examples/web-dev-proxy/seyra-dev-proxy.mjs against a local HTTPS stand-in for the Seyra
// ingress (temporary CA; loopback only). No network outside 127.0.0.1.
//
//   node tests/client/test-dev-proxy.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createDevProxy, loadConfig, checkTarget } = await import(pathToFileURL(join(repo, 'examples', 'web-dev-proxy', 'seyra-dev-proxy.mjs')));
const w = mkdtempSync(join(tmpdir(), 'seyra-dev-proxy-'));
const ossl = (...a) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'pipe'] });
const mkca = (n) => ossl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(w, `${n}.key`), '-out', join(w, `${n}.crt`), '-days', '2', '-subj', `/CN=${n}`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign');
mkca('ca');
mkca('other-ca');
ossl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(w, 'srv.key'), '-out', join(w, 'srv.csr'), '-subj', '/CN=127.0.0.1');
writeFileSync(join(w, 'ext'), 'basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
ossl('x509', '-req', '-in', join(w, 'srv.csr'), '-CA', join(w, 'ca.crt'), '-CAkey', join(w, 'ca.key'), '-CAcreateserial', '-out', join(w, 'srv.crt'), '-days', '1', '-extfile', join(w, 'ext'));
writeFileSync(join(w, 'ca-with-key.pem'), readFileSync(join(w, 'ca.crt')).toString() + readFileSync(join(w, 'ca.key')).toString());

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const DS = 'ds-20261019-devproxy01';
const seen = [];
let upstreamClosed = 0;
// Stand-in for the Seyra ingress: absolute map URLs from the request Host (as nginx does).
const upstream = createHttps({ key: readFileSync(join(w, 'srv.key')), cert: readFileSync(join(w, 'srv.crt')) }, (req, res) => {
  seen.push({ url: req.url, method: req.method, headers: req.headers });
  const base = `https://${req.headers.host}`;
  if (req.url.startsWith('/api/slow')) {
    res.on('close', () => upstreamClosed++); // the connection went away before an answer
    return; // never answers
  }
  if (req.url === `/maps/${DS}/styles/light-fa.json`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ sources: { s: { url: `${base}/maps/${DS}/tiles.json` } }, glyphs: `${base}/maps/${DS}/fonts/{fontstack}/{range}.pbf`, sprite: `${base}/maps/${DS}/sprites/light`, note: `${base}.evil.test/x ${base}x` }));
  }
  if (req.url === `/maps/${DS}/tiles.json`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ tiles: [`${base}/maps/${DS}/tiles/{z}/{x}/{y}.pbf`] }));
  }
  if (req.url.startsWith(`/maps/${DS}/tiles/`)) {
    res.writeHead(200, { 'content-type': 'application/vnd.mapbox-vector-tile' });
    return res.end(Buffer.from([0x1a, 0x00, 0xff, 0x10]));
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'keep-alive' });
    res.end(JSON.stringify({ ok: true, body }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upPort = upstream.address().port;
const seyraOrigin = `https://127.0.0.1:${upPort}`;
const pageOrigin = 'http://localhost:5199';

// ---------------------------------------------------------------------------------------------
// Configuration refusals.
// ---------------------------------------------------------------------------------------------
const base = { seyraOrigin, caFile: join(w, 'ca.crt'), listen: { host: '127.0.0.1', port: 18080 }, pageOrigin };
for (const [name, over, re] of [
  ['plain-HTTP upstream', { seyraOrigin: `http://127.0.0.1:${upPort}` }, /must use https/],
  ['upstream with a path', { seyraOrigin: `${seyraOrigin}/api` }, /origin only/],
  ['upstream with credentials', { seyraOrigin: `https://u:p@127.0.0.1:${upPort}` }, /credentials/],
  ['missing CA file', { caFile: '' }, /caFile/],
  ['CA file holding a private key', { caFile: join(w, 'ca-with-key.pem') }, /private key/],
  ['listening on all interfaces', { listen: { host: '0.0.0.0', port: 18080 } }, /loopback/],
  ['listening on a LAN address', { listen: { host: '192.0.2.5', port: 18080 } }, /loopback/],
  ['no listen port', { listen: { host: '127.0.0.1' } }, /listen\.port/],
  ['page origin with a path', { pageOrigin: 'http://localhost:5199/app' }, /origin only/],
  ['wildcard page origin', { pageOrigin: 'http://*.example.test' }, /not a URL|wildcards/],
]) {
  let err = null;
  try {
    loadConfig({ ...base, ...over });
  } catch (e) {
    err = e.message;
  }
  check(`config refuses ${name}`, err && re.test(err), err ?? 'accepted');
}

// ---------------------------------------------------------------------------------------------
// Request handling.
// ---------------------------------------------------------------------------------------------
const { server, close } = createDevProxy({ ...base, listen: { host: '127.0.0.1', port: 1 } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// The Host allowlist is derived from the configured port; rebuild with the real one.
await close();
const proxy = createDevProxy({ ...base, listen: { host: '127.0.0.1', port } });
await new Promise((r) => proxy.server.listen(port, '127.0.0.1', r));

function raw(lines, { readMs = 1500 } = {}) {
  return new Promise((res) => {
    const s = connect({ host: '127.0.0.1', port }, () => s.write(lines));
    let buf = Buffer.alloc(0);
    s.on('data', (d) => (buf = Buffer.concat([buf, d])));
    const done = () => {
      s.destroy();
      const t = buf.toString('latin1');
      res({ status: Number(t.split(' ')[1]) || null, text: t, body: buf.subarray(buf.indexOf('\r\n\r\n') + 4) });
    };
    s.on('end', done);
    s.on('error', done);
    setTimeout(done, readMs);
  });
}
const get = (path, headers = {}, method = 'GET', body = null) =>
  new Promise((res) => {
    const h = { host: `localhost:${port}`, ...headers };
    if (body) h['content-length'] = Buffer.byteLength(body);
    const r = httpRequest({ host: '127.0.0.1', port, path, method, headers: h, agent: false }, (resp) => {
      const chunks = [];
      resp.on('data', (d) => chunks.push(d));
      resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', (e) => res({ status: null, error: e.code }));
    if (body) r.write(body);
    r.end();
  });

const api = await get('/api/v1/map/capabilities', { cookie: 'a=b', authorization: 'Basic eDp5', origin: 'http://localhost:5199', referer: 'http://localhost:5199/x', 'x-forwarded-host': 'evil.test', 'x-forwarded-for': '203.0.113.9', forwarded: 'for=203.0.113.9', 'x-real-ip': '203.0.113.9' });
const sawApi = seen.find((s) => s.url === '/api/v1/map/capabilities');
check('forwards /api/ over verified TLS', api.status === 200 && JSON.parse(api.body).ok === true, api.status);
check('sends the configured Seyra host, not the client Host', sawApi?.headers.host === `127.0.0.1:${upPort}`, sawApi?.headers.host);
check('never forwards cookies, credentials, Origin/Referer or forwarding headers', sawApi && !['cookie', 'authorization', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-for', 'forwarded', 'x-real-ip'].some((h) => h in sawApi.headers), JSON.stringify(Object.keys(sawApi?.headers ?? {})));

const style = await get(`/maps/${DS}/styles/light-fa.json`, { 'accept-encoding': 'gzip', 'x-forwarded-host': 'evil.test' });
const st = JSON.parse(style.body);
check('style: source, glyph and sprite URLs rewritten to the page origin', st.sources.s.url === `${pageOrigin}/maps/${DS}/tiles.json` && st.glyphs === `${pageOrigin}/maps/${DS}/fonts/{fontstack}/{range}.pbf` && st.sprite === `${pageOrigin}/maps/${DS}/sprites/light`, style.body.toString().slice(0, 200));
check('style: only the exact configured origin is rewritten (look-alike hosts untouched)', st.note === `${seyraOrigin}.evil.test/x ${seyraOrigin}x`, st.note);
check('style: rewritten body has a correct length and no stale encoding', Number(style.headers['content-length']) === style.body.length && !style.headers['content-encoding']);
check('style: upstream was asked for an identity body', seen.find((s) => s.url.endsWith('light-fa.json'))?.headers['accept-encoding'] === 'identity');
const tj = JSON.parse((await get(`/maps/${DS}/tiles.json`)).body);
check('TileJSON tile URL rewritten to the page origin', tj.tiles[0] === `${pageOrigin}/maps/${DS}/tiles/{z}/{x}/{y}.pbf`, tj.tiles[0]);
const tile = await get(`/maps/${DS}/tiles/3/4/5.pbf`);
check('vector tiles pass through byte-identical', tile.status === 200 && tile.body.equals(Buffer.from([0x1a, 0x00, 0xff, 0x10])));
const post = await get('/api/v1/map/route', { 'content-type': 'application/json' }, 'POST', '{"profile":"car"}');
check('POST bodies reach /api/', post.status === 200 && JSON.parse(post.body).body === '{"profile":"car"}');

for (const [name, path, method, want] of [
  ['web root', '/', 'GET', 404],
  ['licenses', '/licenses/vazirmatn-ofl.txt', 'GET', 404],
  ['readiness outside /api/', '/health/ready', 'GET', 404],
  ['dot segment escaping /api/', '/api/../licenses/x', 'GET', 400],
  ['encoded dot segment', '/api/%2e%2e/licenses/x', 'GET', 400],
  ['POST to /maps/', `/maps/${DS}/tiles.json`, 'POST', 405],
  ['PUT to /api/', '/api/v1/map/route', 'PUT', 405],
]) {
  const r = await get(path, {}, method);
  check(`refuses ${name} (${method} ${path}) with ${want}`, r.status === want, r.status);
}
const absolute = await raw(`GET http://evil.test/api/v1/map/capabilities HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
check('refuses an absolute-form target (arbitrary proxy)', absolute.status === 400, absolute.status);
const protoRel = await raw(`GET //evil.test/api/v1 HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
check('refuses a protocol-relative target', protoRel.status === 400, protoRel.status);
const connectM = await raw(`CONNECT evil.test:443 HTTP/1.1\r\nHost: evil.test:443\r\n\r\n`);
check('refuses CONNECT tunnels', connectM.status !== 200, connectM.status);
const rebinding = await get('/api/v1/map/capabilities', { host: 'evil.test' });
check('refuses an unexpected Host header (DNS rebinding)', rebinding.status === 421, rebinding.status);
const viaPage = await get('/api/v1/map/capabilities', { host: 'localhost:5199' });
check('accepts the page origin Host (a dev server proxying to this helper)', viaPage.status === 200, viaPage.status);
check('checkTarget accepts the forwarded prefixes only', checkTarget('GET', '/api/x') === null && checkTarget('GET', '/maps/x') === null && checkTarget('GET', '/apix')?.status === 404);

// Wrong trust anchor: verification fails closed, nothing is returned from the upstream.
await proxy.close();
const wrong = createDevProxy({ ...base, caFile: join(w, 'other-ca.crt'), listen: { host: '127.0.0.1', port } });
await new Promise((r) => wrong.server.listen(port, '127.0.0.1', r));
const before = seen.length;
const bad = await get('/api/v1/map/capabilities');
check('wrong CA: 502 and no upstream request completed', bad.status === 502 && /DEV_PROXY_UPSTREAM_ERROR/.test(bad.body) && seen.length === before, `${bad.status} ${bad.body}`);
await wrong.close();

// Cancellation: closing the client aborts the upstream request.
const again = createDevProxy({ ...base, listen: { host: '127.0.0.1', port } });
await new Promise((r) => again.server.listen(port, '127.0.0.1', r));
await raw(`GET /api/slow HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`, { readMs: 400 });
await new Promise((r) => setTimeout(r, 300));
check('client disconnect cancels the upstream request', upstreamClosed === 1, upstreamClosed);
await again.close();
upstream.close();
rmSync(w, { recursive: true, force: true });

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
