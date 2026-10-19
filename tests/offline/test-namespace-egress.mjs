// Regression for review H3 (6602199): tests/offline/namespace-egress.sh must exit non-zero for any
// failed required assertion, and must never count a tool/exec failure as a successful denial.
//
//   node tests/offline/test-namespace-egress.mjs [path/to/namespace-egress.sh]
//
// Runs the ACTUAL script with a controlled `docker` stand-in first on PATH: it answers route
// lookups, guard counters, connection probes and sink lifecycle from per-scenario settings and
// records every call. No container, namespace or network is touched; the real Docker namespace
// verification stays part of the separately approved rehearsal.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'namespace-egress.sh'));
const w = mkdtempSync(join(tmpdir(), 'seyra-egress-test-'));
const bin = join(w, 'bin');
mkdirSync(bin);
// Scenario knobs (env, see stubs/docker-egress.sh): HOST_ROUTABLE (one destination answered as routable), HOST_EXEC_FAIL,
// FORBIDDEN_OK (a forbidden destination connects), COUNTER=missing|frozen, UPSTREAM_DOWN, NC_MISSING,
// RUN_FAIL (docker run for probes fails without running the probe).
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'stubs', 'docker-egress.sh'), join(bin, 'docker'));
chmodSync(join(bin, 'docker'), 0o755);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const UPSTREAM = '198.18.0.2:8444';
let n = 0;
function run(name, { edge = true, env = {}, want }) {
  n++;
  const out = join(w, `out-${n}`);
  const files = { STUB_LOG: join(w, `log-${n}`), STUB_STATE: join(w, `state-${n}`), STUB_REMOVED: join(w, `removed-${n}`) };
  const args = edge ? [script, out, 'disposable-host', 'disposable-edge', UPSTREAM, 'guard:test'] : [script, out, 'disposable-host'];
  const r = spawnSync('bash', args, { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APPROVED_SAMPLE: '192.0.2.10', UPSTREAM, ...files, ...env }, encoding: 'utf8', timeout: 30_000 });
  const summary = existsSync(join(out, 'summary.txt')) ? readFileSync(join(out, 'summary.txt'), 'utf8') : '';
  const ok = want === 0 ? r.status === 0 : r.status !== 0 && r.status !== null;
  check(`${name}: exit ${want === 0 ? '0' : 'non-zero'}`, ok, `rc=${r.status} ${summary.trim().split('\n').filter((l) => /FAIL|failures/.test(l)).join(' | ') || summary.trim().slice(-200)}`);
  return { r, summary, removed: existsSync(files.STUB_REMOVED) ? readFileSync(files.STUB_REMOVED, 'utf8').trim().split('\n').filter(Boolean) : [], log: existsSync(files.STUB_LOG) ? readFileSync(files.STUB_LOG, 'utf8') : '' };
}

run('host only, isolated', { edge: false, want: 0 });
run('host only, one destination routable', { edge: false, env: { HOST_ROUTABLE: '10.0.0.1' }, want: 1 });
run('host only, docker exec fails (tool error is not isolation)', { edge: false, env: { HOST_EXEC_FAIL: '1' }, want: 1 });
const valid = run('host + edge, all checks hold', { want: 0 });
check('host + edge valid: only this run\'s sinks are removed', valid.removed.length === 2 && valid.removed.every((s) => /^seyra-egress-sink-(seyra_edge|seyra_offline_lab)-\d+$/.test(s)), valid.removed.join(','));
check('host + edge valid: no container other than test sinks is removed', !/docker rm -f (?!seyra-egress-sink-)/.test(valid.log));
run('host + edge, a forbidden connection succeeds', { env: { FORBIDDEN_OK: '198.51.100.1:443' }, want: 1 });
run('host + edge, guard counter missing', { env: { COUNTER: 'missing' }, want: 1 });
run('host + edge, guard counter unchanged', { env: { COUNTER: 'frozen' }, want: 1 });
run('host + edge, allowed upstream unreachable', { env: { UPSTREAM_DOWN: '1' }, want: 1 });
run('host + edge, nc missing in the probe image', { env: { NC_MISSING: '1' }, want: 1 });
run('host + edge, probe container cannot run', { env: { RUN_FAIL: '1' }, want: 1 });
run('host + edge, routable host even though the edge is fine', { env: { HOST_ROUTABLE: '172.16.0.1' }, want: 1 });

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# script=${script} checks=${results.length} failed=${failed}`);
rmSync(w, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
