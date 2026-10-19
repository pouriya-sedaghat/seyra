#!/usr/bin/env node
// Reproduce five client-handoff review findings against the actual checkout. No Docker daemon,
// corporate/LAN endpoints, live Seyra directory or real certificate material is accessed.
// Node >=24, OpenSSL, util-linux flock and bash. Exit 0 means all PRE-FIX defects reproduced;
// this is review evidence, not a desired-behaviour product regression suite.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(process.argv[2] ?? '.');
const out = process.argv[3] && resolve(process.argv[3]);
const w = mkdtempSync(join(tmpdir(), 'seyra-handoff-review-'));
const results = [];
const safeError = (e) => String(e?.message ?? e).split(w).join('<TEMP>');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const ossl = (...a) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const write = (p, s, mode = 0o600) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s, { mode }); };
const add = (id, defect_reproduced, observed) => results.push({ id, defect_reproduced, observed });

try {
  // H1: Run the actual host wrapper, recording Docker argv at its external boundary. Certificate,
  // root and intermediate inputs are deliberately in separate ordinary operator directories.
  const bin = join(w, 'bin'); mkdirSync(bin);
  const dockerLog = join(w, 'docker.args');
  write(join(bin, 'docker'), '#!/bin/bash\nif [ "$1" = network ]; then exit 1; fi\nprintf "%s\\0" "$@" > "$SEYRA_REVIEW_DOCKER_LOG"\n', 0o755);
  const cert = join(w, 'received-leaf', 'server.crt');
  const ca = join(w, 'trust', 'root.crt');
  const chain = join(w, 'intermediates', 'chain.crt');
  const key = join(w, 'server-key', 'server.key');
  for (const p of [cert, ca, chain, key]) write(p, 'recording-only input\n');
  const home = join(w, 'wrapper-home');
  const wr = spawnSync('bash', [join(repo, 'bin', 'seyra-maps'), 'tls', 'import', '--cert', cert, '--ca', ca, '--chain', chain, '--key', key, '--names', 'maps.example.test'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SEYRA_HOME: home, SEYRA_REVIEW_DOCKER_LOG: dockerLog }, encoding: 'utf8',
  });
  if (wr.status !== 0) throw new Error(`wrapper fixture failed: ${wr.stderr}`);
  const argv = readFileSync(dockerLog).toString().split('\0').filter(Boolean);
  const mounts = argv.flatMap((x, i) => x === '-v' ? [argv[i + 1].split(':')[1]] : []);
  const covered = (p) => mounts.some((d) => p === d || p.startsWith(`${d}/`));
  add('H1-wrapper-input-mounts', !covered(ca) && !covered(chain) && covered(cert) && covered(key), {
    cert_mounted: covered(cert), key_mounted: covered(key), ca_mounted: covered(ca), chain_mounted: covered(chain),
    ca_and_chain_still_passed_to_cli: argv.includes(ca) && argv.includes(chain),
  });

  // H5: Compare the configured ingress 413 literal to the actual exported OpenAPI schema. The
  // description permits a missing request_id, but the machine-readable required list forbids it.
  const locations = readFileSync(join(repo, 'infra', 'images', 'proxy', 'locations.conf.template'), 'utf8');
  const ingress413 = JSON.parse(locations.match(/return 413 '([^']+)';/)[1]);
  const spec = JSON.parse(readFileSync(join(repo, 'docs', 'openapi', 'map-services-v1.json'), 'utf8'));
  const required413 = spec.paths['/api/v1/map/route'].post.responses['413'].content['application/json'].schema.properties.error.required;
  add('H5-ingress-413-contract', required413.includes('request_id') && !Object.hasOwn(ingress413.error, 'request_id'), {
    configured_ingress_413: ingress413, openapi_error_required: required413,
    configured_response_violates_exported_schema: required413.some(k=>!Object.hasOwn(ingress413.error,k)),
  });

  // H3: Exercise the real egress script with a deterministic Docker recording stand-in. A route
  // exists to every forbidden destination. No network lookup or connection occurs in this test.
  const nsbin = join(w, 'nsbin'); mkdirSync(nsbin);
  write(join(nsbin, 'docker'), '#!/bin/bash\ncase "$*" in *"ip -4 route get"*) echo "192.0.2.1 via 198.18.0.1 dev eth0";; *ipv4/ip_forward*) echo 1;; *) echo "default via 198.18.0.1 dev eth0";; esac\n', 0o755);
  const nsout = join(w, 'namespace-evidence');
  const nr = spawnSync('bash', [join(repo, 'tests', 'offline', 'namespace-egress.sh'), nsout, 'disposable-review-host'], {
    env: { ...process.env, PATH: `${nsbin}:${process.env.PATH}`, APPROVED_SAMPLE: '192.0.2.10' }, encoding: 'utf8', timeout: 5000,
  });
  const nsSummary = existsSync(join(nsout, 'summary.txt')) ? readFileSync(join(nsout, 'summary.txt'), 'utf8').trim().split(w).join('<TEMP>') : '';
  add('H3-egress-failure-exit-status', nr.status === 0 && /^FAIL /m.test(nsSummary), { exit_code: nr.status, summary: nsSummary, stderr: nr.stderr.trim() });

  // Node's official transform removes TS annotations/parameter properties only. These copies keep
  // the actual logic and change local .js specifiers to .mjs, requiring no package installation.
  const modules = join(w, 'modules'); mkdirSync(modules);
  for (const name of ['proc', 'tls', 'lifecycle-lock']) {
    const source = readFileSync(join(repo, 'apps', 'ops', 'src', `${name}.ts`), 'utf8');
    const js = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/from '(\.\/[^']+)\.js'/g, "from '$1.mjs'");
    write(join(modules, `${name}.mjs`), js);
  }
  const tls = await import(pathToFileURL(join(modules, 'tls.mjs')));
  const locks = await import(pathToFileURL(join(modules, 'lifecycle-lock.mjs')));
  // This sandbox reports uid 0 but disallows chown to the image's uid 101. Exercise the module's
  // explicit unprivileged-test branch (only ownership adjustment is skipped); no TLS/filesystem
  // operation, certificate result, lock or import/recovery decision is replaced.
  const actualGetuid = process.getuid;
  if (process.getuid?.() === 0) process.getuid = () => 1000;
  const material = join(w, 'material'); mkdirSync(material);
  const f = (n) => join(material, n);
  const mkca = (name, signer) => {
    ossl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f(`${name}.key`), '-out', f(`${name}.csr`), '-subj', `/CN=${name}`);
    write(f(`${name}.ext`), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
    ossl('x509', '-req', '-in', f(`${name}.csr`), ...(signer ? ['-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial'] : ['-key', f(`${name}.key`)]), '-out', f(`${name}.crt`), '-days', '2', '-extfile', f(`${name}.ext`));
  };
  mkca('root'); mkca('intermediate', 'root');
  write(f('leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:maps.example.test\nauthorityKeyIdentifier=keyid\n');
  const issue = (csr, output, signer = 'intermediate') => ossl('x509', '-req', '-in', csr, '-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial', '-out', output, '-days', '1', '-extfile', f('leaf.ext'));
  ossl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f('old.key'), '-out', f('old.csr'), '-subj', '/CN=maps.example.test');
  issue(f('old.csr'), f('old.crt'), 'root');
  const names = ['maps.example.test'];

  // H2: The actual import holds the existing kernel lifecycle lock. Pause its final OpenSSL check
  // (then run real OpenSSL unchanged). The new CLI dispatch invokes CSR without that lock, so it
  // can replace the pending key at this exact boundary. No product file or decision is mocked.
  const dir = join(w, 'race-tls'); mkdirSync(dir);
  copyFileSync(f('old.crt'), join(dir, 'server.crt')); copyFileSync(f('old.key'), join(dir, 'server.key')); copyFileSync(f('root.crt'), join(dir, 'ca.crt'));
  const before = { cert: sha(join(dir, 'server.crt')), key: sha(join(dir, 'server.key')) };
  const p = { dir };
  const csr = await tls.tlsCsr(p, names, () => {});
  issue(csr.csr, f('issued.crt'));
  const pause = join(w, 'paused'), release = join(w, 'release');
  write(join(w, 'openssl-pause'), `#!/usr/bin/env node\nimport {existsSync,writeFileSync} from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst a=process.argv.slice(2);\nif(a[0]==='verify'&&a.includes('-x509_strict')){writeFileSync(${JSON.stringify(pause)},'paused');const until=Date.now()+10000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>until)process.exit(99);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}\nconst r=spawnSync('openssl',a,{stdio:'inherit'});process.exit(r.status??1);\n`, 0o755);
  const lock = { lifecycleLock: join(w, 'state', 'lifecycle.lock'), transitionFile: join(w, 'state', 'transition.json') };
  const importing = locks.withLifecycleLock(lock, 'tls-import', null, () => tls.tlsImport(p, { cert: f('issued.crt'), ca: f('root.crt'), chain: f('intermediate.crt'), names, openssl: join(w, 'openssl-pause') }, () => {})).then(() => null, (e) => e);
  const deadline = Date.now() + 10000;
  while (!existsSync(pause)) { if(Date.now()>deadline)throw new Error('OpenSSL pause not reached'); await new Promise(r=>setTimeout(r,10)); }
  const lockHeld = locks.lifecycleLockState(lock.lifecycleLock).held;
  await tls.tlsCsr(p, names, () => {}, { replacePending: true });
  write(release, 'continue');
  const importError = await importing;
  let servedError = null; try { tls.assertServedPair(p); } catch(e) { servedError = safeError(e); }
  const after = { cert: sha(join(dir, 'server.crt')), key: sha(join(dir, 'server.key')) };
  let recoveryError = null; try { tls.tlsRecover(p, () => {}); } catch(e) { recoveryError = safeError(e); }
  const dispatch = readFileSync(join(repo, 'apps', 'ops', 'src', 'main.ts'), 'utf8');
  add('H2-pending-csr-import-race', lockHeld && !!importError && /does not match/.test(String(importError)) && !!servedError && before.key !== after.key && before.cert !== after.cert, {
    import_held_kernel_lock: lockHeld,
    csr_dispatch_calls_without_lifecycle_lock: /else if \(rest\[0\] === 'csr'\) await tlsCsr/.test(dispatch),
    csr_replacement_succeeded_while_import_locked: true,
    import_error: safeError(importError),
    served_pair_refused: servedError,
    tls_recover_error: recoveryError,
    previous_cert_changed: before.cert !== after.cert, previous_key_changed: before.key !== after.key,
    replacement_journal_retained: existsSync(join(dir, 'replace.json')),
    recover_dispatch_calls_without_lifecycle_lock: /else if \(rest\[0\] === 'recover'\) log\(/.test(dispatch),
  });

  // H4: A company-CA chain is actually stored and backed up as leaf+intermediate in server.crt.
  // The documented rollback points tls import at that backup; exactlyOne rejects its own output.
  const renewDir = join(w, 'renew-tls');
  const rp = { dir: renewDir };
  const rcsr = await tls.tlsCsr(rp, names, () => {});
  issue(rcsr.csr, f('renew1.crt'));
  await tls.tlsImport(rp, { cert: f('renew1.crt'), ca: f('root.crt'), chain: f('intermediate.crt'), names }, () => {});
  const rcsr2 = await tls.tlsCsr(rp, names, () => {});
  issue(rcsr2.csr, f('renew2.crt'));
  const logs = [];
  await tls.tlsImport(rp, { cert: f('renew2.crt'), ca: f('root.crt'), chain: f('intermediate.crt'), names }, (m) => logs.push(m));
  const backup = logs.find(l=>l.startsWith('[tls] previous pair kept in ')).slice('[tls] previous pair kept in '.length);
  const backedUpCount = (readFileSync(join(backup, 'server.crt'), 'utf8').match(/BEGIN CERTIFICATE/g) ?? []).length;
  let rollbackError = null;
  try { await tls.tlsImport(rp, { cert: join(backup, 'server.crt'), key: join(backup, 'server.key'), ca: join(backup, 'ca.crt'), names }, () => {}); } catch(e) { rollbackError=safeError(e); }
  add('H4-chain-backup-rollback', backedUpCount === 2 && /exactly one certificate/.test(rollbackError ?? ''), {
    valid_chain_imports_succeeded: 2, backed_up_certificate_count: backedUpCount, rollback_error: rollbackError,
  });
  process.getuid = actualGetuid;
} catch(e) {
  add('HARNESS_ERROR', false, { message: safeError(e), stack: String(e.stack).split(w).join('<TEMP>') });
} finally {
  const report = { node: process.version, openssl: ossl('version').trim(), scope: 'Actual code, temporary certificates, recording Docker stubs; no Docker workloads or live host access', ownership_test_adapter: 'Module unprivileged-test branch selected by process.getuid; sandbox cannot chown to uid 101', results };
  if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  rmSync(w,{recursive:true,force:true});
}
process.exit(results.length === 5 && results.every(r=>r.defect_reproduced) ? 0 : 1);
