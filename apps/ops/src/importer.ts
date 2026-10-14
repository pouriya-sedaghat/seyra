import { chownSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, statfsSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CATALOG_VERSION, SEARCH_NORMALIZATION_VERSION } from '@seyra/contracts';
import { STYLE_VERSION, buildStyle, buildTileJson } from '@seyra/map-assets';
import { composeJobs, jobsInvocation } from './compose.js';
import { psql, recordEvent, renderDbName } from './db.js';
import { PHOTON_EXTRA_TAGS, preprocessDump } from './geocoder-preprocess.js';
import { readPointers } from './activate.js';
import { acquireImportLock } from './import-lock.js';
import { writePhotonNodeConfig } from './photon-config.js';
import { layout, managedChild, readSettings, type Layout, type Settings } from './layout.js';
import { imageEnv, lockedImages, verifyImages, type LockedImage } from './lock.js';
import {
  MANIFEST_SCHEMA,
  PIPELINE_VERSION,
  dataComponents,
  deriveDatasetId,
  readManifest,
  duBytes,
  sha256File,
  sha256Text,
  treeDigest,
  writeManifest,
  type Manifest,
} from './manifest.js';
import { pipe, run } from './proc.js';
import { stageValidate } from './staging.js';

/** Container users of the Seyra images (fixed in the Dockerfiles). */
export const UID = { valhalla: 10001, osm: 10002, tegola: 10003, overpass: 10004, photon: 10005 } as const;

export interface ImportOptions {
  pbf: string;
  snapshotTimestamp?: string;
  log: (msg: string) => void;
}

const PIPELINE_FILES = [
  'infra/catalog/seyra-flex.lua',
  'infra/catalog/pre-import.sql',
  'infra/catalog/post-import.sql',
  'infra/catalog/catalog-report.sql',
  'infra/catalog/tegola.toml.tmpl',
  'infra/catalog/catalog.json',
  'infra/valhalla/valhalla.json',
  'infra/compose/jobs.yml',
];

export async function pipelineFingerprint(l: Layout): Promise<{ sha256: string; files: Record<string, string> }> {
  const files: Record<string, string> = {};
  for (const f of PIPELINE_FILES) files[f] = await sha256File(join(l.install, f));
  const material = JSON.stringify({ files, PIPELINE_VERSION, CATALOG_VERSION, SEARCH_NORMALIZATION_VERSION, STYLE_VERSION, PHOTON_EXTRA_TAGS });
  return { sha256: sha256Text(material), files };
}

export async function assetsDigest(images: LockedImage[]): Promise<string> {
  const proxy = images.find((i) => i.role === 'PROXY')!;
  const r = await run('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', proxy.ref, '/usr/share/seyra/assets/asset-manifest.json']);
  const m = JSON.parse(r.stdout) as { assets_sha256?: string };
  if (!m.assets_sha256) throw new Error('proxy image asset manifest has no digest');
  return m.assets_sha256;
}

function freeBytes(path: string): number {
  const s = statfsSync(path);
  return Number(s.bavail) * Number(s.bsize);
}

function chownTree(dir: string, uid: number, gid = uid): void {
  chownSync(dir, uid, gid);
}

interface SourceInfo {
  header?: { option?: Record<string, string>; boxes?: number[][] };
  data?: { bbox?: number[]; count?: Record<string, number> };
}

export async function sourceInfo(l: Layout, images: LockedImage[], pbf: string): Promise<SourceInfo> {
  const r = await composeJobs(l, { ...imageEnv(images), SEYRA_JOB_INPUT: pbf }, ['run', '--rm', '--no-deps', '-T', 'source-info']);
  const text = r.stdout;
  const start = text.indexOf('{');
  if (start < 0) throw new Error('osmium could not read the input file');
  return JSON.parse(text.slice(start)) as SourceInfo;
}

function centerAndZoom(bbox: [number, number, number, number] | null): { center: [number, number]; zoom: number } {
  if (!bbox) return { center: [53.5, 32.5], zoom: 5 };
  const [w, s, e, n] = bbox;
  const span = Math.max(e - w, n - s, 1e-6);
  const zoom = Math.max(1, Math.min(15, Math.floor(Math.log2(360 / span))));
  return { center: [(w + e) / 2, (s + n) / 2], zoom };
}

/** Tegola decodes bounds/center as float arrays; TOML integers (e.g. a 0 longitude) are rejected. */
export function tomlFloats(values: readonly number[]): string {
  return `[${values.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))).join(', ')}]`;
}

export async function importDataset(opts: ImportOptions): Promise<string> {
  const l = layout();
  const s: Settings = readSettings(l);
  const images = lockedImages(l.install);
  const imageCheck = await verifyImages(images);
  const bad = imageCheck.filter((c) => !c.ok);
  if (bad.length) throw new Error(`required images missing or not matching the lock (load the offline bundle): ${bad.map((b) => b.ref).join(', ')}`);

  const input = resolve(opts.pbf);
  const st = statSync(input);
  if (!st.isFile() || !input.endsWith('.osm.pbf')) throw new Error('input must be a local .osm.pbf file');
  if (input.startsWith(l.releases)) throw new Error('input must not be inside the managed releases directory');

  // Exclusive import lock (one build at a time); an abandoned lock is recovered.
  await acquireImportLock(l, opts.log);

  const steps: Manifest['measurements']['steps'] = [];
  let minFree = freeBytes(l.home);
  const freeBefore = minFree;
  let manifest: Manifest | null = null;
  let releaseDir = '';
  let current = 'preflight';
  const step = async <T>(name: string, fn: () => Promise<T>, outDir?: string): Promise<T> => {
    current = name;
    opts.log(`[import] ${name} …`);
    const t0 = Date.now();
    const out = await fn();
    minFree = Math.min(minFree, freeBytes(l.home));
    steps.push({ step: name, seconds: (Date.now() - t0) / 1000, bytes: outDir ? duBytes(outDir) : null });
    if (manifest) {
      manifest.measurements = { steps, free_bytes_before: freeBefore, free_bytes_min_observed: minFree };
      writeManifest(releaseDir, manifest);
    }
    return out;
  };

  try {
    const sourceSha = await step('source-checksum', () => sha256File(input));
    const info = await step('source-validate', () => sourceInfo(l, images, input));
    const counts = info.data?.count ?? {};
    if (!counts.nodes) throw new Error('input contains no nodes; refusing to build a release');
    const headerTs = info.header?.option?.osmosis_replication_timestamp ?? info.header?.option?.timestamp ?? null;
    const snapshot = opts.snapshotTimestamp ?? headerTs;
    const snapshotSource = opts.snapshotTimestamp ? 'operator' : headerTs ? 'pbf_header' : 'unknown';
    const bb = info.data?.bbox ?? info.header?.boxes?.[0] ?? null;
    const bbox = bb && bb.length === 4 ? ([bb[0], bb[1], bb[2], bb[3]] as [number, number, number, number]) : null;

    const pipeline = await pipelineFingerprint(l);
    const assets = await assetsDigest(images);
    const components = dataComponents(Object.fromEntries(imageCheck.map((c) => [c.role, c.observed!])));
    const datasetId = deriveDatasetId(snapshot, { source_sha256: sourceSha, pipeline_fingerprint: pipeline.sha256, components, assets_sha256: assets });
    releaseDir = managedChild(l.releases, datasetId);
    if (existsSync(releaseDir)) {
      // A failed build of the same inputs is replaced; anything else is never overwritten.
      const p = readPointers(l);
      const previous = existsSync(join(releaseDir, 'manifest.json')) ? readManifest(releaseDir) : null;
      if (previous?.status !== 'failed' || p.active === datasetId || p.previous === datasetId) {
        throw new Error(`release ${datasetId} already exists for these exact inputs (see seyra-maps status)`);
      }
      opts.log(`[import] replacing failed build of ${datasetId} (failed at ${previous.failure?.step ?? 'unknown'})`);
      await psql(l, 'postgres', `DROP DATABASE IF EXISTS ${renderDbName(datasetId)} WITH (FORCE);`);
      rmSync(releaseDir, { recursive: true, force: true });
    }

    const needed = Math.max(s.minFreeBytes, s.minFreeFactor * st.size);
    if (freeBefore < needed) {
      throw new Error(`insufficient free space: ${freeBefore} bytes available, ${needed} required by the configured check (minFreeFactor=${s.minFreeFactor}); measure and adjust, never delete unrelated data`);
    }

    mkdirSync(join(releaseDir, 'source'), { recursive: true });
    for (const d of ['logs', 'validation', 'maps/styles', 'geocoder', '.work']) mkdirSync(join(releaseDir, d), { recursive: true });
    chmodSync(join(releaseDir, '.work'), 0o700);
    const managedCopy = join(releaseDir, 'source', 'input.osm.pbf');
    const log = (n: string) => join(releaseDir, 'logs', `${n}.log`);
    const now = new Date().toISOString();
    manifest = {
      schema: MANIFEST_SCHEMA,
      dataset_id: datasetId,
      status: 'building',
      created_at: now,
      updated_at: now,
      source: {
        original_path: input,
        filename: basename(input),
        size_bytes: st.size,
        sha256: sourceSha,
        managed_copy: managedCopy,
        snapshot_timestamp: snapshot,
        snapshot_timestamp_source: snapshotSource,
        bbox,
        counts,
      },
      pipeline: {
        pipeline_version: PIPELINE_VERSION,
        fingerprint_sha256: pipeline.sha256,
        files: pipeline.files,
        catalog_version: CATALOG_VERSION,
        search_normalization_version: SEARCH_NORMALIZATION_VERSION,
        style_version: STYLE_VERSION,
      },
      components: Object.fromEntries(imageCheck.map((c) => [c.role, { ref: c.ref, image_id: c.observed! }])),
      assets: { assets_sha256: assets, source: 'proxy image /usr/share/seyra/assets/asset-manifest.json' },
      artifacts: {},
      identities: null,
      measurements: { steps, free_bytes_before: freeBefore, free_bytes_min_observed: minFree },
      validation: { status: 'pending', checks: [] },
      failure: null,
    };
    writeManifest(releaseDir, manifest);
    opts.log(`[import] dataset_id ${datasetId}`);

    // The owner's original is only read (checksum + copy); every job uses the managed copy.
    await step('source-copy', async () => {
      copyFileSync(input, managedCopy);
      chmodSync(managedCopy, 0o444);
      if ((await sha256File(managedCopy)) !== sourceSha) throw new Error('managed copy checksum mismatch');
    });
    const jobBase = { ...imageEnv(images), SEYRA_JOB_INPUT: managedCopy, SEYRA_BUILD_THREADS: String(s.buildThreads) };

    // ---- rendering database (new DB per release; frozen after import) --------------------
    const renderDb = renderDbName(datasetId);
    await step('render-import', async () => {
      await psql(l, 'postgres', `CREATE DATABASE ${renderDb} OWNER seyra_admin;`);
      await psql(l, renderDb, readFileSync(join(l.install, 'infra/catalog/pre-import.sql'), 'utf8'), { render_db: renderDb });
      const pgpass = join(releaseDir, '.work', 'pgpass');
      const pw = readFileSync(join(l.secrets, 'db_render_import_password'), 'utf8').trim();
      writeFileSync(pgpass, `db:5432:${renderDb}:seyra_render_import:${pw}\n`, { mode: 0o400 });
      chownSync(pgpass, UID.osm, UID.osm);
      try {
        await composeJobs(l, { ...jobBase, SEYRA_JOB_RENDER_DB: renderDb, SEYRA_JOB_PGPASS: pgpass }, ['run', '--rm', '--no-deps', '-T', 'render-import'], { logFile: log('render-import'), discardStdout: true });
      } finally {
        unlinkSync(pgpass);
      }
      await psql(l, renderDb, readFileSync(join(l.install, 'infra/catalog/post-import.sql'), 'utf8'), {
        render_db: renderDb,
        dataset_id: datasetId,
        source_sha256: sourceSha,
        catalog_version: CATALOG_VERSION,
        pipeline_version: PIPELINE_VERSION,
      });
      const report = await psql(l, renderDb, readFileSync(join(l.install, 'infra/catalog/catalog-report.sql'), 'utf8'));
      writeFileSync(join(releaseDir, 'validation', 'catalog-report.json'), `${JSON.stringify(JSON.parse(report.trim()), null, 2)}\n`);
      const { center, zoom } = centerAndZoom(bbox);
      const tegolaToml = readFileSync(join(l.install, 'infra/catalog/tegola.toml.tmpl'), 'utf8')
        .replaceAll('{{DATASET_ID}}', datasetId)
        .replaceAll('{{CATALOG_VERSION}}', CATALOG_VERSION)
        .replaceAll('{{DB_HOST}}', 'db')
        .replaceAll('{{RENDER_DB}}', renderDb)
        .replaceAll('{{MAP_NAME}}', `seyra_${datasetId.replace(/-/g, '_')}`)
        .replaceAll('{{BOUNDS}}', tomlFloats(bbox ?? [-180, -85, 180, 85]))
        .replaceAll('{{CENTER}}', tomlFloats([center[0], center[1], zoom]));
      mkdirSync(join(releaseDir, 'tegola'), { recursive: true });
      writeFileSync(join(releaseDir, 'tegola', 'tegola.toml'), tegolaToml, { mode: 0o444 });
      manifest!.artifacts.render = {
        database: renderDb,
        frozen: true,
        catalog_report: 'validation/catalog-report.json',
        tegola_config_sha256: sha256Text(tegolaToml),
      };
    });

    // ---- routing graph (explicit Valhalla build; no scripted entrypoint) -----------------
    const valhallaDir = join(releaseDir, 'valhalla');
    await step(
      'routing-build',
      async () => {
        mkdirSync(join(valhallaDir, 'tiles'), { recursive: true });
        copyFileSync(join(l.install, 'infra/valhalla/valhalla.json'), join(valhallaDir, 'valhalla.json'));
        chownTree(valhallaDir, UID.valhalla);
        chownTree(join(valhallaDir, 'tiles'), UID.valhalla);
        chownSync(join(valhallaDir, 'valhalla.json'), UID.valhalla, UID.valhalla);
        await composeJobs(l, { ...jobBase, SEYRA_JOB_OUT: valhallaDir }, ['run', '--rm', '--no-deps', '-T', 'valhalla-build'], { logFile: log('routing-build'), discardStdout: true });
        const tree = await treeDigest(valhallaDir);
        manifest!.artifacts.routing = { dir: 'valhalla', ...tree, timezone_db: 'not packaged (date_time rejected in phase 1)', speed_config: 'not packaged (built-in class defaults)' };
      },
      valhallaDir,
    );

    // ---- geocoder: temporary Nominatim DB -> normalized Photon index ---------------------
    const photonDir = join(releaseDir, 'photon');
    await step(
      'geocoder-build',
      async () => {
        const work = managedChild(l.work, datasetId);
        const workGeo = join(work, 'geocoder');
        const exportDir = join(releaseDir, 'geocoder', 'export');
        mkdirSync(workGeo, { recursive: true });
        mkdirSync(exportDir, { recursive: true });
        const pgUid = Number((await run('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'id', images.find((i) => i.role === 'GEOCODER_BUILD')!.ref, '-u', 'postgres'])).stdout.trim());
        chownSync(workGeo, pgUid, pgUid);
        chownSync(exportDir, pgUid, pgUid);
        await composeJobs(l, { ...jobBase, SEYRA_JOB_WORK: workGeo, SEYRA_JOB_OUT: exportDir }, ['run', '--rm', '--no-deps', '-T', 'geocoder-export'], { logFile: log('geocoder-export'), discardStdout: true });
        const raw = join(exportDir, 'nominatim-export.jsonl');
        const rawSha = await sha256File(raw);
        const importFile = join(releaseDir, 'geocoder', 'photon-import.jsonl');
        const synonyms = join(releaseDir, 'geocoder', 'synonyms.json');
        const stats = await preprocessDump(raw, importFile, synonyms, `seyra-release-${datasetId}`);
        mkdirSync(photonDir, { recursive: true });
        chownTree(photonDir, UID.photon);
        writePhotonNodeConfig(photonDir);
        await composeJobs(
          l,
          { ...jobBase, SEYRA_JOB_IMPORT: join(releaseDir, 'geocoder'), SEYRA_JOB_OUT: photonDir, SEYRA_PHOTON_EXTRA_TAGS: PHOTON_EXTRA_TAGS },
          ['run', '--rm', '--no-deps', '-T', 'photon-import'],
          { logFile: log('photon-import'), discardStdout: true },
        );
        copyFileSync(synonyms, join(photonDir, 'synonyms.json'));
        chownSync(join(photonDir, 'synonyms.json'), UID.photon, UID.photon);
        const nominatimVersion = readFileSync(join(exportDir, 'nominatim-version.txt'), 'utf8').trim();
        // Job-owned temporaries only: raw export and the (already emptied) workspace.
        rmSync(exportDir, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
        manifest!.artifacts.geocoder = {
          nominatim: nominatimVersion,
          export_sha256: rawSha,
          import_file: 'geocoder/photon-import.jsonl',
          import_sha256: await sha256File(importFile),
          synonyms_sha256: await sha256File(synonyms),
          preprocess: stats,
          photon_dir: 'photon',
          photon_extra_tags: PHOTON_EXTRA_TAGS,
          note: 'The Photon index directory receives OpenSearch working-state writes while served; the import JSON is the immutable rebuild input.',
        };
      },
      photonDir,
    );

    // ---- Overpass base database (local XML stream; no clone/replication/areas) -----------
    const overpassDir = join(releaseDir, 'overpass');
    await step(
      'overpass-build',
      async () => {
        mkdirSync(overpassDir, { recursive: true });
        chownTree(overpassDir, UID.overpass);
        const label = `seyra:${datasetId}`;
        const env = { ...jobBase, SEYRA_JOB_OUT: overpassDir, SEYRA_JOB_OVERPASS_LABEL: label };
        const job = (svc: string) => jobsInvocation(l, env, ['run', '--rm', '--no-deps', '-T', svc]);
        await pipe(job('overpass-xml'), job('overpass-import'), log('overpass-build'));
        const tree = await treeDigest(join(overpassDir, 'db'));
        manifest!.artifacts.overpass = { dir: 'overpass/db', version_label: label, ...tree, meta: false, attic: false, areas: false };
      },
      overpassDir,
    );

    // ---- map metadata: TileJSON + light/dark × fa/en styles ------------------------------
    await step('map-styles', async () => {
      const { center, zoom } = centerAndZoom(bbox);
      const maps = join(releaseDir, 'maps');
      writeFileSync(join(maps, 'tiles.json'), `${JSON.stringify(buildTileJson(datasetId, bbox ?? undefined, [center[0], center[1], zoom]), null, 1)}\n`);
      for (const theme of ['light', 'dark'] as const) {
        for (const lang of ['fa', 'en'] as const) {
          const style = buildStyle({ datasetId, theme, lang, ...(bbox ? { bounds: bbox } : {}), center, zoom });
          writeFileSync(join(maps, 'styles', `${theme}-${lang}.json`), `${JSON.stringify(style, null, 1)}\n`);
        }
      }
      manifest!.artifacts.maps = { dir: 'maps', ...(await treeDigest(maps)) };
    });

    // ---- staging validation with real providers on the internal build network -------------
    const validation = await step('staging-validation', () => stageValidate(l, images, releaseDir, datasetId, opts.log));
    manifest.validation = { status: validation.ok ? 'passed' : 'failed', checks: validation.checks };
    manifest.identities = validation.identities;
    writeFileSync(join(releaseDir, 'validation', 'staging.json'), `${JSON.stringify(validation, null, 2)}\n`);
    if (!validation.ok || !validation.identities) throw new Error(`staging validation failed: ${validation.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`);

    manifest.status = 'validated';
    manifest.measurements = { steps, free_bytes_before: freeBefore, free_bytes_min_observed: minFree };
    writeManifest(releaseDir, manifest);
    rmSync(join(releaseDir, '.work'), { recursive: true, force: true });
    await recordEvent(l, datasetId, 'imported', { steps: steps.map((x) => [x.step, x.seconds]) }).catch(() => undefined);
    return datasetId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (manifest && releaseDir) {
      manifest.status = 'failed';
      manifest.failure = { step: current, message };
      manifest.measurements = { steps, free_bytes_before: freeBefore, free_bytes_min_observed: minFree };
      try {
        writeManifest(releaseDir, manifest);
      } catch {
        /* keep original error */
      }
      await recordEvent(l, manifest.dataset_id, 'import_failed', { step: current, message }).catch(() => undefined);
    }
    throw new Error(`import failed at ${current}: ${message}`);
  } finally {
    rmSync(l.importLock, { force: true });
  }
}
