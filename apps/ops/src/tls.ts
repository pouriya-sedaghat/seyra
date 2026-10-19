import { createHash, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { run } from './proc.js';

/**
 * Server TLS provisioning with an issuer managed OUTSIDE the serving host (company CA or an
 * operator-controlled development issuer). Only the server leaf key, the served chain and the
 * public trust anchor live in secrets/tls; an issuer private key never does.
 *
 *   tls csr     new server key (kept on the host) + CSR for the issuer
 *   tls import  validate a returned leaf/chain/trust anchor against the key and the expected names,
 *               then replace the served pair through a journal (recoverable, never half-written)
 *   tls status  public metadata of the served certificate
 *   tls recover finish or undo an interrupted replacement
 *
 * The legacy `tls init` (on-host test CA for synthetic fixtures) is unchanged and test-only.
 */

export interface TlsPaths {
  dir: string; // secrets/tls
}

export const TLS_FILES = { cert: 'server.crt', key: 'server.key', trust: 'ca.crt', legacyCaKey: 'ca.key' } as const;
const JOURNAL = 'replace.json';
const PENDING = 'pending';
/** Apple platforms reject TLS server certificates valid for longer than this. */
export const MAX_LEAF_DAYS = 825;
/** nginx in the proxy image reads the key as this user. */
const PROXY_UID = 101;

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function pemBlocks(text: string): { type: string; pem: string }[] {
  return [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g)].map((m) => ({ type: m[1]!, pem: `${m[0]}\n` }));
}

function certsOf(path: string, what: string, opts: { exactlyOne?: boolean; allowEmpty?: boolean } = {}): X509Certificate[] {
  const text = readFileSync(path, 'utf8');
  const blocks = pemBlocks(text);
  if (blocks.some((b) => /PRIVATE KEY/.test(b.type))) throw new Error(`${what} (${path}) contains a private key; only certificates belong there (an issuer key must never reach the server)`);
  const certs = blocks.filter((b) => b.type === 'CERTIFICATE');
  if (blocks.length !== certs.length) throw new Error(`${what} (${path}) contains non-certificate PEM blocks: ${blocks.filter((b) => b.type !== 'CERTIFICATE').map((b) => b.type).join(', ')}`);
  if (!certs.length && !opts.allowEmpty) throw new Error(`${what} (${path}) holds no certificate`);
  if (opts.exactlyOne && certs.length !== 1) throw new Error(`${what} (${path}) must hold exactly one certificate (found ${certs.length}); pass intermediates with --chain`);
  return certs.map((b) => new X509Certificate(b.pem));
}

function keyOf(path: string): { pem: string; publicDer: string; type: string; detail: string } {
  const text = readFileSync(path, 'utf8');
  const blocks = pemBlocks(text);
  const keys = blocks.filter((b) => /PRIVATE KEY/.test(b.type));
  if (keys.length !== 1 || blocks.length !== 1) throw new Error(`key file ${path} must hold exactly one private key and nothing else`);
  const k = createPrivateKey(keys[0]!.pem);
  const d = k.asymmetricKeyDetails ?? {};
  const type = k.asymmetricKeyType ?? 'unknown';
  if (type === 'rsa' && (d.modulusLength ?? 0) < 2048) throw new Error(`RSA server key below 2048 bits (${d.modulusLength})`);
  if (type === 'ec' && !['prime256v1', 'secp384r1'].includes(d.namedCurve ?? '')) throw new Error(`unsupported EC curve ${d.namedCurve}`);
  if (!['rsa', 'ec', 'ed25519'].includes(type)) throw new Error(`unsupported server key type ${type}`);
  return { pem: keys[0]!.pem, publicDer: createPublicKey(k).export({ type: 'spki', format: 'der' }).toString('hex'), type, detail: type === 'rsa' ? `${d.modulusLength} bits` : (d.namedCurve ?? '') };
}

/** SAN entries of a certificate as "DNS:x" / "IP:x". */
export function sanOf(c: X509Certificate): string[] {
  return (c.subjectAltName ?? '')
    .split(/,\s*/)
    .filter(Boolean)
    .map((e) => e.replace(/^IP Address:/, 'IP:').trim());
}

const nameEntry = (n: string) => (isIP(n) ? `IP:${n}` : `DNS:${n.toLowerCase()}`);

export function validateExpectedNames(names: string[]): string[] {
  if (!names.length) throw new Error('--names is required (the exact LAN names/addresses clients use)');
  for (const n of names) {
    if (isIP(n) === 6) throw new Error(`IPv6 names are not supported by the ingress (${n})`);
    if (!isIP(n) && !/^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(n)) throw new Error(`invalid name ${JSON.stringify(n)} (no wildcards)`);
  }
  return [...new Set(names)];
}

export interface CertificateReport {
  subject: string;
  issuer: string;
  san: string[];
  not_before: string;
  not_after: string;
  days_total: number;
  days_left: number;
  sha256_fingerprint: string;
  key: string;
  chain_length: number;
  extra_san: string[];
  x509_strict: string;
}

/**
 * Validate a proposed leaf + chain + trust anchor against a server key and the expected names.
 * Pure check: nothing is written. Throws with the reason on the first failed requirement.
 */
export async function validateProposedCertificate(input: { cert: string; chain?: string; ca: string; key: string; names: string[]; now?: Date; openssl?: string }): Promise<CertificateReport> {
  const names = validateExpectedNames(input.names);
  const [leaf] = certsOf(input.cert, 'certificate', { exactlyOne: true });
  const chain = input.chain ? certsOf(input.chain, 'chain', { allowEmpty: true }) : [];
  const anchors = certsOf(input.ca, 'trust anchor (--ca)');
  const key = keyOf(input.key);
  const now = input.now ?? new Date();
  if (!leaf) throw new Error('no leaf certificate');
  if (leaf.ca) throw new Error('the certificate is a CA certificate (basicConstraints CA:TRUE); a server leaf is required');
  if (leaf.publicKey.export({ type: 'spki', format: 'der' }).toString('hex') !== key.publicDer) throw new Error('the certificate does not match the server key');
  if (anchors.some((a) => !a.ca)) throw new Error('every --ca certificate must be a CA certificate');
  const nb = new Date(leaf.validFrom);
  const na = new Date(leaf.validTo);
  if (now < nb) throw new Error(`the certificate is not valid before ${nb.toISOString()}`);
  if (now >= na) throw new Error(`the certificate expired at ${na.toISOString()}`);
  const daysTotal = Math.round((na.getTime() - nb.getTime()) / 86_400_000);
  if (daysTotal > MAX_LEAF_DAYS) throw new Error(`the certificate is valid for ${daysTotal} days; at most ${MAX_LEAF_DAYS} (Apple platforms reject longer server certificates)`);
  const san = sanOf(leaf);
  const missing = names.filter((n) => !san.map((s) => s.toLowerCase()).includes(nameEntry(n).toLowerCase()));
  if (missing.length) throw new Error(`the certificate does not name ${missing.join(', ')} (SAN: ${san.join(', ') || 'none'})`);
  if (san.some((s) => s.includes('*'))) throw new Error(`wildcard SAN entries are not accepted (${san.filter((s) => s.includes('*')).join(', ')})`);
  // Extended key usage, key usage, chain and per-name verification by OpenSSL itself.
  const ossl = input.openssl ?? 'openssl';
  const ext = async (name: string) => (await run(ossl, ['x509', '-in', input.cert, '-noout', '-ext', name], { allowFailure: true })).stdout;
  // Node's X509Certificate.ca is false for CA:TRUE without keyCertSign; read basicConstraints itself.
  if (/CA:TRUE/.test(await ext('basicConstraints'))) throw new Error('the certificate is a CA certificate (basicConstraints CA:TRUE); a server leaf is required');
  if (!/TLS Web Server Authentication/.test(await ext('extendedKeyUsage'))) throw new Error('the certificate lacks extendedKeyUsage serverAuth');
  const ku = await ext('keyUsage');
  if (/Key Usage/.test(ku) && !/Digital Signature/.test(ku)) throw new Error('the certificate key usage does not allow digitalSignature');
  const untrusted = input.chain && chain.length ? ['-untrusted', input.chain] : [];
  for (const n of names) {
    const r = await run(ossl, ['verify', '-purpose', 'sslserver', '-CAfile', input.ca, ...untrusted, isIP(n) ? '-verify_ip' : '-verify_hostname', n, input.cert], { allowFailure: true });
    if (r.code !== 0) throw new Error(`chain verification for ${n} failed: ${(r.stdout + r.stderr).trim().split('\n').slice(-2).join(' ')}`);
  }
  // RFC 5280 strictness is reported, not enforced: some managed CAs omit optional extensions.
  const strict = await run(ossl, ['verify', '-x509_strict', '-purpose', 'sslserver', '-CAfile', input.ca, ...untrusted, input.cert], { allowFailure: true });
  return {
    subject: leaf.subject.replace(/\n/g, ', '),
    issuer: leaf.issuer.replace(/\n/g, ', '),
    san,
    not_before: nb.toISOString(),
    not_after: na.toISOString(),
    days_total: daysTotal,
    days_left: Math.floor((na.getTime() - now.getTime()) / 86_400_000),
    sha256_fingerprint: leaf.fingerprint256,
    key: `${key.type} ${key.detail}`,
    chain_length: chain.length,
    extra_san: san.filter((s) => !names.map(nameEntry).map((x) => x.toLowerCase()).includes(s.toLowerCase())),
    x509_strict: strict.code === 0 ? 'ok' : (strict.stdout + strict.stderr).trim().split('\n').slice(-1)[0] ?? 'failed',
  };
}

function setKeyOwner(path: string): void {
  chmodSync(path, 0o400);
  // The CLI runs as root in the OPS container; unprivileged test runs keep their own uid.
  if (process.getuid?.() === 0) chownSync(path, PROXY_UID, PROXY_UID);
}

/** New server key + CSR in secrets/tls/pending. The key never leaves the host. */
export async function tlsCsr(p: TlsPaths, namesIn: string[], log: (m: string) => void, opts: { replacePending?: boolean; openssl?: string } = {}): Promise<{ csr: string; csrSha256: string }> {
  const names = validateExpectedNames(namesIn);
  assertNoTlsReplacement(p);
  const dir = join(p.dir, PENDING);
  if (existsSync(join(dir, TLS_FILES.key)) && !opts.replacePending) throw new Error(`a pending key already exists in ${dir}; import its certificate, or pass --replace-pending to discard it deliberately`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ossl = opts.openssl ?? 'openssl';
  const san = names.map(nameEntry).join(',');
  await run(ossl, ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(dir, TLS_FILES.key), '-out', join(dir, 'server.csr'), '-subj', `/CN=${names[0]}`, '-addext', `subjectAltName=${san}`, '-addext', 'extendedKeyUsage=serverAuth', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'basicConstraints=critical,CA:FALSE']);
  chmodSync(join(dir, TLS_FILES.key), 0o400);
  const csrText = readFileSync(join(dir, 'server.csr'));
  writeFileSync(join(dir, 'names.json'), `${JSON.stringify({ names, created_at: new Date().toISOString() }, null, 2)}\n`);
  log(`[tls] new server key kept in ${dir} (mode 0400; never copy it off the host)`);
  log(`[tls] certificate signing request: ${join(dir, 'server.csr')} (sha256 ${sha256(csrText)}) for ${names.join(', ')}`);
  log('[tls] have the issuer (company CA or the operator development issuer) sign it for serverAuth; then: seyra-maps tls import --cert <leaf> [--chain <intermediates>] --ca <root> --names ...');
  return { csr: join(dir, 'server.csr'), csrSha256: sha256(csrText) };
}

interface Journal {
  schema: 'seyra.tls-replace/3';
  started_at: string;
  previous: { cert_sha256: string; key_sha256: string } | null;
  next: { cert_sha256: string; key_sha256: string; trust_sha256: string; meta_sha256: string };
  backup: string | null;
  /** SHA-256 of every file of the backup set as written (null: the file did not exist). */
  backup_files?: Record<string, string | null>;
}

/** Files that make up a served set in secrets/tls and in a backup. */
const SET_FILES = [TLS_FILES.cert, TLS_FILES.key, TLS_FILES.trust, 'served.json'] as const;

const fileSha = (path: string) => (existsSync(path) ? sha256(readFileSync(path)) : null);
const META = 'served.json';
const STAGED = { leaf: 'leaf.crt', chain: 'chain.pem' } as const;

/** Does this certificate file's first certificate belong to this key? Never throws. */
function pairOk(certPath: string, keyPath: string): boolean {
  try {
    if (!existsSync(certPath) || !existsSync(keyPath)) return false;
    const leaf = pemBlocks(readFileSync(certPath, 'utf8')).find((b) => b.type === 'CERTIFICATE');
    if (!leaf) return false;
    return new X509Certificate(leaf.pem).publicKey.export({ type: 'spki', format: 'der' }).toString('hex') === keyOf(keyPath).publicDer;
  } catch {
    return false;
  }
}

/** Write the previous served set into a backup directory: served file, split leaf/chain, key, trust, metadata. */
function backupCurrent(p: TlsPaths): string | null {
  const cert = join(p.dir, TLS_FILES.cert);
  if (!existsSync(cert) && !existsSync(join(p.dir, TLS_FILES.key))) return null;
  const backup = join(p.dir, `previous-${new Date().toISOString().replace(/[:.]/g, '')}`);
  mkdirSync(backup, { mode: 0o700 });
  for (const f of [TLS_FILES.cert, TLS_FILES.key, TLS_FILES.trust, META]) if (existsSync(join(p.dir, f))) copyFileSync(join(p.dir, f), join(backup, f));
  if (existsSync(cert)) {
    const certs = pemBlocks(readFileSync(cert, 'utf8')).filter((b) => b.type === 'CERTIFICATE');
    if (certs[0]) writeFileSync(join(backup, STAGED.leaf), certs[0].pem, { mode: 0o444 });
    writeFileSync(join(backup, STAGED.chain), certs.slice(1).map((c) => c.pem).join(''), { mode: 0o444 });
  }
  return backup;
}

/**
 * Validate, then replace the served pair. Runs under the lifecycle lock (tls-cli.ts).
 *
 * 1. Snapshot: every input (leaf, chain, trust anchor, key) is read ONCE into a fresh private
 *    staging directory. All validation and the installation use only these staged bytes, so a
 *    later change of any input path (e.g. the pending key) cannot change what is installed.
 * 2. Validate the staged material, including the staged served file against the staged key.
 * 3. Back up the current set (served file, split leaf/chain, key, trust, metadata), write a journal,
 *    then rename the staged files into place one by one. Any interruption leaves the journal;
 *    `start`, `proxy restart` and activation refuse until `tls recover` completes or undoes it.
 */
export async function tlsImport(
  p: TlsPaths,
  input: { cert: string; chain?: string; ca: string; key?: string; names: string[]; openssl?: string; now?: Date; crashAfter?: 'key'; source?: string },
  log: (m: string) => void,
): Promise<CertificateReport> {
  if (existsSync(join(p.dir, JOURNAL))) throw new Error('an earlier certificate replacement did not finish; run: seyra-maps tls recover');
  const keyPath = input.key ?? join(p.dir, PENDING, TLS_FILES.key);
  if (!existsSync(keyPath)) throw new Error(`no server key: pass --key, or create one with seyra-maps tls csr (expected ${keyPath})`);
  mkdirSync(p.dir, { recursive: true, mode: 0o711 });
  const next = join(p.dir, 'next');
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { mode: 0o700 });
  // 1. Snapshot (each input read exactly once).
  const leafBytes = readFileSync(input.cert);
  const chainBytes = input.chain ? readFileSync(input.chain) : Buffer.alloc(0);
  const trustBytes = readFileSync(input.ca);
  const keyBytes = readFileSync(keyPath);
  const st = { leaf: join(next, STAGED.leaf), chain: join(next, STAGED.chain), trust: join(next, TLS_FILES.trust), key: join(next, TLS_FILES.key), served: join(next, TLS_FILES.cert), meta: join(next, META) };
  writeFileSync(st.leaf, leafBytes, { mode: 0o444 });
  writeFileSync(st.chain, chainBytes, { mode: 0o444 });
  writeFileSync(st.trust, trustBytes, { mode: 0o444 });
  writeFileSync(st.key, keyBytes, { mode: 0o400 });
  try {
    // 2. Validate exactly the staged bytes.
    const report = await validateProposedCertificate({ cert: st.leaf, ...(chainBytes.length ? { chain: st.chain } : {}), ca: st.trust, key: st.key, names: input.names, ...(input.openssl ? { openssl: input.openssl } : {}), ...(input.now ? { now: input.now } : {}) });
    const servedText = leafBytes.toString('utf8').trim() + '\n' + (chainBytes.length ? chainBytes.toString('utf8').trim() + '\n' : '');
    writeFileSync(st.served, servedText, { mode: 0o444 });
    if (!pairOk(st.served, st.key)) throw new Error('staged served certificate does not match the staged key');
    if (sha256(readFileSync(st.key)) !== sha256(keyBytes)) throw new Error('staged key changed during validation');
    writeFileSync(st.meta, `${JSON.stringify({ schema: 'seyra.tls-served/1', names: validateExpectedNames(input.names), installed_at: new Date().toISOString(), source: input.source ?? 'import', subject: report.subject, not_after: report.not_after, sha256_fingerprint: report.sha256_fingerprint }, null, 2)}\n`, { mode: 0o444 });
    setKeyOwner(st.key);
    // 3. Back up, journal, rename.
    const cur = { cert: join(p.dir, TLS_FILES.cert), key: join(p.dir, TLS_FILES.key), trust: join(p.dir, TLS_FILES.trust), meta: join(p.dir, META) };
    const previous = existsSync(cur.cert) && existsSync(cur.key) ? { cert_sha256: fileSha(cur.cert)!, key_sha256: fileSha(cur.key)! } : null;
    const backup = backupCurrent(p);
    const journal: Journal = {
      schema: 'seyra.tls-replace/3',
      started_at: new Date().toISOString(),
      previous,
      next: { cert_sha256: fileSha(st.served)!, key_sha256: fileSha(st.key)!, trust_sha256: fileSha(st.trust)!, meta_sha256: fileSha(st.meta)! },
      backup,
      ...(backup ? { backup_files: Object.fromEntries(SET_FILES.map((f) => [f, fileSha(join(backup, f))])) } : {}),
    };
    writeFileSync(join(p.dir, JOURNAL), `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
    renameSync(st.key, cur.key);
    if (input.crashAfter === 'key') return report; // test hook: interruption after the first rename
    renameSync(st.served, cur.cert);
    renameSync(st.trust, cur.trust);
    renameSync(st.meta, cur.meta);
    rmSync(next, { recursive: true, force: true });
    checkPair(p);
    rmSync(join(p.dir, JOURNAL));
    if (!input.key) rmSync(join(p.dir, PENDING), { recursive: true, force: true });
    log(`[tls] served certificate replaced: ${report.subject}; SAN ${report.san.join(', ')}; valid until ${report.not_after}; sha256 ${report.sha256_fingerprint}`);
    if (report.extra_san.length) log(`[tls] note: the certificate also names ${report.extra_san.join(', ')}`);
    if (backup) {
      log(`[tls] previous pair kept in ${backup}`);
      log(`[tls] roll back with: seyra-maps tls restore --from ${backup}`);
    }
    if (existsSync(join(p.dir, TLS_FILES.legacyCaKey))) log(`[tls] note: a legacy on-host test CA key exists (${join(p.dir, TLS_FILES.legacyCaKey)}); it is not part of LAN provisioning. Remove it deliberately once no fixture needs it.`);
    log('[tls] the proxy serves the new pair after it is recreated: seyra-maps proxy restart');
    return report;
  } catch (e) {
    // Nothing was renamed unless the journal exists; a failed validation leaves the served set intact.
    if (!existsSync(join(p.dir, JOURNAL))) rmSync(next, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Restore a backup made by an earlier import (`previous-<time>/`). The backup is validated like
 * any import: its leaf (first certificate of the saved served file, or leaf.crt) must match its
 * key, name the expected names, be a currently valid serverAuth leaf and verify through its saved
 * chain to its saved trust anchor. Expected names come from the backup's metadata, or else from the
 * leaf's own SAN (legacy fixture pairs). The restore goes through the same journalled replacement.
 */
export async function tlsRestore(p: TlsPaths, input: { from: string; names?: string[]; openssl?: string; now?: Date; crashAfter?: 'key' }, log: (m: string) => void): Promise<CertificateReport> {
  const from = input.from;
  for (const f of [TLS_FILES.cert, TLS_FILES.key, TLS_FILES.trust]) if (!existsSync(join(from, f))) throw new Error(`backup ${from} lacks ${f}; nothing restored`);
  const certs = pemBlocks(readFileSync(join(from, TLS_FILES.cert), 'utf8')).filter((b) => b.type === 'CERTIFICATE');
  if (!certs.length) throw new Error(`backup ${from}/${TLS_FILES.cert} holds no certificate`);
  const src = join(p.dir, `restore-source-${process.pid}`);
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { mode: 0o700 });
  try {
    // The served file is the reference (leaf.crt/chain.pem, when present, must agree with it).
    writeFileSync(join(src, STAGED.leaf), certs[0]!.pem, { mode: 0o444 });
    writeFileSync(join(src, STAGED.chain), certs.slice(1).map((c) => c.pem).join(''), { mode: 0o444 });
    if (existsSync(join(from, STAGED.leaf)) && sha256(readFileSync(join(from, STAGED.leaf))) !== sha256(certs[0]!.pem)) throw new Error(`backup ${from}: leaf.crt differs from the saved served certificate`);
    let names = input.names;
    if (!names?.length && existsSync(join(from, META))) names = (JSON.parse(readFileSync(join(from, META), 'utf8')) as { names?: string[] }).names;
    if (!names?.length) names = sanOf(new X509Certificate(certs[0]!.pem)).map((e) => e.replace(/^(DNS|IP):/, ''));
    return await tlsImport(p, { cert: join(src, STAGED.leaf), ...(certs.length > 1 ? { chain: join(src, STAGED.chain) } : {}), ca: join(from, TLS_FILES.trust), key: join(from, TLS_FILES.key), names, source: `restore:${from}`, ...(input.openssl ? { openssl: input.openssl } : {}), ...(input.now ? { now: input.now } : {}), ...(input.crashAfter ? { crashAfter: input.crashAfter } : {}) }, log);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
}

/** Refuse while a certificate replacement is unfinished. */
export function assertNoTlsReplacement(p: TlsPaths): void {
  if (existsSync(join(p.dir, JOURNAL))) throw new Error('a certificate replacement did not finish; run: seyra-maps tls recover');
}

/** The served certificate and key must belong together and no replacement may be unfinished. */
export function assertServedPair(p: TlsPaths): void {
  assertNoTlsReplacement(p);
  checkPair(p);
}

/** Certificate/key match only (used inside the journalled replacement itself). */
function checkPair(p: TlsPaths): void {
  const cert = join(p.dir, TLS_FILES.cert);
  const key = join(p.dir, TLS_FILES.key);
  if (!existsSync(cert) || !existsSync(key)) throw new Error(`TLS material missing in ${p.dir}`);
  const leaf = pemBlocks(readFileSync(cert, 'utf8')).find((b) => b.type === 'CERTIFICATE');
  if (!leaf) throw new Error(`${cert} holds no certificate`);
  const pub = new X509Certificate(leaf.pem).publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  if (pub !== keyOf(key).publicDer) throw new Error(`served certificate ${cert} does not match ${key}`);
}

/**
 * Validate a complete fallback set staged in `dir` (copies of a backup, never active files):
 *  - the certificate, key and trust anchor are all present (metadata too, where it existed);
 *  - for journals that recorded the backup's file hashes (seyra.tls-replace/3), every file equals
 *    that record, so the set is exactly the one that was active before the replacement;
 *  - for older journals without that record (compatibility), integrity cannot be proven, so the
 *    set must pass the full checks below on its own;
 *  - certificate and key match, and the certificate chain verifies to the set's own trust anchor
 *    for server use and for every name the set serves (its metadata names, or else its SAN).
 *    Expiry is not a reason to refuse the previously active set (-no_check_time).
 * Returns null when valid, otherwise the reason.
 */
async function invalidFallback(dir: string, record: Record<string, string | null> | undefined, openssl: string): Promise<string | null> {
  for (const f of [TLS_FILES.cert, TLS_FILES.key, TLS_FILES.trust]) if (!existsSync(join(dir, f))) return `backup lacks ${f}`;
  if (record) {
    for (const f of SET_FILES) {
      if (!(f in record)) return `journal records no hash for ${f}`;
      if (fileSha(join(dir, f)) !== record[f]) return `backup ${f} differs from the set recorded in the journal`;
    }
  }
  if (!pairOk(join(dir, TLS_FILES.cert), join(dir, TLS_FILES.key))) return 'backup certificate and key do not match';
  let anchors: X509Certificate[];
  try {
    anchors = certsOf(join(dir, TLS_FILES.trust), 'backup trust anchor');
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (anchors.some((a) => !a.ca)) return 'backup trust anchor is not a CA certificate';
  const leafPem = pemBlocks(readFileSync(join(dir, TLS_FILES.cert), 'utf8')).find((b) => b.type === 'CERTIFICATE')!.pem;
  const leaf = new X509Certificate(leafPem);
  let names = sanOf(leaf).map((e) => e.replace(/^(DNS|IP):/, ''));
  if (existsSync(join(dir, META))) {
    try {
      const m = JSON.parse(readFileSync(join(dir, META), 'utf8')) as { names?: unknown; sha256_fingerprint?: unknown };
      if (!Array.isArray(m.names) || !m.names.length || !m.names.every((n) => typeof n === 'string')) return 'backup metadata has no names';
      if (m.sha256_fingerprint !== undefined && m.sha256_fingerprint !== leaf.fingerprint256) return 'backup metadata describes another certificate';
      names = m.names as string[];
    } catch {
      return 'backup metadata is not valid JSON';
    }
  }
  if (!names.length) return 'backup certificate names nothing';
  for (const n of names) {
    const r = await run(openssl, ['verify', '-no_check_time', '-purpose', 'sslserver', '-CAfile', join(dir, TLS_FILES.trust), '-untrusted', join(dir, TLS_FILES.cert), isIP(n) ? '-verify_ip' : '-verify_hostname', n, join(dir, TLS_FILES.cert)], { allowFailure: true });
    if (r.code !== 0) return `backup chain does not verify to its trust anchor for ${n}: ${(r.stdout + r.stderr).trim().split('\n').slice(-1)[0] ?? ''}`;
  }
  return null;
}

/**
 * Finish or undo an interrupted replacement (runs under the lifecycle lock).
 *  - Completion: every new file must be found staged or in place with the hash the journal
 *    recorded after validation, and the certificate/key must match; then the staged files move in.
 *  - Fallback: the backup is copied into a private staging directory and validated there as a
 *    complete set (invalidFallback) BEFORE any active file changes; only then do the staged copies
 *    replace the active files and metadata.
 *  - Neither: refuse, leaving the journal and every active file unchanged.
 */
export async function tlsRecover(p: TlsPaths, log: (m: string) => void, opts: { openssl?: string } = {}): Promise<'none' | 'completed' | 'restored'> {
  const jp = join(p.dir, JOURNAL);
  if (!existsSync(jp)) return 'none';
  const j = JSON.parse(readFileSync(jp, 'utf8')) as Journal;
  const next = join(p.dir, 'next');
  const cur = (f: string) => join(p.dir, f);
  const want: [string, string | undefined][] = [
    [TLS_FILES.key, j.next?.key_sha256],
    [TLS_FILES.cert, j.next?.cert_sha256],
    [TLS_FILES.trust, j.next?.trust_sha256],
    ...(j.next?.meta_sha256 ? ([[META, j.next.meta_sha256]] as [string, string][]) : []),
  ];
  // Where each new file is now: still staged, already in place, or missing.
  const where = want.map(([f, h]) => [f, h && fileSha(join(next, f)) === h ? join(next, f) : h && fileSha(cur(f)) === h ? cur(f) : null] as const);
  const keyAt = where.find(([f]) => f === TLS_FILES.key)?.[1];
  const certAt = where.find(([f]) => f === TLS_FILES.cert)?.[1];
  if (where.every(([, at]) => at !== null) && !!keyAt && !!certAt && pairOk(certAt, keyAt)) {
    for (const [f, at] of where) if (at === join(next, f)) renameSync(at, cur(f));
    rmSync(next, { recursive: true, force: true });
    rmSync(jp);
    log('[tls] interrupted replacement completed; the new set is in place');
    return 'completed';
  }
  const b = j.backup;
  let reason = 'no backup was recorded';
  if (b && existsSync(b)) {
    const staging = join(p.dir, 'recover-staging');
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { mode: 0o700 });
    try {
      for (const f of SET_FILES) if (existsSync(join(b, f))) copyFileSync(join(b, f), join(staging, f));
      const invalid = await invalidFallback(staging, j.backup_files, opts.openssl ?? 'openssl');
      if (!invalid) {
        setKeyOwner(join(staging, TLS_FILES.key));
        for (const f of SET_FILES) {
          if (existsSync(join(staging, f))) renameSync(join(staging, f), cur(f));
          else rmSync(cur(f), { force: true }); // the restored set had no such file (e.g. legacy metadata)
        }
        checkPair(p);
        rmSync(next, { recursive: true, force: true });
        rmSync(jp);
        log(`[tls] interrupted replacement undone; previous set restored from ${b}`);
        return 'restored';
      }
      reason = `backup ${b} is not a valid complete set: ${invalid}`;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  } else if (b) reason = `backup ${b} is missing`;
  throw new Error(`cannot recover: the new set is incomplete or inconsistent and ${reason}; the journal and all active files were kept. Inspect ${p.dir}, then import a valid certificate or restore a verified backup.`);
}

/** Public metadata of the served certificate (no key material). */
export function tlsStatus(p: TlsPaths): Record<string, unknown> {
  const cert = join(p.dir, TLS_FILES.cert);
  if (!existsSync(cert)) return { served: null };
  const blocks = pemBlocks(readFileSync(cert, 'utf8')).filter((b) => b.type === 'CERTIFICATE');
  const leaf = new X509Certificate(blocks[0]!.pem);
  let pair = 'ok';
  try {
    assertServedPair(p);
  } catch (e) {
    pair = e instanceof Error ? e.message : String(e);
  }
  return {
    served: { subject: leaf.subject.replace(/\n/g, ', '), issuer: leaf.issuer.replace(/\n/g, ', '), san: sanOf(leaf), not_before: new Date(leaf.validFrom).toISOString(), not_after: new Date(leaf.validTo).toISOString(), sha256_fingerprint: leaf.fingerprint256, chain_certificates: blocks.length },
    pair,
    replacement_journal: existsSync(join(p.dir, JOURNAL)),
    pending_csr: existsSync(join(p.dir, PENDING, 'server.csr')),
    legacy_test_ca_key_present: existsSync(join(p.dir, TLS_FILES.legacyCaKey)),
  };
}
