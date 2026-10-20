// Regression: infra/edge/edge.sh stop must not release the edge's lab address while the serving
// installation may still trust it. A stopped container releases its address at once and Docker
// assigns it to the next container (verified on Docker 29). Review c73db85 R2: a refused TCP
// connection to the relay port is NOT evidence that the trust was removed (a stopped or restarting
// proxy keeps its configured relay peer and re-applies it on start), so every case below runs with
// the relay port closed; only positive state evidence may allow an ordinary stop.
//
//   node tests/security/test-edge-stop.mjs [path/to/edge.sh]
//
// Runs the ACTUAL script with a `docker` stand-in first on PATH (no container is touched). The
// stand-in answers the edge's owner label/run state/lab address (outer daemon) and the serving
// installation's proxy container (nested daemon, `-H`): its id list, state and creation time,
// environment and port bindings. A temporary SEYRA_HOME holds state/settings.json and
// state/runtime.env. Every `docker stop` is recorded.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'infra', 'edge', 'edge.sh'));
const w = mkdtempSync(join(tmpdir(), 'seyra-edge-stop-'));
const bin = join(w, 'bin');
mkdirSync(bin);
writeFileSync(
  join(bin, 'docker'),
  `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [ "$1" = -H ]; then
  shift 2
  case "$1 $2" in
    "ps -a") [ -n "\${STUB_PS_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }; printf '%b' "\${STUB_PROXY_IDS-p1\\n}"; exit 0 ;;
    "container inspect")
      [ -n "\${STUB_INSPECT_FAIL:-}" ] && { echo "Error response from daemon: No such container" >&2; exit 1; }
      case "$*" in
        *State.Status*) echo "\${STUB_STATE:-running true false false} $STUB_CREATED" ;;
        *Config.Env*) printf 'PATH=/usr/bin\\nSEYRA_DATASET_ID=ds-test\\nSEYRA_RELAY_PEER=%s\\nSEYRA_RELAY_CLIENT_CIDRS=x\\n' "\${STUB_ENV_PEER-}" ;;
        *PortBindings*) if [ -n "\${STUB_PORT_8444:-}" ]; then echo '{"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8443"}],"8444/tcp":[{"HostIp":"198.18.1.2","HostPort":"8444"}]}'; else echo '{"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8443"}]}'; fi ;;
        *) exit 98 ;;
      esac; exit 0 ;;
  esac
  exit 97
fi
case "$1 $2" in
  "container inspect")
    case "$*" in
      *seyra.edge.owner*) echo test-owner ;;
      *State.Running*) echo "\${STUB_EDGE_RUNNING:-true}" ;;
      *NetworkSettings.Networks*) [ -n "\${STUB_EDGE_ADDR_FAIL:-}" ] && { echo "inspect failed" >&2; exit 1; }; echo "\${STUB_EDGE_ADDR-198.18.1.3}" ;;
      *) exit 96 ;;
    esac; exit 0 ;;
  "run --rm") echo "rc=\${STUB_NC:-1}"; exit 0 ;;
  "stop seyra-edge-test") echo seyra-edge-test; exit 0 ;;
esac
echo "unexpected docker $*" >&2; exit 99
`,
);
chmodSync(join(bin, 'docker'), 0o755);
const EDGE = '198.18.1.3';
const baseEnv = 'EDGE_OWNER=test-owner\nEDGE_NAME=seyra-edge-test\nEDGE_IMAGE=proxy:test\nEDGE_IMAGE_ID=sha256:1\nEDGE_GUARD_IMAGE=guard:test\nEDGE_GUARD_IMAGE_ID=sha256:2\n' +
  'EDGE_PUBLISH_ADDR=198.18.0.1\nEDGE_PUBLISH_PORT=18443\nEDGE_CLIENT_CIDRS=198.18.0.128/25\nEDGE_UPSTREAM=198.18.1.2:8444\nEDGE_CONF_DIR=/nonexistent\nEDGE_LAB_NETWORK=lab\n';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
/** One case: settings (object, 'missing' or 'invalid'), inner state knobs, expectation. */
function stop(name, { settings = { relayPeer: '' }, inner = true, extra = [], stub = {}, created = Date.now() + 60_000, want }) {
  n++;
  const home = join(w, `home-${n}`);
  mkdirSync(join(home, 'state'), { recursive: true });
  if (settings === 'invalid') writeFileSync(join(home, 'state', 'settings.json'), '{ not json');
  else if (settings !== 'missing') writeFileSync(join(home, 'state', 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(home, 'state', 'runtime.env'), 'SEYRA_RELAY_PEER=\n'); // content never read by edge.sh
  const env = join(w, `edge-${n}.env`);
  writeFileSync(env, baseEnv + (inner ? `EDGE_INNER_DOCKER_HOST=unix:///nested.sock\nEDGE_INNER_HOME=${home}\n` : ''));
  const log = join(w, `log-${n}`);
  const r = spawnSync('bash', [script, env, 'stop', ...extra], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_CREATED: iso(created), ...stub }, encoding: 'utf8' });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const stopped = /^stop seyra-edge-test$/m.test(calls);
  const ok = want === 'stop' ? r.status === 0 && stopped : want === 'noop' ? r.status === 0 && !stopped : r.status !== 0 && r.status !== null && !stopped;
  check(`${name}: ${want === 'stop' ? 'stopped' : want === 'noop' ? 'nothing to stop' : 'refused, edge kept (address held)'}`, ok, `rc=${r.status} stopped=${stopped} ${(r.stderr || r.stdout).trim().slice(0, 240)}`);
  return r;
}
const trusted = { settings: { relayPeer: EDGE }, stub: { STUB_ENV_PEER: EDGE, STUB_PORT_8444: '1' } };
const removed = { settings: { relayPeer: '' }, stub: { STUB_ENV_PEER: '' } };

// Negative: every case has the relay port closed (STUB_NC=1 for the pre-fix TCP probe).
stop('trust still configured and applied, relay port closed', { ...trusted, want: 'refuse' });
stop('proxy stopped with the trust still configured', { ...trusted, stub: { ...trusted.stub, STUB_STATE: 'exited false false false' }, want: 'refuse' });
stop('proxy restarting with the trust still configured', { ...trusted, stub: { ...trusted.stub, STUB_STATE: 'restarting true true false' }, want: 'refuse' });
stop('proxy paused', { ...removed, stub: { ...removed.stub, STUB_STATE: 'paused true false true' }, want: 'refuse' });
stop('proxy stopped after the settings were cleared (state on start unproven)', { ...removed, stub: { ...removed.stub, STUB_STATE: 'exited false false false' }, want: 'refuse' });
stop('settings.json missing', { ...removed, settings: 'missing', want: 'refuse' });
stop('settings.json unreadable as JSON', { ...removed, settings: 'invalid', want: 'refuse' });
stop('settings cleared but the running proxy still trusts the edge (not restarted)', { settings: { relayPeer: '' }, stub: { STUB_ENV_PEER: EDGE, STUB_PORT_8444: '1' }, want: 'refuse' });
stop('running proxy clean but runtime.env changed after it was created (stale applied state)', { ...removed, created: Date.now() - 3_600_000, want: 'refuse' });
stop('no relay peer but the relay port is still published', { ...removed, stub: { ...removed.stub, STUB_PORT_8444: '1' }, want: 'refuse' });
stop('nested daemon unreachable', { ...removed, stub: { ...removed.stub, STUB_PS_FAIL: '1' }, want: 'refuse' });
stop('proxy inspection fails', { ...removed, stub: { ...removed.stub, STUB_INSPECT_FAIL: '1' }, want: 'refuse' });
stop('no serving proxy container', { ...removed, stub: { ...removed.stub, STUB_PROXY_IDS: '' }, want: 'refuse' });
stop('two serving proxy containers', { ...removed, stub: { ...removed.stub, STUB_PROXY_IDS: 'p1\\np2\\n' }, want: 'refuse' });
stop("edge's own lab address unreadable", { ...removed, stub: { ...removed.stub, STUB_EDGE_ADDR_FAIL: '1' }, want: 'refuse' });
stop("edge has no lab address", { ...removed, stub: { ...removed.stub, STUB_EDGE_ADDR: '' }, want: 'refuse' });
stop('trust state location not configured (EDGE_INNER_* unset)', { ...removed, inner: false, want: 'refuse' });
// Positive.
stop('trust removed: settings, running proxy and publication clean, runtime.env older than the proxy', { ...removed, want: 'stop' });
stop('relay moved to another peer everywhere (this address no longer trusted)', { settings: { relayPeer: '198.18.1.9' }, stub: { STUB_ENV_PEER: '198.18.1.9', STUB_PORT_8444: '1' }, want: 'stop' });
const f = stop('--force (emergency) with the trust still configured', { ...trusted, extra: ['--force'], want: 'stop' });
check('--force prints the residual-risk warning', /WARNING --force/.test(f.stderr), f.stderr.trim());
stop('edge already stopped', { ...removed, stub: { ...removed.stub, STUB_EDGE_RUNNING: 'false' }, want: 'noop' });
stop("edge run state unrecognized (inspection answered something else)", { ...trusted, stub: { ...trusted.stub, STUB_EDGE_RUNNING: 'test-owner' }, want: 'refuse' });

for (const c of results) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : ` -- ${c.detail}`}`);
const failed = results.filter((c) => !c.ok).length;
console.log(`# edge stop trust evidence: script=${script} checks=${results.length} failed=${failed}`);
rmSync(w, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
