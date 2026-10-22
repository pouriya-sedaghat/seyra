#!/usr/bin/env node
// Seyra web development proxy (example for the web client developer; no dependencies, Node >= 20).
//
//   node seyra-dev-proxy.mjs --config dev-proxy.json
//
// Lets a web app under development (served from its own dev origin) use the Seyra ingress as if it
// were same-origin, without any CORS grant on Seyra:
//   - forwards ONLY /api/ and /maps/ to ONE configured Seyra origin over HTTPS, verifying the server
//     certificate against the configured Seyra CA file (no way to disable verification);
//   - rewrites exactly the configured Seyra origin to the configured page origin in TileJSON and
//     MapLibre style documents, so tiles, glyphs/fonts and sprites also load through this proxy;
//   - listens on loopback only (a proxy reachable by other machines would bypass the Seyra subnet
//     allowlist) and accepts only expected Host headers (DNS-rebinding protection);
//   - never forwards cookies, credentials, Origin/Referer or forwarding headers, and never trusts a
//     client-supplied Host/X-Forwarded-Host for anything.
//
// Config (all fields required; no ports are assumed):
//   { "seyraOrigin": "https://<seyra-host>:<port>", "caFile": "<path to the Seyra CA certificate>",
//     "listen": { "host": "127.0.0.1", "port": <port> }, "pageOrigin": "http://localhost:<dev-port>" }
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const REWRITE = /^\/maps\/[a-z0-9][a-z0-9-]{2,79}\/(tiles\.json|styles\/(light|dark)-(fa|en)\.json)$/;
const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'accept-encoding', 'content-type', 'content-length', 'if-none-match', 'if-modified-since', 'cache-control'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);
const MAX_REWRITE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 135_000; // above the ingress proxy_read_timeout (130 s)

function origin(value, what, { https }) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${what} is not a URL: ${JSON.stringify(value)}`);
  }
  if (https ? u.protocol !== 'https:' : !['http:', 'https:'].includes(u.protocol)) throw new Error(`${what} must use ${https ? 'https' : 'http or https'}`);
  if (u.username || u.password) throw new Error(`${what} must not contain credentials`);
  if (u.pathname !== '/' || u.search || u.hash || value.endsWith('/')) throw new Error(`${what} must be an origin only (scheme://host[:port], no path or trailing slash)`);
  if (u.hostname.includes('*')) throw new Error(`${what} must not contain wildcards`);
  return u;
}

export function loadConfig(cfg) {
  const seyra = origin(cfg.seyraOrigin, 'seyraOrigin', { https: true });
  const page = origin(cfg.pageOrigin, 'pageOrigin', { https: false });
  if (!cfg.caFile) throw new Error('caFile (the Seyra CA certificate) is required; certificate verification cannot be disabled');
  const ca = readFileSync(cfg.caFile);
  if (/PRIVATE KEY/.test(ca.toString('utf8'))) throw new Error('caFile contains a private key; give the public CA certificate only');
  const host = cfg.listen?.host;
  const port = cfg.listen?.port;
  if (!host || !(isIP(host) === 4 ? host.startsWith('127.') : host === '::1')) throw new Error('listen.host must be a loopback address (127.0.0.1 or ::1); a LAN-reachable proxy would bypass the Seyra network allowlist');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('listen.port must be set explicitly (1-65535)');
  const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`, page.host]);
  return { seyra, page, ca, host, port, allowedHosts, seyraBase: `${seyra.origin}/`, pageBase: `${page.origin}/` };
}

const jsonError = (res, status, code, message) => {
  const body = JSON.stringify({ error: { code, message } });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
};

/** Origin-form path limited to /api/ and /maps/; no dot segments (raw or encoded), no backslashes. */
export function checkTarget(method, url) {
  if (method === 'CONNECT') return { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'CONNECT is not supported' };
  if (!url.startsWith('/') || url.startsWith('//')) return { status: 400, code: 'INVALID_REQUEST', message: 'only origin-form request targets are forwarded' };
  const path = url.split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return { status: 400, code: 'INVALID_REQUEST', message: 'malformed percent-encoding' };
  }
  if (/\\|[\u0000-\u001f]/.test(decoded) || decoded.split('/').some((seg) => seg === '.' || seg === '..')) return { status: 400, code: 'INVALID_REQUEST', message: 'dot segments and control characters are not forwarded' };
  const api = path.startsWith('/api/');
  const maps = path.startsWith('/maps/');
  if (!api && !maps) return { status: 404, code: 'NOT_FOUND', message: 'this development proxy forwards /api/ and /maps/ only' };
  const allowed = api ? ['GET', 'HEAD', 'POST'] : ['GET', 'HEAD'];
  if (!allowed.includes(method)) return { status: 405, code: 'METHOD_NOT_ALLOWED', message: `${method} is not forwarded for ${api ? '/api/' : '/maps/'}` };
  return null;
}

export function createDevProxy(cfg) {
  const c = loadConfig(cfg);
  const agent = new Agent({ keepAlive: true, ca: c.ca, rejectUnauthorized: true, maxSockets: 16 });
  const servername = isIP(c.seyra.hostname) ? undefined : c.seyra.hostname;
  const server = createServer((req, res) => {
    if (!c.allowedHosts.has(String(req.headers.host ?? '').toLowerCase())) return jsonError(res, 421, 'MISDIRECTED_REQUEST', 'unexpected Host header for this development proxy');
    const bad = checkTarget(req.method, req.url);
    if (bad) return jsonError(res, bad.status, bad.code, bad.message);
    const path = req.url.split('?')[0];
    const rewrite = REWRITE.test(path);
    const headers = { host: c.seyra.host };
    for (const h of FORWARD_REQUEST_HEADERS) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
    if (rewrite) headers['accept-encoding'] = 'identity'; // the body is rewritten below
    const up = httpsRequest({ agent, host: c.seyra.hostname, port: c.seyra.port || 443, servername, method: req.method, path: req.url, headers, timeout: UPSTREAM_TIMEOUT_MS }, (ur) => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP_BY_HOP.has(k)) out[k] = v;
      if (!rewrite || ur.statusCode !== 200) {
        res.writeHead(ur.statusCode, out);
        ur.pipe(res);
        return;
      }
      const chunks = [];
      let size = 0;
      ur.on('data', (d) => {
        size += d.length;
        if (size > MAX_REWRITE_BYTES) {
          ur.destroy();
          return jsonError(res, 502, 'DEV_PROXY_UPSTREAM_ERROR', 'map document larger than expected');
        }
        chunks.push(d);
      });
      ur.on('end', () => {
        if (res.headersSent) return;
        // Exact-origin rewrite: only "<seyraOrigin>/" is replaced, so look-alike hosts stay untouched.
        const body = Buffer.from(Buffer.concat(chunks).toString('utf8').split(c.seyraBase).join(c.pageBase));
        delete out['content-encoding'];
        out['content-length'] = String(body.length);
        res.writeHead(200, out);
        res.end(body);
      });
    });
    up.on('timeout', () => up.destroy(new Error('upstream timeout')));
    up.on('error', (e) => {
      if (!res.headersSent) jsonError(res, 502, 'DEV_PROXY_UPSTREAM_ERROR', `Seyra upstream failed: ${e.code ?? e.message}`);
      else res.destroy();
    });
    // Cancellation: a client that goes away aborts the upstream request.
    res.on('close', () => {
      if (!res.writableFinished) up.destroy();
    });
    req.pipe(up);
  });
  return { server, config: c, close: () => new Promise((r) => { agent.destroy(); server.close(() => r()); }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--config');
  if (i < 0) {
    console.error('usage: seyra-dev-proxy.mjs --config dev-proxy.json');
    process.exit(2);
  }
  try {
    const { server, config } = createDevProxy(JSON.parse(readFileSync(process.argv[i + 1], 'utf8')));
    server.listen(config.port, config.host, () => console.log(`seyra dev proxy: http://${config.host}:${config.port} -> ${config.seyra.origin} (/api/, /maps/; map URLs rewritten to ${config.page.origin})`));
  } catch (e) {
    console.error(`seyra dev proxy: ${e.message}`);
    process.exit(2);
  }
}
