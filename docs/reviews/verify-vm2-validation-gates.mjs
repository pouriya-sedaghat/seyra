// Reproduce two validation-harness defects at the attached 82942c1 patch.
// Usage: node verify-vm2-validation-gates.mjs PATCHED_CHECKOUT
// No Docker/network access. The actual update block runs with Docker/CLI call recorders and
// temporary fixture files; the actual browser audit predicate runs with controlled report inputs.
// This confirms pre-fix bugs, not desired post-fix acceptance behavior.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join,resolve } from 'node:path';

const root=resolve(process.argv[2]);
const work=mkdtempSync(join(process.cwd(),'seyra-validation-gates-'));
mkdirSync(join(work,'bundle/install'),{recursive:true});mkdirSync(join(work,'out'));
writeFileSync(join(work,'bundle/install/marker'),'copied before digest rejection');
writeFileSync(join(work,'bundle/SHA256SUMS'),'fixture untrusted completion data\n');
writeFileSync(join(work,'out/.egress-start'),'0\n');
const text=readFileSync(join(root,'tests/validation/iran-offline-host.sh'),'utf8');
const block=text.slice(text.indexOf('if has update; then'),text.indexOf('\nif has import; then'));
assert.ok(block.length>0);
const prelude=String.raw`
set -u
work="$1"
UPDATE_BUNDLE="$work/bundle"
UPDATE_SUMS_DIGEST=deliberately-wrong
OUT="$work/out"
inst="$work/install"
audit="$work/audit"
has(){ [ "$1" = update ]; }
in_host(){ printf 'in_host %s\n' "$*" >> "$audit"; }
cli(){ printf 'cli %s\n' "$*" >> "$audit"; case "$1" in bootstrap-load) echo 'identities match the manifest';; verify-images) echo 'OK';; esac; }
timed(){ shift; "$@"; }
result(){ printf 'result %s\n' "$*" >> "$audit"; }
`;
writeFileSync(join(work,'run.sh'),prelude+'\n'+block+'\n');
execFileSync('bash',[join(work,'run.sh'),work]);
const audit=readFileSync(join(work,'audit'),'utf8');
assert.ok(audit.includes('cli bootstrap-load')&&audit.includes('result FAIL U1'));
assert.ok(existsSync(join(work,'install/marker')));

const browser=readFileSync(join(root,'tests/validation/iran-browser.mjs'),'utf8');
const expression=/^const ok = (.+);$/m.exec(browser)?.[1];
assert.equal(expression,'external.length === 0 && rtlPlugin.length === 0 && failed.length === 0');
const predicate=new Function('external','rtlPlugin','failed','consoleErrors','visits','return '+expression);
assert.equal(predicate([],[],[],['console error'],[{found:true}]),true);
assert.equal(predicate([],[],[],[],[{found:false}]),true);
const evidence={reported_head:'82942c1296e638c8715c021fee49aeb7c540a703',update_gate:{wrong_digest:true,install_copied:true,bootstrap_invoked:true,eventual_result:'FAIL U1'},browser_gate:{accepts_console_error:true,accepts_missing_required_visit:true},limitations:'Harness control-flow reproductions only; no Docker/bootstrap program or browser was executed.'};
const file=join(work,'verification.json');writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({...evidence,evidence:file},null,2));
