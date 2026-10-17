import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPointers, type Pointers } from './activate.js';
import { composeRuntime } from './compose.js';
import { initDatabase, psql, waitForDb } from './db.js';
import { layout, managedChild, validateSettings, writeAtomic, DEFAULT_SETTINGS, type Settings } from './layout.js';
import { readManifest, sha256File, type Manifest } from './manifest.js';
import { run } from './proc.js';

/** Secret files that must be restored (from the operator's separate secret backup) before `init`. */
export const REQUIRED_SECRETS = ['db_admin_password', 'db_render_import_password', 'db_api_password', 'tile_db_password'];

/**
 * Control database dump + state/manifests archives. Map stores are not backed up: they are rebuilt
 * from the original OSM input and the locked images. `includeSources` also copies the managed
 * input of the active and previous releases (large) so a restore does not depend on locating the
 * owner's originals. Secrets and TLS keys are never included.
 */
export async function backup(out: string, opts: { includeSources: boolean; log: (m: string) => void }): Promise<void> {
  const l = layout();
  if (!out.startsWith('/')) throw new Error('--out must be absolute');
  mkdirSync(out, { recursive: true, mode: 0o750 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = join(out, `seyra_app-${stamp}.sql`);
  const r = await composeRuntime(l, ['exec', '-T', 'db', 'pg_dump', '-U', 'seyra_admin', '-d', 'seyra_app', '--no-owner'], { discardStdout: false });
  await new Promise<void>((res, rej) => createWriteStream(dump, { mode: 0o600 }).on('error', rej).end(r.stdout, () => res()));
  await run('tar', ['-C', l.home, '-czf', join(out, `state-${stamp}.tar.gz`), 'state']);
  const manifests = readdirSync(l.releases).filter((n) => existsSync(join(l.releases, n, 'manifest.json')));
  await run('tar', ['-C', l.releases, '-czf', join(out, `manifests-${stamp}.tar.gz`), ...manifests.map((n) => `${n}/manifest.json`)], { allowFailure: manifests.length === 0 });
  if (opts.includeSources) {
    const p = readPointers(l);
    mkdirSync(join(out, 'sources'), { recursive: true, mode: 0o750 });
    for (const id of [p.active, p.previous].filter((x): x is string => !!x)) {
      const m = readManifest(managedChild(l.releases, id));
      copyFileSync(m.source.managed_copy, join(out, 'sources', `${id}.osm.pbf`));
      writeFileSync(join(out, 'sources', `${id}.json`), `${JSON.stringify({ dataset_id: id, sha256: m.source.sha256, snapshot_timestamp: m.source.snapshot_timestamp, original_filename: m.source.filename }, null, 2)}\n`);
      opts.log(`[backup] included managed source of ${id} (${m.source.size_bytes} bytes)`);
    }
  }
  opts.log(`[backup] wrote ${dump} and state/manifest archives to ${out} (secrets and TLS keys are NOT included; back them up separately)`);
}

const newest = (dir: string, re: RegExp) => readdirSync(dir).filter((f) => re.test(f)).sort().at(-1);

/**
 * Fresh-host restore of the control database and operator state from a `backup` directory.
 * Order (RUNBOOK §7): bundle installed, the separately backed-up `secrets/` restored, `init` run
 * (so the database roles carry the restored passwords), then `restore`. The initialised control
 * database is replaced by the dump (no replay over an existing schema), grants and pending
 * migrations are re-applied, settings and history are restored. Release pointers are NOT restored:
 * the map stores do not exist yet; the command prints the re-import commands that rebuild the
 * backed-up releases with their original dataset ids, after which `activate` completes the restore.
 */
export async function restore(from: string, log: (m: string) => void): Promise<void> {
  const l = layout();
  if (!from.startsWith('/') || !existsSync(from)) throw new Error('--from must be an existing absolute directory');
  if (readPointers(l).active) throw new Error('restore is for a fresh installation: a release is already active here');
  for (const s of REQUIRED_SECRETS) {
    if (!existsSync(join(l.secrets, s))) throw new Error(`secret ${s} is missing: restore the secrets backup into ${l.secrets} and run init first`);
  }
  const dump = newest(from, /^seyra_app-.*\.sql$/);
  const state = newest(from, /^state-.*\.tar\.gz$/);
  const manifests = newest(from, /^manifests-.*\.tar\.gz$/);
  if (!dump || !state) throw new Error(`${from} has no seyra_app-*.sql dump and state-*.tar.gz archive`);

  // Unpack and validate the operator state first, so a bad backup changes nothing.
  const tmp = mkdtempSync(join(l.work, '.restore-'));
  try {
    await run('tar', ['-C', tmp, '-xzf', join(from, state)]);
    const settingsFile = join(tmp, 'state', 'settings.json');
    const settings = existsSync(settingsFile) ? { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(settingsFile, 'utf8')) as Partial<Settings>) } : null;
    if (settings) validateSettings(settings);
    const p = JSON.parse(readFileSync(join(tmp, 'state', 'pointers.json'), 'utf8')) as Pointers;

    // Control database: replace the freshly initialised one with the dump.
    await composeRuntime(l, ['up', '-d', 'db']);
    await waitForDb(l);
    await composeRuntime(l, ['stop', 'api'], { allowFailure: true });
    await psql(l, 'postgres', 'DROP DATABASE IF EXISTS seyra_app WITH (FORCE);');
    await psql(l, 'postgres', 'CREATE DATABASE seyra_app OWNER seyra_admin;');
    await psql(l, 'seyra_app', readFileSync(join(from, dump), 'utf8'));
    const applied = await initDatabase(l);
    const events = (await psql(l, 'seyra_app', 'SELECT count(*) FROM seyra_control.release_events;')).trim();
    log(`[restore] control database restored from ${dump} (${events} release events); grants re-applied; migrations applied now: ${applied.length ? applied.join(', ') : 'none'}`);

    // Operator state: settings and history; pointers only reported.
    if (settings) writeAtomic(l.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    const hist = join(tmp, 'state', 'history.jsonl');
    if (existsSync(hist)) {
      writeFileSync(l.historyFile, readFileSync(hist), { mode: 0o640 });
      writeFileSync(l.historyFile, `${JSON.stringify({ at: new Date().toISOString(), event: 'restored', from: state })}\n`, { flag: 'a' });
    }
    const restoredDir = join(l.state, 'restored');
    rmSync(restoredDir, { recursive: true, force: true });
    mkdirSync(restoredDir, { recursive: true });
    if (manifests) await run('tar', ['-C', restoredDir, '-xzf', join(from, manifests)]);
    for (const [role, id] of [['active', p.active], ['previous', p.previous]] as const) {
      if (!id) continue;
      const mf = join(restoredDir, id, 'manifest.json');
      const m = existsSync(mf) ? (JSON.parse(readFileSync(mf, 'utf8')) as Manifest) : null;
      const pbf = join(from, 'sources', `${id}.osm.pbf`);
      const have = existsSync(pbf) && m ? (await sha256File(pbf)) === m.source.sha256 : false;
      const ts = m?.source.snapshot_timestamp_source === 'operator' && m.source.snapshot_timestamp ? ` --snapshot-timestamp ${m.source.snapshot_timestamp}` : '';
      log(
        `[restore] backed-up ${role} release ${id}: source ${m?.source.filename ?? '?'} sha256 ${m?.source.sha256 ?? '?'}` +
          (have ? `; rebuild with: seyra-maps import --pbf ${pbf}${ts}` : `; rebuild it from the owner's original input with that sha256: seyra-maps import --pbf /path/to/input.osm.pbf${ts}`),
      );
    }
    log('[restore] then activate the rebuilt active release (seyra-maps activate DATASET_ID); identical inputs and images reproduce the same dataset id');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
