// Reviewer checks for the attached patch ending at d63f1d9. Node 24, no packages/network/Docker.
// Usage: node verify-vm2-d63f1d9.mjs BASE_E7_CHECKOUT PATCHED_CHECKOUT OUTPUT_DIR
// Actual capacity module and actual shell blocks; external CLI/Docker boundaries are recorders.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, resolve } from 'node:path';

const [base, root, out] = process.argv.slice(2).map(p => resolve(p));
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(out, 'fixtures-'));
const src = p => readFileSync(join(root, p), 'utf8');
const hash = x => createHash('sha256').update(x).digest('hex');
const asModule = s => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, { mode: 'transform' })).toString('base64');
const cap = await import(asModule(src('apps/ops/src/capacity.ts')));
const checks = [];
const pass = (id, detail) => checks.push({ id, result: 'PASS', detail });
const GiB = 1024 ** 3, MiB = 1024 ** 2;
const fsDev = p => lstatSync(p, { bigint: true }).dev;
const required = 4 * GiB;
const settings = { minFreeFactor: 120, minFreeBytes: required };
const d = join(work, 'failed'); mkdirSync(d);
writeFileSync(join(d, 'store'), ''); truncateSync(join(d, 'store'), 8 * GiB);
let cleaned = 0;
await assert.rejects(cap.admitImport({
  path: work, datasetId: 'ds-20261019-review', inputBytes: 1, settings,
  free: () => GiB, log: () => {}, failedBuild: {
    estimate: () => cap.reclaimableBytes(d, fsDev(work)), renderDbLogicalBytes: async () => 128 * GiB,
    cleanup: async () => { cleaned++; rmSync(d, { recursive: true }); },
  },
}), e => e instanceof cap.CapacityRefusal && e.admission.render_db_credit_bytes === 0);
assert.equal(cleaned, 0); assert.ok(existsSync(join(d, 'store')));
pass('sparse-and-db-credit-refusal', 'The real admission function refuses an 8 GiB sparse store plus 128 GiB logical DB without cleanup; failed data is kept.');

const outside = join(work, 'outside'); writeFileSync(outside, Buffer.alloc(MiB, 7));
symlinkSync(outside, join(d, 'symbolic')); linkSync(outside, join(d, 'shared'));
let r = cap.reclaimableBytes(d, fsDev(work));
assert.ok(r.bytes < MiB); assert.equal(r.not_credited.symlinks, 1); assert.equal(r.not_credited.shared_inodes, 1);
pass('outside-links', 'Actual lstat-based estimator does not credit either outside symlink targets or data with a surviving outside hard link.');
rmSync(join(d, 'shared')); rmSync(outside);
writeFileSync(join(d, 'allocated'), Buffer.alloc(2 * MiB, 8)); linkSync(join(d, 'allocated'), join(d, 'second-name'));
r = cap.reclaimableBytes(d, fsDev(work));
assert.ok(r.bytes >= 2 * MiB && r.bytes < 3 * MiB); assert.equal(r.not_credited.shared_inodes, 0);
pass('inside-hardlink-dedup', 'An internal hard-link pair earns one allocation rather than two logical lengths.');

let reads = 0, cleanupDone = false;
const result = await cap.admitImport({
  path: work, datasetId: 'ds-20261019-review', inputBytes: 1, settings,
  free: () => { reads++; if (reads === 1) return required - MiB; assert.equal(cleanupDone, true); return required + MiB; },
  log: () => {}, failedBuild: {
    estimate: () => cap.reclaimableBytes(d, fsDev(work)), renderDbLogicalBytes: async () => { throw Error('DB size unavailable'); },
    cleanup: async () => { cleanupDone = true; },
  },
});
assert.equal(reads, 2); assert.equal(result.admission.ok, true); assert.equal(result.after_cleanup.ok, true); assert.equal(result.render_db_logical_bytes, null);
pass('authorized-cleanup-order', 'An allocated-store admission invokes cleanup and then checks observed free space; unavailable DB size is informative only.');
let after = false;
await assert.rejects(cap.admitImport({
  path: work, datasetId: 'ds-20261019-review', inputBytes: 1, settings, free: () => required - MiB, log: () => {},
  failedBuild: { estimate: () => cap.reclaimableBytes(d, fsDev(work)), renderDbLogicalBytes: async () => 0, cleanup: async () => { after = true; } },
}), e => after && e instanceof cap.CapacityRefusal && e.admission.after_cleanup.ok === false && /no new import data was written/.test(e.message));
pass('post-cleanup-shortfall', 'A shortfall after authorized cleanup is explicitly reported and does not return permission to begin new import writes.');
const noFailed = { path: work, datasetId: 'ds-20261019-review', inputBytes: 1, settings, log: () => {}, failedBuild: null };
await assert.rejects(cap.admitImport({ ...noFailed, free: () => required - 1 }), /nothing was changed/);
assert.equal((await cap.admitImport({ ...noFailed, free: () => required })).admission.ok, true);
pass('new-import-boundary', 'Without a failed build the actual admission function honors the exact free-space boundary.');

function updateLink(repo, label) {
  const w = join(work, label); mkdirSync(join(w, 'bundle/install'), { recursive: true }); mkdirSync(join(w, 'install')); mkdirSync(join(w, 'out'));
  writeFileSync(join(w, 'install/marker'), 'old'); writeFileSync(join(w, 'bundle/install/marker'), 'new');
  const sums = `${hash('new')}  install/marker\n`; writeFileSync(join(w, 'bundle/SHA256SUMS'), sums);
  symlinkSync(join(w, 'does-not-exist'), join(w, 'bundle/install/unlisted-link'));
  const text = readFileSync(join(repo, 'tests/validation/iran-offline-host.sh'), 'utf8');
  const block = text.slice(text.indexOf('# >>> update-phase'), text.indexOf('# <<< update-phase'));
  const pre = String.raw`
set -uo pipefail
w="$1"; UPDATE_BUNDLE="$w/bundle"; UPDATE_SUMS_DIGEST="$2"; OUT="$w/out"; inst="$w/install"; BUNDLE=original
has(){ [ "$1" = update ]; }
guard_phase(){ :; }
in_host(){ echo "in_host $*" >> "$w/audit"; "$@"; }
cli(){ echo "cli $*" >> "$w/audit"; case "$1" in bootstrap-load) echo 'identities match the manifest';; verify-images) echo OK;; esac; }
timed(){ shift; "$@"; }
result(){ echo "result $*" >> "$w/audit"; }
finish(){ exit 1; }
egress_count(){ echo 0; }
`;
  writeFileSync(join(w, 'run.sh'), pre + '\n' + block);
  let rc = 0; try { execFileSync('bash', [join(w, 'run.sh'), w, hash(sums)], { timeout: 5000, stdio: ['ignore','pipe','pipe'] }); } catch(e) { rc = e.status; }
  return { rc, audit: readFileSync(join(w, 'audit'), 'utf8'), marker: readFileSync(join(w, 'install/marker'), 'utf8') };
}
const old = updateLink(base, 'old-link'), fixed = updateLink(root, 'fixed-link');
assert.equal(old.rc, 0); assert.match(old.audit, /cli bootstrap-load/); assert.equal(old.marker, 'new');
assert.equal(fixed.rc, 1); assert.doesNotMatch(fixed.audit, /cli /); assert.equal(fixed.marker, 'old');
pass('original-F2-counterexample-closed', 'The same unlisted dangling-link fixture is installed/bootstrap-called by e7a2175 but refused before those actions by d63f1d9.');

const info = {
  reviewed_base: 'e7a2175149824f7cba92e47382c464607248f609', reviewed_head: 'd63f1d9310c4a3c51abee3dde832eb36e51b267f', node: process.version, checks,
  source_sha256: { capacity: hash(src('apps/ops/src/capacity.ts')), importer: hash(src('apps/ops/src/importer.ts')), harness: hash(src('tests/validation/iran-offline-host.sh')) },
  limitations: 'Actual functions/blocks with controlled filesystem and external boundaries, not a full importer/Docker/Photon/PBF/browser rerun. Reviewer Node is 24.19.0, not pinned 24.21.0.',
};
writeFileSync(join(out, 'VM2_d63f1d9_actual_code_evidence.json'), JSON.stringify(info, null, 2) + '\n');
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(info, null, 2));
