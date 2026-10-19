// Client side of the disposable relay rehearsal (tests/rehearsal/handoff-rehearsal.sh). Runs in a
// container on one of the rehearsal networks and checks what that position must and must not get.
//
//   node relay-client.mjs <role> <config.json> <out.json>
//
// role approved  (an address inside the approved stand-in subnet, via the published edge port):
//                 every path class is served with real TLS for the rehearsal name; unknown Host and
//                 the control-path name get 421; spoofed forwarding headers change nothing; hidden
//                 diagnostics variants are never served; an oversized body gets the typed 413 that
//                 validates against the exported schema; the served spec equals the export.
//                 A direct connection to the inner listeners (bypassing the edge) gets no response.
//      outsider  (outside the approved subnet, via the published edge port, or an address where
//                 nothing may be published): no HTTP response, also with spoofed forwarding headers.
//      forger    (a container on the lab network, directly to the inner relay listener): a forged
//                 PROXY header claiming the approved client gets 403 on every path class; missing
//                 or malformed PROXY headers get no response; the ordinary listener is not reachable
//                 from the lab network.
//      control   (inside the host's namespace, the ordinary loopback listener): served without a
//                 PROXY header; it must not depend on the relay.
//      closed    (a lab-network container after rollback): the relay listener no longer answers,
//                 with or without a PROXY header naming the approved client.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const [role, cfgPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const CA = readFileSync(cfg.ca);
const results = [];
const PATHS = ['/health/live', '/', '/api/docs/', '/api/docs/json', '/api/v1/map/capabilities', `/maps/${cfg.datasetId}/tiles.json`, `/maps/${cfg.datasetId}/tiles/14/8192/8191.pbf`, '/licenses/vazirmatn-ofl.txt'];
const check = (name, ok, detail = '') => results.push({ name: `${role}: ${name}`, ok: Boolean(ok), detail: String(detail).slice(0, 300) });

function request({ host, port, sni = cfg.sni, hostHeader = cfg.hostHeader, path = '/health/live', method = 'GET', headers = {}, body = null, prefix = null, timeoutMs = 6000 }) {
  return new Promise((res) => {
    const sock = connect({ host, port });
    let finished = false;
    const done = (r) => {
      if (finished) return;
      finished = true;
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
      const t = tlsConnect({ socket: sock, ca: CA, servername: /^[0-9.]+$/.test(sni) ? undefined : sni, ALPNProtocols: ['http/1.1'] });
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
        const hdrs = {};
        for (const l of lines.slice(1)) {
          const i = l.indexOf(':');
          (hdrs[l.slice(0, i).trim().toLowerCase()] ??= []).push(l.slice(i + 1).trim());
        }
        const status = Number(lines[0]?.split(' ')[1]) || null;
        done({ status, headers: hdrs, body: rest.join('\r\n\r\n'), peerFingerprint: t.getPeerCertificate()?.fingerprint256, error: status ? null : 'no HTTP response' });
      });
      t.on('secureConnect', () => {
        const h = { Host: hostHeader, Connection: 'close', ...headers };
        if (body !== null) h['Content-Length'] = Buffer.byteLength(body);
        t.write(`${method} ${path} HTTP/1.0\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (body !== null) t.write(body);
      });
    });
  });
}

try {
  if (role === 'approved') {
    const E = { host: cfg.edge.host, port: cfg.edge.port };
    const exported = JSON.parse(readFileSync(cfg.exportedSpec, 'utf8'));
    const Ajv = createRequire(cfg.ajvFrom)('ajv');
    const ajv = new (Ajv.default ?? Ajv)({ strict: false });
    const csp = cfg.csp;
    const ds = cfg.datasetId;
    const base = `https://${cfg.hostHeader}`;
    const ready = await request({ ...E, path: '/health/ready' });
    check('readiness 200 through edge and relay, with real TLS for the rehearsal name', ready.status === 200 && JSON.parse(ready.body).dataset_id === ds, `${ready.status} ${ready.error ?? ''}`);
    check('served certificate is the imported rehearsal certificate', ready.peerFingerprint === cfg.expectedFingerprint, `${ready.peerFingerprint} != ${cfg.expectedFingerprint}`);
    for (const [path, want, extra] of [
      ['/api/v1/map/capabilities', 200, (r) => JSON.parse(r.body).dataset_id === ds],
      ['/api/docs/', 200, (r) => r.headers['content-security-policy']?.length === 1 && r.headers['content-security-policy'][0] === csp],
      ['/api/docs/json', 200, (r) => JSON.stringify(JSON.parse(r.body)) === JSON.stringify(exported)],
      [`/maps/${ds}/tiles.json`, 200, (r) => r.body.includes(`${base}/maps/${ds}/tiles/`)],
      [`/maps/${ds}/styles/light-fa.json`, 200, (r) => r.body.includes(`"glyphs":"${base}/maps/${ds}/fonts/`) && !r.body.includes('__SEYRA_BASE__')],
      [`/maps/${ds}/tiles/14/8192/8191.pbf`, null, (r) => [200, 204].includes(r.status)],
      [`/maps/${ds}/sprites/light.json`, 200],
      [`/maps/${ds}/fonts/Vazirmatn%20Regular/0-255.pbf`, 200],
      ['/licenses/vazirmatn-ofl.txt', 200],
      ['/', 200],
    ]) {
      const r = await request({ ...E, path });
      check(`${path} served`, (want === null || r.status === want) && (!extra || extra(r)), `${r.status} ${r.error ?? ''}`);
    }
    check('unknown Host (valid SNI) gets 421', (await request({ ...E, hostHeader: 'unknown.example.test' })).status === 421);
    check('the control-path name localhost gets 421 on the relay', (await request({ ...E, hostHeader: 'localhost' })).status === 421);
    const spoof = await request({ ...E, headers: { 'X-Forwarded-For': cfg.outsiderAddress, 'X-Real-IP': cfg.outsiderAddress, Forwarded: `for=${cfg.outsiderAddress}` } });
    check('spoofed forwarding headers naming an outsider change nothing', spoof.status === 200, spoof.status);
    let diagServed = 0;
    for (const path of ['/api/v1/map/diagnostics', '/api/v1/map/diagnostics/', '/api/v1/map//diagnostics', '/api/v1/map/%64iagnostics', '/health/../api/v1/map/diagnostics', '/api/v1/map/x/../diagnostics']) {
      for (const method of ['GET', 'HEAD']) {
        const r = await request({ ...E, path, method });
        if (r.status === null || /provider_queues|uptime_s/.test(r.body ?? '') || (r.status === 200 && !/^text\/html/.test(r.headers['content-type']?.[0] ?? ''))) diagServed++;
      }
    }
    check('12 diagnostics variants (GET/HEAD) are never served', diagServed === 0, diagServed);
    for (const port of [cfg.relay.port, 8443]) {
      const r = await request({ host: cfg.relay.host, port, timeoutMs: 4000 });
      check(`direct bypass of the edge to ${cfg.relay.host}:${port}: no response`, r.status === null, `${r.status} ${r.error}`);
    }
    const big = await request({ ...E, path: '/api/v1/map/route', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(70 * 1024) }) });
    const v = ajv.compile(exported.paths['/api/v1/map/route'].post.responses['413'].content['application/json'].schema);
    let b413 = null;
    try {
      b413 = JSON.parse(big.body);
    } catch {}
    check('oversized body: typed 413 validating against the exported schema', big.status === 413 && b413 && v(b413) && /^[0-9a-f]{32}$/.test(b413.error.request_id), `${big.status} ${big.body?.slice(0, 120)}`);
  } else if (role === 'outsider') {
    const spoofed = { 'X-Forwarded-For': cfg.approvedAddress, 'X-Real-IP': cfg.approvedAddress, Forwarded: `for=${cfg.approvedAddress}` };
    for (const path of PATHS) {
      const r = await request({ host: cfg.edge.host, port: cfg.edge.port, path, timeoutMs: 4000 });
      check(`no HTTP response for ${path}`, r.status === null, `${r.status} ${r.error}`);
    }
    const s = await request({ host: cfg.edge.host, port: cfg.edge.port, headers: spoofed, timeoutMs: 4000 });
    check('forwarding headers naming the approved client do not help', s.status === null, `${s.status} ${s.error}`);
  } else if (role === 'forger') {
    const R = { host: cfg.relay.host, port: cfg.relay.port };
    const claim = `PROXY TCP4 ${cfg.approvedAddress} ${cfg.relay.host} 50000 ${cfg.relay.port}\r\n`;
    const not403 = [];
    for (const path of PATHS) {
      const forged = await request({ ...R, path, prefix: claim, headers: { 'X-Forwarded-For': cfg.approvedAddress } });
      if (forged.status !== 403) not403.push(`${path}=${forged.status ?? forged.error}`);
    }
    check(`untrusted peer forging the approved client gets 403 on ${PATHS.length} path classes`, not403.length === 0, not403.join(' '));
    const none = await request({ ...R });
    check('no PROXY header gets no HTTP response', none.status === null, `${none.status} ${none.error}`);
    const bad = await request({ ...R, prefix: 'PROXY TCP4 not-an-address\r\n' });
    check('malformed PROXY header gets no HTTP response', bad.status === null, `${bad.status} ${bad.error}`);
    const ctl = await request({ host: cfg.relay.host, port: 8443, timeoutMs: 4000 });
    check('the ordinary listener is not reachable from the lab network', ctl.status === null, `${ctl.status} ${ctl.error}`);
  } else if (role === 'closed') {
    const R = { host: cfg.relay.host, port: cfg.relay.port, timeoutMs: 4000 };
    const claim = `PROXY TCP4 ${cfg.approvedAddress} ${cfg.relay.host} 50000 ${cfg.relay.port}\r\n`;
    const a = await request({ ...R, prefix: claim });
    check('after rollback a PROXY header naming the approved client gets no response', a.status === null, `${a.status} ${a.error}`);
    const b = await request({ ...R });
    check('after rollback the relay port gets no response', b.status === null, `${b.status} ${b.error}`);
  } else if (role === 'control') {
    const C = { host: '127.0.0.1', port: 8443 };
    const r = await request({ ...C, path: '/health/ready', hostHeader: cfg.controlHost ?? cfg.sni });
    check('ordinary loopback listener serves readiness without a PROXY header', r.status === 200, `${r.status} ${r.error ?? ''}`);
  } else throw new Error(`unknown role ${role}`);
} catch (e) {
  check('client completed', false, e.stack ?? e);
}
writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail}`}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
