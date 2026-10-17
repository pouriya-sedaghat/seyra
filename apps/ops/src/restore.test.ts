// Fresh-host backup/restore (review R5). The real backup() and restore() run against real temporary
// SEYRA_HOMEs (a source host and a fresh destination host) with real tar archives and copied
// sources; only the Docker/SQL boundary is recorded. Backup files are located by role whatever the
// directory layout, so these cases also run against the reviewed flat layout, where the reviewed
// ones fail. The end-to-end drill on real images is tests/offline/restore-drill.sh.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let replayed = '';
let dumpGeneration = 0;
let failStateArchive = false;

const dumpText = (n: number) => `--\n-- PostgreSQL database dump\n--\n-- seyra test generation ${n}\nCREATE SCHEMA seyra_control;\n--\n-- PostgreSQL database dump complete\n--\n`;

vi.mock('./compose.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./compose.js')>()),
  composeRuntime: vi.fn(async (_l: unknown, args: string[]) => {
    if (args.includes('pg_dump')) return { code: 0, stdout: dumpText(dumpGeneration), stderr: '' }; // backup side
    calls.push(`compose ${args.join(' ')}`);
    return { code: 0, stdout: '', stderr: '' };
  }),
}));
vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db.js')>()),
  waitForDb: vi.fn(async () => undefined),
  initDatabase: vi.fn(async () => {
    calls.push('initDatabase');
    return [];
  }),
  psql: vi.fn(async (_l: unknown, db: string, sql: string) => {
    calls.push(`psql ${db} ${sql.split('\n').find((x) => x && !x.startsWith('--')) ?? ''}`);
    if (db === 'seyra_app' && sql.includes('PostgreSQL database dump')) replayed = sql;
    return sql.includes('count(*)') ? '3' : '';
  }),
}));
// Real processes, except that a backup can be interrupted right after its SQL dump.
vi.mock('./proc.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./proc.js')>();
  return {
    ...orig,
    run: vi.fn(async (cmd: string, args: string[], opts?: Parameters<typeof orig.run>[2]) => {
      if (failStateArchive && cmd === 'tar' && args.includes('state') && args.some((a) => a.startsWith('-c'))) throw new Error('injected: backup interrupted after its SQL dump');
      return orig.run(cmd, args, opts);
    }),
  };
});

const { backup, restore, REQUIRED_SECRETS } = await import('./backup.js');
const { DEFAULT_SETTINGS, ensureDirs, layout } = await import('./layout.js');
const { DATA_COMPONENT_ROLES, MANIFEST_SCHEMA, sha256File, writeManifest } = await import('./manifest.js');

let root = '';
let srcHome = '';
let dstHome = '';
let out = '';
const logs: string[] = [];
const log = (m: string) => logs.push(m);

function useHome(h: string) {
  process.env.SEYRA_HOME = h;
  return layout();
}

async function makeRelease(l: ReturnType<typeof layout>, id: string, ts: string | null): Promise<void> {
  const dir = join(l.releases, id);
  mkdirSync(join(dir, 'source'), { recursive: true });
  const pbf = join(dir, 'source', 'input.osm.pbf');
  writeFileSync(pbf, `pbf of ${id}`);
  const now = new Date().toISOString();
  writeManifest(dir, {
    schema: MANIFEST_SCHEMA,
    dataset_id: id,
    status: 'validated',
    created_at: now,
    updated_at: now,
    source: { original_path: pbf, filename: `${id}.osm.pbf`, size_bytes: 9, sha256: await sha256File(pbf), managed_copy: pbf, snapshot_timestamp: ts, snapshot_timestamp_source: ts ? 'operator' : 'unknown', bbox: null, counts: {} },
    pipeline: { pipeline_version: 'test', fingerprint_sha256: 'x', files: {}, catalog_version: 'x', search_normalization_version: 'x', style_version: 'x' },
    components: Object.fromEntries(DATA_COMPONENT_ROLES.map((r) => [r, { ref: `seyra/${r.toLowerCase()}:test`, image_id: `sha256:${r.toLowerCase()}` }])),
    assets: { assets_sha256: 'x', source: 'test' },
    artifacts: { routing: { sha256: 'x' }, overpass: { sha256: 'x' }, maps: { sha256: 'x' }, geocoder: { import_sha256: 'x' }, render: { tegola_config_sha256: 'x' } },
    identities: { tiles: 't', routing: 'r', geocoder: 'g', overpass: 'o' },
    measurements: { steps: [], free_bytes_before: null, free_bytes_min_observed: null },
    validation: { status: 'passed', checks: [] },
    failure: null,
  });
}

/** Source host serving A (previous B) with the given settings; returns after a backup attempt. */
async function backupFrom(settings: object, opts: { includeSources?: boolean; generation: number; interruptAfterSql?: boolean }) {
  const l = useHome(srcHome);
  writeFileSync(l.settingsFile, `${JSON.stringify({ ...DEFAULT_SETTINGS, ...settings })}\n`);
  writeFileSync(l.historyFile, `{"event":"activated","dataset_id":"ds-a","generation":${opts.generation}}\n`);
  dumpGeneration = opts.generation;
  failStateArchive = !!opts.interruptAfterSql;
  try {
    return await backup(out, { includeSources: opts.includeSources ?? false, log: () => undefined });
  } finally {
    failStateArchive = false;
    await new Promise((r) => setTimeout(r, 5)); // distinct generation timestamps
  }
}

/** Every backup file of a role, found anywhere under the backup directory (layout-agnostic). */
function files(re: RegExp): string[] {
  const all: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(join(d, e.name)) : all.push(join(d, e.name)));
  };
  walk(out);
  return all.filter((f) => re.test(relative(out, f))).sort();
}
const ROLE = { sql: /seyra_app[^/]*\.sql$/, state: /state[^/]*\.tar\.gz$/, manifests: /manifests[^/]*\.tar\.gz$/, source: /sources\/ds-a\.osm\.pbf$/ };
const flip = (f: string) => {
  const b = readFileSync(f);
  b[Math.floor(b.length / 2)] ^= 0xff;
  writeFileSync(f, b);
};

const dstSettings = () => JSON.parse(readFileSync(layout().settingsFile, 'utf8')) as { valhallaThreads: number };

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'seyra-restore-'));
  srcHome = join(root, 'src');
  dstHome = join(root, 'dst');
  out = join(root, 'backups');
  let l = useHome(srcHome);
  ensureDirs(l);
  writeFileSync(l.pointersFile, JSON.stringify({ active: 'ds-a', previous: 'ds-b' }));
  await makeRelease(l, 'ds-a', '2026-10-01T00:00:00Z');
  await makeRelease(l, 'ds-b', null);
  // The fresh destination host: secrets restored and `init` run (default settings).
  l = useHome(dstHome);
  ensureDirs(l);
  writeFileSync(l.settingsFile, `${JSON.stringify(DEFAULT_SETTINGS)}\n`);
  for (const s of REQUIRED_SECRETS) writeFileSync(join(l.secrets, s), 'restored-secret\n');
  calls.length = 0;
  logs.length = 0;
  replayed = '';
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.SEYRA_HOME;
});

describe('backup and restore of one complete generation (review R5)', () => {
  it('restores a complete backup: control DB replaced, settings/history restored, verified sources and re-import commands', async () => {
    await backupFrom({ valhallaThreads: 3 }, { includeSources: true, generation: 1 });
    useHome(dstHome);
    await restore(out, log);
    expect(calls.filter((c) => c.startsWith('psql') || c === 'initDatabase')).toEqual([
      'psql postgres DROP DATABASE IF EXISTS seyra_app WITH (FORCE);',
      'psql postgres CREATE DATABASE seyra_app OWNER seyra_admin;',
      'psql seyra_app CREATE SCHEMA seyra_control;',
      'initDatabase',
      'psql seyra_app SELECT count(*) FROM seyra_control.release_events;',
    ]);
    expect(replayed).toContain('generation 1');
    expect(dstSettings().valhallaThreads).toBe(3);
    expect(readFileSync(layout().historyFile, 'utf8')).toMatch(/"generation":1[\s\S]*"restored"/);
    expect(existsSync(layout().pointersFile)).toBe(false); // map stores do not exist yet
    const text = logs.join('\n');
    expect(text).toMatch(/selected backup generation seyra-backup-\S+ \(the only complete generation/);
    expect(text).toMatch(/backed-up active release ds-a[^\n]*rebuild with: seyra-maps import --pbf \S+\/sources\/ds-a\.osm\.pbf --snapshot-timestamp 2026-10-01T00:00:00Z/);
    expect(text).toMatch(/backed-up previous release ds-b[^\n]*rebuild with: seyra-maps import --pbf \S+\/sources\/ds-b\.osm\.pbf/);
  });

  it('an interrupted second backup is never mixed with the complete one (reviewed case)', async () => {
    await backupFrom({ valhallaThreads: 3 }, { generation: 1 });
    await expect(backupFrom({ valhallaThreads: 4 }, { generation: 2, interruptAfterSql: true })).rejects.toThrow(/interrupted/);
    expect(files(ROLE.sql).length).toBeGreaterThanOrEqual(1);
    // A backup killed outright cannot clean up: it leaves its newer SQL dump behind as well.
    mkdirSync(join(out, '.seyra-backup-29991231T000000000Z-ffffff.partial'), { recursive: true });
    writeFileSync(join(out, '.seyra-backup-29991231T000000000Z-ffffff.partial', 'seyra_app.sql'), dumpText(2));
    useHome(dstHome);
    await restore(out, log);
    expect(replayed).toContain('generation 1'); // the reviewed version replayed generation 2's SQL
    expect(replayed).not.toContain('generation 2');
    expect(dstSettings().valhallaThreads).toBe(3);
    expect(logs.join('\n')).toMatch(/ignoring incomplete backup attempt/);
  });

  it('the reviewed flat layout (an older set plus a newer lone SQL file) is refused before any database change', async () => {
    const s = join(root, 'legacy-state');
    mkdirSync(join(s, 'state'), { recursive: true });
    writeFileSync(join(s, 'state', 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, serverNames: 'older.internal' }));
    writeFileSync(join(s, 'state', 'pointers.json'), JSON.stringify({ active: null, previous: null }));
    mkdirSync(out, { recursive: true });
    execFileSync('tar', ['-C', s, '-czf', join(out, 'state-2026-10-16.tar.gz'), 'state']);
    execFileSync('tar', ['-C', s, '-czf', join(out, 'manifests-2026-10-16.tar.gz'), 'state']);
    writeFileSync(join(out, 'seyra_app-2026-10-16.sql'), dumpText(1));
    writeFileSync(join(out, 'seyra_app-2026-10-17.sql'), dumpText(2));
    useHome(dstHome);
    const before = readFileSync(layout().settingsFile, 'utf8');
    await expect(restore(out, log)).rejects.toThrow(/older backup layout|no complete backup generation/);
    expect(calls).toEqual([]);
    expect(readFileSync(layout().settingsFile, 'utf8')).toBe(before);
  });

  it.each([
    ['SQL dump missing', () => rmSync(files(ROLE.sql)[0]!), /seyra_app\.sql is missing/],
    ['SQL dump corrupted', () => flip(files(ROLE.sql)[0]!), /seyra_app\.sql does not match its recorded SHA-256/],
    ['SQL dump truncated', () => truncateSync(files(ROLE.sql)[0]!, Math.floor(statSync(files(ROLE.sql)[0]!).size / 2)), /seyra_app\.sql has \d+ bytes, expected \d+/],
    ['state archive missing', () => rmSync(files(ROLE.state)[0]!), /state\.tar\.gz is missing/],
    ['state archive corrupted', () => flip(files(ROLE.state)[0]!), /state\.tar\.gz does not match its recorded SHA-256/],
    ['manifest archive missing', () => rmSync(files(ROLE.manifests)[0]!), /manifests\.tar\.gz is missing/],
    ['manifest archive corrupted', () => flip(files(ROLE.manifests)[0]!), /manifests\.tar\.gz does not match its recorded SHA-256/],
    ['included source missing', () => rmSync(files(ROLE.source)[0]!), /sources\/ds-a\.osm\.pbf is missing/],
    ['included source corrupted', () => flip(files(ROLE.source)[0]!), /sources\/ds-a\.osm\.pbf does not match its recorded SHA-256/],
    ['completion record missing', () => rmSync(files(/backup-manifest\.json$/)[0]!), /no complete backup generation|backup-manifest\.json is missing/],
    ['unlisted file added', () => writeFileSync(join(files(ROLE.sql)[0]!, '..', 'extra.sql'), 'x'), /unlisted files present: extra\.sql/],
  ])('%s: refused before DROP/CREATE/replay, nothing changed', async (_name, damage, reason) => {
    await backupFrom({ valhallaThreads: 3 }, { includeSources: true, generation: 1 });
    damage();
    useHome(dstHome);
    const before = readFileSync(layout().settingsFile, 'utf8');
    await expect(restore(out, log)).rejects.toThrow(reason);
    expect(calls).toEqual([]);
    expect(replayed).toBe('');
    expect(readFileSync(layout().settingsFile, 'utf8')).toBe(before);
  });

  it('several complete generations: the newest is selected and named; --generation selects another', async () => {
    for (const [n, threads] of [[1, 3], [2, 4], [3, 5]] as const) await backupFrom({ valhallaThreads: threads }, { generation: n });
    const generations = readdirSync(out).filter((d) => d.startsWith('seyra-backup-')).sort();
    expect(generations).toHaveLength(3);
    useHome(dstHome);
    await restore(out, log);
    expect(replayed).toContain('generation 3');
    expect(dstSettings().valhallaThreads).toBe(5);
    expect(logs.join('\n')).toContain(`selected backup generation ${generations[2]} (newest of 3 complete generations`);
    // An explicit, older generation on another fresh host.
    dstHome = join(root, 'dst2');
    const l = useHome(dstHome);
    ensureDirs(l);
    for (const s of REQUIRED_SECRETS) writeFileSync(join(l.secrets, s), 'restored-secret\n');
    logs.length = 0;
    await restore(out, log, { generation: generations[0]! });
    expect(replayed).toContain('generation 1');
    expect(dstSettings().valhallaThreads).toBe(3);
    expect(logs.join('\n')).toContain(`selected backup generation ${generations[0]} (requested`);
  });

  it('refuses before touching the database when a secret was not restored', async () => {
    await backupFrom({}, { generation: 1 });
    useHome(dstHome);
    rmSync(join(layout().secrets, 'db_api_password'));
    await expect(restore(out, log)).rejects.toThrow(/secret db_api_password is missing/);
    expect(calls).toEqual([]);
  });

  it('refuses on a host that already serves a release', async () => {
    await backupFrom({}, { generation: 1 });
    useHome(dstHome);
    writeFileSync(layout().pointersFile, JSON.stringify({ active: 'ds-x', previous: null }));
    await expect(restore(out, log)).rejects.toThrow(/fresh installation/);
    expect(calls).toEqual([]);
  });

  it('rejects backed-up settings that violate the access rules before changing anything', async () => {
    await backupFrom({ bindAddr: '0.0.0.0', accessMode: 'loopback' }, { generation: 1 });
    useHome(dstHome);
    const before = readFileSync(layout().settingsFile, 'utf8');
    await expect(restore(out, log)).rejects.toThrow(/loopback/);
    expect(readFileSync(layout().settingsFile, 'utf8')).toBe(before);
    expect(calls).toEqual([]);
  });
});
