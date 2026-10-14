import { join } from 'node:path';
import type { Layout, Settings } from './layout.js';
import { writeAtomic } from './layout.js';
import { imageEnv, type LockedImage } from './lock.js';
import { run, type RunOptions, type RunResult } from './proc.js';

export const RUNTIME_PROJECT = 'seyra';
export const JOBS_PROJECT = 'seyra-jobs';

export function composeFile(l: Layout, name: 'runtime.yml' | 'jobs.yml'): string {
  return join(l.install, 'infra', 'compose', name);
}

/** Placeholder release used before the first activation so compose can interpolate. */
export const NO_RELEASE = 'none';

export function runtimeEnv(l: Layout, s: Settings, images: LockedImage[], datasetId: string): Record<string, string> {
  return {
    SEYRA_HOME: l.home,
    SEYRA_DATASET_ID: datasetId,
    SEYRA_RELEASE_DIR: join(l.releases, datasetId),
    SEYRA_BIND_ADDR: s.bindAddr,
    SEYRA_HTTPS_PORT: String(s.httpsPort),
    SEYRA_ACCESS_MODE: s.accessMode,
    SEYRA_LAN_ALLOW_CIDRS: s.lanCidrs,
    SEYRA_SERVER_NAMES: s.serverNames,
    SEYRA_VALHALLA_THREADS: String(s.valhallaThreads),
    SEYRA_PHOTON_JAVA_OPTS: s.photonJavaOpts,
    SEYRA_TILE_CACHE_MAX: s.tileCacheMax,
    ...imageEnv(images),
  };
}

export function serializeEnv(env: Record<string, string>): string {
  return `${Object.entries(env)
    .map(([k, v]) => {
      if (/[\n\r]/.test(v)) throw new Error(`invalid newline in ${k}`);
      return `${k}=${/[\s#"'$]/.test(v) ? JSON.stringify(v) : v}`;
    })
    .join('\n')}\n`;
}

export function writeRuntimeEnv(l: Layout, env: Record<string, string>): void {
  writeAtomic(l.runtimeEnv, serializeEnv(env), 0o640);
}

/** docker compose for the operational stack, always using the generated runtime.env. */
export function composeRuntime(l: Layout, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run('docker', ['compose', '-p', RUNTIME_PROJECT, '-f', composeFile(l, 'runtime.yml'), '--env-file', l.runtimeEnv, ...args], opts);
}

/** Per-run job variables. Compose interpolates every service in jobs.yml, not only the one being run. */
export const JOB_VARS = [
  'SEYRA_JOB_INPUT',
  'SEYRA_JOB_OUT',
  'SEYRA_JOB_WORK',
  'SEYRA_JOB_IMPORT',
  'SEYRA_JOB_RELEASE',
  'SEYRA_JOB_RENDER_DB',
  'SEYRA_JOB_PGPASS',
  'SEYRA_JOB_OVERPASS_LABEL',
  'SEYRA_PHOTON_EXTRA_TAGS',
] as const;

/**
 * docker compose for offline build jobs; per-run mounts are passed as environment variables.
 * Variables of the services that are NOT being run get an inert managed placeholder so compose
 * can interpolate the whole file; the caller supplies every variable its own service needs.
 */
export function jobsInvocation(l: Layout, env: Record<string, string>, args: string[]): { cmd: string; args: string[]; env: Record<string, string> } {
  const placeholder = join(l.work, '.job-var-unset');
  const filler = Object.fromEntries(JOB_VARS.filter((k) => env[k] === undefined).map((k) => [k, placeholder]));
  return { cmd: 'docker', args: ['compose', '-p', JOBS_PROJECT, '-f', composeFile(l, 'jobs.yml'), ...args], env: { SEYRA_HOME: l.home, ...filler, ...env } };
}

export function composeJobs(l: Layout, env: Record<string, string>, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const inv = jobsInvocation(l, env, args);
  return run(inv.cmd, inv.args, { ...opts, env: { ...inv.env, ...opts.env } });
}

export async function ensureNetworks(): Promise<void> {
  for (const name of ['seyra_backend', 'seyra_build']) {
    const exists = await run('docker', ['network', 'inspect', name], { allowFailure: true });
    // Internal networks: no route to the outside world for anything attached to them.
    if (exists.code !== 0) await run('docker', ['network', 'create', '--internal', '--label', 'seyra.managed=true', name]);
  }
}
