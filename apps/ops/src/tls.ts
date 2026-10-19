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
  schema: 'seyra.tls-replace/1';
  started_at: string;
  previous: { cert_sha256: string; key_sha256: string } | null;
  next: { cert_sha256: string; key_sha256: string; trust_sha256: string };
  backup: string | null;
}

const fileSha = (path: string) => (existsSync(path) ? sha256(readFileSync(path)) : null);

/**
 * Validate, then replace the served pair. Order: the new pair is staged in next/, the previous
 * pair copied to a backup, a journal written, then the files renamed into place one by one. Any
 * interruption leaves the journal; start refuses until `tls recover` finishes or undoes it.
 */
export async function tlsImport(
  p: TlsPaths,
  input: { cert: string; chain?: string; ca: string; key?: string; names: string[]; openssl?: string; now?: Date; crashAfter?: 'key' },
  log: (m: string) => void,
): Promise<CertificateReport> {
  if (existsSync(join(p.dir, JOURNAL))) throw new Error('an earlier certificate replacement did not finish; run: seyra-maps tls recover');
  const keyPath = input.key ?? join(p.dir, PENDING, TLS_FILES.key);
  if (!existsSync(keyPath)) throw new Error(`no server key: pass --key, or create one with seyra-maps tls csr (expected ${keyPath})`);
  const report = await validateProposedCertificate({ cert: input.cert, ...(input.chain ? { chain: input.chain } : {}), ca: input.ca, key: keyPath, names: input.names, ...(input.openssl ? { openssl: input.openssl } : {}), ...(input.now ? { now: input.now } : {}) });
  mkdirSync(p.dir, { recursive: true, mode: 0o711 });
  const next = join(p.dir, 'next');
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { mode: 0o700 });
  const served = readFileSync(input.cert, 'utf8').trim() + '\n' + (input.chain ? readFileSync(input.chain, 'utf8').trim() + '\n' : '');
  writeFileSync(join(next, TLS_FILES.cert), served, { mode: 0o444 });
  copyFileSync(keyPath, join(next, TLS_FILES.key));
  setKeyOwner(join(next, TLS_FILES.key));
  writeFileSync(join(next, TLS_FILES.trust), readFileSync(input.ca), { mode: 0o444 });
  const cur = { cert: join(p.dir, TLS_FILES.cert), key: join(p.dir, TLS_FILES.key), trust: join(p.dir, TLS_FILES.trust) };
  let backup: string | null = null;
  if (existsSync(cur.cert) || existsSync(cur.key)) {
    backup = join(p.dir, `previous-${new Date().toISOString().replace(/[:.]/g, '')}`);
    mkdirSync(backup, { mode: 0o700 });
    for (const f of [TLS_FILES.cert, TLS_FILES.key, TLS_FILES.trust]) if (existsSync(join(p.dir, f))) copyFileSync(join(p.dir, f), join(backup, f));
  }
  const journal: Journal = {
    schema: 'seyra.tls-replace/1',
    started_at: new Date().toISOString(),
    previous: existsSync(cur.cert) && existsSync(cur.key) ? { cert_sha256: fileSha(cur.cert)!, key_sha256: fileSha(cur.key)! } : null,
    next: { cert_sha256: fileSha(join(next, TLS_FILES.cert))!, key_sha256: fileSha(join(next, TLS_FILES.key))!, trust_sha256: fileSha(join(next, TLS_FILES.trust))! },
    backup,
  };
  writeFileSync(join(p.dir, JOURNAL), `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  renameSync(join(next, TLS_FILES.key), cur.key);
  if (input.crashAfter === 'key') return report; // test hook: interruption after the first rename
  renameSync(join(next, TLS_FILES.cert), cur.cert);
  renameSync(join(next, TLS_FILES.trust), cur.trust);
  rmSync(next, { recursive: true, force: true });
  checkPair(p);
  rmSync(join(p.dir, JOURNAL));
  if (!input.key) rmSync(join(p.dir, PENDING), { recursive: true, force: true });
  log(`[tls] served certificate replaced: ${report.subject}; SAN ${report.san.join(', ')}; valid until ${report.not_after}; sha256 ${report.sha256_fingerprint}`);
  if (report.extra_san.length) log(`[tls] note: the certificate also names ${report.extra_san.join(', ')}`);
  if (backup) log(`[tls] previous pair kept in ${backup}`);
  if (existsSync(join(p.dir, TLS_FILES.legacyCaKey))) log(`[tls] note: a legacy on-host test CA key exists (${join(p.dir, TLS_FILES.legacyCaKey)}); it is not part of LAN provisioning. Remove it deliberately once no fixture needs it.`);
  log('[tls] the proxy serves the new pair after it is recreated: seyra-maps proxy restart');
  return report;
}

/** Refuse while a certificate replacement is unfinished (activation/rollback precheck). */
export function assertNoTlsReplacement(p: TlsPaths): void {
  if (existsSync(join(p.dir, JOURNAL))) throw new Error('a certificate replacement did not finish; run: seyra-maps tls recover');
}

/** The served certificate and key must belong together and no replacement may be unfinished. */
export function assertServedPair(p: TlsPaths): void {
  if (existsSync(join(p.dir, JOURNAL))) throw new Error('a certificate replacement did not finish; run: seyra-maps tls recover');
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
 * Finish or undo an interrupted replacement. The import renames key, certificate and trust anchor
 * from next/ in that order, so after any interruption each new file is either still staged in
 * next/ or already in place (matching the journal). If that holds for all three, the replacement is
 * completed; otherwise the previous pair is restored from its backup. Either way the result is a
 * matching pair and no journal.
 */
export function tlsRecover(p: TlsPaths, log: (m: string) => void): 'none' | 'completed' | 'restored' {
  const jp = join(p.dir, JOURNAL);
  if (!existsSync(jp)) return 'none';
  const j = JSON.parse(readFileSync(jp, 'utf8')) as Journal;
  const next = join(p.dir, 'next');
  const cur = (f: string) => join(p.dir, f);
  const want: [string, string][] = [
    [TLS_FILES.key, j.next.key_sha256],
    [TLS_FILES.cert, j.next.cert_sha256],
    [TLS_FILES.trust, j.next.trust_sha256],
  ];
  const completable = want.every(([f, h]) => fileSha(join(next, f)) === h || fileSha(cur(f)) === h);
  if (completable) {
    for (const [f, h] of want) if (fileSha(join(next, f)) === h) renameSync(join(next, f), cur(f));
    rmSync(next, { recursive: true, force: true });
    checkPair(p);
    rmSync(jp);
    log('[tls] interrupted replacement completed; the new pair is in place');
    return 'completed';
  }
  if (!j.backup || !existsSync(j.backup)) throw new Error('cannot recover: the new pair is incomplete and no previous pair was backed up; import a certificate again');
  for (const f of [TLS_FILES.cert, TLS_FILES.key, TLS_FILES.trust]) {
    if (!existsSync(join(j.backup, f))) continue;
    const tmp = `${cur(f)}.restore`;
    copyFileSync(join(j.backup, f), tmp);
    if (f === TLS_FILES.key) setKeyOwner(tmp);
    renameSync(tmp, cur(f));
  }
  rmSync(next, { recursive: true, force: true });
  checkPair(p);
  rmSync(jp);
  log(`[tls] interrupted replacement undone; previous pair restored from ${j.backup}`);
  return 'restored';
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
