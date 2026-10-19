// Desired-behaviour regression tests for review findings R2 (exception-safe activation recovery)
// and R3 (lifecycle exclusion). The real activate/recover/rollback/prune/lock code runs against a
// real temporary SEYRA_HOME with genuine release fixtures (checksums made by the production helpers,
// so the real verifyRelease runs). Only the Docker/SQL boundary is replaced by a small simulated
// stack; cross-process cases use a real second OS process as the lock owner.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Sim {
  running: string | null;
  failUp: number;
  unhealthy: Set<string>;
  upCalls: number;
  drops: string[];
  markers: Map<string, string>;
  /** Another process holds the ingress host port. */
  portHeld: boolean;
  /** The proxy runs without its published port (Docker after a failed bind, observed in lifecycle L8). */
  proxyUnpublished: boolean;
  proxyRecreates: number;
  /** Simulated duration of `compose up` (ms). */
  upDelayMs: number;
}
const sim: Sim = { running: null, failUp: 0, unhealthy: new Set(), upCalls: 0, drops: [], markers: new Map(), portHeld: false, proxyUnpublished: false, proxyRecreates: 0, upDelayMs: 0 };

vi.mock('./compose.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./compose.js')>();
  const { readFileSync: read } = await import('node:fs');
  return {
    ...orig,
    composeRuntime: vi.fn(async (l: { runtimeEnv: string }, args: string[]) => {
      if (args[0] === 'up') {
        sim.upCalls++;
        if (sim.upDelayMs) await new Promise((r) => setTimeout(r, sim.upDelayMs));
        if (sim.failUp > 0) {
          sim.failUp--;
          throw new Error('injected: docker compose up failed (container create error)');
        }
        sim.running = orig.parseEnv(read(l.runtimeEnv, 'utf8')).SEYRA_DATASET_ID ?? null;
        // Docker semantics reproduced in isolation: a proxy started while the port is held runs
        // unpublished; a plain `up` leaves a running proxy alone; only a recreate binds again.
        if (args.includes('--force-recreate')) {
          sim.proxyRecreates++;
          sim.proxyUnpublished = sim.portHeld;
        } else if (sim.portHeld) sim.proxyUnpublished = true;
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'port') {
        const env = orig.parseEnv(read(l.runtimeEnv, 'utf8'));
        return sim.running && !sim.proxyUnpublished
          ? { code: 0, stdout: `${env.SEYRA_BIND_ADDR}:${env.SEYRA_HTTPS_PORT}\n`, stderr: '' }
          : { code: 1, stdout: '', stderr: 'no port 8443/tcp for container seyra-proxy-1: ' };
      }
      if (args[0] === 'stop' && args.includes('proxy')) sim.running = null;
      if (args[0] === 'exec') {
        const ds = sim.running;
        if (!ds || sim.unhealthy.has(ds)) return { code: 3, stdout: '', stderr: '' };
        const providers = ['tiles', 'routing', 'geocoder', 'overpass'].map((provider) => ({ provider, status: 'ok', observed_identity: `${provider}-${ds}` }));
        return { code: 0, stdout: JSON.stringify({ dataset_id: ds, providers, dependencies: [{ name: 'control_db', status: 'ok' }] }), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }),
  };
});
vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db.js')>()),
  psql: vi.fn(async (_l: unknown, database: string, sql: string) => {
    if (sql.includes('DROP DATABASE')) sim.drops.push(/DROP DATABASE IF EXISTS (\S+)/.exec(sql)![1]!);
    if (sql.includes('SELECT dataset_id FROM render.seyra_release')) return sim.markers.get(database) ?? '';
    return '';
  }),
  recordEvent: vi.fn(async () => undefined),
}));
vi.mock('./lock.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./lock.js')>();
  const images = orig.IMAGE_ROLES.map((role) => ({ role, ref: `seyra/${role.toLowerCase()}:test`, image_id: `sha256:${role.toLowerCase()}`, platform: 'linux/amd64', origin: 'test' }));
  return { ...orig, lockedImages: vi.fn(() => images), verifyImages: vi.fn(async () => images.map((i) => ({ role: i.role, ref: i.ref, ok: true, observed: i.image_id, expected: i.image_id }))) };
});
vi.mock('./proc.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./proc.js')>()),
  run: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })), // e.g. `docker ps` of job containers: none
}));

const { activate, prune, readPointers, readTransition, recover, rollback } = await import('./activate.js');
const { runtimeEnv, writeRuntimeEnv } = await import('./compose.js');
const { renderDbName } = await import('./db.js');
const { LifecycleBusyError, readOwner, withLifecycleLock } = await import('./lifecycle-lock.js');
const { DEFAULT_SETTINGS, ensureDirs, layout } = await import('./layout.js');
const { lockedImages } = await import('./lock.js');
const { DATA_COMPONENT_ROLES, MANIFEST_SCHEMA, readManifest, sha256File, sha256Text, treeDigest, writeManifest } = await import('./manifest.js');
const { PHOTON_OPENSEARCH_SETTINGS } = await import('./photon-config.js');

type L = ReturnType<typeof layout>;
let home = '';
let l: L;
// Activation checks the served TLS pair under the lifecycle lock; every fixture home gets a real,
// matching temporary certificate/key (test-only material, generated once).
const tlsFixture = mkdtempSync(join(tmpdir(), 'seyra-lifecycle-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(tlsFixture, 'server.key'), '-out', join(tlsFixture, 'server.crt'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
afterAll(() => rmSync(tlsFixture, { recursive: true, force: true }));
function installTlsFixture(): void {
  mkdirSync(l.tls, { recursive: true });
  for (const f of ['server.crt', 'server.key']) copyFileSync(join(tlsFixture, f), join(l.tls, f));
  copyFileSync(join(tlsFixture, 'server.crt'), join(l.tls, 'ca.crt'));
}
const fast = { log: () => undefined, readinessTimeoutS: 0.4, pollMs: 10 };
const children: ChildProcess[] = [];

async function makeRelease(id: string, status: 'validated' | 'building' | 'failed' = 'validated'): Promise<void> {
  const dir = join(l.releases, id);
  for (const d of ['valhalla', 'overpass/db', 'maps/styles', 'geocoder', 'photon/photon_data/node_1/config', 'tegola', 'source']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'valhalla', 'tiles.bin'), `graph ${id}`);
  writeFileSync(join(dir, 'overpass', 'db', 'nodes.bin'), `overpass ${id}`);
  writeFileSync(join(dir, 'maps', 'tiles.json'), '{}');
  writeFileSync(join(dir, 'geocoder', 'photon-import.jsonl'), `{"id":"${id}"}\n`);
  writeFileSync(join(dir, 'photon', 'photon_data', 'node_1', 'config', 'opensearch.yml'), `${PHOTON_OPENSEARCH_SETTINGS.join('\n')}\n`);
  const toml = `# tegola ${id}\n`;
  writeFileSync(join(dir, 'tegola', 'tegola.toml'), toml);
  const pbf = join(dir, 'source', 'input.osm.pbf');
  writeFileSync(pbf, `pbf ${id}`);
  const now = new Date().toISOString();
  writeManifest(dir, {
    schema: MANIFEST_SCHEMA,
    dataset_id: id,
    status,
    created_at: now,
    updated_at: now,
    source: { original_path: pbf, filename: 'input.osm.pbf', size_bytes: 1, sha256: await sha256File(pbf), managed_copy: pbf, snapshot_timestamp: null, snapshot_timestamp_source: 'unknown', bbox: null, counts: {} },
    pipeline: { pipeline_version: 'test', fingerprint_sha256: 'x', files: {}, catalog_version: 'x', search_normalization_version: 'x', style_version: 'x' },
    components: Object.fromEntries(DATA_COMPONENT_ROLES.map((r) => [r, { ref: `seyra/${r.toLowerCase()}:test`, image_id: `sha256:${r.toLowerCase()}` }])),
    assets: { assets_sha256: 'x', source: 'test' },
    artifacts: {
      routing: { sha256: (await treeDigest(join(dir, 'valhalla'))).sha256 },
      overpass: { sha256: (await treeDigest(join(dir, 'overpass', 'db'))).sha256 },
      maps: { sha256: (await treeDigest(join(dir, 'maps'))).sha256 },
      geocoder: { import_sha256: await sha256File(join(dir, 'geocoder', 'photon-import.jsonl')) },
      render: { tegola_config_sha256: sha256Text(toml) },
    },
    identities: { tiles: `tiles-${id}`, routing: `routing-${id}`, geocoder: `geocoder-${id}`, overpass: `overpass-${id}` },
    measurements: { steps: [], free_bytes_before: null, free_bytes_min_observed: null },
    validation: { status: status === 'validated' ? 'passed' : 'pending', checks: [] },
    failure: null,
  });
  sim.markers.set(renderDbName(id), id);
}

/** A state where A is active and serving (as after a successful earlier activation). */
async function activeA(): Promise<void> {
  await makeRelease('ds-a');
  await makeRelease('ds-b');
  writeRuntimeEnv(l, runtimeEnv(l, { ...DEFAULT_SETTINGS }, lockedImages(l.install), 'ds-a'));
  writeFileSync(join(l.active, 'release.json'), '{"dataset_id":"ds-a"}\n');
  writeFileSync(l.pointersFile, `${JSON.stringify({ active: 'ds-a', previous: null })}\n`);
  sim.running = 'ds-a';
}

const snapshot = () => ({
  runtimeEnv: readFileSync(l.runtimeEnv, 'utf8'),
  release: readFileSync(join(l.active, 'release.json'), 'utf8'),
  pointers: readPointers(l),
});
const maintenanceOn = () => existsSync(join(l.flags, 'maintenance'));

/** Assert the platform is back exactly on A: config, pointers, no maintenance/journal, serving A. */
function expectRestoredToA(before: ReturnType<typeof snapshot>): void {
  expect(snapshot()).toEqual(before);
  expect(maintenanceOn()).toBe(false);
  expect(readTransition(l)).toBeNull();
  expect(existsSync(l.transitionDir)).toBe(false);
  expect(sim.running).toBe('ds-a');
  expect(lockReleased()).toBe(true);
}

/** A real, live foreign process to own a lock (cross-process liveness, not a fake flag). */
function liveForeignProcess(): ChildProcess {
  const c = spawn('sleep', ['120'], { stdio: 'ignore' });
  children.push(c);
  return c;
}
function writeLock(path: string, pid: number, op: string, target: string | null): void {
  writeFileSync(path, `${JSON.stringify({ pid, host: hostname(), op, target, started_at: new Date().toISOString(), token: `foreign-${pid}` })}\n`);
}
/** Is the kernel lock on `path` held by any process right now? */
function lockHeld(path: string): boolean {
  return spawnSync('flock', ['-n', '-E', '75', path, 'true']).status === 75;
}
/** Released: kernel lock free and no owner record left behind. */
function lockReleased(): boolean {
  return !lockHeld(l.lifecycleLock) && readOwner(l.lifecycleLock) === null;
}
/** A real, live foreign process holding the lifecycle lock (as another ops container would). */
async function liveForeignLockHolder(op: string, target: string | null): Promise<ChildProcess> {
  const c = spawn('flock', ['-o', l.lifecycleLock, 'sleep', '120'], { stdio: 'ignore' });
  children.push(c);
  while (!lockHeld(l.lifecycleLock)) await new Promise((r) => setTimeout(r, 10));
  writeLock(l.lifecycleLock, c.pid!, op, target);
  return c;
}
async function kill(c: ChildProcess): Promise<void> {
  if (c.exitCode !== null || c.signalCode !== null) return;
  await new Promise<void>((res) => {
    c.once('exit', () => res());
    c.kill('SIGKILL');
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'seyra-lifecycle-'));
  process.env.SEYRA_HOME = home;
  process.env.SEYRA_INSTALL_DIR = join(home, 'install');
  l = layout();
  ensureDirs(l);
  installTlsFixture();
  Object.assign(sim, { running: null, failUp: 0, unhealthy: new Set(), upCalls: 0, drops: [], markers: new Map(), portHeld: false, proxyUnpublished: false, proxyRecreates: 0, upDelayMs: 0 });
});
afterEach(async () => {
  for (const c of children.splice(0)) await kill(c);
  rmSync(home, { recursive: true, force: true });
  delete process.env.SEYRA_HOME;
  delete process.env.SEYRA_INSTALL_DIR;
});

describe('TLS precondition under the lifecycle lock (review H2)', () => {
  it('activation refuses, before changing anything, when a certificate replacement is unfinished', async () => {
    await activeA();
    writeFileSync(join(l.tls, 'replace.json'), '{}');
    const before = readFileSync(l.pointersFile, 'utf8');
    await expect(activate('ds-b', fast)).rejects.toThrow(/certificate replacement did not finish/);
    expect(readFileSync(l.pointersFile, 'utf8')).toBe(before);
    expect(existsSync(l.transitionFile)).toBe(false);
  });
  it('activation refuses a mismatched served pair', async () => {
    await activeA();
    execFileSync('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-out', join(l.tls, 'other.key')], { stdio: 'ignore' });
    copyFileSync(join(l.tls, 'other.key'), join(l.tls, 'server.key'));
    await expect(activate('ds-b', fast)).rejects.toThrow(/does not match/);
    expect(existsSync(l.transitionFile)).toBe(false);
  });
});

describe('activation recovery (review R2)', () => {
  it('commits a successful A -> B transition and clears maintenance and the journal', async () => {
    await activeA();
    await activate('ds-b', fast);
    expect(readPointers(l)).toEqual({ active: 'ds-b', previous: 'ds-a' });
    expect(sim.running).toBe('ds-b');
    expect(maintenanceOn()).toBe(false);
    expect(readTransition(l)).toBeNull();
  });

  it('compose up failure after the config switch restores A (reviewed case)', async () => {
    await activeA();
    const before = snapshot();
    sim.failUp = 1;
    await expect(activate('ds-b', fast)).rejects.toThrow(/activation of ds-b failed \(injected: docker compose up failed.*previous release ds-a restored and ready/);
    expect(sim.upCalls).toBe(2); // the failed start + the recovery start
    expectRestoredToA(before);
  });

  it('a filesystem failure while switching the configuration restores A', async () => {
    await activeA();
    const before = snapshot();
    mkdirSync(`${l.runtimeEnv}.tmp-${process.pid}`); // makes the atomic runtime.env write fail (EISDIR)
    await expect(activate('ds-b', fast)).rejects.toThrow(/previous release ds-a restored and ready/);
    rmSync(`${l.runtimeEnv}.tmp-${process.pid}`, { recursive: true });
    expectRestoredToA(before);
  });

  it('providers not reporting the new revision restore A', async () => {
    await activeA();
    const before = snapshot();
    sim.unhealthy.add('ds-b');
    await expect(activate('ds-b', fast)).rejects.toThrow(/providers did not report ds-b.*previous release ds-a restored and ready/);
    expectRestoredToA(before);
  });

  it('when recovery also fails: maintenance stays on, both errors are reported, journal kept; recover finishes it', async () => {
    await activeA();
    const before = snapshot();
    sim.failUp = 99;
    const err = await activate('ds-b', fast).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/activation of ds-b failed \(injected.*AND restoring ds-a failed \(injected.*stays in maintenance.*seyra-maps recover/);
    expect(maintenanceOn()).toBe(true);
    expect(readTransition(l)).toMatchObject({ from: 'ds-a', to: 'ds-b' });
    expect(readPointers(l)).toEqual(before.pointers);
    // Fail closed until recovered: another activation and prune refuse to run.
    await expect(activate('ds-b', fast)).rejects.toThrow(/did not finish; run: seyra-maps recover/);
    await expect(prune(() => undefined)).rejects.toThrow(/run: seyra-maps recover/);
    sim.failUp = 0;
    await recover(fast);
    expectRestoredToA(before);
  });

  it('a proxy Docker left running without its published port is recreated before readiness counts', async () => {
    await activeA();
    sim.proxyUnpublished = true; // e.g. left over from an earlier failed bind
    await activate('ds-b', fast);
    expect(sim.proxyRecreates).toBe(1);
    expect(sim.proxyUnpublished).toBe(false);
    expect(readPointers(l)).toEqual({ active: 'ds-b', previous: 'ds-a' });
  });

  it('an ingress that cannot be published is never reported ready (lifecycle L8): recovery fails closed, recover rebinds it', async () => {
    await activeA();
    const before = snapshot();
    sim.portHeld = true; // another process holds 127.0.0.1:8443 throughout
    const err = await activate('ds-b', fast).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/activation of ds-b failed \(the proxy does not publish 127\.0\.0\.1:8443.*AND restoring ds-a failed \(the proxy does not publish 127\.0\.0\.1:8443/);
    expect(maintenanceOn()).toBe(true);
    expect(readTransition(l)).toMatchObject({ from: 'ds-a', to: 'ds-b' });
    // The port is free again but the running proxy is still unpublished: a plain `up` would not fix it.
    sim.portHeld = false;
    await recover(fast);
    expect(sim.proxyUnpublished).toBe(false);
    expectRestoredToA(before);
  });

  it('a process killed mid-transition (journal left behind) is restored by recover', async () => {
    await activeA();
    const before = snapshot();
    // Exactly the state an activation leaves when killed after switching the config.
    mkdirSync(l.transitionDir, { recursive: true });
    writeFileSync(join(l.transitionDir, 'runtime.env'), before.runtimeEnv);
    writeFileSync(join(l.transitionDir, 'release.json'), before.release);
    writeFileSync(l.transitionFile, JSON.stringify({ schema: 'seyra.transition/1', op: 'activate', from: 'ds-a', to: 'ds-b', started_at: new Date().toISOString(), phase: 'switched' }));
    writeRuntimeEnv(l, runtimeEnv(l, { ...DEFAULT_SETTINGS }, lockedImages(l.install), 'ds-b'));
    writeFileSync(join(l.active, 'release.json'), '{"dataset_id":"ds-b"}\n');
    writeFileSync(join(l.flags, 'maintenance'), 'ds-b\n');
    sim.running = null;
    await expect(activate('ds-b', fast)).rejects.toThrow(/run: seyra-maps recover/);
    await recover(fast);
    expectRestoredToA(before);
  });

  it('a transition killed after committing its pointers is finished (not reverted) by recover', async () => {
    await activeA();
    writeRuntimeEnv(l, runtimeEnv(l, { ...DEFAULT_SETTINGS }, lockedImages(l.install), 'ds-b'));
    writeFileSync(l.pointersFile, JSON.stringify({ active: 'ds-b', previous: 'ds-a' }));
    mkdirSync(l.transitionDir, { recursive: true });
    writeFileSync(l.transitionFile, JSON.stringify({ schema: 'seyra.transition/1', op: 'activate', from: 'ds-a', to: 'ds-b', started_at: new Date().toISOString(), phase: 'committed' }));
    writeFileSync(join(l.flags, 'maintenance'), 'ds-b\n');
    sim.running = null;
    await recover(fast);
    expect(readPointers(l)).toEqual({ active: 'ds-b', previous: 'ds-a' });
    expect(sim.running).toBe('ds-b');
    expect(maintenanceOn()).toBe(false);
    expect(readTransition(l)).toBeNull();
  });

  it('rollback runs activate inside the same lock without deadlocking', async () => {
    await activeA();
    await activate('ds-b', fast);
    await rollback(() => undefined).catch((e) => {
      throw e;
    });
    expect(readPointers(l)).toEqual({ active: 'ds-a', previous: 'ds-b' });
    expect(sim.running).toBe('ds-a');
  }, 20_000);
});

describe('lifecycle exclusion (review R3)', () => {
  it('prune never drops or deletes what a live import is building (reviewed case)', async () => {
    await activeA();
    await makeRelease('ds-p');
    writeFileSync(l.pointersFile, JSON.stringify({ active: 'ds-a', previous: 'ds-p' }));
    await makeRelease('ds-c', 'building'); // the live import's named target
    await makeRelease('ds-e', 'building'); // building, not yet named in the lease
    await makeRelease('ds-f', 'failed');
    const importer = liveForeignProcess();
    writeLock(l.importLock, importer.pid!, 'import', 'ds-c');
    const removed = await prune(() => undefined);
    expect(removed.sort()).toEqual(['ds-b', 'ds-f']);
    expect(sim.drops.sort()).toEqual([renderDbName('ds-b'), renderDbName('ds-f')].sort());
    for (const keep of ['ds-a', 'ds-p', 'ds-c', 'ds-e']) expect(existsSync(join(l.releases, keep, 'manifest.json'))).toBe(true);
    expect(readManifest(join(l.releases, 'ds-c')).status).toBe('building');
    expect(existsSync(l.importLock)).toBe(true); // a live owner is never "recovered"
  });

  it('an abandoned import (owner gone) is recovered by prune: marked failed, then removed', async () => {
    await activeA();
    await makeRelease('ds-c', 'building');
    const gone = liveForeignProcess();
    writeLock(l.importLock, gone.pid!, 'import', 'ds-c');
    await kill(gone);
    const removed = await prune(() => undefined);
    expect(removed).toContain('ds-c');
    expect(existsSync(l.importLock)).toBe(false);
    expect(readPointers(l).active).toBe('ds-a');
  });

  it('prune and activation refuse while another live process holds the lifecycle lock', async () => {
    await activeA();
    const before = snapshot();
    const other = await liveForeignLockHolder('activate', 'ds-b');
    await expect(prune(() => undefined)).rejects.toBeInstanceOf(LifecycleBusyError);
    await expect(activate('ds-b', fast)).rejects.toThrow(/another lifecycle operation is running: activate ds-b/);
    expect(sim.drops).toEqual([]);
    expect(existsSync(join(l.releases, 'ds-b'))).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(maintenanceOn()).toBe(false);
    expect(readTransition(l)).toBeNull();
    // Once that owner is gone (the kernel released its lock), its leftover record no longer blocks.
    await kill(other);
    await activate('ds-b', fast);
    expect(readPointers(l).active).toBe('ds-b');
  });

  it('competing activations: exactly one runs, the other is refused without side effects', async () => {
    await activeA();
    await makeRelease('ds-c');
    sim.upDelayMs = 600; // the winner is still inside after the loser's short fail-fast grace
    const results = await Promise.allSettled([activate('ds-b', fast), activate('ds-c', fast)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(LifecycleBusyError);
    const winner = results[0]!.status === 'fulfilled' ? 'ds-b' : 'ds-c';
    expect(readPointers(l)).toEqual({ active: winner, previous: 'ds-a' });
    expect(sim.running).toBe(winner);
    expect(lockReleased()).toBe(true);
  });

  it('a stale lifecycle lock with an unfinished transition only admits recover', async () => {
    await activeA();
    writeFileSync(l.transitionFile, JSON.stringify({ schema: 'seyra.transition/1', op: 'activate', from: 'ds-a', to: 'ds-b', started_at: new Date().toISOString(), phase: 'started' }));
    mkdirSync(l.transitionDir, { recursive: true });
    writeFileSync(join(l.transitionDir, 'runtime.env'), readFileSync(l.runtimeEnv));
    const gone = liveForeignProcess();
    writeLock(l.lifecycleLock, gone.pid!, 'activate', 'ds-b');
    await kill(gone);
    await expect(prune(() => undefined)).rejects.toThrow(/ended without finishing; run: seyra-maps recover/);
    await recover(fast);
    expect(readTransition(l)).toBeNull();
    expect(sim.running).toBe('ds-a');
  });

  it('the first command on a fresh SEYRA_HOME (init, before state/ exists) can take the lock', async () => {
    const fresh = join(home, 'fresh-home');
    process.env.SEYRA_HOME = fresh;
    const lf = layout();
    expect(existsSync(lf.state)).toBe(false);
    expect(await withLifecycleLock(lf, 'init', null, async () => readOwner(lf.lifecycleLock)?.op)).toBe('init');
    expect(readOwner(lf.lifecycleLock)).toBeNull(); // released: the file stays, its owner record is cleared
    expect(lockHeld(lf.lifecycleLock)).toBe(false);
  });
});
