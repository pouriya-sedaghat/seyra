import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { isLoopbackIPv4, parseIPv4, parseLanCidrs } from './net.js';
import { REFERENCE_MIN_FREE_FACTOR } from './capacity.js';

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
  /** Global lock for short mutating lifecycle commands (review R3). */
  lifecycleLock: string;
  /** Journal of an activation/rollback transition in progress (review R2). */
  transitionFile: string;
  /** Configuration backed up at the start of a transition, for recovery. */
  transitionDir: string;
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
    lifecycleLock: join(state, 'lifecycle.lock'),
    transitionFile: join(state, 'transition.json'),
    transitionDir: join(state, 'transition'),
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
  /**
   * Import admission on SEYRA_HOME's filesystem: required = max(minFreeBytes, minFreeFactor x input
   * size), compared with free space plus a replaced failed build's bytes (capacity.ts). The default
   * factor is the measured Iran reference with margin; `init` persists it, so a home initialised
   * with an older default keeps that value until the operator changes state/settings.json.
   */
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
  minFreeFactor: REFERENCE_MIN_FREE_FACTOR,
  minFreeBytes: 2 * 1024 ** 3,
  readinessTimeoutS: 300,
};

export function readSettings(l: Layout): Settings {
  if (!existsSync(l.settingsFile)) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(l.settingsFile, 'utf8')) as Partial<Settings>) };
}

const ACCESS_MODES = ['loopback', 'lan'] as const;
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/**
 * Access rules (fail closed, checked before anything is persisted or started):
 *  - loopback: the published bind address must be in 127.0.0.0/8 and no allowlist is configured;
 *  - lan: any non-loopback exposure needs explicit, valid CIDRs (nginx adds `deny all` after them).
 * A non-loopback bind is therefore impossible without an allowlist.
 */
export function validateAccess(a: { accessMode: unknown; bindAddr: unknown; lanCidrs: unknown; httpsPort: unknown; serverNames: unknown }): void {
  if (!ACCESS_MODES.includes(a.accessMode as never)) throw new Error(`access mode must be one of ${ACCESS_MODES.join(', ')} (got ${JSON.stringify(a.accessMode)})`);
  if (typeof a.bindAddr !== 'string' || parseIPv4(a.bindAddr) === null) throw new Error(`bind address ${JSON.stringify(a.bindAddr)} is not a valid IPv4 address`);
  if (typeof a.lanCidrs !== 'string') throw new Error('LAN CIDRs must be a comma-separated string');
  if (!Number.isInteger(a.httpsPort) || (a.httpsPort as number) < 1 || (a.httpsPort as number) > 65535) throw new Error(`invalid HTTPS port ${JSON.stringify(a.httpsPort)}`);
  if (typeof a.serverNames !== 'string' || !a.serverNames.trim() || !a.serverNames.trim().split(/\s+/).every((n) => HOST_RE.test(n) || parseIPv4(n) !== null)) {
    throw new Error(`invalid server names ${JSON.stringify(a.serverNames)}`);
  }
  if (a.accessMode === 'loopback') {
    if (!isLoopbackIPv4(a.bindAddr)) {
      throw new Error(`loopback access mode requires a loopback bind address (127.0.0.0/8), got ${a.bindAddr}; non-loopback exposure needs --access lan with --lan-cidrs`);
    }
    if (a.lanCidrs.trim()) throw new Error('a LAN CIDR allowlist is only valid with --access lan');
  } else {
    if (!a.lanCidrs.trim()) throw new Error('LAN access mode requires an explicit CIDR allowlist (fail closed)');
    parseLanCidrs(a.lanCidrs);
    if (isLoopbackIPv4(a.bindAddr)) throw new Error('LAN access mode needs a non-loopback --bind address');
  }
}

export function validateSettings(s: Settings): void {
  validateAccess(s);
  const intIn = (name: string, v: unknown, min: number, max: number) => {
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  };
  intIn('valhallaThreads', s.valhallaThreads, 1, 256);
  intIn('buildThreads', s.buildThreads, 1, 256);
  intIn('readinessTimeoutS', s.readinessTimeoutS, 10, 3600);
  if (typeof s.minFreeFactor !== 'number' || !(s.minFreeFactor > 0)) throw new Error('minFreeFactor must be a positive number');
  intIn('minFreeBytes', s.minFreeBytes, 0, Number.MAX_SAFE_INTEGER);
  if (typeof s.tileCacheMax !== 'string' || !/^[1-9][0-9]*[kmg]$/.test(s.tileCacheMax)) throw new Error('tileCacheMax must look like 512m or 2g');
  if (typeof s.photonJavaOpts !== 'string' || !/^[-A-Za-z0-9=:+._ ]+$/.test(s.photonJavaOpts)) throw new Error('photonJavaOpts contains unsupported characters');
}

/** The same access rules applied to a generated runtime.env (runtime boundary before start). */
export function validateRuntimeAccess(env: Record<string, string>): void {
  validateAccess({
    accessMode: env.SEYRA_ACCESS_MODE,
    bindAddr: env.SEYRA_BIND_ADDR,
    lanCidrs: env.SEYRA_LAN_ALLOW_CIDRS ?? '',
    httpsPort: Number(env.SEYRA_HTTPS_PORT),
    serverNames: env.SEYRA_SERVER_NAMES,
  });
}

/** Atomic write (temp file + rename). */
export function writeAtomic(path: string, content: string, mode = 0o644): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}
