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
// Lab hosts: a deliberate sink default route on an --internal network, plus real host probes.
const sinkOk = { HOST_SINK_ROUTE: '1', SINK_GATEWAY: '198.18.0.250', CONTROLLED_SINKS: '198.18.10.250:9 10.250.0.10:9', HOST_CONTROL: '198.18.0.60:8443' };
run('host only, sink route on an internal network, sink absent, probes refused, control connects', { edge: false, env: sinkOk, want: 0 });
run('host + edge, sink-routed host and a valid edge', { env: sinkOk, want: 0 });
run('host only, sink route but SINK_GATEWAY not declared (counts as routable)', { edge: false, env: { ...sinkOk, SINK_GATEWAY: '' }, want: 1 });
run('host only, sink route on a network that is not internal', { edge: false, env: { ...sinkOk, NET_NOT_INTERNAL: '1' }, want: 1 });
run('host only, the sink address answers', { edge: false, env: { ...sinkOk, SINK_PRESENT: '1' }, want: 1 });
// Review c73db85 R3: only positive evidence proves the sink absent; tool errors are failures.
run('host only, ping missing in the host (exit 127)', { edge: false, env: { ...sinkOk, PING_MISSING: '1' }, want: 1 });
run('host only, the sink probe exec fails (daemon error)', { edge: false, env: { ...sinkOk, SINK_PROBE_EXEC_FAIL: '1' }, want: 1 });
run('host only, the sink is silent to ICMP but resolves at the link layer', { edge: false, env: { ...sinkOk, NEIGH_LLADDR: '1' }, want: 1 });
run('host only, no neighbour resolution result (inconclusive)', { edge: false, env: { ...sinkOk, NEIGH_EMPTY: '1' }, want: 1 });
run('host only, ip neigh fails', { edge: false, env: { ...sinkOk, NEIGH_ERROR: '1' }, want: 1 });
run("host only, Docker's inventory lists the sink address", { edge: false, env: { ...sinkOk, SINK_IN_INVENTORY: '1' }, want: 1 });
run("host only, Docker's address inventory cannot be read", { edge: false, env: { ...sinkOk, NET_INVENTORY_FAIL: '1' }, want: 1 });
run('host only, network Internal flag cannot be read', { edge: false, env: { ...sinkOk, NET_INTERNAL_FAIL: '1' }, want: 1 });
run('host only, a NEW connection to a controlled sink succeeds', { edge: false, env: { ...sinkOk, HOST_SINK_OK: '10.250.0.10:9' }, want: 1 });
run('host only, nc missing on the host (tool error)', { edge: false, env: { ...sinkOk, HOST_NC_MISSING: '1' }, want: 1 });
run('host only, the control destination does not connect', { edge: false, env: { ...sinkOk, HOST_CONTROL_DOWN: '1' }, want: 1 });

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# script=${script} checks=${results.length} failed=${failed}`);
rmSync(w, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
