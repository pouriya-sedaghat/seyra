#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { activate, apiHealth, prune, readPointers, rollback, verifyRelease } from './activate.js';
import { bundleExport, bundleLoad, bundleVerify } from './bundle.js';
import { composeRuntime } from './compose.js';
import { importDataset } from './importer.js';
import { layout, managedChild } from './layout.js';
import { lockedImages, verifyImages } from './lock.js';
import { readManifest } from './manifest.js';
import { run } from './proc.js';
import { init, tlsImport, tlsInit } from './setup.js';

const USAGE = `seyra-maps — offline Map Services release tool (runs inside the seyra/ops image)

  init [--bind IP] [--port N] [--access loopback|lan] [--lan-cidrs a/b,c/d] [--server-names "h1 h2"]
  tls init --names localhost,127.0.0.1[,host.internal]   | tls import --cert FILE --key FILE
  verify-images                     check every locked image is loaded with its locked identity
  import --pbf /abs/path/iran.osm.pbf [--snapshot-timestamp ISO8601]
  activate DATASET_ID               maintenance cutover to a validated release
  rollback                          cut back to the previous release
  start | stop                      start/stop the complete runtime stack (all four providers)
  status                            pointers, releases and live provider readiness
  verify-release DATASET_ID         re-check staged artifacts and render DB marker
  prune                             keep active + previous releases only
  backup --out DIR                  control DB dump + state/manifests (not map stores)
  bundle export --out DIR [--include PATH ...] | bundle verify DIR | bundle load DIR
`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const log = (m: string) => console.log(m);

async function status(): Promise<void> {
  const l = layout();
  const p = readPointers(l);
  console.log(`active:   ${p.active ?? '(none)'}\nprevious: ${p.previous ?? '(none)'}`);
  console.log(`maintenance flag: ${existsSync(join(l.flags, 'maintenance')) ? 'PRESENT' : 'absent'}`);
  console.log('releases:');
  for (const name of existsSync(l.releases) ? readdirSync(l.releases).sort() : []) {
    if (!existsSync(join(l.releases, name, 'manifest.json'))) continue;
    try {
      const m = readManifest(managedChild(l.releases, name));
      console.log(`  ${name}  ${m.status}${m.failure ? ` (failed at ${m.failure.step}: ${m.failure.message})` : ''}  source=${m.source.filename} sha256=${m.source.sha256.slice(0, 12)}…`);
    } catch (err) {
      console.log(`  ${name}  unreadable manifest: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const h = await apiHealth(l);
  console.log(h ? `live readiness: ${JSON.stringify(h, null, 1)}` : 'live readiness: API not reachable');
}

async function backup(out: string): Promise<void> {
  const l = layout();
  if (!out.startsWith('/')) throw new Error('--out must be absolute');
  mkdirSync(out, { recursive: true, mode: 0o750 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = join(out, `seyra_app-${stamp}.sql`);
  // Control/application database only; map stores are rebuildable from source + pipeline.
  const r = await composeRuntime(l, ['exec', '-T', 'db', 'pg_dump', '-U', 'seyra_admin', '-d', 'seyra_app', '--no-owner'], { discardStdout: false });
  const ws = createWriteStream(dump, { mode: 0o600 });
  ws.end(r.stdout);
  await run('tar', ['-C', l.home, '-czf', join(out, `state-${stamp}.tar.gz`), 'state']);
  const manifests = readdirSync(l.releases).filter((n) => existsSync(join(l.releases, n, 'manifest.json')));
  await run('tar', ['-C', l.releases, '-czf', join(out, `manifests-${stamp}.tar.gz`), ...manifests.map((n) => `${n}/manifest.json`)], { allowFailure: manifests.length === 0 });
  log(`[backup] wrote ${dump} and state/manifest archives to ${out} (secrets and TLS keys are NOT included; back them up separately)`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'init':
      await init(
        {
          ...(arg(rest, '--bind') ? { bindAddr: arg(rest, '--bind')! } : {}),
          ...(arg(rest, '--port') ? { httpsPort: Number(arg(rest, '--port')) } : {}),
          ...(arg(rest, '--access') ? { accessMode: arg(rest, '--access') as 'loopback' | 'lan' } : {}),
          ...(arg(rest, '--lan-cidrs') !== undefined ? { lanCidrs: arg(rest, '--lan-cidrs')! } : {}),
          ...(arg(rest, '--server-names') ? { serverNames: arg(rest, '--server-names')! } : {}),
        },
        log,
      );
      return 0;
    case 'tls':
      if (rest[0] === 'init') await tlsInit((arg(rest, '--names') ?? 'localhost,127.0.0.1').split(','), log);
      else if (rest[0] === 'import') await tlsImport(arg(rest, '--cert')!, arg(rest, '--key')!, log);
      else throw new Error('tls init | tls import');
      return 0;
    case 'verify-images': {
      const res = await verifyImages(lockedImages(layout().install));
      for (const r of res) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.role.padEnd(15)} ${r.ref}  observed=${r.observed ?? 'missing'} expected=${r.expected ?? 'unknown'}`);
      return res.every((r) => r.ok) ? 0 : 1;
    }
    case 'import': {
      const pbf = arg(rest, '--pbf');
      if (!pbf) throw new Error('--pbf is required');
      const ts = arg(rest, '--snapshot-timestamp');
      const id = await importDataset({ pbf, ...(ts ? { snapshotTimestamp: ts } : {}), log });
      log(`[import] release ${id} built and validated in staging; activate with: seyra-maps activate ${id}`);
      return 0;
    }
    case 'activate':
      if (!rest[0]) throw new Error('dataset id required');
      await activate(rest[0], { log });
      return 0;
    case 'rollback':
      await rollback(log);
      return 0;
    case 'start': {
      // Image references are tags; refuse to start anything that no longer resolves to the lock.
      const l = layout();
      const bad = (await verifyImages(lockedImages(l.install))).filter((r) => !r.ok);
      if (bad.length) throw new Error(`refusing to start: ${bad.map((b) => `${b.role} is ${b.observed ?? 'missing'}, locked ${b.expected ?? 'unknown'}`).join('; ')}`);
      await composeRuntime(l, ['up', '-d']);
      return 0;
    }
    case 'stop':
      await composeRuntime(layout(), ['stop', '-t', '40']);
      return 0;
    case 'status':
      await status();
      return 0;
    case 'verify-release': {
      const { problems } = await verifyRelease(layout(), rest[0] ?? '');
      console.log(problems.length ? problems.join('\n') : 'release artifacts verified');
      return problems.length ? 1 : 0;
    }
    case 'prune':
      log(`[prune] removed: ${(await prune(log)).join(', ') || 'nothing'}`);
      return 0;
    case 'backup':
      await backup(arg(rest, '--out') ?? join(layout().backups, 'latest'));
      return 0;
    case 'bundle': {
      const sub = rest[0];
      if (sub === 'export') {
        const out = arg(rest, '--out');
        if (!out) throw new Error('--out required');
        const includes: string[] = [];
        rest.forEach((v, i) => rest[i - 1] === '--include' && includes.push(v));
        await bundleExport(layout().install, out, includes, log);
      } else if (sub === 'verify') {
        const { problems } = await bundleVerify(rest[1] ?? '.');
        console.log(problems.length ? `BUNDLE INVALID:\n${problems.join('\n')}` : 'bundle verified: all checksums match');
        return problems.length ? 1 : 0;
      } else if (sub === 'load') {
        await bundleLoad(rest[1] ?? '.', log);
      } else throw new Error('bundle export|verify|load');
      return 0;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      console.error(USAGE);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`seyra-maps: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
