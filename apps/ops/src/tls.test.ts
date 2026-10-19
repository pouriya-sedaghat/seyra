import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertNoTlsReplacement, assertServedPair, MAX_LEAF_DAYS, tlsCsr, tlsImport, tlsRecover, tlsRestore, tlsStatus, validateProposedCertificate } from './tls.js';

// Temporary synthetic issuer hierarchy (test only; documentation-range names and addresses).
const w = mkdtempSync(join(tmpdir(), 'seyra-tls-test-'));
afterAll(() => rmSync(w, { recursive: true, force: true }));
const ossl = (...a: string[]) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const NAMES = ['192.0.2.10', 'maps.example.test'];
const f = (n: string) => join(w, n);
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';

function ca(name: string, signer?: string) {
  ossl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f(`${name}.key`), '-out', f(`${name}.csr`), '-subj', `/CN=${name}`);
  writeFileSync(f(`${name}.ext`), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
  const sign = signer ? ['-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial'] : ['-key', f(`${name}.key`)];
  ossl('x509', '-req', '-in', f(`${name}.csr`), ...sign, '-out', f(`${name}.crt`), '-days', '30', '-extfile', f(`${name}.ext`));
}
interface LeafOpts { san?: string; eku?: string; caTrue?: boolean; days?: number; notBefore?: Date; notAfter?: Date; signer?: string; key?: string; csr?: string }
function leaf(name: string, o: LeafOpts = {}) {
  const key = o.key ?? f(`${name}.key`);
  const csr = o.csr ?? f(`${name}.csr`);
  if (!o.csr) {
    if (!o.key) ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-out', key);
    ossl('req', '-new', '-key', key, '-out', csr, '-subj', '/CN=maps.example.test');
  }
  writeFileSync(f(`${name}.ext`), [`basicConstraints=${o.caTrue ? 'critical,CA:TRUE' : 'CA:FALSE'}`, 'keyUsage=critical,digitalSignature', `extendedKeyUsage=${o.eku ?? 'serverAuth'}`, `subjectAltName=${o.san ?? 'IP:192.0.2.10,DNS:maps.example.test'}`, 'authorityKeyIdentifier=keyid'].join('\n') + '\n');
  const signer = o.signer ?? 'intermediate';
  const validity = o.notBefore ? ['-not_before', stamp(o.notBefore), '-not_after', stamp(o.notAfter!)] : ['-days', String(o.days ?? 30)];
  ossl('x509', '-req', '-in', csr, '-CA', f(`${signer}.crt`), '-CAkey', f(`${signer}.key`), '-CAcreateserial', '-out', f(`${name}.crt`), ...validity, '-extfile', f(`${name}.ext`));
  return { cert: f(`${name}.crt`), key };
}
ca('root');
ca('intermediate', 'root');
ca('other-root');
const good = leaf('good');

let dir: string;
const p = () => ({ dir });
const legacyPair = () => {
  // A served pair as left by the legacy on-host test CA (fixtures), plus its CA key.
  ca('legacy-ca');
  const l = leaf('legacy', { signer: 'legacy-ca' });
  writeFileSync(join(dir, 'server.crt'), readFileSync(l.cert));
  writeFileSync(join(dir, 'server.key'), readFileSync(l.key));
  writeFileSync(join(dir, 'ca.crt'), readFileSync(f('legacy-ca.crt')));
  writeFileSync(join(dir, 'ca.key'), readFileSync(f('legacy-ca.key')));
};
const served = () => ({ cert: sha(join(dir, 'server.crt')), key: sha(join(dir, 'server.key')), trust: sha(join(dir, 'ca.crt')) });

beforeEach(() => {
  dir = join(w, `tls-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  legacyPair();
});

describe('certificate validation before replacement', () => {
  it('accepts an externally issued leaf whose key, names, purpose, validity and chain all check out', async () => {
    const r = await validateProposedCertificate({ cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES });
    expect(r.san).toEqual(['IP:192.0.2.10', 'DNS:maps.example.test']);
    expect(r.chain_length).toBe(1);
    expect(r.extra_san).toEqual([]);
    expect(r.days_total).toBe(30);
  });

  const refusals: [string, () => Record<string, unknown>, RegExp][] = [
    ['a key that does not match the certificate', () => ({ key: leaf('stranger').key }), /does not match the server key/],
    ['a certificate missing an expected name', () => ({ ...leaf('dns-only', { san: 'DNS:maps.example.test' }) }), /does not name 192\.0\.2\.10/],
    ['a CA certificate instead of a server leaf', () => ({ ...leaf('ca-leaf', { caTrue: true }) }), /CA certificate/],
    ['a client-only certificate (no serverAuth)', () => ({ ...leaf('client', { eku: 'clientAuth' }) }), /serverAuth/],
    ['a chain that does not lead to the given trust anchor', () => ({ ca: f('other-root.crt') }), /chain verification for .* failed/],
    ['an expired certificate', () => ({ ...leaf('expired', { notBefore: new Date(Date.now() - 40 * 86_400_000), notAfter: new Date(Date.now() - 86_400_000) }) }), /expired/],
    ['a certificate that is not valid yet', () => ({ ...leaf('future', { notBefore: new Date(Date.now() + 86_400_000), notAfter: new Date(Date.now() + 30 * 86_400_000) }) }), /not valid before/],
    [`a certificate valid longer than ${MAX_LEAF_DAYS} days`, () => ({ ...leaf('long', { days: MAX_LEAF_DAYS + 30 }) }), /at most 825/],
    ['a wildcard SAN', () => ({ ...leaf('wild', { san: 'IP:192.0.2.10,DNS:maps.example.test,DNS:*.example.test' }) }), /wildcard/],
    ['a certificate file carrying a private key', () => {
      const c = f('with-key.crt');
      writeFileSync(c, readFileSync(good.cert));
      appendFileSync(c, readFileSync(f('intermediate.key')));
      return { cert: c };
    }, /contains a private key/],
    ['a trust anchor file carrying the issuer key', () => {
      const c = f('root-with-key.crt');
      writeFileSync(c, readFileSync(f('root.crt')));
      appendFileSync(c, readFileSync(f('root.key')));
      return { ca: c };
    }, /contains a private key/],
    ['a leaf file holding two certificates', () => {
      const c = f('two.crt');
      writeFileSync(c, readFileSync(good.cert));
      appendFileSync(c, readFileSync(f('intermediate.crt')));
      return { cert: c };
    }, /exactly one certificate/],
    ['a non-CA certificate as trust anchor', () => ({ ca: good.cert }), /must be a CA certificate/],
    ['a wildcard expected name', () => ({ names: ['*.example.test'] }), /no wildcards/],
  ];
  it.each(refusals)('refuses %s and keeps the previous served pair', async (_name, mk, re) => {
    const before = served();
    const o = { cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES, ...mk() } as Parameters<typeof tlsImport>[1];
    await expect(tlsImport(p(), o, () => {})).rejects.toThrow(re);
    expect(served()).toEqual(before);
    expect(existsSync(join(dir, 'replace.json'))).toBe(false);
    expect(() => assertServedPair(p())).not.toThrow();
  });
});

describe('replacement of the served pair', () => {
  it('replaces a legacy fixture pair, keeps a backup and the legacy CA key, and serves leaf + chain', async () => {
    const before = served();
    const logs: string[] = [];
    const r = await tlsImport(p(), { cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES }, (m) => logs.push(m));
    expect(r.sha256_fingerprint).toMatch(/^[0-9A-F:]+$/);
    expect(() => assertServedPair(p())).not.toThrow();
    const pem = readFileSync(join(dir, 'server.crt'), 'utf8');
    expect(pem.match(/BEGIN CERTIFICATE/g)).toHaveLength(2); // leaf then intermediate
    expect(sha(join(dir, 'ca.crt'))).toBe(sha(f('root.crt')));
    expect(existsSync(join(dir, 'ca.key'))).toBe(true); // never deleted implicitly
    expect(logs.join('\n')).toMatch(/legacy on-host test CA key/);
    const backup = logs.join('\n').match(/previous pair kept in (\S+)/)![1]!;
    expect(sha(join(backup, 'server.crt'))).toBe(before.cert);
    expect(sha(join(backup, 'server.key'))).toBe(before.key);
    expect(existsSync(join(dir, 'replace.json'))).toBe(false);
    const st = tlsStatus(p());
    expect(st).toMatchObject({ pair: 'ok', replacement_journal: false, legacy_test_ca_key_present: true });
    expect(JSON.stringify(st)).not.toMatch(/PRIVATE KEY/);
  });

  it('CSR flow: the key is created and kept on the host, the issued certificate is imported against it', async () => {
    const r = await tlsCsr(p(), NAMES, () => {});
    const csrText = ossl('req', '-in', r.csr, '-noout', '-text');
    expect(csrText).toMatch(/IP Address:192\.0\.2\.10/);
    expect(csrText).toMatch(/DNS:maps\.example\.test/);
    await expect(tlsCsr(p(), NAMES, () => {})).rejects.toThrow(/pending key already exists/);
    // The issuer signs the CSR elsewhere (here: the test intermediate).
    const issued = leaf('from-csr', { csr: r.csr, key: join(dir, 'pending', 'server.key') });
    await tlsImport(p(), { cert: issued.cert, chain: f('intermediate.crt'), ca: f('root.crt'), names: NAMES }, () => {});
    expect(() => assertServedPair(p())).not.toThrow();
    expect(existsSync(join(dir, 'pending'))).toBe(false);
  });

  it('an interrupted replacement blocks start/activation until recover completes it', async () => {
    await tlsImport(p(), { cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES, crashAfter: 'key' }, () => {});
    expect(() => assertServedPair(p())).toThrow(/did not finish/);
    expect(() => assertNoTlsReplacement(p())).toThrow(/tls recover/);
    await expect(tlsImport(p(), { cert: good.cert, ca: f('root.crt'), key: good.key, names: NAMES }, () => {})).rejects.toThrow(/did not finish/);
    expect(await tlsRecover(p(), () => {})).toBe('completed');
    expect(() => assertServedPair(p())).not.toThrow();
    expect(sha(join(dir, 'server.key'))).toBe(sha(good.key));
    expect(await tlsRecover(p(), () => {})).toBe('none');
  });

  it('an interruption with a damaged staging area is undone from the backup', async () => {
    const before = served();
    await tlsImport(p(), { cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES, crashAfter: 'key' }, () => {});
    rmSync(join(dir, 'next', 'server.crt')); // the staged certificate is gone
    expect(await tlsRecover(p(), () => {})).toBe('restored');
    expect(served()).toEqual(before);
    expect(() => assertServedPair(p())).not.toThrow();
  });
});

describe('operator development issuer (infra/tls/dev-issuer.sh) uses the same provisioning interface', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'infra', 'tls', 'dev-issuer.sh');
  const env = { ...process.env, SEYRA_HOME: '' };
  delete (env as Record<string, string | undefined>).SEYRA_HOME;
  it('signs the CSR from tls csr; tls import validates and installs it; the issuer key never enters the TLS directory', async () => {
    const issuer = join(w, `issuer-${Math.random().toString(16).slice(2)}`);
    execFileSync('bash', [script, 'init', issuer, '--days', '30'], { env });
    const { csr } = await tlsCsr(p(), NAMES, () => {});
    execFileSync('bash', [script, 'sign', issuer, csr, '--names', NAMES.join(','), '--days', '30'], { env });
    await tlsImport(p(), { cert: csr.replace(/\.csr$/, '.crt'), ca: join(issuer, 'root.crt'), names: NAMES }, () => {});
    expect(() => assertServedPair(p())).not.toThrow();
    const rootKey = readFileSync(join(issuer, 'root.key'));
    for (const f of ['server.crt', 'server.key', 'ca.crt']) expect(readFileSync(join(dir, f)).includes(rootKey)).toBe(false);
    expect(readFileSync(join(dir, 'ca.crt')).equals(readFileSync(join(issuer, 'root.crt')))).toBe(true);
  });
  it('refuses to run where SEYRA_HOME is set, and refuses wildcard names', () => {
    const issuer = join(w, 'issuer-refuse');
    expect(() => execFileSync('bash', [script, 'init', issuer], { env: { ...env, SEYRA_HOME: '/srv/seyra' }, stdio: 'pipe' })).toThrow();
    execFileSync('bash', [script, 'init', issuer], { env });
    expect(() => execFileSync('bash', [script, 'sign', issuer, f('good.csr'), '--names', '*.example.test'], { env, stdio: 'pipe' })).toThrow();
  });
});

describe('restore of a full-chain backup (review H4)', () => {
  it('restores a leaf + intermediate backup byte for byte, also after an interruption', async () => {
    await tlsImport(p(), { cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES }, () => {});
    const first = served();
    const renewed = leaf('renewed');
    const logs: string[] = [];
    await tlsImport(p(), { cert: renewed.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: renewed.key, names: NAMES }, (m) => logs.push(m));
    const backup = logs.join('\n').match(/previous pair kept in (\S+)/)![1]!;
    expect(readFileSync(join(backup, 'server.crt'), 'utf8').match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
    expect(readFileSync(join(backup, 'chain.pem'), 'utf8').match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
    // Interrupted after the first rename, then recovered: the backup set is in place.
    await tlsRestore(p(), { from: backup, crashAfter: 'key' }, () => {});
    expect(() => assertServedPair(p())).toThrow(/did not finish/);
    expect(await tlsRecover(p(), () => {})).toBe('completed');
    expect(served()).toEqual(first);
    expect(() => assertServedPair(p())).not.toThrow();
  });

  it('derives the expected names of a legacy backup from its own SAN and still validates the chain', async () => {
    // The legacy fixture pair (single leaf, own test CA) becomes the first backup.
    const legacy = served();
    const logs: string[] = [];
    await tlsImport(p(), { cert: good.cert, chain: f('intermediate.crt'), ca: f('root.crt'), key: good.key, names: NAMES }, (m) => logs.push(m));
    const backup = logs.join('\n').match(/previous pair kept in (\S+)/)![1]!;
    await tlsRestore(p(), { from: backup }, () => {});
    expect(served()).toEqual(legacy);
    // A backup whose trust anchor does not verify its chain is refused; the served set stays.
    const bad = join(dir, 'previous-bad-anchor');
    mkdirSync(bad);
    for (const x of ['server.crt', 'server.key']) writeFileSync(join(bad, x), readFileSync(join(dir, x)));
    writeFileSync(join(bad, 'ca.crt'), readFileSync(f('other-root.crt')));
    await expect(tlsRestore(p(), { from: bad }, () => {})).rejects.toThrow(/chain verification/);
    expect(served()).toEqual(legacy);
  });
});
