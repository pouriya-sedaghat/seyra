import { withLifecycleLock } from './lifecycle-lock.js';
import type { Layout } from './layout.js';
import { tlsInit } from './setup.js';
import { tlsCsr, tlsImport, tlsRecover, tlsRestore, tlsStatus } from './tls.js';

const arg = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const namesOf = (args: string[]) => (arg(args, '--names') ?? '').split(',').map((n) => n.trim()).filter(Boolean);

/**
 * `seyra-maps tls …`. Every subcommand that changes secrets/tls (csr, import, restore, recover and
 * the legacy test-only init) runs under the same lifecycle lock as start, proxy restart and
 * activation, and evaluates its preconditions (e.g. an unfinished replacement journal) only after
 * acquiring it. `status` only reads.
 */
export async function tlsCommand(l: Pick<Layout, 'tls' | 'lifecycleLock' | 'transitionFile'>, rest: string[], log: (m: string) => void, opts: { openssl?: string; waitMs?: number } = {}): Promise<number> {
  const p = { dir: l.tls };
  const locked = <T>(op: string, fn: () => Promise<T>) => withLifecycleLock(l, op, null, fn, opts.waitMs !== undefined ? { waitMs: opts.waitMs } : {});
  const ossl = opts.openssl ? { openssl: opts.openssl } : {};
  switch (rest[0]) {
    case 'status':
      console.log(JSON.stringify(tlsStatus(p), null, 2));
      return 0;
    case 'init':
      await locked('tls-init', () => tlsInit((arg(rest, '--names') ?? 'localhost,127.0.0.1').split(','), log));
      return 0;
    case 'csr':
      await locked('tls-csr', () => tlsCsr(p, namesOf(rest), log, { replacePending: rest.includes('--replace-pending'), ...ossl }));
      return 0;
    case 'import': {
      const cert = arg(rest, '--cert');
      const ca = arg(rest, '--ca');
      if (!cert || !ca) throw new Error('tls import needs --cert and --ca (the issuer trust anchor) and --names');
      const chain = arg(rest, '--chain');
      const key = arg(rest, '--key');
      await locked('tls-import', () => tlsImport(p, { cert, ca, names: namesOf(rest), ...(chain ? { chain } : {}), ...(key ? { key } : {}), ...ossl }, log));
      return 0;
    }
    case 'restore': {
      const from = arg(rest, '--from');
      if (!from) throw new Error('tls restore needs --from <secrets/tls/previous-…> (a backup made by tls import)');
      const names = namesOf(rest);
      await locked('tls-restore', () => tlsRestore(p, { from, ...(names.length ? { names } : {}), ...ossl }, log));
      return 0;
    }
    case 'recover':
      await locked('tls-recover', async () => log(`[tls] recover: ${await tlsRecover(p, log, ossl)}`));
      return 0;
    default:
      throw new Error('tls csr | tls import | tls restore | tls status | tls recover | tls init (test only)');
  }
}
