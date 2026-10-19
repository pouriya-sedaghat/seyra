// Reviewer checks for the attached 15-commit patch ending at e7a2175.
// Node 24; no packages/network/Docker required.
// Usage: node verify-vm2-e7a2175.mjs PATCHED_CHECKOUT OUTPUT_DIRECTORY
// Executes actual capacity code and selected actual functions/blocks with filesystem fixtures.
// Docker, CLI and Playwright boundaries are recorders; this is not a provider/browser rerun.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(out, 'fixtures-'));
const code = p => readFileSync(join(root, p), 'utf8');
const hash = b => createHash('sha256').update(b).digest('hex');
const moduleURL = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const transform = s => stripTypeScriptTypes(s, { mode: 'transform' });
const checks = [];
const observations = [];
const pass = (id, detail) => checks.push({ id, result: 'PASS', detail });

const cap = await import(moduleURL(transform(code('apps/ops/src/capacity.ts'))));
const policy = { minFreeFactor: 120, minFreeBytes: 2 * 1024 ** 3 };
const input = 229845082;
const need = input * 120;
assert.equal(cap.REFERENCE_MIN_FREE_FACTOR, 120);
assert.equal(cap.capacityCheck(work, need, 0, input, policy).ok, true);
assert.equal(cap.capacityCheck(work, need - 1, 0, input, policy).ok, false);
assert.equal(cap.capacityCheck(work, 0, 0, 1000, policy).required_bytes, 2 * 1024 ** 3);
assert.equal(cap.capacityCheck(work, need - 100, 100, input, policy).ok, true);
pass('capacity-boundaries', 'The 120x reference, 2 GiB floor, exact boundary and reclaim arithmetic behave as documented.');
let next = 0;
const values = [100, 100, 40, 95];
const m = new cap.FreeSpaceMonitor(() => values[next++], () => new Date('2026-10-19T00:00:00Z'));
m.sample(); m.beginStep(); m.sample();
assert.equal(m.endStep(), 40); assert.equal(m.minimum(), 40); assert.equal(m.samples, 4);
pass('within-step-minimum', 'An actual monitor sample between two high boundaries becomes the step/run minimum.');
const broken = new cap.FreeSpaceMonitor(() => { throw Error('failed statfs'); });
assert.ok(Number.isNaN(broken.sample())); assert.equal(broken.samples, 0); assert.equal(broken.minimum(), null);
pass('failed-statfs', 'A failed sample is not recorded as a free-space value.');
let tick = 0;
const timed = new cap.FreeSpaceMonitor(() => 1000 - tick++);
timed.start(5); await new Promise(r => setTimeout(r, 45)); timed.stop();
const samples = timed.samples; assert.ok(samples >= 3);
await new Promise(r => setTimeout(r, 20)); assert.equal(timed.samples, samples);
pass('monitor-timer', 'Timer samples stop when stop() is called.');

// This formerly descriptive logical-size helper is now used as capacity credit by importer.ts.
const manifest = code('apps/ops/src/manifest.ts');
const duCode = manifest.slice(manifest.indexOf('export function duBytes('), manifest.indexOf('\n/**', manifest.indexOf('export function duBytes(')));
const { duBytes } = await import(moduleURL("import { readdirSync,statSync,existsSync } from 'node:fs'; import { join } from 'node:path';\n" + transform(duCode)));
const failed = join(work, 'failed-release'); mkdirSync(failed);
const sparse = join(failed, 'partial-store.bin'); writeFileSync(sparse, ''); truncateSync(sparse, 8 * 1024 ** 3);
const measured = statSync(sparse);
const logicalCredit = duBytes(failed);
assert.equal(logicalCredit, 8 * 1024 ** 3);
assert.ok(measured.blocks * 512 < 1024 ** 2);
const freeBudget = 1024 ** 3;
const credited = cap.capacityCheck(work, freeBudget, logicalCredit, 1, { minFreeFactor: 120, minFreeBytes: 4 * 1024 ** 3 });
assert.equal(credited.ok, true);
assert.ok(freeBudget + measured.blocks * 512 < credited.required_bytes);
observations.push({ id: 'F1-logical-reclaim-credit', reproduced: true, logical_credit_bytes: logicalCredit, allocated_file_bytes: measured.blocks * 512, illustrative_free_bytes: freeBudget, required_bytes: credited.required_bytes, admission: credited.ok, detail: 'The actual helper credits 8 GiB for a sparse file with almost no allocated blocks. Arithmetic admits a 4 GiB requirement with only a 1 GiB free-space budget. This is an actual-code/filesystem counterexample, not a full import.' });
const outside = join(work, 'outside-store'); writeFileSync(outside, 'outside bytes');
symlinkSync(outside, join(failed, 'linked-store'));
assert.equal(duBytes(failed), logicalCredit + statSync(outside).size);
observations.push({ id: 'F1-followed-link-credit', reproduced: true, linked_target_bytes_credited: statSync(outside).size, detail: 'duBytes follows a symlink and credits target bytes even though deleting the release removes only the link.' });

const bundle = code('apps/ops/src/bundle.ts');
const ownCode = bundle.slice(bundle.indexOf('export function applyBundleOwnership('), bundle.indexOf('\n/**', bundle.indexOf('export function applyBundleOwnership(')));
const { applyBundleOwnership } = await import(moduleURL("import { statSync,lstatSync,chmodSync,chownSync,readdirSync } from 'node:fs'; import { join } from 'node:path';\n" + transform(ownCode)));
const output = join(work, 'bundle-output'); mkdirSync(join(output, 'images'), { recursive: true }); mkdirSync(join(output, 'install/bin'), { recursive: true });
const tar = join(output, 'images/ops.tar'); writeFileSync(tar, 'archive'); chmodSync(tar, 0o600);
const wrapper = join(output, 'install/bin/seyra-maps'); writeFileSync(wrapper, '#!/bin/sh\n'); chmodSync(wrapper, 0o700);
const secret = join(work, 'unrelated-secret'); writeFileSync(secret, 'secret'); chmodSync(secret, 0o400);
symlinkSync(secret, join(output, 'external-link'));
chmodSync(output, 0o750); const digestBefore = hash(readFileSync(tar));
const owner = applyBundleOwnership(output);
assert.equal(statSync(tar).mode & 0o777, 0o644); assert.equal(statSync(wrapper).mode & 0o777, 0o755);
assert.equal(statSync(output).mode & 0o777, 0o750); assert.equal(statSync(secret).mode & 0o777, 0o400);
assert.equal(hash(readFileSync(tar)), digestBefore); assert.equal(statSync(tar).uid, owner.uid);
pass('bundle-output-policy', 'Actual ownership helper fixes archive mode, retains executable mode and bytes, and leaves the output parent and symlink target untouched. No real non-root wrapper rerun here.');

const harness = code('tests/validation/iran-offline-host.sh');
const update = harness.slice(harness.indexOf('# >>> update-phase'), harness.indexOf('# <<< update-phase'));
function updateCase(kind) {
  const w = join(work, 'update-' + kind); const b = join(w, 'bundle');
  mkdirSync(join(b, 'install'), { recursive: true }); mkdirSync(join(w, 'out')); mkdirSync(join(w, 'install'));
  writeFileSync(join(w, 'install/marker'), 'old'); writeFileSync(join(b, 'install/marker'), 'new');
  const sums = `${hash('new')}  install/marker\n`; writeFileSync(join(b, 'SHA256SUMS'), sums);
  if (kind === 'symlink') symlinkSync(outside, join(b, 'install/unlisted-link.sql'));
  if (kind === 'regular-extra') writeFileSync(join(b, 'install/extra'), 'extra');
  const sh = String.raw`
set -uo pipefail
w="$1"; UPDATE_BUNDLE="$w/bundle"; UPDATE_SUMS_DIGEST="$2"; OUT="$w/out"; inst="$w/install"; BUNDLE=original
has(){ [ "$1" = update ]; }
in_host(){ echo "in_host $*" >> "$w/audit"; "$@"; }
cli(){ echo "cli $*" >> "$w/audit"; case "$1" in bootstrap-load) echo 'identities match the manifest';; verify-images) echo OK;; esac; }
timed(){ shift; "$@"; }
result(){ echo "result $*" >> "$w/audit"; }
finish(){ echo finish >> "$w/audit"; exit 1; }
egress_count(){ echo 0; }
`;
  writeFileSync(join(w, 'run.sh'), sh + '\n' + update);
  let rc = 0; try { execFileSync('bash', [join(w, 'run.sh'), w, hash(sums)], { stdio: ['ignore','pipe','pipe'] }); } catch(e) { rc = e.status; }
  return { rc, audit: readFileSync(join(w, 'audit'), 'utf8'), copied_link: existsSync(join(w, 'install/unlisted-link.sql')) };
}
const valid = updateCase('valid'); assert.equal(valid.rc, 0); assert.match(valid.audit, /result PASS U1/);
const extra = updateCase('regular-extra'); assert.notEqual(extra.rc, 0); assert.doesNotMatch(extra.audit, /cli bootstrap/);
pass('update-regular-files', 'Actual update block admits a valid fixture and refuses an unlisted regular file before bootstrap.');
const linked = updateCase('symlink'); assert.equal(linked.rc, 0); assert.match(linked.audit, /result PASS U1/); assert.equal(linked.copied_link, true);
observations.push({ id: 'F2-unlisted-link-gate', reproduced: true, ...linked, detail: 'The actual pre-install gate ignores unlisted symlinks (find -type f). The link is copied and bootstrap is called. CLI is a recorder; a later product verifier might reject, after install mutation.' });

const browser = code('tests/validation/iran-browser.mjs');
const start = browser.indexOf('const searchAndOpen = async');
const end = browser.indexOf('// Zoom out', start);
const search = browser.slice(start, end).replace('const searchAndOpen =', 'return');
let clickAttempts = 0;
const item = { innerText: async () => 'تهران', click: async () => { clickAttempts++; throw Error('click failed'); } };
const page = {
  getByRole: () => ({ first: () => ({ fill: async () => {} }) }), keyboard: { press: async () => {} }, waitForTimeout: async () => {},
  locator: selector => selector === 'aside' ? { innerText: async () => 'تهران' } : selector.includes('scale') ? { first: () => ({ innerText: async () => '100 km' }) } : { count: async () => 1, nth: () => item },
};
const searchAndOpen = new Function('page', 'settle', search)(page, async () => {});
const visit = await searchAndOpen('برج آزادی', 'تهران'); assert.equal(clickAttempts, 1); assert.equal(visit.found, true);
const { browserVerdict } = await import(pathToFileURL(join(root, 'tests/validation/browser-verdict.mjs')));
const verdict = browserVerdict({ visits: Array.from({ length: 6 }, () => visit), expectedVisits: 6 }); assert.equal(verdict.ok, true);
observations.push({ id: 'F3-visit-click-failure', reproduced: true, click_attempts: clickAttempts, visit, verdict: verdict.status, detail: 'The actual searchAndOpen swallows a failed result click, returns found=true, and the new verdict accepts six such visits. No actual map movement is checked.' });
assert.equal(browserVerdict({ visits: [], expectedVisits: 6 }).ok, false);
assert.equal(browserVerdict({ visits: [], expectedVisits: 0, consoleErrors: ['error'] }).ok, false);
pass('browser-negative-categories', 'The new predicate does reject missing declared visits and console errors.');

const ds = harness.indexOf('drop_host() {');
const de = harness.indexOf('\nattach_host()', ds);
const drop = harness.slice(ds, de);
const w = join(work, 'host-drop'); mkdirSync(w); mkdirSync(join(w, 'socket'));
const sh = String.raw`
set -uo pipefail
w="$1"; audit="$w/audit"; name=preserved-unlabelled-owner-host; LAB="$w/lab"; SEYRA_HOME="$LAB/home"; inst="$LAB/install"; work="$LAB/work"; sock_dir="$w/socket"
docker(){ echo "docker $*" >> "$audit"; return 0; }
in_host(){ echo "in_host $*" >> "$audit"; return 0; }
`;
writeFileSync(join(w, 'run.sh'), sh + '\n' + drop + '\ndrop_host\n');
execFileSync('bash', [join(w, 'run.sh'), w], { stdio: ['ignore','pipe','pipe'] });
const audit = readFileSync(join(w, 'audit'), 'utf8');
assert.match(audit, /docker rm -f preserved-unlabelled-owner-host/); assert.match(audit, /in_host rm -rf/); assert.doesNotMatch(audit, /inspect/);
observations.push({ id: 'F4-unguarded-attached-host-drop', reproduced: true, audit, detail: 'Actual drop_host issues destructive cleanup without checking a lab label. attach_host accepts any name; the restore phase calls drop_host before new_host can protect the other target. Docker/in_host are recorders only.' });

const result = { reviewed_head: 'e7a2175149824f7cba92e47382c464607248f609', node: process.version, checks, observations, limitations: 'No full checkout dependencies, exact pinned Node 24.21.0, real Docker/Photon/PBF import, browser or full provider suites were run by this reviewer.' };
// Obtain the precise head from the already supplied patch, without relying on a guessed suffix.
const patch = resolve(root, '../upload/seyra-vm2-followup-review.patch');
if (existsSync(patch)) {
  const text = readFileSync(patch, 'utf8'); result.reviewed_head = [...text.matchAll(/^From ([a-f0-9]{40}) Mon Sep 17/gm)].at(-1)[1]; result.patch_sha256 = hash(text);
}
writeFileSync(join(out, 'VM2_e7a2175_evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
rmSync(work, { recursive: true, force: true });
