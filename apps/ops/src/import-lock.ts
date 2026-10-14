import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { JOBS_PROJECT } from './compose.js';
import { recordEvent } from './db.js';
import { managedChild, type Layout } from './layout.js';
import { readManifest, writeManifest } from './manifest.js';
import { run } from './proc.js';

interface LockOwner {
  pid: number;
  /** Host name of the process; inside the ops container this is the container id. */
  host: string;
  started_at: string;
}

function readOwner(path: string): LockOwner | null {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockOwner>;
    return typeof o.pid === 'number' && typeof o.host === 'string' && typeof o.started_at === 'string' ? (o as LockOwner) : null;
  } catch {
    return null;
  }
}

async function ownerAlive(o: LockOwner): Promise<boolean> {
  if (o.host === hostname()) {
    try {
      process.kill(o.pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
  // Another (wrapper-started) ops container: alive only while that container is running.
  const r = await run('docker', ['inspect', '-f', '{{.State.Running}}', o.host], { allowFailure: true });
  return r.code === 0 && r.stdout.trim() === 'true';
}

/**
 * Clean up after an import whose process ended without finishing (killed, host restart):
 * stop its still-running build/staging job containers and mark its release failed. The active
 * release is never touched; the failed release is removed later by `prune`.
 */
async function recoverInterrupted(l: Layout, log: (m: string) => void): Promise<void> {
  const jobs = await run('docker', ['ps', '-q', '--filter', `label=com.docker.compose.project=${JOBS_PROJECT}`]);
  const ids = jobs.stdout.split('\n').filter(Boolean);
  if (ids.length) {
    log(`[import] stopping ${ids.length} orphaned job container(s) of the interrupted import`);
    await run('docker', ['stop', '-t', '10', ...ids], { allowFailure: true });
  }
  if (!existsSync(l.releases)) return;
  for (const name of readdirSync(l.releases)) {
    const dir = join(l.releases, name);
    if (!existsSync(join(dir, 'manifest.json'))) continue;
    const m = readManifest(managedChild(l.releases, name));
    if (m.status !== 'building') continue;
    m.status = 'failed';
    m.failure = { step: 'interrupted', message: 'the import process ended before the release was complete' };
    writeManifest(dir, m);
    await recordEvent(l, m.dataset_id, 'import_failed', { step: 'interrupted' }).catch(() => undefined);
    log(`[import] marked interrupted release ${name} as failed (remove it with: seyra-maps prune)`);
  }
}

/** Exclusive import lock; a lock left behind by a process that no longer exists is recovered. */
export async function acquireImportLock(l: Layout, log: (m: string) => void): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(l.importLock, 'wx', 0o600);
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, host: hostname(), started_at: new Date().toISOString() } satisfies LockOwner)}\n`);
      closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const owner = readOwner(l.importLock);
    if (!owner) throw new Error(`import lock ${l.importLock} is unreadable; remove it only if no import process exists`);
    if (await ownerAlive(owner)) throw new Error(`another import is running (started ${owner.started_at})`);
    log(`[import] the import started ${owner.started_at} is no longer running; recovering`);
    await recoverInterrupted(l, log);
    rmSync(l.importLock, { force: true });
  }
  throw new Error('could not acquire the import lock');
}
