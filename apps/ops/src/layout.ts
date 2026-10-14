import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** On-disk layout under SEYRA_HOME (identical path inside the ops container and on the host). */
export interface Layout {
  home: string;
  secrets: string;
  tls: string;
  state: string;
  active: string;
  previous: string;
  flags: string;
  releases: string;
  work: string;
  cache: string;
  logs: string;
  backups: string;
  data: string;
  settingsFile: string;
  runtimeEnv: string;
  historyFile: string;
  pointersFile: string;
  importLock: string;
  /** Read-only install files (compose, catalog, lock, migrations) mounted from the bundle. */
  install: string;
}

export function layout(home = process.env.SEYRA_HOME): Layout {
  if (!home || !home.startsWith('/')) throw new Error('SEYRA_HOME must be an absolute path');
  const h = resolve(home);
  const state = join(h, 'state');
  return {
    home: h,
    secrets: join(h, 'secrets'),
    tls: join(h, 'secrets', 'tls'),
    state,
    active: join(state, 'active'),
    previous: join(state, 'previous'),
    flags: join(state, 'flags'),
    releases: join(h, 'releases'),
    work: join(h, 'work'),
    cache: join(h, 'cache'),
    logs: join(h, 'logs'),
    backups: join(h, 'backups'),
    data: join(h, 'data'),
    settingsFile: join(state, 'settings.json'),
    runtimeEnv: join(state, 'runtime.env'),
    historyFile: join(state, 'history.jsonl'),
    pointersFile: join(state, 'pointers.json'),
    importLock: join(state, 'import.lock'),
    install: process.env.SEYRA_INSTALL_DIR ?? '/opt/seyra-install',
  };
}

/** Refuse to touch anything that is not a direct child of a managed directory. */
export function managedChild(parent: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(name)) throw new Error(`refusing unmanaged path name: ${name}`);
  const p = resolve(parent, name);
  if (!p.startsWith(resolve(parent) + sep)) throw new Error(`path escapes managed directory: ${p}`);
  return p;
}

export function ensureDirs(l: Layout): void {
  for (const [dir, mode] of [
    [l.home, 0o755],
    [l.secrets, 0o711],
    [l.tls, 0o711],
    [l.state, 0o755],
    [l.active, 0o755],
    [l.previous, 0o755],
    [l.flags, 0o755],
    [l.releases, 0o755],
    [l.work, 0o755],
    [join(l.cache, 'tiles'), 0o777],
    [l.logs, 0o750],
    [l.backups, 0o750],
    [join(l.data, 'postgres'), 0o700],
  ] as const) {
    mkdirSync(dir, { recursive: true, mode });
    chmodSync(dir, mode);
  }
}

export interface Settings {
  bindAddr: string;
  httpsPort: number;
  accessMode: 'loopback' | 'lan';
  lanCidrs: string;
  serverNames: string;
  valhallaThreads: number;
  buildThreads: number;
  photonJavaOpts: string;
  tileCacheMax: string;
  /** Minimum free space before an import, as a multiple of the input size (reference default). */
  minFreeFactor: number;
  minFreeBytes: number;
  readinessTimeoutS: number;
}

export const DEFAULT_SETTINGS: Settings = {
  bindAddr: '127.0.0.1',
  httpsPort: 8443,
  accessMode: 'loopback',
  lanCidrs: '',
  serverNames: 'localhost 127.0.0.1',
  valhallaThreads: 2,
  buildThreads: 2,
  photonJavaOpts: '-Xms512m -Xmx2g',
  tileCacheMax: '2g',
  minFreeFactor: 40,
  minFreeBytes: 2 * 1024 ** 3,
  readinessTimeoutS: 300,
};

export function readSettings(l: Layout): Settings {
  if (!existsSync(l.settingsFile)) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(l.settingsFile, 'utf8')) as Partial<Settings>) };
}

export function validateSettings(s: Settings): void {
  if (s.accessMode === 'lan') {
    if (!s.lanCidrs.trim()) throw new Error('LAN access mode requires an explicit CIDR allowlist (fail closed)');
    for (const c of s.lanCidrs.split(',')) {
      if (!/^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/.test(c.trim())) throw new Error(`invalid CIDR ${c}`);
    }
    if (s.bindAddr === '127.0.0.1') throw new Error('LAN access mode needs a non-loopback --bind address');
  }
  if (!/^[A-Za-z0-9. -]+$/.test(s.serverNames)) throw new Error('invalid server names');
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s.bindAddr)) throw new Error('bind address must be an IPv4 address');
}

/** Atomic write (temp file + rename). */
export function writeAtomic(path: string, content: string, mode = 0o644): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}
