// Regression for review R1 (e6a39ab): `tls recover` may only restore a COMPLETE, validated previous
// set (server.crt, server.key, ca.crt and its metadata), never a matching leaf/key with altered,
// missing or unrelated trust material; when neither the proposed nor the backup set is valid it
// must refuse and leave the journal and every active file unchanged.
//
//   node tests/ops/test-tls-recover.mjs [checkout-root]      (built apps/ops/dist required)
//
// The interrupted state is produced by the checkout's own tlsImport (its existing interruption
// hook, real temporary root -> intermediate -> leaf PKI), so the journal and backup are exactly
// what that code writes. Recovery runs through the real CLI entry point in a separate process.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const dist = join(root, 'apps', 'ops', 'dist');
if (!existsSync(join(dist, 'main.js'))) {
  console.log(`NOT RUN: ${dist}/main.js missing (build apps/ops first)`);
  process.exit(3);
}
const w = mkdtempSync(join(tmpdir(), 'seyra-tls-recover-'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const ossl = (...a) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const sha = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null);
const f = (n) => join(w, 'pki', n);
mkdirSync(join(w, 'pki'));
const NAMES = ['maps.example.test'];

function mkca(name, signer) {
  ossl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f(`${name}.key`), '-out', f(`${name}.csr`), '-subj', `/CN=${name}`);
  writeFileSync(f(`${name}.ext`), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
  ossl('x509', '-req', '-in', f(`${name}.csr`), ...(signer ? ['-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial'] : ['-key', f(`${name}.key`)]), '-out', f(`${name}.crt`), '-days', '5', '-extfile', f(`${name}.ext`));
}
function mkleaf(name, signer) {
  writeFileSync(f(`${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${NAMES[0]}\nauthorityKeyIdentifier=keyid\n`);
  ossl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f(`${name}.key`), '-out', f(`${name}.csr`), '-subj', `/CN=${NAMES[0]}`);
  ossl('x509', '-req', '-in', f(`${name}.csr`), '-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial', '-out', f(`${name}.crt`), '-days', '2', '-extfile', f(`${name}.ext`));
}
mkca('rootA');
mkca('intA', 'rootA');
mkca('rootB');
mkleaf('first', 'intA');
mkleaf('second', 'rootB');

const cli = (home, args) => spawnSync(process.execPath, [join(dist, 'main.js'), ...args], { env: { ...process.env, SEYRA_HOME: home, SEYRA_INSTALL_DIR: join(home, 'install') }, encoding: 'utf8', timeout: 60_000 });
/** Run the checkout's own tlsImport with its interruption hook (journal written, one file renamed). */
function interruptedImport(dir) {
  const script = `const t = await import(${JSON.stringify(pathToFileURL(join(dist, 'tls.js')).href)});
await t.tlsImport({ dir: ${JSON.stringify(dir)} }, { cert: ${JSON.stringify(f('second.crt'))}, key: ${JSON.stringify(f('second.key'))}, ca: ${JSON.stringify(f('rootB.crt'))}, names: ${JSON.stringify(NAMES)}, crashAfter: 'key' }, () => {});`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
}
const ACTIVE = ['server.crt', 'server.key', 'ca.crt', 'served.json'];
const snapshot = (d) => Object.fromEntries(ACTIVE.map((x) => [x, sha(join(d, x))]));
const chainOk = (d) => spawnSync('openssl', ['verify', '-purpose', 'sslserver', '-verify_hostname', NAMES[0], '-CAfile', join(d, 'ca.crt'), '-untrusted', join(d, 'server.crt'), join(d, 'server.crt')], { encoding: 'utf8' }).status === 0;
const writable = (p) => existsSync(p) && chmodSync(p, 0o600);

/** A home with a valid A-root import active, then an interrupted B-root import. */
function scenario(name) {
  const home = join(w, name);
  const d = join(home, 'secrets', 'tls');
  mkdirSync(d, { recursive: true });
  const r = cli(home, ['tls', 'import', '--cert', f('first.crt'), '--key', f('first.key'), '--chain', f('intA.crt'), '--ca', f('rootA.crt'), '--names', NAMES.join(',')]);
  if (r.status !== 0) throw new Error(`${name}: first import failed: ${r.stdout}${r.stderr}`);
  const setA = snapshot(d);
  interruptedImport(d);
  const journal = JSON.parse(readFileSync(join(d, 'replace.json'), 'utf8'));
  return { home, d, setA, journal, backup: journal.backup };
}
function expectRefusal(label, s) {
  const before = snapshot(s.d);
  const journalBytes = readFileSync(join(s.d, 'replace.json'));
  const r = cli(s.home, ['tls', 'recover']);
  check(`${label}: recover refuses`, r.status !== 0, `rc=${r.status} ${(r.stdout + r.stderr).trim().slice(-200)}`);
  check(`${label}: every active file unchanged`, JSON.stringify(snapshot(s.d)) === JSON.stringify(before), JSON.stringify({ before, after: snapshot(s.d) }));
  check(`${label}: journal kept unchanged`, existsSync(join(s.d, 'replace.json')) && readFileSync(join(s.d, 'replace.json')).equals(journalBytes));
}

try {
  // Valid proposed completion.
  {
    const s = scenario('completion');
    const r = cli(s.home, ['tls', 'recover']);
    check('valid completion: recover completes the proposed set', r.status === 0 && /completed/.test(r.stdout) && !existsSync(join(s.d, 'replace.json')) && sha(join(s.d, 'server.key')) === sha(f('second.key')) && chainOk(s.d), `rc=${r.status} ${(r.stdout + r.stderr).trim().slice(-200)}`);
  }
  // Valid fallback: the staged certificate is damaged, the complete backup is intact.
  {
    const s = scenario('fallback');
    rmSync(join(s.d, 'next', 'server.crt'));
    const r = cli(s.home, ['tls', 'recover']);
    check('valid fallback: recover restores the complete previous set', r.status === 0 && /restored/.test(r.stdout), `rc=${r.status} ${(r.stdout + r.stderr).trim().slice(-200)}`);
    check('valid fallback: certificate, key, trust anchor and metadata equal the previous set', JSON.stringify(snapshot(s.d)) === JSON.stringify(s.setA), JSON.stringify({ want: s.setA, got: snapshot(s.d) }));
    check('valid fallback: the restored certificate verifies against the restored trust anchor', chainOk(s.d));
    check('valid fallback: journal removed', !existsSync(join(s.d, 'replace.json')));
  }
  // Neither valid: staged certificate damaged AND the backup's trust anchor replaced by unrelated root B.
  {
    const s = scenario('wrong-root');
    rmSync(join(s.d, 'next', 'server.crt'));
    writable(join(s.backup, 'ca.crt'));
    writeFileSync(join(s.backup, 'ca.crt'), readFileSync(f('rootB.crt')));
    expectRefusal('backup with an unrelated root (review R1)', s);
  }
  {
    const s = scenario('missing-root');
    rmSync(join(s.d, 'next', 'server.crt'));
    rmSync(join(s.backup, 'ca.crt'));
    expectRefusal('backup without its trust anchor', s);
  }
  {
    const s = scenario('corrupt-root');
    rmSync(join(s.d, 'next', 'server.crt'));
    writable(join(s.backup, 'ca.crt'));
    writeFileSync(join(s.backup, 'ca.crt'), '-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n');
    expectRefusal('backup with a corrupt trust anchor', s);
  }
  {
    const s = scenario('incomplete');
    rmSync(join(s.d, 'next', 'server.crt'));
    rmSync(join(s.backup, 'server.key'));
    expectRefusal('incomplete backup (no key)', s);
  }
  {
    const s = scenario('metadata');
    rmSync(join(s.d, 'next', 'server.crt'));
    const meta = join(s.backup, 'served.json');
    if (existsSync(meta)) {
      writable(meta);
      const m = JSON.parse(readFileSync(meta, 'utf8'));
      m.names = ['other.example.test'];
      writeFileSync(meta, JSON.stringify(m));
      expectRefusal('backup with inconsistent metadata', s);
    } else check('backup with inconsistent metadata: backup carries served.json', false, 'no served.json in the backup');
  }
  // Compatibility: a journal written before backups were integrity-bound (no backup_files record).
  for (const valid of [true, false]) {
    const s = scenario(`legacy-journal-${valid ? 'valid' : 'wrong-root'}`);
    rmSync(join(s.d, 'next', 'server.crt'));
    const j = JSON.parse(readFileSync(join(s.d, 'replace.json'), 'utf8'));
    delete j.backup_files;
    j.schema = 'seyra.tls-replace/2';
    writable(join(s.d, 'replace.json'));
    writeFileSync(join(s.d, 'replace.json'), JSON.stringify(j));
    if (!valid) {
      writable(join(s.backup, 'ca.crt'));
      writeFileSync(join(s.backup, 'ca.crt'), readFileSync(f('rootB.crt')));
      expectRefusal('older journal, backup with an unrelated root', s);
    } else {
      const r = cli(s.home, ['tls', 'recover']);
      check('older journal, complete chain-valid backup: restored', r.status === 0 && /restored/.test(r.stdout) && JSON.stringify(snapshot(s.d)) === JSON.stringify(s.setA) && chainOk(s.d), `rc=${r.status} ${(r.stdout + r.stderr).trim().slice(-200)}`);
    }
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
