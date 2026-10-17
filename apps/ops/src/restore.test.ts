// Fresh-host restore (corrective prompt, RUNBOOK §7). The real restore code runs against a real
// temporary SEYRA_HOME and a real backup directory made by `tar`; only the Docker/SQL boundary is
// recorded. The isolated end-to-end drill on real images is tests/lifecycle/restore-drill.sh.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('./compose.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./compose.js')>()),
  composeRuntime: vi.fn(async (_l: unknown, args: string[]) => {
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
    calls.push(`psql ${db} ${sql.split('\n')[0]}`);
    return sql.includes('count(*)') ? '3' : '';
  }),
}));

const { restore } = await import('./backup.js');
const { DEFAULT_SETTINGS, ensureDirs, layout } = await import('./layout.js');
const { REQUIRED_SECRETS } = await import('./backup.js');

let home = '';
let src = '';
let l: ReturnType<typeof layout>;
const logs: string[] = [];
const log = (m: string) => logs.push(m);

/** A backup directory as `backup` writes it, from a host whose active/previous were A/B. */
function makeBackup(settings: object): void {
  const s = join(src, 'state');
  mkdirSync(join(s, 'state'), { recursive: true });
  writeFileSync(join(s, 'state', 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(s, 'state', 'history.jsonl'), '{"event":"activated","dataset_id":"ds-a"}\n');
  writeFileSync(join(s, 'state', 'pointers.json'), JSON.stringify({ active: 'ds-a', previous: 'ds-b' }));
  execFileSync('tar', ['-C', s, '-czf', join(src, 'state-2026-10-17T00-00-00-000Z.tar.gz'), 'state']);
  for (const [id, ts] of [['ds-a', '2026-10-01T00:00:00Z'], ['ds-b', null]] as const) {
    mkdirSync(join(s, 'rel', id), { recursive: true });
    writeFileSync(
      join(s, 'rel', id, 'manifest.json'),
      JSON.stringify({ dataset_id: id, source: { filename: `${id}.osm.pbf`, sha256: 'f'.repeat(64), snapshot_timestamp: ts, snapshot_timestamp_source: ts ? 'operator' : 'unknown' } }),
    );
  }
  execFileSync('tar', ['-C', join(s, 'rel'), '-czf', join(src, 'manifests-2026-10-17T00-00-00-000Z.tar.gz'), 'ds-a/manifest.json', 'ds-b/manifest.json']);
  writeFileSync(join(src, 'seyra_app-2026-10-17T00-00-00-000Z.sql'), 'CREATE SCHEMA seyra_control;\n');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'seyra-restore-home-'));
  src = mkdtempSync(join(tmpdir(), 'seyra-restore-src-'));
  process.env.SEYRA_HOME = home;
  l = layout();
  ensureDirs(l);
  writeFileSync(l.settingsFile, `${JSON.stringify(DEFAULT_SETTINGS)}\n`);
  for (const s of REQUIRED_SECRETS) writeFileSync(join(l.secrets, s), 'restored-secret\n');
  calls.length = 0;
  logs.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
});

describe('restore --from (fresh host)', () => {
  it('replaces the initialised control DB with the dump, re-applies grants, restores settings/history and prints re-import commands', async () => {
    makeBackup({ ...DEFAULT_SETTINGS, valhallaThreads: 3 });
    await restore(src, log);
    const db = calls.filter((c) => c.startsWith('psql') || c === 'initDatabase');
    expect(db).toEqual([
      'psql postgres DROP DATABASE IF EXISTS seyra_app WITH (FORCE);',
      'psql postgres CREATE DATABASE seyra_app OWNER seyra_admin;',
      'psql seyra_app CREATE SCHEMA seyra_control;',
      'initDatabase',
      'psql seyra_app SELECT count(*) FROM seyra_control.release_events;',
    ]);
    expect(calls).toContain('compose stop api');
    expect(JSON.parse(readFileSync(l.settingsFile, 'utf8')).valhallaThreads).toBe(3);
    expect(readFileSync(l.historyFile, 'utf8')).toMatch(/"activated"[\s\S]*"restored"/);
    // Pointers are not restored: the map stores do not exist yet.
    expect(existsSync(l.pointersFile)).toBe(false);
    const out = logs.join('\n');
    expect(out).toContain('backed-up active release ds-a');
    expect(out).toContain('--snapshot-timestamp 2026-10-01T00:00:00Z');
    expect(out).toContain('backed-up previous release ds-b');
    expect(out).toMatch(/ds-b[^\n]*original input/);
  });

  it('refuses before touching the database when a secret was not restored', async () => {
    makeBackup(DEFAULT_SETTINGS);
    rmSync(join(l.secrets, 'db_api_password'));
    await expect(restore(src, log)).rejects.toThrow(/secret db_api_password is missing/);
    expect(calls).toEqual([]);
  });

  it('refuses on a host that already serves a release', async () => {
    makeBackup(DEFAULT_SETTINGS);
    writeFileSync(l.pointersFile, JSON.stringify({ active: 'ds-x', previous: null }));
    await expect(restore(src, log)).rejects.toThrow(/fresh installation/);
    expect(calls).toEqual([]);
  });

  it('rejects backed-up settings that violate the access rules before changing anything', async () => {
    makeBackup({ ...DEFAULT_SETTINGS, bindAddr: '0.0.0.0', accessMode: 'loopback' });
    const before = readFileSync(l.settingsFile, 'utf8');
    await expect(restore(src, log)).rejects.toThrow(/loopback/);
    expect(readFileSync(l.settingsFile, 'utf8')).toBe(before);
    expect(calls).toEqual([]); // validated before the control database is replaced
  });
});
