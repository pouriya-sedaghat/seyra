// Artifact and link inventory for the two deliverables (review 6602199, packaging observation):
//   - the operational bundle's install files (apps/ops/src/bundle.ts INSTALL_PATHS): every path
//     exists, and every relative Markdown link inside them resolves within that same set;
//   - the client handoff pack (infra/handoff/build-client-pack.mjs): built for real into a temporary
//     directory; every relative link resolves inside the pack, operator material and key material
//     are absent, and PACK-MANIFEST.json matches the copied bytes.
// This checks the declared file sets; it does not claim an exported (image) bundle was tested.
//
//   node tests/client/test-handoff-artifacts.mjs [checkout-root]
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const links = (md) => [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((t) => !/^[a-z]+:/i.test(t) && !t.startsWith('#')).map((t) => t.split('#')[0]).filter(Boolean);
const walk = (base, rel) => (statSync(join(base, rel)).isFile() ? [rel] : readdirSync(join(base, rel)).sort().flatMap((n) => walk(base, `${rel}/${n}`)));
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

// ---- operational bundle install set ---------------------------------------------------------------
const bundleSrc = readFileSync(join(root, 'apps', 'ops', 'src', 'bundle.ts'), 'utf8');
const list = bundleSrc.slice(bundleSrc.indexOf('export const INSTALL_PATHS = ['), bundleSrc.indexOf('];', bundleSrc.indexOf('export const INSTALL_PATHS')));
const installPaths = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const missing = installPaths.filter((p) => !existsSync(join(root, p)));
check(`bundle: all ${installPaths.length} declared install paths exist`, missing.length === 0, missing.join(', '));
const installFiles = installPaths.filter((p) => existsSync(join(root, p))).flatMap((p) => walk(root, p));
const broken = [];
for (const f of installFiles.filter((x) => x.endsWith('.md'))) {
  for (const l of links(readFileSync(join(root, f), 'utf8'))) {
    const t = normalize(join(dirname(f), l)).replace(/\/$/, '');
    if (!installFiles.some((x) => x === t || x.startsWith(`${t}/`))) broken.push(`${f} -> ${l}`);
  }
}
check('bundle: every relative link in the install docs resolves inside the install set', broken.length === 0, broken.join(' | '));
check('bundle: no install file holds a PEM private key', !installFiles.some((f) => PRIVATE_KEY.test(readFileSync(join(root, f), 'utf8'))));
check('bundle: no development issuer tool in the install set', !installFiles.some((f) => f.startsWith('infra/tls/')));

// ---- client handoff pack ---------------------------------------------------------------------------
const builder = join(root, 'infra', 'handoff', 'build-client-pack.mjs');
if (!existsSync(builder)) {
  check('pack: a declared client handoff pack builder exists', false, `${builder} missing; the guide's linked examples/handoff files belong to no deliverable`);
} else {
  const { buildClientPack, CLIENT_PACK } = await import(pathToFileURL(builder));
  const out = mkdtempSync(join(tmpdir(), 'seyra-client-pack-'));
  try {
    const m = buildClientPack(root, out);
    const packed = Object.keys(m.files);
    check('pack: built from the declared list', packed.length > 0 && CLIENT_PACK.every((p) => packed.some((f) => f === p || f.startsWith(`${p}/`))), packed.length);
    const bad = [];
    for (const f of packed.filter((x) => x.endsWith('.md'))) {
      for (const l of links(readFileSync(join(out, f), 'utf8'))) {
        const t = normalize(join(dirname(f), l)).replace(/\/$/, '');
        if (!existsSync(join(out, t))) bad.push(`${f} -> ${l}`);
      }
    }
    check('pack: every relative link resolves inside the built pack', bad.length === 0, bad.join(' | '));
    check('pack: the guide links the dev proxy example and the handoff index, and both are packed', existsSync(join(out, 'examples/web-dev-proxy/seyra-dev-proxy.mjs')) && existsSync(join(out, 'docs/handoff/README.md')));
    check('pack: no operator plan, evidence, edge or issuer tooling', !packed.some((f) => /DEPLOYMENT_PLAN|\/evidence\/|^infra\//.test(f)));
    check('pack: no PEM private key in any packed file', !packed.some((f) => PRIVATE_KEY.test(readFileSync(join(out, f), 'utf8'))));
    check('pack: manifest hashes equal the packed bytes', packed.every((f) => createHash('sha256').update(readFileSync(join(out, f))).digest('hex') === m.files[f]));
    check('pack: manifest written', existsSync(join(out, 'PACK-MANIFEST.json')));
  } catch (e) {
    check('pack: builds without refusal', false, e.message);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# checkout=${root} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
