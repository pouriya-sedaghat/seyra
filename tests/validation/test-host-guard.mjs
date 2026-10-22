// Regression for review finding F4 (e7a2175): every mutating boundary of the Iran harness must
// refuse hosts that are not disposable members of the current lab.
//
//   node tests/validation/test-host-guard.mjs [path/to/iran-offline-host.sh]
//
// Runs the ACTUAL harness with a recording `docker` stub first on PATH (container/volume labels and
// mounts come from a fake table) and a recording Seyra CLI stub. No real container, volume or
// daemon is touched. For each refusal case the run must stop before any kill, rm, volume rm, run,
// volume create or CLI call against the protected host. The lab's own hosts must still be admitted.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const harness = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'iran-offline-host.sh'));

// Shell text: '@{' stands for '${' (a JS template would otherwise interpolate it).
const dockerStub = String.raw`#!/usr/bin/env bash
# Recording docker stub: answers inspect/ps from $FAKE_DB, records every call, changes nothing.
echo "@{DOCKER_HOST:+[inner] }docker $*" >> "$AUDIT"
db="$FAKE_DB"
fmt=""; args=()
while [ $# -gt 0 ]; do case "$1" in -f|--format) fmt="$2"; shift 2;; *) args+=("$1"); shift;; esac; done
set -- "@{args[@]}"
[ -n "@{DOCKER_HOST:-}" ] && exit 0   # the offline daemon: nothing to answer for these tests
case "$1 $2" in
  "container inspect")
    jq -e --arg n "$3" '.containers[$n]' "$db" >/dev/null || exit 1
    case "$fmt" in
      *Labels*) jq -r --arg n "$3" '.containers[$n].label // ""' "$db" ;;
      *Mounts*) jq -r --arg n "$3" '.containers[$n].volume // ""' "$db" ;;
    esac ;;
  "volume inspect")
    jq -e --arg n "$3" '.volumes[$n]' "$db" >/dev/null || exit 1
    case "$fmt" in *Labels*) jq -r --arg n "$3" '.volumes[$n].label // ""' "$db" ;; esac ;;
  "ps -a")
    v="$(printf '%s\n' "$@" | sed -n 's/^volume=//p')"
    jq -r --arg v "$v" '.containers | to_entries[] | select(.value.volume == $v) | .key' "$db" ;;
  "network inspect") exit 0 ;;
  exec\ *)
    # In a real offline host this deletes lab paths as root; here only paths in this test's tree.
    if [ "$3" = rm ]; then for p in "@{@:4}"; do case "$p" in "$STUB_ROOT"/*) rm -rf -- "$p" ;; esac; done; fi ;;
esac
exit 0
`.replaceAll('@{', '${');
const cliStub = '#!/usr/bin/env bash\necho "cli $*" >> "$AUDIT"\nexit 0\n';

function run({ phases, host1, host2 = 'seyra-guard-target-2', db, extraEnv = {} }) {
  const w = mkdtempSync(join(tmpdir(), 'seyra-host-guard-'));
  const lab = join(w, 'lab');
  for (const d of ['bin', 'bundle/install/bin', 'out', 'lab/install/bin', 'lab/install/infra']) mkdirSync(join(w, d), { recursive: true });
  writeFileSync(join(w, 'bin', 'docker'), dockerStub);
  chmodSync(join(w, 'bin', 'docker'), 0o755);
  writeFileSync(join(w, 'lab', 'install', 'bin', 'seyra-maps'), cliStub);
  chmodSync(join(w, 'lab', 'install', 'bin', 'seyra-maps'), 0o755);
  writeFileSync(join(w, 'lab', 'install', 'infra', 'dependencies.lock.json'), '{"images":{"ops":{"ref":"seyra/ops:test"}}}\n');
  writeFileSync(join(w, 'in.osm.pbf'), 'pbf');
  writeFileSync(join(w, 'out', '.dataset_id'), 'ds-20261019-000000000000\n');
  writeFileSync(join(w, 'out', '.egress-start'), '0\n');
  const table = JSON.parse(JSON.stringify(db).replaceAll('$LAB', lab));
  writeFileSync(join(w, 'db.json'), JSON.stringify(table));
  const env = {
    ...process.env,
    PATH: `${join(w, 'bin')}:${process.env.PATH}`,
    AUDIT: join(w, 'audit'),
    FAKE_DB: join(w, 'db.json'),
    STUB_ROOT: w,
    BUNDLE: join(w, 'bundle'),
    PBF: join(w, 'in.osm.pbf'),
    LAB: lab,
    DIND_IMAGE: 'docker:test-dind',
    OUT: join(w, 'out'),
    PHASES: phases,
    HOST1_NAME: host1,
    HOST2_NAME: host2,
    READINESS_TRIALS: '1',
    READINESS_SECONDS: '1',
    UPDATE_BUNDLE: join(w, 'bundle'),
    UPDATE_SUMS_DIGEST: 'f'.repeat(64),
    ...extraEnv,
  };
  delete env.SEYRA_HARNESS_FROZEN;
  let rc = 0;
  try {
    execFileSync('bash', [harness], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  } catch (e) {
    rc = e.signal ? 'timeout' : (e.status ?? 1);
  }
  const audit = existsSync(join(w, 'audit')) ? readFileSync(join(w, 'audit'), 'utf8') : '';
  const progress = existsSync(join(w, 'out', 'progress.log')) ? readFileSync(join(w, 'out', 'progress.log'), 'utf8') : '';
  execFileSync('chmod', ['-R', 'u+w', w]); // the harness's frozen copy is read-only by design
  rmSync(w, { recursive: true, force: true });
  return { rc, audit, progress };
}

const mutating = (audit, host) =>
  audit.split('\n').filter((l) =>
    (host ? l.includes(host) : true) &&
    (/docker kill/.test(l) || /^docker exec \S+ rm -rf/.test(l) || /^docker rm -f/.test(l) || /^docker volume rm/.test(l) || /^docker (run|volume create)/.test(l)),
  );
const cliCalls = (audit) => audit.split('\n').filter((l) => l.startsWith('cli '));

const PROTECTED = 'seyra-guard-preserved';
const unlabelled = { containers: { [PROTECTED]: { label: '', volume: `${PROTECTED}-docker` } }, volumes: { [`${PROTECTED}-docker`]: { label: '' } } };
const otherLab = { containers: { [PROTECTED]: { label: '/srv/another-lab', volume: `${PROTECTED}-docker` } }, volumes: { [`${PROTECTED}-docker`]: { label: '/srv/another-lab' } } };
const OWN = 'seyra-guard-own';
const own = (extra = {}) => ({ containers: { [OWN]: { label: '$LAB', volume: `${OWN}-docker` }, ...(extra.containers ?? {}) }, volumes: { [`${OWN}-docker`]: { label: '$LAB' }, ...(extra.volumes ?? {}) } });

const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: Boolean(cond), detail });
const refusal = (name, r, host) => {
  check(`${name}: run stopped (exit 2, REFUSED recorded)`, r.rc === 2 && /REFUSED/.test(r.progress), `rc=${r.rc}`);
  check(`${name}: no kill/rm/volume rm/run against ${host}`, mutating(r.audit, host).length === 0, mutating(r.audit, host).join(' | '));
  check(`${name}: no Seyra CLI call`, cliCalls(r.audit).length === 0, cliCalls(r.audit).join(' | '));
};

for (const [label, db] of [['unlabelled', unlabelled], ['wrong-lab', otherLab]]) {
  refusal(`restore on an attached ${label} host`, run({ phases: 'restore', host1: PROTECTED, db }), PROTECTED);
  refusal(`readiness on an attached ${label} host`, run({ phases: 'readiness', host1: PROTECTED, db }), PROTECTED);
  refusal(`update on an attached ${label} host`, run({ phases: 'update', host1: PROTECTED, db }), PROTECTED);
}
// A new host must not take over a leftover volume that is not this lab's.
const orphan = run({ phases: 'install', host1: 'seyra-guard-new', db: { containers: {}, volumes: { 'seyra-guard-new-docker': { label: '' } } } });
check('install over an unlabelled leftover volume: run stopped', orphan.rc === 2 && /REFUSED/.test(orphan.progress), `rc=${orphan.rc}`);
check('install over an unlabelled leftover volume: volume kept', !/^docker volume rm/m.test(orphan.audit), mutating(orphan.audit).join(' | '));
// Restore from the lab's own host onto a preserved target: the own host may go, the target may not.
const target = run({ phases: 'restore', host1: OWN, host2: PROTECTED, db: own({ containers: unlabelled.containers, volumes: unlabelled.volumes }) });
check('restore onto a preserved restore target: run stopped', target.rc === 2 && /REFUSED/.test(target.progress), `rc=${target.rc}`);
check('restore onto a preserved restore target: target untouched', mutating(target.audit, PROTECTED).length === 0, mutating(target.audit, PROTECTED).join(' | '));
check('restore onto a preserved restore target: own host 1 was dropped first', /^docker rm -f seyra-guard-own$/m.test(target.audit) && /^docker volume rm seyra-guard-own-docker$/m.test(target.audit), '');
// The lab's own hosts are still admitted (safe resumption).
const ownReady = run({ phases: 'readiness', host1: OWN, db: own() });
check('readiness on the lab\'s own host: admitted (stop/start issued)', /^cli stop$/m.test(ownReady.audit) && /^cli start$/m.test(ownReady.audit), cliCalls(ownReady.audit).join(' | '));
const ownRestore = run({ phases: 'restore', host1: OWN, db: own() });
check('restore on the lab\'s own host: host 1 and its volume removed', /^docker rm -f seyra-guard-own$/m.test(ownRestore.audit) && /^docker volume rm seyra-guard-own-docker$/m.test(ownRestore.audit), mutating(ownRestore.audit).join(' | '));
check('restore on the lab\'s own host: host 2 created with this lab\'s label', /^docker volume create --label seyra\.validation\.lab=\S+ seyra-guard-target-2-docker$/m.test(ownRestore.audit) && /^docker run -d --privileged --name seyra-guard-target-2 --label seyra\.validation\.lab=/m.test(ownRestore.audit), '');

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# harness=${harness} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
