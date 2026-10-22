import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyBundleOwnership } from './bundle.js';

const root = mkdtempSync(join(tmpdir(), 'seyra-bundle-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const mode = (p: string) => statSync(p).mode & 0o777;

describe('bundle output ownership', () => {
  it('makes what `docker save -o` leaves root-only readable by the operator, without changing contents', () => {
    const out = join(root, 'bundle');
    mkdirSync(join(out, 'images'), { recursive: true });
    mkdirSync(join(out, 'install', 'bin'), { recursive: true });
    writeFileSync(join(out, 'images', 'ops.tar'), 'archive bytes');
    chmodSync(join(out, 'images', 'ops.tar'), 0o600); // as docker save -o writes it
    chmodSync(join(out, 'images'), 0o700);
    writeFileSync(join(out, 'install', 'bin', 'seyra-maps'), '#!/usr/bin/env bash\n');
    chmodSync(join(out, 'install', 'bin', 'seyra-maps'), 0o700);
    writeFileSync(join(out, 'SHA256SUMS'), 'sums\n');
    chmodSync(join(out, 'SHA256SUMS'), 0o600);
    chmodSync(out, 0o750);

    const owner = applyBundleOwnership(out);

    expect(owner).toEqual({ uid: statSync(out).uid, gid: statSync(out).gid });
    expect(mode(join(out, 'images'))).toBe(0o755);
    expect(mode(join(out, 'images', 'ops.tar'))).toBe(0o644);
    expect(mode(join(out, 'install', 'bin', 'seyra-maps'))).toBe(0o755); // executables stay executable
    expect(mode(join(out, 'SHA256SUMS'))).toBe(0o644);
    expect(mode(out)).toBe(0o750); // OUT itself (the operator's directory) is left alone
    expect(readFileSync(join(out, 'images', 'ops.tar'), 'utf8')).toBe('archive bytes');
    for (const p of [join(out, 'images', 'ops.tar'), join(out, 'install', 'bin', 'seyra-maps')]) {
      expect(statSync(p).uid).toBe(owner.uid);
      expect(statSync(p).gid).toBe(owner.gid);
    }
  });

  it('touches nothing outside the output directory', () => {
    const outside = join(root, 'unrelated-secret');
    writeFileSync(outside, 'secret');
    chmodSync(outside, 0o400);
    const out = join(root, 'bundle2');
    mkdirSync(out);
    writeFileSync(join(out, 'SHA256SUMS'), 'x\n');
    applyBundleOwnership(out);
    expect(mode(outside)).toBe(0o400);
  });
});
