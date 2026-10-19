import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAccess } from './activate.js';
import { parseEnv, relayEnabled, runtimeComposeFiles, runtimeEnv, serializeEnv } from './compose.js';
import { DEFAULT_SETTINGS, layout, validateRuntimeAccess, validateSettings, writeAtomic, type Layout, type Settings } from './layout.js';
import { lockedImages } from './lock.js';

const s = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });
// Placeholders: documentation (192.0.2.0/24) and benchmark (198.18.0.0/15) ranges, never operator values.
const relay: Partial<Settings> = {
  accessMode: 'loopback',
  bindAddr: '127.0.0.1',
  relayPeer: '198.18.0.3',
  relayBindAddr: '198.18.0.2',
  relayPort: 8444,
  relayClientCidrs: '192.0.2.0/24',
  relayServerNames: '192.0.2.10',
};

describe('relay settings (nested-host topology)', () => {
  it('accepts a complete relay with loopback access mode and keeps direct LAN mode unchanged', () => {
    expect(() => validateSettings(s(relay))).not.toThrow();
    expect(() => validateSettings(s({ accessMode: 'lan', bindAddr: '10.20.0.15', lanCidrs: '10.20.0.0/24', serverNames: 'maps.internal 10.20.0.15' }))).not.toThrow();
  });

  it.each([
    ['relay with lan access mode', { ...relay, accessMode: 'lan', bindAddr: '10.20.0.15', lanCidrs: '10.20.0.0/24' }, /requires loopback access mode/],
    ['relay fields without a peer', { relayBindAddr: '198.18.0.2', relayPort: 8444 }, /only valid together with --relay-peer/],
    ['peer is a network', { ...relay, relayPeer: '198.18.0.0/15' }, /exact non-loopback IPv4/],
    ['peer is loopback', { ...relay, relayPeer: '127.0.0.2' }, /exact non-loopback IPv4/],
    ['peer is 0.0.0.0', { ...relay, relayPeer: '0.0.0.0' }, /exact non-loopback IPv4/],
    ['peer inside the client allowlist', { ...relay, relayPeer: '192.0.2.77' }, /inside the client allowlist/],
    ['relay published on all interfaces', { ...relay, relayBindAddr: '0.0.0.0' }, /concrete non-loopback/],
    ['relay published on loopback', { ...relay, relayBindAddr: '127.0.0.1' }, /concrete non-loopback/],
    ['relay port missing', { ...relay, relayPort: 0 }, /invalid relay port/],
    ['relay port out of range', { ...relay, relayPort: 70000 }, /invalid relay port/],
    ['no client CIDRs', { ...relay, relayClientCidrs: '' }, /relay-client-cidrs/],
    ['allow-all client CIDR', { ...relay, relayClientCidrs: '0.0.0.0/0' }, /broader than/],
    ['non-canonical client CIDR', { ...relay, relayClientCidrs: '192.0.2.10/24' }, /host bits/],
    ['localhost in relay server names', { ...relay, relayServerNames: '192.0.2.10 localhost' }, /loopback names/],
    ['127.0.0.1 in relay server names', { ...relay, relayServerNames: '127.0.0.1' }, /loopback names/],
    ['wildcard relay server name', { ...relay, relayServerNames: '*.example' }, /invalid relay server names/],
  ] as [string, Partial<Settings>, RegExp][])('refuses %s', (_name, over, re) => {
    expect(() => validateSettings(s(over))).toThrow(re);
  });

  it('carries relay settings into runtime.env and re-validates a hand-edited file', () => {
    const l = { home: '/h', releases: '/h/releases' } as Layout;
    const env = runtimeEnv(l, s(relay), [], 'ds-x');
    expect(env).toMatchObject({ SEYRA_RELAY_PEER: '198.18.0.3', SEYRA_RELAY_BIND_ADDR: '198.18.0.2', SEYRA_RELAY_PORT: '8444', SEYRA_RELAY_CLIENT_CIDRS: '192.0.2.0/24', SEYRA_RELAY_SERVER_NAMES: '192.0.2.10' });
    expect(() => validateRuntimeAccess(parseEnv(serializeEnv(env)))).not.toThrow();
    const tampered = parseEnv(serializeEnv({ ...env, SEYRA_RELAY_CLIENT_CIDRS: '0.0.0.0/0' }));
    expect(() => validateRuntimeAccess(tampered)).toThrow(/broader than/);
    // Without a relay the variables are empty, and an older runtime.env without them stays valid.
    const plain = runtimeEnv(l, s({}), [], 'ds-x');
    expect(plain.SEYRA_RELAY_PEER).toBe('');
    const legacy = Object.fromEntries(Object.entries(plain).filter(([k]) => !k.startsWith('SEYRA_RELAY_')));
    expect(() => validateRuntimeAccess(legacy)).not.toThrow();
  });
});

describe('relay compose file and access apply', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  let home: string;
  let l: Layout;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'seyra-relay-'));
    process.env.SEYRA_HOME = home;
    process.env.SEYRA_INSTALL_DIR = join(home, 'install');
    l = layout();
    mkdirSync(join(l.install, 'infra', 'compose'), { recursive: true });
    for (const f of ['runtime.yml', 'runtime.relay.yml']) writeFileSync(join(l.install, 'infra', 'compose', f), readFileSync(join(repo, 'infra', 'compose', f)));
    writeFileSync(join(l.install, 'infra', 'dependencies.lock.json'), readFileSync(join(repo, 'infra', 'dependencies.lock.json')));
    mkdirSync(dirname(l.settingsFile), { recursive: true });
  });
  afterEach(() => {
    delete process.env.SEYRA_HOME;
    delete process.env.SEYRA_INSTALL_DIR;
    rmSync(home, { recursive: true, force: true });
  });

  it('adds the relay port file to every runtime compose invocation only when runtime.env enables a relay', () => {
    writeAtomic(l.runtimeEnv, serializeEnv(runtimeEnv(l, s({}), lockedImages(l.install), 'ds-a')));
    expect(relayEnabled(l)).toBe(false);
    expect(runtimeComposeFiles(l).filter((a) => a.endsWith('.yml'))).toEqual([join(l.install, 'infra', 'compose', 'runtime.yml')]);
    writeAtomic(l.runtimeEnv, serializeEnv(runtimeEnv(l, s(relay), lockedImages(l.install), 'ds-a')));
    expect(relayEnabled(l)).toBe(true);
    expect(runtimeComposeFiles(l).filter((a) => a.endsWith('.yml'))).toEqual([join(l.install, 'infra', 'compose', 'runtime.yml'), join(l.install, 'infra', 'compose', 'runtime.relay.yml')]);
    expect(readFileSync(join(l.install, 'infra', 'compose', 'runtime.relay.yml'), 'utf8')).toContain('"${SEYRA_RELAY_BIND_ADDR:?}:${SEYRA_RELAY_PORT:?}:8444"');
  });

  it('access apply rewrites only access keys for the active release, keeps the previous file, and refuses unsafe settings', () => {
    writeAtomic(l.pointersFile, `${JSON.stringify({ active: 'ds-a', previous: null })}\n`);
    writeAtomic(l.runtimeEnv, serializeEnv(runtimeEnv(l, s({}), lockedImages(l.install), 'ds-a')));
    const before = readFileSync(l.runtimeEnv, 'utf8');
    writeAtomic(l.settingsFile, `${JSON.stringify(s(relay))}\n`);
    const logs: string[] = [];
    const r = applyAccess(l, (m) => logs.push(m));
    expect(r.changed).toEqual(['SEYRA_RELAY_BIND_ADDR', 'SEYRA_RELAY_CLIENT_CIDRS', 'SEYRA_RELAY_PEER', 'SEYRA_RELAY_PORT', 'SEYRA_RELAY_SERVER_NAMES']);
    expect(readFileSync(`${l.runtimeEnv}.prev`, 'utf8')).toBe(before);
    expect(parseEnv(readFileSync(l.runtimeEnv, 'utf8')).SEYRA_DATASET_ID).toBe('ds-a');
    expect(applyAccess(l, () => {}).changed).toEqual([]);
    // Unsafe persisted settings: refused, runtime.env untouched.
    const applied = readFileSync(l.runtimeEnv, 'utf8');
    writeAtomic(l.settingsFile, `${JSON.stringify(s({ ...relay, relayClientCidrs: '0.0.0.0/0' }))}\n`);
    expect(() => applyAccess(l, () => {})).toThrow(/broader than/);
    expect(readFileSync(l.runtimeEnv, 'utf8')).toBe(applied);
    // A difference beyond access keys (e.g. another dataset) is not this command's business.
    writeAtomic(l.settingsFile, `${JSON.stringify(s(relay))}\n`);
    writeAtomic(l.pointersFile, `${JSON.stringify({ active: 'ds-b', previous: 'ds-a' })}\n`);
    expect(() => applyAccess(l, () => {})).toThrow(/beyond access settings/);
    expect(existsSync(l.runtimeEnv)).toBe(true);
  });
});
