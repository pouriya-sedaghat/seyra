// Regression: infra/edge/edge.sh stop must refuse while the inner relay listener still answers.
// A stopped container releases its lab address at once and Docker assigns it to the next container
// (verified on Docker 29), so stopping the edge before the inner proxy drops its relay trust would
// leave a trusted address free for reuse.
//
//   node tests/security/test-edge-stop.mjs [path/to/edge.sh]
//
// Runs the ACTUAL script with a `docker` stand-in first on PATH (no container is touched): the
// stand-in reports the owner label, answers the upstream probe from STUB_NC (0 connects, 1 refused,
// "error" = the probe did not run) and records every `docker stop`.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
case "$1 $2" in
  "container inspect") echo test-owner ;;
  "run --rm")
    case "$STUB_NC" in 0|1) echo "rc=$STUB_NC" ;; *) echo "docker: Error response from daemon: probe image missing" >&2; exit 125 ;; esac ;;
  "stop seyra-edge-test") echo seyra-edge-test ;;
  *) echo "unexpected docker $*" >&2; exit 99 ;;
esac
`,
);
chmodSync(join(bin, 'docker'), 0o755);
const env = join(w, 'edge.env');
writeFileSync(
  env,
  'EDGE_OWNER=test-owner\nEDGE_NAME=seyra-edge-test\nEDGE_IMAGE=proxy:test\nEDGE_IMAGE_ID=sha256:1\nEDGE_GUARD_IMAGE=guard:test\nEDGE_GUARD_IMAGE_ID=sha256:2\n' +
    'EDGE_PUBLISH_ADDR=198.18.0.1\nEDGE_PUBLISH_PORT=18443\nEDGE_CLIENT_CIDRS=198.18.0.128/25\nEDGE_UPSTREAM=198.18.1.2:8444\nEDGE_CONF_DIR=/nonexistent\n',
);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
let n = 0;
function stop(nc, extra = []) {
  n++;
  const log = join(w, `log-${n}`);
  const r = spawnSync('bash', [script, env, 'stop', ...extra], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_NC: nc }, encoding: 'utf8' });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  return { r, stopped: /^stop seyra-edge-test$/m.test(calls), probed: /nc -w 3 -z 198\.18\.1\.2 8444/.test(calls) };
}

let s = stop('0');
check('upstream still answers: refused, edge not stopped', s.r.status === 2 && !s.stopped && s.probed && /init --no-relay/.test(s.r.stderr), `rc=${s.r.status} stopped=${s.stopped} ${s.r.stderr.trim()}`);
s = stop('error');
check('probe did not run: refused (a tool error is not a closed upstream)', s.r.status === 2 && !s.stopped && /could not probe/.test(s.r.stderr), `rc=${s.r.status} stopped=${s.stopped} ${s.r.stderr.trim()}`);
s = stop('1');
check('upstream refuses (relay trust removed): edge stopped', s.r.status === 0 && s.stopped && /stopped/.test(s.r.stdout), `rc=${s.r.status} ${s.r.stderr.trim()}`);
s = stop('0', ['--force']);
check('--force (emergency): stopped without the probe, with a warning', s.r.status === 0 && s.stopped && !s.probed && /WARNING --force/.test(s.r.stderr), `rc=${s.r.status} ${s.r.stderr.trim()}`);

for (const c of results) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : ` -- ${c.detail}`}`);
const failed = results.filter((c) => !c.ok).length;
console.log(`# edge stop interlock: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
