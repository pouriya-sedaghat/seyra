// Regression for review finding V1: an incoming bundle must be verified before any install action.
// Runs the harness's actual update block (bash) with recorders in place of Docker/the Seyra CLI,
// against temporary bundles. No Docker, no network.
//
//   node tests/validation/test-update-gate.mjs [path/to/iran-offline-host.sh]
//
// Cases: wrong out-of-band digest; corrupted payload with an unchanged SHA256SUMS; an unlisted file;
// (review F2, e7a2175) an unlisted symlink, a dangling symlink, a listed file replaced by a symlink
// to identical bytes outside, an unlisted FIFO, a listed FIFO (would block a naive read), "..",
// absolute and newline-bearing names, a symlinked bundle root and SHA256SUMS, a failing copy;
// and a valid update. Each run has a 20 s limit, so a gate that blocks counts as a failure. A refused update must make zero install changes, zero CLI/bootstrap calls, keep
// BUNDLE and end the run (finish); a valid one replaces the install tree and runs bootstrap-load.
// Exit status 0 only if every case behaves as required.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const harness = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'iran-offline-host.sh'));
const text = readFileSync(harness, 'utf8');
// Current harness: the marked block (gate function + phase). Older revisions: the plain phase.
const a = text.indexOf('# >>> update-phase');
const block = a >= 0 ? text.slice(a, text.indexOf('# <<< update-phase')) : text.slice(text.indexOf('if has update; then'), text.indexOf('\nif has import; then'));
if (!block.includes('if has update; then')) throw new Error(`no update phase found in ${harness}`);

const sha = (b) => createHash('sha256').update(b).digest('hex');
const prelude = String.raw`
set -u
work="$1"; UPDATE_BUNDLE="$work/bundle"; UPDATE_SUMS_DIGEST="$2"
OUT="$work/out"; inst="$work/install"; audit="$work/audit"; BUNDLE="$work/old-bundle"
mkdir -p "$OUT"
has() { [ "$1" = update ]; }
guard_phase() { :; } # lab ownership is exercised by test-host-guard.mjs
in_host() { printf 'in_host %s\n' "$*" >> "$audit"; [ "$1" = rm ] && "$@"; return 0; }
cli() { printf 'cli %s\n' "$*" >> "$audit"; case "$1" in bootstrap-load) echo 'identities match the manifest';; verify-images) echo OK;; esac; }
timed() { shift; "$@"; }
result() { printf 'result %s\n' "$*" >> "$audit"; }
finish() { echo finish >> "$audit"; echo "BUNDLE=$BUNDLE" >> "$audit"; exit 1; }
egress_count() { echo 0; }
`;

function makeCase(kind) {
  const work = mkdtempSync(join(tmpdir(), `seyra-update-gate-${kind}-`));
  const files = { 'install/bin/seyra-maps': '#!/usr/bin/env bash\necho new\n', 'install/marker': 'NEW install tree\n', 'images/ops.tar': 'image archive bytes', 'bundle-manifest.json': '{}\n' };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(work, 'bundle', dirname(rel)), { recursive: true });
    writeFileSync(join(work, 'bundle', rel), body);
  }
  const outside = join(work, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'same-bytes'), files['install/marker']);
  let sums = `${Object.keys(files).sort().map((rel) => `${sha(files[rel])}  ${rel}`).join('\n')}\n`;
  if (kind === 'dotdot-path') sums += `${sha(files['install/marker'])}  install/../outside/same-bytes\n`;
  if (kind === 'absolute-path') sums += `${sha(files['install/marker'])}  ${join(outside, 'same-bytes')}\n`;
  writeFileSync(join(work, 'bundle', 'SHA256SUMS'), sums);
  mkdirSync(join(work, 'install'), { recursive: true });
  writeFileSync(join(work, 'install', 'marker'), 'OLD install tree\n');
  let digest = sha(sums);
  let bundleArg = join(work, 'bundle');
  let extraPrelude = '';
  const b = (rel) => join(work, 'bundle', rel);
  if (kind === 'wrong-digest') digest = 'f'.repeat(64);
  if (kind === 'corrupt-payload') appendFileSync(b('images/ops.tar'), 'X'); // SHA256SUMS untouched
  if (kind === 'unlisted-file') writeFileSync(b('install/extra.sh'), 'echo surprise\n');
  if (kind === 'unlisted-symlink') symlinkSync(join(outside, 'same-bytes'), b('install/unlisted-link.sql'));
  if (kind === 'dangling-symlink') symlinkSync(join(outside, 'does-not-exist'), b('install/dangling'));
  if (kind === 'listed-file-is-symlink') {
    unlinkSync(b('install/marker'));
    symlinkSync(join(outside, 'same-bytes'), b('install/marker')); // same bytes: sha256sum -c alone would pass
  }
  if (kind === 'unlisted-fifo') execFileSync('mkfifo', [b('images/pipe')]);
  if (kind === 'listed-fifo') {
    unlinkSync(b('images/ops.tar'));
    execFileSync('mkfifo', [b('images/ops.tar')]); // a naive checksum read blocks forever
  }
  if (kind === 'newline-name') writeFileSync(b('install/evil\nname'), 'x');
  if (kind === 'bundle-root-symlink') {
    symlinkSync(join(work, 'bundle'), join(work, 'bundle-link'));
    bundleArg = join(work, 'bundle-link');
  }
  if (kind === 'sums-symlink') {
    writeFileSync(join(outside, 'SHA256SUMS'), sums);
    unlinkSync(b('SHA256SUMS'));
    symlinkSync(join(outside, 'SHA256SUMS'), b('SHA256SUMS'));
  }
  if (kind === 'copy-fails') extraPrelude = 'cp() { echo "cp $*" >> "$audit"; return 1; }';
  writeFileSync(join(work, 'run.sh'), `${prelude.replace('UPDATE_BUNDLE="$work/bundle"', 'UPDATE_BUNDLE="$3"')}\n${extraPrelude}\n${block}\necho "BUNDLE=$BUNDLE" >> "$audit"\n`);
  let rc = 0;
  try {
    execFileSync('bash', [join(work, 'run.sh'), work, digest, bundleArg], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, killSignal: 'SIGKILL' });
  } catch (e) {
    rc = e.signal ? 'timeout' : (e.status ?? 1);
  }
  const audit = existsSync(join(work, 'audit')) ? readFileSync(join(work, 'audit'), 'utf8') : '';
  const marker = existsSync(join(work, 'install', 'marker')) ? readFileSync(join(work, 'install', 'marker'), 'utf8') : '(missing)';
  rmSync(work, { recursive: true, force: true });
  return { rc, audit, marker, bundleAfter: /BUNDLE=(.*)/.exec(audit)?.[1] ?? '' };
}

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: Boolean(cond), detail });
const refused = ['wrong-digest', 'corrupt-payload', 'unlisted-file'];
const refusedF2 = ['unlisted-symlink', 'dangling-symlink', 'listed-file-is-symlink', 'unlisted-fifo', 'listed-fifo', 'dotdot-path', 'absolute-path', 'newline-name', 'bundle-root-symlink', 'sums-symlink', 'copy-fails'];
const only = process.env.ONLY_ORIGINAL ? refused : [...refused, ...refusedF2];
for (const kind of only) {
  const r = makeCase(kind);
  check(`${kind}: refused (FAIL U1)`, /result FAIL U1/.test(r.audit), r.audit.split('\n').find((l) => l.startsWith('result')) ?? '');
  check(`${kind}: no CLI/bootstrap call`, !/^cli /m.test(r.audit), (r.audit.match(/^cli .*/gm) ?? []).join(' | '));
  check(`${kind}: install tree unchanged`, r.marker === 'OLD install tree\n' && !/^in_host rm -rf \S*\/install$/m.test(r.audit), `marker=${JSON.stringify(r.marker)}`);
  check(`${kind}: BUNDLE not reassigned`, r.bundleAfter.endsWith('/old-bundle'), r.bundleAfter);
  check(`${kind}: run ends (dependent phases skipped)`, r.rc !== 0 && /^finish$/m.test(r.audit), `rc=${r.rc}`);
}
const v = makeCase('valid');
check('valid: PASS U1', /result PASS U1/.test(v.audit), v.audit.split('\n').find((l) => l.startsWith('result')) ?? '');
check('valid: install tree replaced', v.marker === 'NEW install tree\n', `marker=${JSON.stringify(v.marker)}`);
check('valid: bootstrap-load ran after verification', /^cli bootstrap-load/m.test(v.audit), '');
check('valid: BUNDLE now the update', v.bundleAfter.endsWith('/bundle'), v.bundleAfter);

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# harness=${harness} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
