// Regression for review finding F1 (e7a2175): the storage credited for a failed build before it is
// deleted must be what deletion can actually release on SEYRA_HOME's filesystem.
//
//   node tests/validation/test-reclaim-credit.mjs [CHECKOUT]
//
// Loads, from CHECKOUT (default: this repository), the credit function its importer.ts actually uses
// for a failed build (`duBytes` up to e7a2175, `reclaimableBytes` after) and that revision's own
// capacityCheck, then decides admission near the boundary for real filesystem fixtures:
//   sparse 8 GiB file (0 allocated)       free = required - 4 GiB    -> must be refused
//   symlink to a 64 MiB file outside      free = required - 32 MiB   -> must be refused
//   hard link with a surviving outside link (64 MiB)                  -> must be refused
//   ordinary allocated 96 MiB file        free = required - 64 MiB   -> must be admitted
// Exit status 0 only if every case is decided as required. Node 24 (type stripping); no packages.
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.removeAllListeners('warning');
const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const src = (p) => readFileSync(join(root, p), 'utf8');
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code, { mode: 'transform' })).toString('base64')}`);
const importer = src('apps/ops/src/importer.ts');
const cap = await load(src('apps/ops/src/capacity.ts'));
let mechanism;
let credit;
if (/duBytes\(setupDir\)/.test(importer)) {
  const m = src('apps/ops/src/manifest.ts');
  const a = m.indexOf('export function duBytes(');
  const { duBytes } = await load(`import { readdirSync, statSync, existsSync } from 'node:fs';\nimport { join } from 'node:path';\n${m.slice(a, m.indexOf('\n}\n', a) + 3)}`);
  mechanism = 'duBytes(setupDir) (logical stat.size, follows symlinks)';
  credit = (dir) => duBytes(dir);
} else if (/reclaimableBytes\(setupDir/.test(importer)) {
  mechanism = 'reclaimableBytes(setupDir, dev) (allocated blocks, lstat, same device, link-aware)';
  credit = (dir) => cap.reclaimableBytes(dir, lstatSync(dir, { bigint: true }).dev).bytes;
} else {
  throw new Error(`cannot tell which reclaim credit ${root}/apps/ops/src/importer.ts uses`);
}

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const settings = { minFreeFactor: 120, minFreeBytes: 0 };
const input = 64 * MiB; // requirement 7.5 GiB
const required = 120 * input;
const work = mkdtempSync(join(tmpdir(), 'seyra-reclaim-regression-'));
const outside = join(work, 'outside');
mkdirSync(outside);
const cases = [
  {
    name: 'sparse 8 GiB file with no allocated blocks',
    free: required - 4 * GiB,
    expect: false,
    make: (d) => {
      writeFileSync(join(d, 'partial-store.bin'), '');
      truncateSync(join(d, 'partial-store.bin'), 8 * GiB);
    },
  },
  {
    name: 'symlink to a 64 MiB file outside the release',
    free: required - 32 * MiB,
    expect: false,
    make: (d) => {
      writeFileSync(join(outside, 'target.bin'), Buffer.alloc(64 * MiB, 1));
      symlinkSync(join(outside, 'target.bin'), join(d, 'linked-store'));
    },
  },
  {
    name: 'hard-linked 64 MiB file whose other link survives outside',
    free: required - 32 * MiB,
    expect: false,
    make: (d) => {
      writeFileSync(join(d, 'shared.bin'), Buffer.alloc(64 * MiB, 2));
      linkSync(join(d, 'shared.bin'), join(outside, 'kept-link.bin'));
    },
  },
  {
    name: 'ordinary allocated 96 MiB file',
    free: required - 64 * MiB,
    expect: true,
    make: (d) => writeFileSync(join(d, 'store.bin'), Buffer.alloc(96 * MiB, 3)),
  },
];

console.log(`# checkout=${root}\n# credit used by importer.ts: ${mechanism}`);
let failures = 0;
for (const c of cases) {
  const d = mkdtempSync(join(work, 'failed-release-'));
  c.make(d);
  const credited = credit(d);
  const decision = cap.capacityCheck(d, c.free, credited, input, settings).ok;
  const pass = decision === c.expect;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c.name}: credited ${credited} B, free ${c.free} B, required ${required} B -> ${decision ? 'admitted' : 'refused'} (expected ${c.expect ? 'admitted' : 'refused'})`);
}
rmSync(work, { recursive: true, force: true });
console.log(`# failures: ${failures}`);
process.exit(failures ? 1 : 0);
