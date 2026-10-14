import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeRuntime, ensureNetworks, runtimeEnv, writeRuntimeEnv, NO_RELEASE } from './compose.js';
import { initDatabase, waitForDb } from './db.js';
import { DEFAULT_SETTINGS, ensureDirs, layout, readSettings, validateSettings, writeAtomic, type Settings } from './layout.js';
import { lockedImages } from './lock.js';
import { run } from './proc.js';
import { UID } from './importer.js';
import { readPointers } from './activate.js';

/** Secret files and the container user that must read each one (mode 0400). */
const SECRETS: { name: string; owner: number }[] = [
  { name: 'db_admin_password', owner: 0 },
  { name: 'db_render_import_password', owner: 0 },
  { name: 'db_api_password', owner: 1000 }, // node user in the API image
  { name: 'tile_db_password', owner: UID.tegola },
];

export async function init(opts: Partial<Settings>, log: (m: string) => void): Promise<void> {
  const l = layout();
  ensureDirs(l);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...readSettings(l), ...opts };
  validateSettings(settings);
  writeAtomic(l.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  for (const s of SECRETS) {
    const p = join(l.secrets, s.name);
    if (!existsSync(p)) {
      writeFileSync(p, randomBytes(24).toString('hex'), { mode: 0o400 });
      log(`[init] generated secret ${s.name}`);
    }
    chownSync(p, s.owner, s.owner);
    chmodSync(p, 0o400);
  }
  await ensureNetworks();
  const pointers = readPointers(l);
  if (!existsSync(l.runtimeEnv)) {
    mkdirSync(join(l.releases, NO_RELEASE), { recursive: true });
    writeRuntimeEnv(l, runtimeEnv(l, settings, lockedImages(l.install), pointers.active ?? NO_RELEASE));
  }
  await composeRuntime(l, ['up', '-d', 'db']);
  await waitForDb(l);
  const applied = await initDatabase(l);
  log(`[init] database roles ensured; migrations applied: ${applied.length ? applied.join(', ') : 'none (up to date)'}`);
}

/** Local CA + server certificate for the internal entry point (no ACME, no public CA). */
export async function tlsInit(names: string[], log: (m: string) => void, days = 825): Promise<void> {
  const l = layout();
  mkdirSync(l.tls, { recursive: true, mode: 0o711 });
  const caKey = join(l.tls, 'ca.key');
  const caCrt = join(l.tls, 'ca.crt');
  const key = join(l.tls, 'server.key');
  const csr = join(l.tls, 'server.csr');
  const crt = join(l.tls, 'server.crt');
  if (existsSync(crt)) throw new Error('TLS material already exists; remove it deliberately before re-issuing');
  const san = names.map((n) => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? `IP:${n}` : `DNS:${n}`)).join(',');
  const ext = join(l.tls, 'server.ext');
  writeFileSync(ext, `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
  await run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', caKey, '-out', caCrt, '-days', '3650', '-subj', '/CN=Seyra internal test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  await run('openssl', ['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${names[0]}`]);
  await run('openssl', ['x509', '-req', '-in', csr, '-CA', caCrt, '-CAkey', caKey, '-CAcreateserial', '-out', crt, '-days', String(days), '-extfile', ext]);
  chmodSync(caKey, 0o400);
  chownSync(key, 101, 101); // nginx user in the proxy image
  chmodSync(key, 0o400);
  chmodSync(crt, 0o444);
  chmodSync(caCrt, 0o444);
  log(`[tls] issued server certificate for ${names.join(', ')}; distribute ${caCrt} to clients that must trust it`);
}

export async function tlsImport(certPath: string, keyPath: string, log: (m: string) => void): Promise<void> {
  const l = layout();
  mkdirSync(l.tls, { recursive: true, mode: 0o711 });
  writeFileSync(join(l.tls, 'server.crt'), readFileSync(certPath), { mode: 0o444 });
  writeFileSync(join(l.tls, 'server.key'), readFileSync(keyPath), { mode: 0o400 });
  chownSync(join(l.tls, 'server.key'), 101, 101);
  await run('openssl', ['x509', '-in', join(l.tls, 'server.crt'), '-noout', '-subject', '-enddate']);
  log('[tls] imported operator-provided certificate and key');
}
