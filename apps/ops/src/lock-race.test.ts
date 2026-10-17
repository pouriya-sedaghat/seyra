// Review R3 follow-up: mutual exclusion of the lifecycle lock between real OS processes, including
// two commands that both find the lock left by a crashed owner. Each worker runs the real lock
// module (test/lock-worker.mjs); interleavings are made deterministic by pausing one process at a
// chosen point, as the reviewer's reproducer does. Nothing in the lock is mocked.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const workerScript = fileURLToPath(new URL('../test/lock-worker.mjs', import.meta.url));
let dir = '';
let lockPath = '';
const workers: Worker[] = [];

interface Worker {
  role: string;
  proc: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
}

function start(role: string, op: string, pause: 'none' | 'before-unlink' | 'after-stale-read' = 'none', waitMs = 0): Worker {
  const proc = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', workerScript, dir, role, op, pause, String(waitMs)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const w: Worker = { role, proc, lines: [], exited: new Promise((res) => proc.once('exit', (code) => res(code))) };
  let buf = '';
  proc.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    const parts = buf.split('\n');
    buf = parts.pop()!;
    w.lines.push(...parts);
  });
  let err = '';
  proc.stderr!.on('data', (d: Buffer) => (err += d.toString()));
  proc.once('exit', () => err && w.lines.push(`STDERR ${err.trim()}`));
  workers.push(w);
  return w;
}

/** Wait for the worker's next state line (PAUSED / HOLDING / BUSY / ERROR). */
async function next(w: Worker, from = 0): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const line = w.lines.slice(from).find((x) => /^(PAUSED|HOLDING|BUSY|ERROR)/.test(x));
    if (line) return line;
    if (Date.now() > deadline || (w.proc.exitCode !== null && !w.lines.slice(from).some((x) => /^(PAUSED|HOLDING|BUSY|ERROR)/.test(x)))) {
      throw new Error(`worker ${w.role} gave no state: ${w.lines.join(' | ')}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const resume = (w: Worker) => w.proc.stdin!.write('g');
async function finish(w: Worker): Promise<number | null> {
  if (w.proc.exitCode === null) w.proc.stdin!.end('\n');
  return w.exited;
}

/** Owner record currently in the lock file (diagnostics), or null. */
function record(): { token: string; op: string } | null {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8')) as { token: string; op: string };
  } catch {
    return null;
  }
}

/** The invariant: at most one process inside, and the lock names the one inside. */
function expectExclusive(): void {
  const inside = readdirSync(dir).filter((f) => f.startsWith('inside-'));
  expect(inside.length, `processes inside the critical section at once: ${inside.join(', ')}`).toBeLessThanOrEqual(1);
  if (inside.length === 1) expect(record()?.token, 'a live holder must keep its ownership').toBe(readFileSync(join(dir, inside[0]!), 'utf8'));
}

function writeCrashedOwner(op = 'activate'): void {
  writeFileSync(lockPath, `${JSON.stringify({ pid: 2147483647, host: hostname(), op, target: 'ds-b', started_at: '2026-10-17T00:00:00Z', token: 'crashed-owner' })}\n`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seyra-lock-race-'));
  lockPath = join(dir, 'lifecycle.lock');
});
afterEach(async () => {
  for (const w of workers.splice(0)) {
    if (w.proc.exitCode === null) w.proc.kill('SIGKILL');
    await w.exited;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('lifecycle lock between real processes (review R3 follow-up)', () => {
  it('two commands recovering from a crashed owner never both enter (reviewed interleaving)', async () => {
    writeCrashedOwner();
    // A is descheduled exactly where the reviewed version unlinked the lock it judged stale.
    const a = start('a', 'activate', 'before-unlink');
    const aFirst = await next(a);
    expectExclusive();
    // B recovers the same crashed owner and tries to enter its own protected operation.
    const b = start('b', 'prune');
    const bFirst = await next(b);
    expectExclusive();
    if (aFirst === 'PAUSED') {
      resume(a);
      await next(a, a.lines.indexOf('PAUSED') + 1);
      expectExclusive(); // reviewed version: A deleted B's live lock and entered too
    }
    const states = [a, b].map((w) => w.lines.find((x) => /^(HOLDING|BUSY|ERROR)/.test(x)) ?? '');
    expect(states.filter((s) => s.startsWith('HOLDING'))).toHaveLength(1);
    expect(states.filter((s) => s.startsWith('BUSY'))).toHaveLength(1);
    expect(bFirst.startsWith('HOLDING') || bFirst.startsWith('BUSY')).toBe(true);
    for (const w of [a, b]) await finish(w);
    expect(record()).toBeNull(); // released: no owner left behind
  });

  it('a command paused right after seeing the crashed owner keeps exclusion when another one runs', async () => {
    writeCrashedOwner();
    const a = start('a', 'activate', 'after-stale-read');
    await next(a);
    const b = start('b', 'prune');
    await next(b);
    expectExclusive();
    if (a.lines.includes('PAUSED')) {
      resume(a);
      await next(a, a.lines.indexOf('PAUSED') + 1);
      expectExclusive();
    }
    const holders = [a, b].filter((w) => w.lines.some((x) => x.startsWith('HOLDING')));
    expect(holders).toHaveLength(1);
    for (const w of [a, b]) await finish(w);
    // The one that was refused can now run.
    const loser = [a, b].find((w) => !holders.includes(w))!;
    const retry = start(`${loser.role}2`, 'prune');
    expect(await next(retry)).toMatch(/^HOLDING/);
    expectExclusive();
    await finish(retry);
  });

  it('ordinary contention: a live holder refuses others, a bounded wait enters after it leaves', async () => {
    const a = start('a', 'activate');
    expect(await next(a)).toMatch(/^HOLDING/);
    const failFast = start('b', 'prune');
    expect(await next(failFast)).toMatch(/^BUSY another lifecycle operation is running: activate/);
    expect(await failFast.exited).toBe(3);
    const waiter = start('c', 'prune', 'none', 5_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(waiter.lines.some((x) => x.startsWith('HOLDING'))).toBe(false); // still waiting
    expectExclusive();
    await finish(a);
    expect(await next(waiter)).toMatch(/^HOLDING/);
    expectExclusive();
    await finish(waiter);
  });

  it('a holder killed with SIGKILL releases the lock; its record does not block the next command', async () => {
    const a = start('a', 'activate');
    expect(await next(a)).toMatch(/^HOLDING/);
    a.proc.kill('SIGKILL');
    await a.exited;
    rmSync(join(dir, 'inside-a'), { force: true }); // the killed process could not clean up
    const b = start('b', 'prune');
    expect(await next(b)).toMatch(/^HOLDING/);
    expectExclusive();
    await finish(b);
  });

  it('after a crashed owner with an unfinished transition, only recover is admitted', async () => {
    writeCrashedOwner('activate');
    writeFileSync(join(dir, 'transition.json'), '{"schema":"seyra.transition/1","op":"activate"}');
    const p = start('p', 'prune');
    expect(await next(p)).toMatch(/^ERROR the activate started .* ended without finishing; run: seyra-maps recover/);
    expect(existsSync(join(dir, 'inside-p'))).toBe(false);
    const r = start('r', 'recover');
    expect(await next(r)).toMatch(/^HOLDING/);
    expectExclusive();
    await finish(r);
  });
});

