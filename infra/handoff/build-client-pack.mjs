#!/usr/bin/env node
// Assemble the client handoff pack for the web and mobile developers (off-host, given by the owner).
//
//   node infra/handoff/build-client-pack.mjs <out-dir>
//
// The pack is a declared, repository-relative set of files (CLIENT_PACK below), copied with its
// layout so every relative link keeps working. It is separate from the operational bundle
// (apps/ops/src/bundle.ts INSTALL_PATHS) and never contains operator material: the deployment
// plan, evidence, edge/issuer tooling, private keys or operational values. The builder refuses if
// a declared path is missing, a relative Markdown link points outside the pack, or any file holds a
// PEM private key. PACK-MANIFEST.json lists every file with its SHA-256 and the source revision.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLIENT_PACK = [
  'docs/handoff/README.md',
  'docs/CLIENT_INTEGRATION.md',
  'docs/MOBILE_INTEGRATION.md',
  'docs/mobile-fixtures',
  'docs/openapi',
  'docs/LICENSES.md',
  'examples/web-dev-proxy',
  'tests/validation/search-seeds.json',
];
/** Never in the client pack, whatever the list says. */
export const EXCLUDED = [/^docs\/handoff\/(DEPLOYMENT_PLAN\.md|evidence\/)/, /^infra\//, /\.(key|pem)$/, /(^|\/)\.env/];
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

function walk(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error(`declared pack path ${rel} does not exist`);
  if (statSync(p).isFile()) return [rel];
  return readdirSync(p).sort().flatMap((n) => walk(root, `${rel}/${n}`));
}

/** Relative Markdown link targets (anchors and URLs ignored). */
export function relativeLinks(markdown) {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((t) => !/^[a-z]+:/i.test(t) && !t.startsWith('#')).map((t) => t.split('#')[0]).filter(Boolean);
}

export function buildClientPack(repo, out) {
  const files = [...new Set(CLIENT_PACK.flatMap((rel) => walk(repo, rel)))];
  const problems = [];
  for (const f of files) {
    if (EXCLUDED.some((re) => re.test(f))) problems.push(`${f} must not be in the client pack`);
    if (PRIVATE_KEY.test(readFileSync(join(repo, f), 'utf8'))) problems.push(`${f} contains a PEM private key`);
    if (f.endsWith('.md')) {
      for (const link of relativeLinks(readFileSync(join(repo, f), 'utf8'))) {
        const target = normalize(join(dirname(f), link)).replace(/\/$/, '');
        const inPack = files.some((x) => x === target || x.startsWith(`${target}/`));
        if (!inPack) problems.push(`${f} links ${link}, which is not in the pack`);
      }
    }
  }
  if (problems.length) throw new Error(`client pack refused:\n  ${problems.join('\n  ')}`);
  let revision = 'unknown';
  try {
    revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {}
  const manifest = { schema: 'seyra.client-pack/1', source_revision: revision, files: {} };
  for (const f of files) {
    mkdirSync(dirname(join(out, f)), { recursive: true });
    copyFileSync(join(repo, f), join(out, f));
    manifest.files[f] = createHash('sha256').update(readFileSync(join(repo, f))).digest('hex');
  }
  writeFileSync(join(out, 'PACK-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: build-client-pack.mjs <out-dir>');
    process.exit(2);
  }
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const m = buildClientPack(repo, resolve(out));
    console.log(`client pack: ${Object.keys(m.files).length} files from ${m.source_revision} -> ${relative(process.cwd(), resolve(out)) || '.'}`);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
