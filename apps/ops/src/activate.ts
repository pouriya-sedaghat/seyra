import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeRuntime, runtimeEnv, writeRuntimeEnv, NO_RELEASE } from './compose.js';
import { psql, recordEvent, renderDbName } from './db.js';
import { layout, managedChild, readSettings, writeAtomic, type Layout } from './layout.js';
import { lockedImages, verifyImages } from './lock.js';
import { PHOTON_OPENSEARCH_SETTINGS } from './photon-config.js';
import { DATA_COMPONENT_ROLES, readManifest, sha256File, sha256Text, treeDigest, type Manifest } from './manifest.js';

export interface Pointers {
  active: string | null;
  previous: string | null;
}

export function readPointers(l: Layout): Pointers {
  if (!existsSync(l.pointersFile)) return { active: null, previous: null };
  return JSON.parse(readFileSync(l.pointersFile, 'utf8')) as Pointers;
}

function writePointers(l: Layout, p: Pointers): void {
  writeAtomic(l.pointersFile, `${JSON.stringify(p, null, 2)}\n`);
}

function history(l: Layout, entry: Record<string, unknown>): void {
  writeFileSync(l.historyFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { flag: 'a', mode: 0o640 });
}

/** Re-verify a staged release before it may become active (managed checksums + frozen DB). */
export async function verifyRelease(l: Layout, datasetId: string): Promise<{ manifest: Manifest; problems: string[] }> {
  const dir = managedChild(l.releases, datasetId);
  const m = readManifest(dir);
  const problems: string[] = [];
  if (m.status !== 'validated') problems.push(`release status is ${m.status}`);
  if (!m.identities) problems.push('release has no recorded provider identities');
  // The stores are only servable by the exact data-component images that built them.
  const locked = new Map(lockedImages(l.install).map((i) => [i.role, i.image_id]));
  for (const role of DATA_COMPONENT_ROLES) {
    const built = m.components[role]?.image_id;
    if (!built || built !== locked.get(role)) problems.push(`release was built with ${role} ${built ?? 'unknown'}, locked image is ${locked.get(role) ?? 'unknown'}; re-import required`);
  }
  const art = m.artifacts as Record<string, Record<string, unknown>>;
  const routing = await treeDigest(join(dir, 'valhalla'));
  if (routing.sha256 !== art.routing?.sha256) problems.push('routing graph checksum mismatch');
  const overpass = await treeDigest(join(dir, 'overpass', 'db'));
  if (overpass.sha256 !== art.overpass?.sha256) problems.push('overpass base checksum mismatch');
  const maps = await treeDigest(join(dir, 'maps'));
  if (maps.sha256 !== art.maps?.sha256) problems.push('map styles checksum mismatch');
  const importFile = join(dir, 'geocoder', 'photon-import.jsonl');
  if (!existsSync(importFile) || (await sha256File(importFile)) !== art.geocoder?.import_sha256) problems.push('geocoder import checksum mismatch');
  if (!existsSync(join(dir, 'photon', 'photon_data'))) problems.push('photon index missing');
  const photonConf = join(dir, 'photon', 'photon_data', 'node_1', 'config', 'opensearch.yml');
  const conf = existsSync(photonConf) ? readFileSync(photonConf, 'utf8') : '';
  if (!PHOTON_OPENSEARCH_SETTINGS.every((line) => conf.includes(line))) {
    problems.push('photon index lacks the absolute disk watermarks (built by an older pipeline); re-import required');
  }
  const tegola = readFileSync(join(dir, 'tegola', 'tegola.toml'), 'utf8');
  if (sha256Text(tegola) !== art.render?.tegola_config_sha256) problems.push('tegola configuration checksum mismatch');
  if ((await sha256File(m.source.managed_copy)) !== m.source.sha256) problems.push('managed source copy checksum mismatch');
  try {
    const marker = (await psql(l, renderDbName(datasetId), 'SELECT dataset_id FROM render.seyra_release;')).trim();
    if (marker !== datasetId) problems.push(`render database marker is ${marker || 'missing'}`);
  } catch (err) {
    problems.push(`render database unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { manifest: m, problems };
}

interface ApiHealth {
  dataset_id: string | null;
  providers: { provider: string; status: string; observed_identity: string | null }[];
  dependencies: { name: string; status: string }[];
}

/** Probe the API's real provider checks from inside its container (no host port needed). */
export async function apiHealth(l: Layout): Promise<ApiHealth | null> {
  const script =
    "fetch('http://127.0.0.1:3000/api/v1/map/health').then(r=>r.text()).then(t=>{process.stdout.write(t)},()=>process.exit(3))";
  const r = await composeRuntime(l, ['exec', '-T', 'api', 'node', '-e', script], { allowFailure: true });
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as ApiHealth;
  } catch {
    return null;
  }
}

/** Same-revision readiness: every provider ok with the expected dataset (maintenance flag ignored). */
async function waitSameRevision(l: Layout, datasetId: string, timeoutS: number, log: (m: string) => void): Promise<{ ok: boolean; last: ApiHealth | null }> {
  const deadline = Date.now() + timeoutS * 1000;
  let last: ApiHealth | null = null;
  while (Date.now() < deadline) {
    last = await apiHealth(l);
    if (last && last.dataset_id === datasetId && last.providers.length === 4 && last.providers.every((p) => p.status === 'ok') && last.dependencies.every((d) => d.status === 'ok')) {
      return { ok: true, last };
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  log(`[activate] readiness not reached: ${JSON.stringify(last?.providers ?? null)}`);
  return { ok: false, last };
}

function releaseDescriptor(m: Manifest): string {
  return `${JSON.stringify({ schema: 'seyra.active-release/1', dataset_id: m.dataset_id, activated_at: new Date().toISOString(), identities: m.identities }, null, 2)}\n`;
}

/** Bring up the complete stack for `datasetId` (config already written). */
async function startStack(l: Layout): Promise<void> {
  await composeRuntime(l, ['up', '-d', '--remove-orphans']);
}

export async function activate(datasetId: string, opts: { log: (m: string) => void; reason?: 'activate' | 'rollback' }): Promise<void> {
  const l = layout();
  const s = readSettings(l);
  const images = lockedImages(l.install);
  const bad = (await verifyImages(images)).filter((c) => !c.ok);
  if (bad.length) throw new Error(`images missing or not matching the lock: ${bad.map((b) => b.ref).join(', ')}`);
  const { manifest, problems } = await verifyRelease(l, datasetId);
  if (problems.length) throw new Error(`release ${datasetId} cannot be activated: ${problems.join('; ')}`);

  const pointers = readPointers(l);
  const prior = pointers.active;
  const maintenance = join(l.flags, 'maintenance');
  opts.log(`[activate] ${prior ?? '(none)'} -> ${datasetId}: entering maintenance window`);
  writeFileSync(maintenance, `${datasetId}\n`);
  history(l, { event: 'activation_started', dataset_id: datasetId, from: prior });
  await recordEvent(l, datasetId, 'activation_started', { from: prior }).catch(() => undefined);

  // Drain: API stops admitting work (maintenance) and gets its grace period on SIGTERM.
  await composeRuntime(l, ['stop', '-t', '40', 'api'], { allowFailure: true });
  await composeRuntime(l, ['stop', '-t', '20', 'proxy', 'tegola', 'valhalla', 'photon', 'overpass'], { allowFailure: true });

  // Keep the previous complete configuration for recovery/rollback.
  if (existsSync(l.runtimeEnv)) copyFileSync(l.runtimeEnv, join(l.previous, 'runtime.env'));
  if (existsSync(join(l.active, 'release.json'))) copyFileSync(join(l.active, 'release.json'), join(l.previous, 'release.json'));

  writeRuntimeEnv(l, runtimeEnv(l, s, images, datasetId));
  writeAtomic(join(l.active, 'release.json'), releaseDescriptor(manifest));
  // Discard only the managed, dataset-keyed tile cache.
  for (const entry of readdirSync(join(l.cache, 'tiles'))) rmSync(join(l.cache, 'tiles', entry), { recursive: true, force: true });

  await startStack(l);
  const result = await waitSameRevision(l, datasetId, s.readinessTimeoutS, opts.log);
  if (result.ok) {
    rmSync(maintenance, { force: true });
    writePointers(l, opts.reason === 'rollback' ? { active: datasetId, previous: prior } : { active: datasetId, previous: prior ?? pointers.previous });
    history(l, { event: opts.reason === 'rollback' ? 'rollback' : 'activated', dataset_id: datasetId, from: prior });
    await recordEvent(l, datasetId, opts.reason === 'rollback' ? 'rollback' : 'activated', { from: prior }).catch(() => undefined);
    opts.log(`[activate] ${datasetId} is active; all four providers report its identities`);
    return;
  }

  // Failed activation: restore the previous complete configuration (if any).
  history(l, { event: 'activation_failed', dataset_id: datasetId, last: result.last });
  await recordEvent(l, datasetId, 'activation_failed', { last: result.last }).catch(() => undefined);
  if (!prior || !existsSync(join(l.previous, 'runtime.env'))) {
    throw new Error(`activation of ${datasetId} failed and there is no previous release to restore; the platform stays in maintenance (not ready)`);
  }
  opts.log(`[activate] activation failed; restoring ${prior}`);
  await composeRuntime(l, ['stop', '-t', '40', 'api'], { allowFailure: true });
  copyFileSync(join(l.previous, 'runtime.env'), l.runtimeEnv);
  copyFileSync(join(l.previous, 'release.json'), join(l.active, 'release.json'));
  await startStack(l);
  await composeRuntime(l, ['restart', 'api'], { allowFailure: true });
  const restored = await waitSameRevision(l, prior, s.readinessTimeoutS, opts.log);
  if (restored.ok) {
    rmSync(maintenance, { force: true });
    history(l, { event: 'recovered', dataset_id: prior });
    await recordEvent(l, prior, 'recovered', { failed: datasetId }).catch(() => undefined);
    throw new Error(`activation of ${datasetId} failed; previous release ${prior} restored and ready`);
  }
  throw new Error(`activation of ${datasetId} failed AND restoring ${prior} did not reach readiness; platform remains in maintenance`);
}

export async function rollback(log: (m: string) => void): Promise<void> {
  const l = layout();
  const p = readPointers(l);
  if (!p.previous) throw new Error('no previous release recorded');
  await activate(p.previous, { log, reason: 'rollback' });
}

/** Retain active + previous; remove other managed releases and their render databases. */
export async function prune(log: (m: string) => void): Promise<string[]> {
  const l = layout();
  const p = readPointers(l);
  const keep = new Set([p.active, p.previous].filter((x): x is string => !!x));
  const removed: string[] = [];
  for (const name of readdirSync(l.releases)) {
    if (keep.has(name) || name === NO_RELEASE) continue;
    const dir = managedChild(l.releases, name);
    if (!existsSync(join(dir, 'manifest.json'))) {
      log(`[prune] skipping ${name}: not a managed release (no manifest)`);
      continue;
    }
    await psql(l, 'postgres', `DROP DATABASE IF EXISTS ${renderDbName(name)} WITH (FORCE);`);
    rmSync(dir, { recursive: true, force: true });
    const work = join(l.work, name);
    if (existsSync(work)) rmSync(managedChild(l.work, name), { recursive: true, force: true });
    await recordEvent(l, name, 'pruned', {}).catch(() => undefined);
    removed.push(name);
    log(`[prune] removed release ${name}`);
  }
  return removed;
}
