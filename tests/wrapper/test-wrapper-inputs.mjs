// Regression for review H1 (6602199): the host wrapper must make every input file of a command
// visible inside the OPS container, read-only, without shadowing writable SEYRA_HOME state.
//
//   node tests/wrapper/test-wrapper-inputs.mjs [path/to/bin/seyra-maps]
//
// Runs the ACTUAL wrapper with a recording `docker` first on PATH (argv recorded NUL-separated; the
// stub never starts anything). For each case the recorded `docker run` argv is checked: every input
// path handed to the CLI is absolute and visible (inside the writable SEYRA_HOME mount, or covered by
// a read-only mount); no read-only mount sits at or under SEYRA_HOME; no mount target repeats; and a
// missing input or argument stops before Docker is called at all.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const wrapper = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'seyra-maps'));
const w = mkdtempSync(join(tmpdir(), 'seyra-wrapper-'));
const bin = join(w, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'docker'), '#!/bin/bash\nif [ "$1" = network ]; then exit 1; fi\nprintf "%s\\0" "$@" > "$WRAPPER_DOCKER_LOG"\n');
chmodSync(join(bin, 'docker'), 0o755);
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const file = (p) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 'input\n');
  return p;
};

/** Parse `-v src:dst[:ro]` and `--mount type=bind,"source=…","target=…"[,readonly]`. */
function mountsOf(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-v') {
      const parts = argv[i + 1].split(':');
      out.push({ src: parts[0], dst: parts[1], ro: parts[2] === 'ro', raw: argv[i + 1] });
    } else if (argv[i] === '--mount') {
      const fields = [...argv[i + 1].matchAll(/"([^"]*)"|([^,]+)/g)].map((m) => m[1] ?? m[2]);
      const kv = Object.fromEntries(fields.map((f) => (f.includes('=') ? [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)] : [f, true])));
      out.push({ src: kv.source ?? kv.src, dst: kv.target ?? kv.destination ?? kv.dst, ro: kv.readonly === true || kv.readonly === 'true' || kv.ro === true, raw: argv[i + 1] });
    }
  }
  return out;
}
const covers = (m, p) => p === m.dst || p.startsWith(`${m.dst}/`);

function run(name, { args, cwd = w, home = join(w, `home-${name}`), expectDocker = true, inputs = [] }) {
  const log = join(w, `${name}.argv`);
  const r = spawnSync('bash', [wrapper, ...args], { cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SEYRA_HOME: home, WRAPPER_DOCKER_LOG: log }, encoding: 'utf8' });
  const called = existsSync(log);
  if (!expectDocker) {
    check(`${name}: refused before Docker (exit 2, no docker run)`, r.status === 2 && !called, `rc=${r.status} docker=${called} ${r.stderr.trim()}`);
    return;
  }
  if (!called) return check(`${name}: docker run recorded`, false, `rc=${r.status} ${r.stderr.trim()}`);
  const argv = readFileSync(log).toString().split('\0').filter(Boolean);
  const mounts = mountsOf(argv);
  const homeMount = mounts.find((m) => m.dst === home && !m.ro);
  check(`${name}: SEYRA_HOME stays a writable mount`, homeMount, mounts.map((m) => m.raw).join(' | '));
  const shadow = mounts.filter((m) => m.ro && (m.dst === home || m.dst.startsWith(`${home}/`)));
  check(`${name}: no read-only mount at or under SEYRA_HOME`, shadow.length === 0, shadow.map((m) => m.raw).join(' | '));
  const targets = mounts.map((m) => m.dst);
  check(`${name}: no mount target repeats`, new Set(targets).size === targets.length, targets.join(' | '));
  for (const [flag, abs] of inputs) {
    const i = argv.indexOf(flag);
    const passed = argv[i + 1];
    check(`${name}: ${flag} passed as the absolute path`, passed === abs, `${passed} != ${abs}`);
    const visible = passed?.startsWith(`${home}/`) ? Boolean(homeMount) : mounts.some((m) => m.ro && covers(m, passed) && m.src === m.dst);
    check(`${name}: ${flag} visible inside the container`, visible, `${passed} mounts: ${mounts.map((m) => m.raw).join(' | ')}`);
  }
}

// 1. A normal operator layout: leaf, root, intermediates and key in separate directories.
const sep = { cert: file(join(w, 'received', 'leaf.crt')), ca: file(join(w, 'trust', 'root.crt')), chain: file(join(w, 'intermediates', 'chain.pem')), key: file(join(w, 'keys', 'server.key')) };
run('separate-directories', { args: ['tls', 'import', '--cert', sep.cert, '--ca', sep.ca, '--chain', sep.chain, '--key', sep.key, '--names', 'maps.example.test'], inputs: [['--cert', sep.cert], ['--ca', sep.ca], ['--chain', sep.chain], ['--key', sep.key]] });
// 2. Everything in one directory (one mount per file, never the same target twice).
const one = join(w, 'one');
const same = { cert: file(join(one, 'leaf.crt')), ca: file(join(one, 'root.crt')), chain: file(join(one, 'chain.pem')), key: file(join(one, 'server.key')) };
run('same-directory', { args: ['tls', 'import', '--cert', same.cert, '--ca', same.ca, '--chain', same.chain, '--key', same.key, '--names', 'maps.example.test'], inputs: [['--cert', same.cert], ['--ca', same.ca], ['--chain', same.chain], ['--key', same.key]] });
// 3. Relative paths with spaces, resolved against the caller's directory.
const rel = join(w, 'operator files');
file(join(rel, 'issued leaf.crt'));
file(join(rel, 'company root.crt'));
run('relative-with-spaces', { cwd: rel, args: ['tls', 'import', '--cert', 'issued leaf.crt', '--ca', './company root.crt', '--names', 'maps.example.test'], inputs: [['--cert', join(rel, 'issued leaf.crt')], ['--ca', join(rel, 'company root.crt')]] });
// 4. Service-local inputs inside SEYRA_HOME (e.g. the pending key, a backup): no extra mount.
const home4 = join(w, 'home-service-local');
const local = { key: file(join(home4, 'secrets', 'tls', 'pending', 'server.key')), cert: file(join(home4, 'secrets', 'tls', 'issued.crt')) };
const extRoot = file(join(w, 'ext', 'root.crt'));
run('service-local', { home: home4, args: ['tls', 'import', '--cert', local.cert, '--key', local.key, '--ca', extRoot, '--names', 'maps.example.test'], inputs: [['--cert', local.cert], ['--key', local.key], ['--ca', extRoot]] });
// 5. Paths with a comma and a colon survive the mount syntax.
const odd = file(join(w, 'odd,dir:x', 'root.crt'));
run('comma-colon-path', { args: ['tls', 'import', '--cert', sep.cert, '--ca', odd, '--names', 'maps.example.test'], inputs: [['--ca', odd]] });
// 6. The same file named twice is mounted once.
run('same-file-twice', { args: ['tls', 'import', '--cert', sep.cert, '--chain', sep.cert, '--ca', sep.ca, '--names', 'maps.example.test'], inputs: [['--cert', sep.cert], ['--ca', sep.ca]] });
// 7. PBF input outside SEYRA_HOME still works.
const pbf = file(join(w, 'owner input', 'iran.osm.pbf'));
run('pbf-outside-home', { args: ['import', '--pbf', pbf], inputs: [['--pbf', pbf]] });
// 8. Missing inputs and missing arguments stop before Docker.
run('missing-ca-file', { args: ['tls', 'import', '--cert', sep.cert, '--ca', join(w, 'trust', 'absent.crt'), '--names', 'x.test'], expectDocker: false });
run('missing-ca-directory', { args: ['tls', 'import', '--cert', sep.cert, '--ca', join(w, 'no-such-dir', 'root.crt'), '--names', 'x.test'], expectDocker: false });
run('missing-chain-argument', { args: ['tls', 'import', '--cert', sep.cert, '--ca', sep.ca, '--chain'], expectDocker: false });
run('directory-instead-of-file', { args: ['tls', 'import', '--cert', join(w, 'received'), '--ca', sep.ca, '--names', 'x.test'], expectDocker: false });
// 9. A new --out directory is 0755 even under a group-writable umask (bundle export, backup).
{
  const outDir = join(w, 'exports', 'bundle-new');
  const log = join(w, 'out-mode.argv');
  const r = spawnSync('bash', ['-c', 'umask 0002; exec bash "$0" "$@"', wrapper, 'bundle', 'export', '--out', outDir], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SEYRA_HOME: join(w, 'home-out-mode'), WRAPPER_DOCKER_LOG: log }, encoding: 'utf8' });
  const mode = existsSync(outDir) ? (statSync(outDir).mode & 0o777).toString(8) : 'absent';
  check('new --out directory is 0755 under umask 0002', r.status === 0 && mode === '755', `rc=${r.status} mode=${mode} ${r.stderr.trim()}`);
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` -- ${r.detail.slice(0, 300)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`# wrapper=${wrapper} checks=${results.length} failed=${failed}`);
rmSync(w, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
