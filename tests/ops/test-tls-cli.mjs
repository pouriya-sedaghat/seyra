// Regressions for review H2 and H4 (6602199), black-box through the real OPS CLI entry point
// (apps/ops/dist/main.js of the given checkout) in separate processes, with the real kernel
// lifecycle lock, real OpenSSL and a temporary root -> intermediate -> leaf hierarchy.
//
//   node tests/ops/test-tls-cli.mjs [checkout-root]        (built apps/ops/dist required)
//
// Determinism: an `openssl` wrapper first on PATH pauses import at its final validation command
// (`verify -x509_strict`) until the test releases it, so "a second command while import holds the
// lock" happens at an exact point. Everything else is the product's own code.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const cliJs = join(root, 'apps', 'ops', 'dist', 'main.js');
if (!existsSync(cliJs)) {
  console.log(`NOT RUN: ${cliJs} missing (build apps/ops first)`);
  process.exit(3);
}
const w = mkdtempSync(join(tmpdir(), 'seyra-tls-cli-'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const realOpenssl = execFileSync('sh', ['-c', 'command -v openssl']).toString().trim();
const ossl = (...a) => execFileSync(realOpenssl, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
// OpenSSL 3.5 `genpkey` exits 0 even when it cannot write -out (e.g. a 0400 file): replace the file
// explicitly and prove the content changed, so a setup step can never silently do nothing.
function newKey(path) {
  const before = existsSync(path) ? sha(path) : null;
  rmSync(path, { force: true });
  ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-out', path);
  if (!existsSync(path) || sha(path) === before) throw new Error(`test setup could not replace ${path}`);
}
const f = (n) => join(w, 'pki', n);
mkdirSync(join(w, 'pki'));
const NAMES = 'maps.example.test';

// --- temporary hierarchy (test-only) ------------------------------------------------------------
function mkca(name, signer) {
  ossl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f(`${name}.key`), '-out', f(`${name}.csr`), '-subj', `/CN=${name}`);
  writeFileSync(f(`${name}.ext`), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
  ossl('x509', '-req', '-in', f(`${name}.csr`), ...(signer ? ['-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial'] : ['-key', f(`${name}.key`)]), '-out', f(`${name}.crt`), '-days', '5', '-extfile', f(`${name}.ext`));
}
mkca('root');
mkca('intermediate', 'root');
writeFileSync(f('leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${NAMES}\nauthorityKeyIdentifier=keyid\n`);
const issue = (csr, out) => ossl('x509', '-req', '-in', csr, '-CA', f('intermediate.crt'), '-CAkey', f('intermediate.key'), '-CAcreateserial', '-out', out, '-days', '2', '-extfile', f('leaf.ext'));

// --- CLI helpers --------------------------------------------------------------------------------
const pauseDir = join(w, 'pausebin');
mkdirSync(pauseDir);
writeFileSync(join(pauseDir, 'openssl'), `#!/bin/sh
for a in "$@"; do if [ "$a" = -x509_strict ] && [ -n "$PAUSE_FILE" ]; then
  : > "$PAUSE_FILE"; i=0; while [ ! -e "$RELEASE_FILE" ] && [ $i -lt 2000 ]; do sleep 0.01; i=$((i+1)); done
fi; done
exec ${realOpenssl} "$@"
`);
chmodSync(join(pauseDir, 'openssl'), 0o755);
function homeFor(name) {
  const home = join(w, name);
  mkdirSync(join(home, 'secrets', 'tls'), { recursive: true });
  return home;
}
const env = (home, extra = {}) => ({ ...process.env, SEYRA_HOME: home, SEYRA_INSTALL_DIR: join(home, 'install'), PATH: `${pauseDir}:${process.env.PATH}`, ...extra });
const cli = (home, args, extra) => spawnSync(process.execPath, [cliJs, ...args], { env: env(home, extra), encoding: 'utf8', timeout: 60_000 });
const cliAsync = (home, args, extra) =>
  new Promise((res) => {
    const c = spawn(process.execPath, [cliJs, ...args], { env: env(home, extra) });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => res({ status: code, out }));
  });
const waitFor = async (p, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!existsSync(p)) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${p}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const tlsDir = (home) => join(home, 'secrets', 'tls');
const pairOk = (home) => {
  const d = tlsDir(home);
  try {
    const a = ossl('x509', '-in', join(d, 'server.crt'), '-noout', '-pubkey');
    const b = ossl('pkey', '-in', join(d, 'server.key'), '-pubout');
    return a === b;
  } catch {
    return false;
  }
};
/** A served starting point: an earlier valid import (previous pair to fall back to). */
function seed(home) {
  const r1 = cli(home, ['tls', 'csr', '--names', NAMES]);
  if (r1.status !== 0) throw new Error(`csr failed: ${r1.stderr}`);
  issue(join(tlsDir(home), 'pending', 'server.csr'), f(`${home.split('/').pop()}-first.crt`));
  const r2 = cli(home, ['tls', 'import', '--cert', f(`${home.split('/').pop()}-first.crt`), '--chain', f('intermediate.crt'), '--ca', f('root.crt'), '--names', NAMES]);
  if (r2.status !== 0) throw new Error(`first import failed: ${r2.stdout}${r2.stderr}`);
}

try {
  // ------------------------------------------------------------------------------------------
  // H2a: CSR replacement while import holds the lifecycle lock.
  // ------------------------------------------------------------------------------------------
  {
    const home = homeFor('csr-race');
    seed(home);
    const before = { cert: sha(join(tlsDir(home), 'server.crt')), key: sha(join(tlsDir(home), 'server.key')) };
    cli(home, ['tls', 'csr', '--names', NAMES]);
    const validatedKey = sha(join(tlsDir(home), 'pending', 'server.key'));
    issue(join(tlsDir(home), 'pending', 'server.csr'), f('race.crt'));
    const pause = join(w, 'csr-race.paused');
    const release = join(w, 'csr-race.release');
    const importing = cliAsync(home, ['tls', 'import', '--cert', f('race.crt'), '--chain', f('intermediate.crt'), '--ca', f('root.crt'), '--names', NAMES], { PAUSE_FILE: pause, RELEASE_FILE: release });
    await waitFor(pause);
    const csr = cli(home, ['tls', 'csr', '--names', NAMES, '--replace-pending']);
    writeFileSync(release, '');
    const imp = await importing;
    check('H2a: tls csr --replace-pending is refused while tls import holds the lifecycle lock', csr.status !== 0 && /another lifecycle operation is running/.test(csr.stderr), `rc=${csr.status} ${csr.stderr.trim()}`);
    check('H2a: the import completes', imp.status === 0, imp.out.trim().split('\n').slice(-2).join(' '));
    check('H2a: served certificate and key match after the import', pairOk(home));
    check('H2a: the served key is the validated pending key', sha(join(tlsDir(home), 'server.key')) === validatedKey);
    check('H2a: no replacement journal is left', !existsSync(join(tlsDir(home), 'replace.json')));
    check('H2a: the served set changed exactly once (to the new pair)', sha(join(tlsDir(home), 'server.crt')) !== before.cert);
  }
  // ------------------------------------------------------------------------------------------
  // H2b: tls recover while import holds the lifecycle lock.
  // ------------------------------------------------------------------------------------------
  {
    const home = homeFor('recover-race');
    seed(home);
    cli(home, ['tls', 'csr', '--names', NAMES]);
    issue(join(tlsDir(home), 'pending', 'server.csr'), f('rr.crt'));
    const pause = join(w, 'rr.paused');
    const release = join(w, 'rr.release');
    const importing = cliAsync(home, ['tls', 'import', '--cert', f('rr.crt'), '--chain', f('intermediate.crt'), '--ca', f('root.crt'), '--names', NAMES], { PAUSE_FILE: pause, RELEASE_FILE: release });
    await waitFor(pause);
    const rec = cli(home, ['tls', 'recover']);
    writeFileSync(release, '');
    const imp = await importing;
    check('H2b: tls recover is refused while tls import holds the lifecycle lock', rec.status !== 0 && /another lifecycle operation is running/.test(rec.stderr), `rc=${rec.status} ${(rec.stdout + rec.stderr).trim()}`);
    check('H2b: the import completes with a matching pair', imp.status === 0 && pairOk(home), imp.out.trim().split('\n').slice(-1)[0]);
  }
  // ------------------------------------------------------------------------------------------
  // H2c: an input changed by an unlocked writer after it was read: what is installed is the
  // validated snapshot, never the changed path.
  // ------------------------------------------------------------------------------------------
  {
    const home = homeFor('snapshot');
    seed(home);
    cli(home, ['tls', 'csr', '--names', NAMES]);
    const pendingKey = join(tlsDir(home), 'pending', 'server.key');
    const validatedKey = sha(pendingKey);
    issue(join(tlsDir(home), 'pending', 'server.csr'), f('snap.crt'));
    const pause = join(w, 'snap.paused');
    const release = join(w, 'snap.release');
    const importing = cliAsync(home, ['tls', 'import', '--cert', f('snap.crt'), '--chain', f('intermediate.crt'), '--ca', f('root.crt'), '--names', NAMES], { PAUSE_FILE: pause, RELEASE_FILE: release });
    await waitFor(pause);
    // A writer outside Seyra's lock replaces the pending key file in place.
    newKey(pendingKey);
    writeFileSync(release, '');
    const imp = await importing;
    check('H2c: the import installs the validated snapshot, not the replaced path', imp.status === 0 && sha(join(tlsDir(home), 'server.key')) === validatedKey && pairOk(home), `rc=${imp.status} ${imp.out.trim().split('\n').slice(-1)[0]}`);
  }
  // ------------------------------------------------------------------------------------------
  // H2d: recovery does not trust a journal whose new set is an incompatible pair; it restores the
  // verified previous pair. H2e: if neither is valid it refuses and keeps everything.
  // ------------------------------------------------------------------------------------------
  for (const backupValid of [true, false]) {
    const home = homeFor(`recover-${backupValid ? 'fallback' : 'none'}`);
    seed(home);
    const d = tlsDir(home);
    const prev = join(d, 'previous-test');
    mkdirSync(prev);
    for (const x of ['server.crt', 'server.key', 'ca.crt']) writeFileSync(join(prev, x), readFileSync(join(d, x)));
    if (!backupValid) newKey(join(prev, 'server.key'));
    const before = { cert: sha(join(d, 'server.crt')), key: sha(join(d, 'server.key')), trust: sha(join(d, 'ca.crt')) };
    // The broken state the review produced: current files match the journal's hashes but the
    // certificate belongs to another key.
    newKey(join(d, 'server.key'));
    const journal = { schema: 'seyra.tls-replace/1', started_at: new Date().toISOString(), previous: { cert_sha256: before.cert, key_sha256: before.key }, next: { cert_sha256: sha(join(d, 'server.crt')), key_sha256: sha(join(d, 'server.key')), trust_sha256: sha(join(d, 'ca.crt')) }, backup: prev };
    writeFileSync(join(d, 'replace.json'), JSON.stringify(journal));
    const broken = { cert: sha(join(d, 'server.crt')), key: sha(join(d, 'server.key')) };
    const rec = cli(home, ['tls', 'recover']);
    if (backupValid) {
      check('H2d: recover restores the verified previous pair instead of the journal-matching incompatible set', rec.status === 0 && /restored/.test(rec.stdout) && pairOk(home) && sha(join(d, 'server.key')) === before.key && !existsSync(join(d, 'replace.json')), `rc=${rec.status} ${(rec.stdout + rec.stderr).trim().slice(-200)}`);
    } else {
      check('H2e: with no valid candidate, recover refuses and keeps the journal and files', rec.status !== 0 && existsSync(join(d, 'replace.json')) && sha(join(d, 'server.crt')) === broken.cert && sha(join(d, 'server.key')) === broken.key, `rc=${rec.status} ${(rec.stdout + rec.stderr).trim().slice(-200)}`);
      const st = cli(home, ['tls', 'csr', '--names', NAMES, '--replace-pending']);
      check('H2e: a new CSR is refused while the replacement is unfinished', st.status !== 0 && /did not finish/.test(st.stderr), `rc=${st.status} ${st.stderr.trim()}`);
    }
  }
  // ------------------------------------------------------------------------------------------
  // H4: import -> renewal -> documented rollback with the actual saved full-chain backup.
  // ------------------------------------------------------------------------------------------
  {
    const home = homeFor('rollback');
    seed(home);
    const d = tlsDir(home);
    const first = { cert: readFileSync(join(d, 'server.crt')), key: readFileSync(join(d, 'server.key')), trust: readFileSync(join(d, 'ca.crt')) };
    check('H4: the served certificate is leaf + intermediate', (first.cert.toString().match(/BEGIN CERTIFICATE/g) ?? []).length === 2);
    cli(home, ['tls', 'csr', '--names', NAMES]);
    issue(join(d, 'pending', 'server.csr'), f('renewed.crt'));
    const renew = cli(home, ['tls', 'import', '--cert', f('renewed.crt'), '--chain', f('intermediate.crt'), '--ca', f('root.crt'), '--names', NAMES]);
    check('H4: renewal import succeeds', renew.status === 0, renew.stderr.trim());
    const backup = readdirSync(d).filter((x) => x.startsWith('previous-')).map((x) => join(d, x)).find((p) => existsSync(join(p, 'server.crt')) && readFileSync(join(p, 'server.crt')).equals(first.cert));
    check('H4: the renewal kept the first served set as a backup', backup);
    // The rollback command documented in DEPLOYMENT_PLAN.md §4 / RUNBOOK: tls restore --from <backup>.
    const rb = cli(home, ['tls', 'restore', '--from', backup ?? '/nonexistent']);
    check('H4: documented rollback (tls restore --from <backup>) succeeds on the full-chain backup', rb.status === 0, `rc=${rb.status} ${(rb.stdout + rb.stderr).trim().slice(-200)}`);
    check('H4: served chain, key and trust anchor are byte-identical to the first served set', readFileSync(join(d, 'server.crt')).equals(first.cert) && readFileSync(join(d, 'server.key')).equals(first.key) && readFileSync(join(d, 'ca.crt')).equals(first.trust));
    check('H4: no journal left after the rollback', !existsSync(join(d, 'replace.json')));
    // The backup's separated representation also works with a plain import (leaf + chain files).
    const sep = cli(home, ['tls', 'import', '--cert', join(backup, 'leaf.crt'), '--chain', join(backup, 'chain.pem'), '--key', join(backup, 'server.key'), '--ca', join(backup, 'ca.crt'), '--names', NAMES]);
    check('H4: the backup\'s split leaf.crt/chain.pem import cleanly as well', sep.status === 0 && readFileSync(join(d, 'server.crt')).equals(first.cert), `rc=${sep.status} ${sep.stderr.trim().slice(-160)}`);
    // A tampered backup is validated like an import and refused, keeping what is served.
    const now = { cert: sha(join(d, 'server.crt')), key: sha(join(d, 'server.key')) };
    const bad = join(d, 'previous-tampered');
    mkdirSync(bad);
    for (const x of ['server.crt', 'ca.crt']) writeFileSync(join(bad, x), readFileSync(join(d, x)));
    newKey(join(bad, 'server.key'));
    const rbBad = cli(home, ['tls', 'restore', '--from', bad]);
    check('H4: a backup whose key does not match is refused and the served set is kept', rbBad.status !== 0 && sha(join(d, 'server.crt')) === now.cert && sha(join(d, 'server.key')) === now.key, `rc=${rbBad.status} ${rbBad.stderr.trim().slice(-160)}`);
  }
} catch (e) {
  check('harness completed', false, e.stack ?? e);
} finally {
  rmSync(w, { recursive: true, force: true });
}
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# checkout=${root} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
