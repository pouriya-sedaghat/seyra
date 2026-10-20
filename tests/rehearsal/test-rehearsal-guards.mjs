// Regressions for review c73db85 R1 and R4 on the ACTUAL rehearsal driver
// (tests/rehearsal/handoff-rehearsal.sh), run with recording `docker` and `ip` stand-ins first on PATH.
// No daemon, network, volume or route is touched.
//
//   node tests/rehearsal/test-rehearsal-guards.mjs [path/to/handoff-rehearsal.sh]
//
// R1 (vm phase): the fixed-name rehearsal VM volume must be positively this lab's (local driver,
// unused) before the privileged VM mounts it at /var/lib/docker. Foreign, unlabelled, in-use and
// uncertain (inspect/create/list error) states are refused before any `docker run`; a new volume is
// verified after creation (a concurrent foreign create is caught); owned/new volumes proceed. The
// stand-in fails every `docker run` after recording it, so no positive case starts anything either.
// R4 (cleanup phase): failed removals, failed or non-empty inventory, unreadable or changed outer
// routes and an unremovable lab directory are FAIL with a non-zero exit; objects that are not this
// lab's are never removed; a clean run passes. The Docker stand-in is stubs/docker-rehearsal.sh.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const driver = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'handoff-rehearsal.sh'));
const frozen = resolve(dirname(driver), '..', '..'); // run in place: the driver's own tree is the "frozen" copy
const w = mkdtempSync(join(tmpdir(), 'seyra-rehearsal-guards-'));
const bin = join(w, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'ip'), '#!/bin/sh\n[ -n "$STUB_IP_FAIL" ] && { echo "ip: cannot open netlink socket" >&2; exit 1; }\nprintf "%s\\n" "${STUB_ROUTES:-default via 192.0.2.1 dev eth0}"\n');
chmodSync(join(bin, 'ip'), 0o755);
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'stubs', 'docker-rehearsal.sh'), join(bin, 'docker'));
chmodSync(join(bin, 'docker'), 0o755);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
let n = 0;
function drive(phase, stub = {}, prep = () => {}) {
  n++;
  const dir = join(w, `case-${n}`);
  const lab = join(dir, 'lab');
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  mkdirSync(lab, { recursive: true });
  prep({ lab, out });
  const log = join(dir, 'docker.log');
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_DIR: dir, STUB_PHASE: phase, LAB: lab, OUT: out,
    OLD_BUNDLE: join(dir, 'old'), NEW_BUNDLE: join(dir, 'new'), NEW_SUMS_DIGEST: 'a'.repeat(64), FIXTURE: join(dir, 'f.pbf'),
    DIND_IMAGE: 'dind:test', RUNNER: 'node:test', NODE_MODULES: join(dir, 'nm'), SEYRA_REHEARSAL_FROZEN: frozen, PHASES: phase, ...stub,
  };
  const r = spawnSync('bash', [driver], { env, encoding: 'utf8', timeout: 30_000 });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const summary = existsSync(join(out, 'summary.txt')) ? readFileSync(join(out, 'summary.txt'), 'utf8') : '';
  return { r, calls, summary, lab, out };
}
const mounted = (calls) => /^-H unix:\/\/\/var\/run\/docker\.sock run .*seyra-rh-vm-docker:\/var\/lib\/docker/m.test(calls);

// ---- R1: vm phase volume admission
for (const [name, stub, reason] of [
  ['existing foreign volume', { STUB_VOL: 'foreign' }, /not this lab's/],
  ['existing unlabelled volume', { STUB_VOL: 'unlabelled' }, /not this lab's/],
  ['existing volume of this lab on another driver', { STUB_VOL: 'otherdriver' }, /not this lab's/],
  ['existing owned volume in use by a container', { STUB_VOL: 'owned', STUB_VOL_USERS: 'abc123\n' }, /in use/],
  ['volume state uncertain (inspect error)', { STUB_VOL: 'error' }, /cannot establish/],
  ['volume create fails', { STUB_VOL: 'absent', STUB_CREATE_FAIL: '1' }, /cannot create/],
  ['foreign volume created concurrently (create returns it)', { STUB_VOL: 'race-foreign' }, /not this lab's/],
  ['inspect after create fails', { STUB_VOL: 'postcreate-error' }, /after it was found\/created/],
  ['users of the volume cannot be listed', { STUB_VOL: 'owned', STUB_USERS_FAIL: '1' }, /cannot list the users/],
]) {
  const x = drive('vm', stub);
  check(`R1 ${name}: refused before any mount, non-zero exit`, x.r.status !== 0 && !mounted(x.calls) && !/ run /.test(x.calls.replace(/^-H \S+ /gm, ' ')) && /FAIL RV0/.test(x.summary) && reason.test(x.summary), `rc=${x.r.status} mount=${mounted(x.calls)} ${x.summary.trim().split('\n').slice(-2).join(' | ')}`);
}
for (const [name, stub, state] of [
  ['absent volume: created with the lab label, verified, then mounted', { STUB_VOL: 'absent' }, /created, labelled for this lab, unused/],
  ['existing owned, unused volume: reused', { STUB_VOL: 'owned' }, /existing, labelled for this lab, unused/],
]) {
  const x = drive('vm', stub);
  const st = existsSync(join(x.out, 'rv0-volume.txt')) ? readFileSync(join(x.out, 'rv0-volume.txt'), 'utf8') : '';
  check(`R1 ${name}`, mounted(x.calls) && !/FAIL RV0/.test(x.summary) && state.test(st), `rc=${x.r.status} mount=${mounted(x.calls)} state=${st.trim()} ${x.summary.trim().split('\n').slice(-1)}`);
}

// ---- R4: cleanup verdict
const base = (o) => writeFileSync(join(o.out, 'vm-routes-before.txt'), 'default via 192.0.2.1 dev eth0\n');
const clean = drive('cleanup', { STUB_VOL: 'owned' }, base);
check('R4 clean cleanup: PASS RC1, exit 0, lab directory removed', clean.r.status === 0 && /PASS RC1/.test(clean.summary) && !existsSync(clean.lab), `rc=${clean.r.status} ${clean.summary.trim().split('\n').slice(-2).join(' | ')}`);
check('R4 clean cleanup: removes exactly the owned VM, volume and three networks', /-H unix:\/\/\/var\/run\/docker\.sock rm -f seyra-rh-vm$/m.test(clean.calls) && /volume rm seyra-rh-vm-docker$/m.test(clean.calls) && (clean.calls.match(/network rm seyra-rh-/g) ?? []).length === 3, clean.calls.split('\n').filter((l) => / rm /.test(l)).join(' | '));
for (const [name, stub, prep, reason] of [
  ['removals fail, objects remain, routes changed (review case)', { STUB_RM_FAIL: '1', STUB_REMAIN_CTR: 'c1\n', STUB_REMAIN_NET: 'n1\n', STUB_REMAIN_VOL: 'v1\n', STUB_ROUTES: 'changed' }, base, /failure/],
  ['container removal fails only', { STUB_RM_FAIL: '1' }, base, /removing/],
  ['inner removal on the lab host fails', { STUB_INNER_FAIL: '1' }, base, /inner removal/],
  ['an owned container remains after removal', { STUB_REMAIN_CTR: 'c1\n' }, base, /remaining/],
  ['inventory query fails', { STUB_LS_FAIL: '1' }, base, /inventory|cannot list/],
  ['outer routes changed only', { STUB_ROUTES: 'default via 192.0.2.1 dev eth0\n198.18.10.0/24 dev br-x' }, base, /CHANGED/],
  ['outer routes unreadable', { STUB_IP_FAIL: '1' }, base, /cannot read the outer VM routing table/],
  ['no route baseline', {}, () => {}, /no outer route baseline/],
  ['network inspection fails (not "not found")', { STUB_NET_INSPECT_FAIL: '1' }, base, /cannot inspect network/],
  ['lab directory cannot be removed', {}, (o) => { base(o); mkdirSync(join(o.lab, 'home', 'locked', 'x'), { recursive: true }); chmodSync(join(o.lab, 'home', 'locked'), 0o555); }, /lab directory not removed/],
]) {
  const x = drive('cleanup', stub, prep);
  check(`R4 ${name}: FAIL RC1, non-zero exit`, x.r.status !== 0 && x.r.status !== null && /FAIL RC1/.test(x.summary) && reason.test(x.summary), `rc=${x.r.status} ${x.summary.trim().split('\n').slice(-2).join(' | ')}`);
  try { chmodSync(join(x.lab, 'home', 'locked'), 0o755); } catch {}
}
const foreign = drive('cleanup', { STUB_NET_LABEL: '/other/lab', STUB_VOL: 'foreign' }, base);
check('R4 foreign network/volume with the fixed names: preserved (never removed), reported, verdict PASS', foreign.r.status === 0 && /PASS RC1/.test(foreign.summary) && /preserved non-lab objects/.test(foreign.summary) && !/(network|volume) rm /.test(foreign.calls), `rc=${foreign.r.status} ${foreign.summary.trim().split('\n').slice(-2).join(' | ')}`);
const gone = drive('cleanup', { STUB_VM_GONE: '1', STUB_VOL: 'gone' }, base);
check('R4 cleanup after the VM is already gone: no guard refusal, PASS', gone.r.status === 0 && /PASS RC1/.test(gone.summary) && !/RV0|RH0/.test(gone.summary), `rc=${gone.r.status} ${gone.summary.trim().split('\n').slice(-2).join(' | ')}`);

for (const c of results) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : ` -- ${c.detail.slice(0, 400)}`}`);
const failed = results.filter((c) => !c.ok).length;
console.log(`# rehearsal guards: driver=${driver} checks=${results.length} failed=${failed}`);
rmSync(w, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
