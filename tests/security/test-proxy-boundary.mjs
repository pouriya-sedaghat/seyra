// Ingress and relay boundary test with the exact locked proxy image's nginx binary (extracted by
// tests/security/extract-image-nginx.sh; no container is created or started) and the real Fastify
// API as its upstream. Everything listens on 127.0.0.1 with test ports; distinct 127.0.0.x source
// addresses stand for the approved client, an outsider, an untrusted peer and the relay.
//
//   node tests/security/test-proxy-boundary.mjs <extracted-dir>     (Node 24, openssl, envsubst)
//
// Covers: config rendering refusals, nginx -t of every mode, the local control path without PROXY
// headers, edge -> relay -> API end to end, untrusted peers forging approved addresses, absent and
// malformed PROXY headers, client-supplied PROXY headers through the edge, spoofed HTTP forwarding
// headers, direct bypass of the edge, unknown Host, the hidden diagnostics route and its path
// variants, the typed 413, the single ingress CSP, and every path class behind the same boundary.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extracted = resolve(process.argv[2] ?? '');
const nginxBin = join(extracted, 'nginx');
if (!existsSync(nginxBin)) {
  console.log(`NOT RUN: no extracted nginx at ${extracted} (run tests/security/extract-image-nginx.sh first)`);
  process.exit(3);
}
const imageId = readFileSync(join(extracted, 'image-id.txt'), 'utf8').trim();
const w = mkdtempSync(join(tmpdir(), 'seyra-proxy-boundary-'));
const DS = 'ds-20261019-boundary0001';
const LAN_NAME = 'seyra-lan.test';
const APPROVED = '127.0.0.8/29'; // test stand-in for the approved client subnet
const CLIENT = '127.0.0.10';
const OUTSIDER = '127.0.0.20';
const RELAY = '127.0.0.2';
const UNTRUSTED = '127.0.0.3';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const children = [];
const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

// ---------------------------------------------------------------------------------------------
// Fixtures: temporary TLS material, release map metadata, web root, assets.
// ---------------------------------------------------------------------------------------------
const tls = join(w, 'tls');
mkdirSync(tls);
const ossl = (...a) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'pipe'] });
ossl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(tls, 'ca.key'), '-out', join(tls, 'ca.crt'), '-days', '2', '-subj', '/CN=boundary test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign');
ossl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(tls, 'server.key'), '-out', join(tls, 'server.csr'), '-subj', `/CN=${LAN_NAME}`);
writeFileSync(join(tls, 'ext'), `basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${LAN_NAME},DNS:localhost,IP:127.0.0.1\n`);
ossl('x509', '-req', '-in', join(tls, 'server.csr'), '-CA', join(tls, 'ca.crt'), '-CAkey', join(tls, 'ca.key'), '-CAcreateserial', '-out', join(tls, 'server.crt'), '-days', '1', '-extfile', join(tls, 'ext'));
const CA = readFileSync(join(tls, 'ca.crt'));
const maps = join(w, 'maps');
mkdirSync(join(maps, 'styles'), { recursive: true });
writeFileSync(join(maps, 'tiles.json'), JSON.stringify({ tilejson: '3.0.0', tiles: [`__SEYRA_BASE__/maps/${DS}/tiles/{z}/{x}/{y}.pbf`] }));
writeFileSync(join(maps, 'styles', 'light-fa.json'), JSON.stringify({ version: 8, sources: { s: { type: 'vector', url: `__SEYRA_BASE__/maps/${DS}/tiles.json` } }, glyphs: `__SEYRA_BASE__/maps/${DS}/fonts/{fontstack}/{range}.pbf`, sprite: `__SEYRA_BASE__/maps/${DS}/sprites/light` }));
const web = join(w, 'web');
mkdirSync(join(web, 'assets'), { recursive: true });
writeFileSync(join(web, 'index.html'), '<!doctype html><title>seyra test client</title>');
const assets = join(w, 'assets');
mkdirSync(join(assets, 'fonts', 'Vazirmatn Regular'), { recursive: true });
mkdirSync(join(assets, 'sprites'), { recursive: true });
mkdirSync(join(assets, 'licenses'), { recursive: true });
writeFileSync(join(assets, 'fonts', 'Vazirmatn Regular', '0-255.pbf'), 'glyphs');
writeFileSync(join(assets, 'sprites', 'light.json'), '{}');
writeFileSync(join(assets, 'licenses', 'Vazirmatn-OFL.txt'), 'OFL');

// ---------------------------------------------------------------------------------------------
// Upstreams: the real API (built apps/api/dist) and a tile stub.
// ---------------------------------------------------------------------------------------------
const { buildApp } = await import(pathToFileURL(join(repo, 'apps', 'api', 'dist', 'app.js')));
const { HealthService } = await import(pathToFileURL(join(repo, 'apps', 'api', 'dist', 'services', 'health.js')));
const { DEFAULT_LIMITS } = await import(pathToFileURL(join(repo, 'packages', 'contracts', 'dist', 'index.js')));
let diagnosticsCalls = 0;
const ids = { tiles: 'seyra_ds_20261019_boundary0001', routing: '1', geocoder: 'g', overpass: 'o' };
const health = new HealthService(
  { schema: 'seyra.active-release/1', dataset_id: DS, activated_at: '2026-10-19T00:00:00Z', identities: ids },
  { tiles: async () => ({ identity: ids.tiles }), routing: async () => ({ identity: '1' }), geocoder: async () => ({ identity: 'g' }), overpass: async () => ({ identity: 'o' }), controlDb: async () => undefined },
  { cacheMs: 60_000, probeTimeoutMs: 1000, maintenanceFlagFile: join(w, 'no-maintenance') },
);
await health.refresh();
const api = await buildApp({
  limits: DEFAULT_LIMITS,
  health,
  routing: { route: async () => [], pair: async () => [] },
  geocoder: { search: async () => [], reverse: async () => [] },
  poi: { run: async () => [] },
  geography: { distances: async (_o, p) => p.map(() => 1) },
  logLevel: 'silent',
  providerStats: () => {
    diagnosticsCalls++;
    return {};
  },
});
const apiPort = await freePort();
await api.listen({ host: '127.0.0.1', port: apiPort });
const tilePort = await freePort();
const tileStub = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/vnd.mapbox-vector-tile' });
  res.end(`tile ${req.url}`);
});
await new Promise((r) => tileStub.listen(tilePort, '127.0.0.1', r));

// ---------------------------------------------------------------------------------------------
// Rendering with the real render script; the rendered files are then pointed at test paths.
// ---------------------------------------------------------------------------------------------
const proxyDir = join(repo, 'infra', 'images', 'proxy');
function render(env, rundir) {
  rmSync(rundir, { recursive: true, force: true });
  const r = spawnSync('sh', [join(proxyDir, 'render.sh')], {
    env: { PATH: process.env.PATH, SEYRA_NGINX_TEMPLATES: proxyDir, SEYRA_NGINX_RUNDIR: rundir, SEYRA_DATASET_ID: DS, SEYRA_BIND_ADDR: '127.0.0.1', ...env },
    encoding: 'utf8',
  });
  return { code: r.status, stderr: r.stderr, relay: existsSync(join(rundir, 'conf.d', 'relay.conf')), nginx: existsSync(join(rundir, 'nginx.conf')) };
}
function localize(rundir, ports) {
  for (const f of ['nginx.conf', 'locations.conf', 'conf.d/relay.conf']) {
    const p = join(rundir, f);
    if (!existsSync(p)) continue;
    let s = readFileSync(p, 'utf8');
    s = s
      .replaceAll('/tmp/nginx/', `${rundir}/`)
      .replaceAll('/run/secrets/tls_cert', join(tls, 'server.crt'))
      .replaceAll('/run/secrets/tls_key', join(tls, 'server.key'))
      .replaceAll('/etc/seyra/', `${proxyDir}/`)
      .replaceAll('/etc/nginx/mime.types', join(extracted, 'root', 'etc', 'nginx', 'mime.types'))
      .replaceAll('/var/cache/seyra/tiles', join(rundir, 'cache'))
      .replaceAll('/srv/seyra/release/maps/', `${maps}/`)
      .replaceAll('/usr/share/seyra/web', web)
      .replaceAll('/usr/share/seyra/assets/', `${assets}/`)
      .replace('worker_processes auto;', 'worker_processes 1;')
      .replace('error_log /dev/stderr warn;', `error_log ${rundir}/error.log warn;`)
      .replace('access_log /dev/stdout seyra;', `access_log ${rundir}/access.log seyra;`)
      .replace('server api:3000;', `server 127.0.0.1:${apiPort};`)
      .replace('server tegola:8080;', `server 127.0.0.1:${tilePort};`)
      .replaceAll('listen 8443 ', `listen 127.0.0.1:${ports.control} `)
      .replaceAll('listen 8444 ', `listen 127.0.0.1:${ports.relay} `);
    writeFileSync(p, s);
  }
  mkdirSync(join(rundir, 'cache'), { recursive: true });
  mkdirSync(join(rundir, 'logs'), { recursive: true });
}
const nginxTest = (prefix, conf) => spawnSync(nginxBin, ['-p', prefix, '-e', join(dirname(conf), 'startup.log'), '-c', conf, '-t'], { encoding: 'utf8' });
async function startNginx(prefix, conf) {
  mkdirSync(join(prefix, 'logs'), { recursive: true });
  const t = nginxTest(prefix, conf);
  if (t.status !== 0) throw new Error(`nginx -t failed: ${t.stderr}`);
  const child = spawn(nginxBin, ['-p', prefix, '-e', join(dirname(conf), 'startup.log'), '-c', conf, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  children.push(child);
  await new Promise((r) => setTimeout(r, 300));
  if (child.exitCode !== null) throw new Error(`nginx exited: ${err}`);
  return child;
}

// ---------------------------------------------------------------------------------------------
// Client: raw TCP from a chosen source address, optional raw prefix (PROXY header), then TLS + HTTP/1.0.
// ---------------------------------------------------------------------------------------------
function request({ port, from = '127.0.0.1', host = LAN_NAME, sni = null, path = '/health/live', method = 'GET', headers = {}, body = null, prefix = null, timeoutMs = 4000 }) {
  return new Promise((res) => {
    const sock = connect({ host: '127.0.0.1', port, localAddress: from });
    const done = (r) => {
      sock.destroy();
      res(r);
    };
    const timer = setTimeout(() => done({ status: null, error: 'timeout' }), timeoutMs);
    sock.on('error', (e) => {
      clearTimeout(timer);
      done({ status: null, error: e.code ?? e.message });
    });
    sock.on('connect', () => {
      if (prefix) sock.write(prefix);
      // SNI is a valid certificate name; the Host header may differ (Host-header injection cases).
      const name = sni ?? host.split(':')[0];
      const t = tlsConnect({ socket: sock, ca: CA, servername: /^[0-9.]+$/.test(name) ? undefined : name, ALPNProtocols: ['http/1.1'] });
      let raw = Buffer.alloc(0);
      t.on('error', (e) => {
        clearTimeout(timer);
        done({ status: null, error: e.code ?? e.message });
      });
      t.on('data', (d) => (raw = Buffer.concat([raw, d])));
      t.on('end', () => {
        clearTimeout(timer);
        const text = raw.toString('utf8');
        const [head, ...rest] = text.split('\r\n\r\n');
        const lines = head.split('\r\n');
        const status = Number(lines[0]?.split(' ')[1]) || null;
        const hdrs = {};
        for (const l of lines.slice(1)) {
          const i = l.indexOf(':');
          const k = l.slice(0, i).trim().toLowerCase();
          (hdrs[k] ??= []).push(l.slice(i + 1).trim());
        }
        done({ status, headers: hdrs, body: rest.join('\r\n\r\n'), error: status ? null : 'no HTTP response' });
      });
      t.on('secureConnect', () => {
        const h = { Host: host, Connection: 'close', ...headers };
        if (body !== null) h['Content-Length'] = Buffer.byteLength(body);
        t.write(`${method} ${path} HTTP/1.0\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (body !== null) t.write(body);
      });
    });
  });
}
const proxyV1 = (src, dst = '127.0.0.1') => `PROXY TCP4 ${src} ${dst} 50000 443\r\n`;

try {
  // ------------------------------------------------------------------------------------------
  // 1. Rendering refusals (fail closed, nothing rendered).
  // ------------------------------------------------------------------------------------------
  const relayEnv = { SEYRA_ACCESS_MODE: 'loopback', SEYRA_RELAY_PEER: RELAY, SEYRA_RELAY_CLIENT_CIDRS: APPROVED, SEYRA_RELAY_SERVER_NAMES: LAN_NAME };
  const refusals = [
    ['relay with lan access mode', { ...relayEnv, SEYRA_ACCESS_MODE: 'lan', SEYRA_BIND_ADDR: '10.20.0.15', SEYRA_LAN_ALLOW_CIDRS: '10.20.0.0/24' }, /requires loopback access mode/],
    ['relay peer without client CIDRs', { SEYRA_RELAY_PEER: RELAY, SEYRA_RELAY_SERVER_NAMES: LAN_NAME }, /together/],
    ['relay CIDRs without a peer', { SEYRA_RELAY_CLIENT_CIDRS: APPROVED, SEYRA_RELAY_SERVER_NAMES: LAN_NAME }, /together/],
    ['relay peer is not an address', { ...relayEnv, SEYRA_RELAY_PEER: '198.18.0.0/15' }, /invalid SEYRA_RELAY_PEER/],
    ['relay peer out of range', { ...relayEnv, SEYRA_RELAY_PEER: '300.1.1.1' }, /invalid SEYRA_RELAY_PEER/],
    ['relay peer 0.0.0.0', { ...relayEnv, SEYRA_RELAY_PEER: '0.0.0.0' }, /one host address/],
    ['relay client CIDR 0.0.0.0/0', { ...relayEnv, SEYRA_RELAY_CLIENT_CIDRS: '0.0.0.0/0' }, /invalid CIDR/],
    ['relay client CIDR not canonical', { ...relayEnv, SEYRA_RELAY_CLIENT_CIDRS: '127.0.0.9/29' }, /invalid CIDR/],
    ['relay client CIDR list with an empty entry', { ...relayEnv, SEYRA_RELAY_CLIENT_CIDRS: `${APPROVED},` }, /empty entry/],
    ['relay peer inside the client allowlist', { ...relayEnv, SEYRA_RELAY_PEER: '127.0.0.9' }, /inside the client allowlist/],
    ['relay server names with localhost', { ...relayEnv, SEYRA_RELAY_SERVER_NAMES: `${LAN_NAME} localhost` }, /loopback name/],
    ['relay server names with 127.0.0.1', { ...relayEnv, SEYRA_RELAY_SERVER_NAMES: '127.0.0.1' }, /loopback name/],
    ['relay server names with a wildcard', { ...relayEnv, SEYRA_RELAY_SERVER_NAMES: '*.test' }, /invalid SEYRA_RELAY_SERVER_NAMES/],
    ['lan mode without CIDRs', { SEYRA_ACCESS_MODE: 'lan', SEYRA_BIND_ADDR: '10.20.0.15' }, /requires SEYRA_LAN_ALLOW_CIDRS/],
    ['lan CIDR with an invalid entry', { SEYRA_ACCESS_MODE: 'lan', SEYRA_BIND_ADDR: '10.20.0.15', SEYRA_LAN_ALLOW_CIDRS: '10.20.0.0/24,300.1.1.0/24' }, /invalid CIDR/],
    ['loopback mode bound to 0.0.0.0', { SEYRA_ACCESS_MODE: 'loopback', SEYRA_BIND_ADDR: '0.0.0.0' }, /non-loopback bind/],
  ];
  for (const [name, env, re] of refusals) {
    const r = render(env, join(w, 'refuse'));
    check(`render refuses: ${name}`, r.code === 2 && re.test(r.stderr) && !r.nginx && !r.relay, `rc=${r.code} ${r.stderr.trim()}`);
  }

  // ------------------------------------------------------------------------------------------
  // 2. nginx -t with the exact image binary: loopback, direct LAN and relay modes; edge config.
  // ------------------------------------------------------------------------------------------
  const ports = { control: await freePort(), relay: await freePort(), edge: await freePort(), wideEdge: await freePort() };
  for (const [mode, env] of [
    ['loopback', { SEYRA_ACCESS_MODE: 'loopback' }],
    ['direct lan', { SEYRA_ACCESS_MODE: 'lan', SEYRA_BIND_ADDR: '10.20.0.15', SEYRA_LAN_ALLOW_CIDRS: '10.20.0.0/24' }],
    ['relay', relayEnv],
  ]) {
    const rd = join(w, `t-${mode.replace(' ', '-')}`);
    const r = render(env, rd);
    localize(rd, ports);
    const t = r.code === 0 ? nginxTest(w, join(rd, 'nginx.conf')) : { status: -1, stderr: r.stderr };
    check(`nginx -t (${mode} mode, image ${imageId.slice(7, 19)})`, t.status === 0, t.stderr.trim().split('\n').slice(-2).join(' '));
  }
  const lanConf = readFileSync(join(w, 't-direct-lan', 'nginx.conf'), 'utf8');
  check('direct LAN mode keeps the allowlist on the ordinary listener and renders no relay', /allow 10\.20\.0\.0\/24;\s+deny all;/.test(lanConf) && !existsSync(join(w, 't-direct-lan', 'conf.d', 'relay.conf')));

  // Start the relay-mode proxy for the behaviour checks.
  const run = join(w, 'run');
  check('relay-mode render', render(relayEnv, run).code === 0);
  localize(run, ports);
  await startNginx(w, join(run, 'nginx.conf'));
  // Edges: the strict one with the approved stand-in subnet, a permissive one (127.0.0.0/24) so the
  // inner boundary can be tested on its own.
  const renderEdge = (cidrs, port, name) => {
    const out = join(w, name);
    const r = spawnSync('sh', [join(repo, 'infra', 'edge', 'render-edge.sh'), out], { env: { PATH: process.env.PATH, EDGE_CLIENT_CIDRS: cidrs, EDGE_UPSTREAM: `127.0.0.1:${ports.relay}`, EDGE_SOURCE: RELAY }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`edge render failed: ${r.stderr}`);
    const p = join(out, 'edge.conf');
    writeFileSync(p, readFileSync(p, 'utf8').replace('listen 8443;', `listen 127.0.0.1:${port};`).replace('/tmp/seyra-edge.pid', `${out}/edge.pid`).replace('error_log /dev/stderr warn;', `error_log ${out}/error.log warn;`));
    return p;
  };
  const strictEdge = renderEdge(APPROVED, ports.edge, 'edge-strict');
  const wideEdge = renderEdge('127.0.0.0/24', ports.wideEdge, 'edge-wide');
  const et = nginxTest(w, strictEdge);
  check(`edge stream config passes nginx -t with the exact image binary (stream + proxy_protocol)`, et.status === 0, et.stderr.trim());
  for (const [bad, re] of [[{ EDGE_CLIENT_CIDRS: '0.0.0.0/0', EDGE_UPSTREAM: '198.18.0.2:8444' }, /invalid CIDR/], [{ EDGE_CLIENT_CIDRS: APPROVED, EDGE_UPSTREAM: 'relay.local:8444' }, /invalid upstream/], [{ EDGE_CLIENT_CIDRS: APPROVED, EDGE_UPSTREAM: '198.18.0.2' }, /IPv4:port/]]) {
    const r = spawnSync('sh', [join(repo, 'infra', 'edge', 'render-edge.sh'), join(w, 'edge-bad')], { env: { PATH: process.env.PATH, ...bad }, encoding: 'utf8' });
    check(`edge render refuses ${JSON.stringify(bad)}`, r.status === 2 && re.test(r.stderr), r.stderr.trim());
  }
  await startNginx(w, strictEdge);
  await startNginx(w, wideEdge);

  // ------------------------------------------------------------------------------------------
  // 3. Local control path (ordinary listener, no PROXY header).
  // ------------------------------------------------------------------------------------------
  const ctl = (o) => request({ port: ports.control, host: 'localhost', ...o });
  check('control path: readiness without a PROXY header', (await ctl({ path: '/health/ready' })).status === 200);
  check('control path: unknown Host (valid SNI) gets 421', (await ctl({ host: 'unknown.test', sni: 'localhost' })).status === 421);
  const ctlDiag = await ctl({ path: '/api/v1/map/diagnostics' });
  check('control path: diagnostics blocked (404 JSON)', ctlDiag.status === 404 && /NOT_FOUND/.test(ctlDiag.body), ctlDiag.status);

  // ------------------------------------------------------------------------------------------
  // 4. End to end: approved client -> edge -> relay listener -> API / map / web.
  // ------------------------------------------------------------------------------------------
  const viaEdge = (o) => request({ port: ports.edge, from: CLIENT, ...o });
  const csp = readFileSync(join(proxyDir, 'security-headers.conf'), 'utf8').match(/Content-Security-Policy "([^"]+)"/)[1];
  const exported = JSON.parse(readFileSync(join(repo, 'docs', 'openapi', 'map-services-v1.json'), 'utf8'));
  for (const [path, want, extra] of [
    ['/health/live', 200],
    ['/health/ready', 200],
    ['/api/v1/map/capabilities', 200],
    ['/api/docs/', 200, (r) => r.headers['content-security-policy']?.length === 1 && r.headers['content-security-policy'][0] === csp],
    ['/api/docs', 200],
    ['/api/docs/static/swagger-ui-bundle.js', 200],
    ['/api/docs/json', 200, (r) => JSON.stringify(JSON.parse(r.body)) === JSON.stringify(exported)],
    [`/maps/${DS}/tiles.json`, 200, (r) => r.body.includes(`https://${LAN_NAME}:${ports.edge}/maps/${DS}/tiles/`)],
    [`/maps/${DS}/styles/light-fa.json`, 200, (r) => !r.body.includes('__SEYRA_BASE__') && r.body.includes(`"glyphs":"https://${LAN_NAME}:${ports.edge}/maps/${DS}/fonts/`)],
    [`/maps/${DS}/tiles/0/0/0.pbf`, 200],
    [`/maps/${DS}/fonts/Vazirmatn Regular/0-255.pbf`.replace(' ', '%20'), 200],
    [`/maps/${DS}/sprites/light.json`, 200],
    ['/maps/ds-other-release/tiles.json', 404, (r) => /DATASET_MISMATCH/.test(r.body)],
    ['/licenses/vazirmatn-ofl.txt', 200],
    ['/', 200],
  ]) {
    const r = await viaEdge({ host: `${LAN_NAME}:${ports.edge}`, path });
    check(`relay e2e: approved client ${path} -> ${want}`, r.status === want && (!extra || extra(r)), `${r.status} ${r.error ?? ''}`);
  }
  check('relay e2e: unknown Host (valid SNI) gets 421', (await viaEdge({ host: 'unknown.test', sni: LAN_NAME })).status === 421);
  check('relay e2e: control-path name localhost as Host gets 421 on the relay listener', (await viaEdge({ host: 'localhost', sni: LAN_NAME })).status === 421);
  const big = await viaEdge({ path: '/api/v1/map/route', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(70 * 1024) }) });
  check('relay e2e: body over 64 KiB gets the typed 413 envelope', big.status === 413 && JSON.parse(big.body).error.code === 'PAYLOAD_TOO_LARGE', `${big.status} ${big.body.slice(0, 80)}`);
  check('relay e2e: spoofed X-Forwarded-For/X-Real-IP/Forwarded naming an outsider are ignored', (await viaEdge({ headers: { 'X-Forwarded-For': OUTSIDER, 'X-Real-IP': OUTSIDER, Forwarded: `for=${OUTSIDER}` } })).status === 200);

  // ------------------------------------------------------------------------------------------
  // 5. Edge boundary: outsiders never reach TLS.
  // ------------------------------------------------------------------------------------------
  const outEdge = await request({ port: ports.edge, from: OUTSIDER });
  check('edge: client outside the approved subnet is dropped before TLS', outEdge.status === null, outEdge.error);

  // ------------------------------------------------------------------------------------------
  // 6. Inner relay boundary on its own (permissive edge in front).
  // ------------------------------------------------------------------------------------------
  const viaWide = (o) => request({ port: ports.wideEdge, ...o });
  const pathClasses = ['/health/live', '/api/v1/map/capabilities', '/api/docs/', '/api/docs/json', `/maps/${DS}/tiles.json`, `/maps/${DS}/tiles/0/0/0.pbf`, `/maps/${DS}/sprites/light.json`, '/licenses/vazirmatn-ofl.txt', '/', '/assets/x.js'];
  for (const path of pathClasses) {
    const r = await viaWide({ from: OUTSIDER, path });
    check(`relay: conveyed outsider address gets 403 for ${path}`, r.status === 403, r.status);
  }
  check('relay: outsider with X-Forwarded-For/X-Real-IP naming an approved client still 403', (await viaWide({ from: OUTSIDER, headers: { 'X-Forwarded-For': CLIENT, 'X-Real-IP': CLIENT, Forwarded: `for=${CLIENT}` } })).status === 403);
  const ownHeader = await viaWide({ from: OUTSIDER, prefix: proxyV1(CLIENT) });
  check('relay: a PROXY header sent by the client through the edge never admits it', ownHeader.status !== 200, `${ownHeader.status} ${ownHeader.error ?? ''}`);

  // ------------------------------------------------------------------------------------------
  // 7. Direct connections to the relay listener.
  // ------------------------------------------------------------------------------------------
  const direct = (o) => request({ port: ports.relay, ...o });
  const forged = await direct({ from: UNTRUSTED, prefix: proxyV1(CLIENT) });
  check('relay: untrusted peer forging an approved client address gets 403', forged.status === 403, `${forged.status} ${forged.error ?? ''}`);
  const bypass = await direct({ from: CLIENT, prefix: proxyV1(CLIENT) });
  check('relay: approved client bypassing the edge gets 403 (peer is not the relay)', bypass.status === 403, `${bypass.status} ${bypass.error ?? ''}`);
  const noHeader = await direct({ from: RELAY });
  check('relay: no PROXY header (even from the relay address) gets no HTTP response', noHeader.status === null, noHeader.error);
  const malformed = await direct({ from: RELAY, prefix: 'PROXY TCP4 not-an-address\r\n' });
  check('relay: malformed PROXY header gets no HTTP response', malformed.status === null, malformed.error);
  const trusted = await direct({ from: RELAY, prefix: proxyV1(CLIENT) });
  check('relay: the configured relay conveying an approved client is admitted', trusted.status === 200, `${trusted.status} ${trusted.error ?? ''}`);
  const trustedOutsider = await direct({ from: RELAY, prefix: proxyV1(OUTSIDER) });
  check('relay: the configured relay conveying an outsider gets 403', trustedOutsider.status === 403, trustedOutsider.status);
  const untrustedUnknownHost = await direct({ from: UNTRUSTED, prefix: proxyV1(CLIENT), host: 'unknown.test', sni: LAN_NAME });
  check('relay: untrusted peer with an unknown Host gets 403, not 421', untrustedUnknownHost.status === 403, untrustedUnknownHost.status);

  // ------------------------------------------------------------------------------------------
  // 8. Hidden diagnostics route: no variant reaches the API.
  // ------------------------------------------------------------------------------------------
  const before = diagnosticsCalls;
  const variants = ['/api/v1/map/diagnostics', '/api/v1/map/diagnostics/', '/api/v1/map/diagnostics?x=1', '/api/v1/map//diagnostics', '/api//v1/map/diagnostics', '/api/v1/map/./diagnostics', '/api/v1/map/x/../diagnostics', '/api/v1/map/%64iagnostics', '/api/v1/map/diagnostic%73', '/api/v1/map/diagnostics%3Fx', '/api/v1%2Fmap%2Fdiagnostics', '/health/../api/v1/map/diagnostics', '/health/%2E%2E/api/v1/map/diagnostics', '/api/v1/map/Diagnostics', '/API/v1/map/diagnostics', '/api/v1/map/diagnostics;x'];
  for (const path of variants) {
    for (const method of ['GET', 'HEAD']) {
      const r = await viaEdge({ path, method });
      // A variant may fall through to the web client's SPA page (200 HTML); it must never be the API's diagnostics JSON.
      check(`diagnostics variant ${method} ${path} is not served`, r.status !== null && !/provider_queues|uptime_s/.test(r.body ?? '') && (r.status !== 200 || /^text\/html/.test(r.headers['content-type']?.[0] ?? '')), `${r.status} ${r.headers?.['content-type'] ?? ''} ${r.error ?? ''}`);
    }
  }
  check('diagnostics: the API handler was never reached through the ingress', diagnosticsCalls === before, `${diagnosticsCalls - before} calls`);
} catch (e) {
  check('harness completed', false, e.stack ?? e);
} finally {
  for (const c of children) c.kill('SIGTERM');
  await api.close();
  tileStub.close();
  await new Promise((r) => setTimeout(r, 200));
  rmSync(w, { recursive: true, force: true });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# image=${imageId} nginx=${extracted} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
