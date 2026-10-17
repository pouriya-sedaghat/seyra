import { AsyncLocalStorage } from 'node:async_hooks';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { Layout } from './layout.js';
import { run } from './proc.js';

/**
 * Lifecycle exclusion (review R3).
 *
 * - `state/lifecycle.lock` — one global lock for every short mutating command (activate, rollback,
 *   recover, prune, start, stop, init and the set-up phase of an import). Conflicting commands fail
 *   fast with the owner's description; nested calls in the same process are re-entrant.
 * - `state/import.lock` — the long-running import lease (see import-lock.ts). It names its target
 *   dataset once known; prune never touches that target or any `building` release while it lives.
 *
 * Owner liveness is decided conservatively: a lock is only treated as abandoned when its owner is
 * positively gone (process absent on this host, or its ops container no longer exists/runs).
 */
export interface LockOwner {
  pid: number;
  /** Host name of the owner; inside the wrapper-started ops container this is the container id. */
  host: string;
  op: string;
  target: string | null;
  started_at: string;
  /** Random token so a process only ever removes its own lock. */
  token: string;
}

export class LifecycleBusyError extends Error {
  constructor(readonly owner: LockOwner) {
    super(`another lifecycle operation is running: ${owner.op}${owner.target ? ` ${owner.target}` : ''} (started ${owner.started_at}); retry when it has finished`);
  }
}

export function readOwner(path: string): LockOwner | null {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockOwner>;
    return typeof o.pid === 'number' && typeof o.host === 'string' && typeof o.started_at === 'string' && typeof o.op === 'string' && typeof o.token === 'string'
      ? ({ target: null, ...o } as LockOwner)
      : null;
  } catch {
    return null;
  }
}

/** true = alive, false = positively gone. Throws when liveness cannot be determined. */
export async function ownerAlive(o: LockOwner): Promise<boolean> {
  if (o.host === hostname()) {
    try {
      process.kill(o.pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
  // Another (wrapper-started) ops container: alive while that container is running.
  const r = await run('docker', ['inspect', '-f', '{{.State.Running}}', o.host], { allowFailure: true });
  if (r.code === 0) return r.stdout.trim() === 'true';
  if (/no such (object|container)/i.test(r.stderr)) return false;
  throw new Error(`cannot determine whether lock owner ${o.host} is alive (${r.stderr.trim().split('\n').pop() ?? 'docker inspect failed'}); not touching its lock`);
}

export function newOwner(op: string, target: string | null): LockOwner {
  return { pid: process.pid, host: hostname(), op, target, started_at: new Date().toISOString(), token: `${process.pid}-${Math.random().toString(36).slice(2)}` };
}

/** Create a lock file exclusively; false when it already exists. */
export function tryCreate(path: string, owner: LockOwner): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  writeFileSync(fd, `${JSON.stringify(owner)}\n`);
  closeSync(fd);
  return true;
}

/** Remove a lock only if it still carries our token. */
export function releaseOwned(path: string, owner: LockOwner): void {
  if (readOwner(path)?.token === owner.token) rmSync(path, { force: true });
}

// Re-entrancy is scoped to the async call chain that holds the lock (e.g. rollback -> activate),
// so a concurrent call in the same process still sees the lock as busy.
const holder = new AsyncLocalStorage<LockOwner>();

export function lifecycleLockHeld(): LockOwner | null {
  return holder.getStore() ?? null;
}

/**
 * Run `fn` holding the global lifecycle lock. A lock left by an owner that is positively gone is
 * removed (stale) — except that an unfinished activation transition must be handled by `recover`.
 * `waitMs` > 0 polls for a live owner to finish instead of failing immediately.
 */
export async function withLifecycleLock<T>(l: Layout, op: string, target: string | null, fn: () => Promise<T>, opts: { waitMs?: number; pollMs?: number } = {}): Promise<T> {
  if (holder.getStore()) return fn();
  const owner = newOwner(op, target);
  const deadline = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    if (tryCreate(l.lifecycleLock, owner)) break;
    const current = readOwner(l.lifecycleLock);
    if (!current) throw new Error(`lifecycle lock ${l.lifecycleLock} is unreadable; remove it only if no seyra-maps command is running`);
    if (await ownerAlive(current)) {
      if (Date.now() >= deadline) throw new LifecycleBusyError(current);
      await new Promise((res) => setTimeout(res, opts.pollMs ?? 2000));
      continue;
    }
    if (existsSync(l.transitionFile) && op !== 'recover') {
      throw new Error(`the ${current.op} started ${current.started_at} ended without finishing; run: seyra-maps recover`);
    }
    // Positively abandoned: remove only that exact stale record, then retry.
    if (readOwner(l.lifecycleLock)?.token === current.token) rmSync(l.lifecycleLock, { force: true });
  }
  try {
    return await holder.run(owner, fn);
  } finally {
    releaseOwned(l.lifecycleLock, owner);
  }
}
