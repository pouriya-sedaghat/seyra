// Regression for review finding V1: an incoming bundle must be verified before any install action.
// Runs the harness's actual update block (bash) with recorders in place of Docker/the Seyra CLI,
// against temporary bundles. No Docker, no network.
//
//   node tests/validation/test-update-gate.mjs [path/to/iran-offline-host.sh]
//
// Cases: wrong out-of-band digest; corrupted payload with an unchanged SHA256SUMS; an unlisted file;
// a valid update. A refused update must make zero install changes, zero CLI/bootstrap calls, keep
// BUNDLE and end the run (finish); a valid one replaces the install tree and runs bootstrap-load.
// Exit status 0 only if every case behaves as required.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const sums = `${Object.keys(files).sort().map((rel) => `${sha(files[rel])}  ${rel}`).join('\n')}\n`;
  writeFileSync(join(work, 'bundle', 'SHA256SUMS'), sums);
  mkdirSync(join(work, 'install'), { recursive: true });
  writeFileSync(join(work, 'install', 'marker'), 'OLD install tree\n');
  let digest = sha(sums);
  if (kind === 'wrong-digest') digest = 'f'.repeat(64);
  if (kind === 'corrupt-payload') appendFileSync(join(work, 'bundle', 'images', 'ops.tar'), 'X'); // SHA256SUMS untouched
  if (kind === 'unlisted-file') writeFileSync(join(work, 'bundle', 'install', 'extra.sh'), 'echo surprise\n');
  writeFileSync(join(work, 'run.sh'), `${prelude}\n${block}\necho "BUNDLE=$BUNDLE" >> "$audit"\n`);
  let rc = 0;
  try {
    execFileSync('bash', [join(work, 'run.sh'), work, digest], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    rc = e.status ?? 1;
  }
  const audit = existsSync(join(work, 'audit')) ? readFileSync(join(work, 'audit'), 'utf8') : '';
  const marker = existsSync(join(work, 'install', 'marker')) ? readFileSync(join(work, 'install', 'marker'), 'utf8') : '(missing)';
  rmSync(work, { recursive: true, force: true });
  return { rc, audit, marker, bundleAfter: /BUNDLE=(.*)/.exec(audit)?.[1] ?? '' };
}

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: Boolean(cond), detail });
for (const kind of ['wrong-digest', 'corrupt-payload', 'unlisted-file']) {
  const r = makeCase(kind);
  check(`${kind}: refused (FAIL U1)`, /result FAIL U1/.test(r.audit), r.audit.split('\n').find((l) => l.startsWith('result')) ?? '');
  check(`${kind}: no CLI/bootstrap call`, !/^cli /m.test(r.audit), (r.audit.match(/^cli .*/gm) ?? []).join(' | '));
  check(`${kind}: install tree unchanged`, r.marker === 'OLD install tree\n' && !/^in_host rm/m.test(r.audit), `marker=${JSON.stringify(r.marker)}`);
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
