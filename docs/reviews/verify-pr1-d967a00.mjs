// Reviewer checks for Seyra PR #1. No Docker, database or network access.
// Usage: node verify-pr1-d967a00.mjs /absolute/path/to/checkout
// Actual TypeScript control flow runs through Node's built-in transformer. Docker/SQL/checksum
// boundaries are isolated. The lock race uses two real processes and pauses one filesystem read
// to make a valid OS scheduling interleaving deterministic; it does not change the lock algorithm.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const worker = process.argv[2] === '--lock-worker';
const root = resolve(process.argv[worker ? 3 : 2] ?? '.');
const url = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
function source(path, imports = {}) {
  const js = stripTypeScriptTypes(fs.readFileSync(join(root, path), 'utf8'), { mode: 'transform', sourceUrl: path });
  return url(js.replace(/from (['"])([^'"]+)\1/g, (m, _q, spec) => imports[spec] ? `from ${JSON.stringify(imports[spec])}` : m));
}

if (worker) {
  const dir = process.argv[4];
  const role = process.argv[5];
  const lockPath = join(dir, 'lifecycle.lock');
  const procUrl = source('apps/ops/src/proc.ts');
  const lifecycleUrl = source('apps/ops/src/lifecycle-lock.ts', { './proc.js': procUrl });
  if (role === 'a') {
    const original = fs.default.readFileSync;
    let reads = 0;
    fs.default.readFileSync = function(path, ...args) {
      const value = original(path, ...args);
      if (String(path) === lockPath && ++reads === 2) {
        // This read observed the stale owner. Another process may run before its following unlink.
        process.stdout.write('PAUSED_AFTER_STALE_READ\n');
        fs.readSync(0, Buffer.alloc(1), 0, 1, null);
      }
      return value;
    };
    syncBuiltinESMExports();
  }
  const { withLifecycleLock } = await import(lifecycleUrl);
  await withLifecycleLock({ lifecycleLock: lockPath, transitionFile: join(dir, 'transition.json') }, role === 'a' ? 'activate' : 'prune', null, async () => {
    fs.writeFileSync(join(dir, `inside-${role}`), String(process.pid));
    process.stdout.write('HOLDING\n');
    await new Promise((res) => process.stdin.once('data', res));
    fs.rmSync(join(dir, `inside-${role}`));
  });
  process.exit(0);
}

const work = fs.mkdtempSync(join(resolve(process.env.SEYRA_REVIEW_TMPDIR ?? process.cwd()), 'seyra-round2-'));
const evidence = { reviewed_commit: 'd967a000cf378af2f4e286fef6bd2ce28bdd2d01', node: process.version, checks: [], limitations: 'Isolated control-flow checks only; full Docker/provider/browser suites were not repeated by the reviewer.' };
evidence.source_sha256 = Object.fromEntries(['apps/ops/src/net.ts','apps/ops/src/layout.ts','apps/ops/src/compose.ts','apps/ops/src/lifecycle-lock.ts','apps/ops/src/import-lock.ts','apps/ops/src/activate.ts','apps/ops/src/backup.ts','apps/api/src/services/health.ts'].map(path => [path,createHash('sha256').update(fs.readFileSync(join(root,path))).digest('hex')]));
const netUrl = source('apps/ops/src/net.ts');
const layoutUrl = source('apps/ops/src/layout.ts', { './net.js': netUrl });
const L = await import(layoutUrl);
for (const bindAddr of ['0.0.0.0', '10.20.0.1', '300.1.1.1']) {
  assert.throws(() => L.validateSettings({ ...L.DEFAULT_SETTINGS, bindAddr }));
}
assert.doesNotThrow(() => L.validateSettings({ ...L.DEFAULT_SETTINGS, accessMode: 'lan', bindAddr: '0.0.0.0', lanCidrs: '10.20.0.0/16' }));
evidence.checks.push({ id: 'R1', result: 'PASS', unsafe_loopback_bind_rejected: true, canonical_lan_accepted: true });

const sim = globalThis.__seyraRound2 = { running: 'ds-a', failures: 0, calls: [], dbCalls: [], manifests: new Map(), unpublished: false, recreateFails: false };
const procUrl = url(`
import {readFileSync} from 'node:fs';
export async function run(cmd,args,opts={}) {
 const s=globalThis.__seyraRound2;
 if(cmd==='tar') { const {execFileSync}=await import('node:child_process');execFileSync(cmd,args);return {code:0,stdout:'',stderr:''}; }
 s.calls.push(args);
 if(args[0]!=='compose') return {code:0,stdout:'',stderr:''};
 const i=args.indexOf('--env-file'); const env=Object.fromEntries(readFileSync(args[i+1],'utf8').trim().split('\\n').map(x=>{const p=x.indexOf('=');return [x.slice(0,p),x.slice(p+1)];}));
 const op=args.slice(i+2);
 if(op[0]==='up') { if(s.failures>0){s.failures--;throw new Error('injected compose up failure');}s.running=env.SEYRA_DATASET_ID;if(op.includes('--force-recreate')&&!s.recreateFails)s.unpublished=false; }
 if(op[0]==='port') return {code:s.unpublished?1:0,stdout:s.unpublished?'':env.SEYRA_BIND_ADDR+':'+env.SEYRA_HTTPS_PORT,stderr:''};
 if(op[0]==='exec') return {code:0,stdout:JSON.stringify({dataset_id:s.running,providers:['tiles','routing','geocoder','overpass'].map(provider=>({provider,status:'ok',observed_identity:provider+'-'+s.running})),dependencies:[{name:'control_db',status:'ok'}]}),stderr:''};
 return {code:0,stdout:'',stderr:''};
}`);
const lockUrl = url(`export function lockedImages(){return [];}export async function verifyImages(){return [];}export function imageEnv(){return {};}`);
const dbUrl = url(`export const renderDbName=id=>'render_'+id.replaceAll('-','_');export async function psql(l,db,sql){const s=globalThis.__seyraRound2;s.dbCalls.push({db,sql});if(sql.includes('SELECT dataset_id'))return db.replace('render_','').replaceAll('_','-');return '0';}export async function recordEvent(){}export async function waitForDb(){}export async function initDatabase(){return [];}`);
const manifestUrl = url(`import {readFileSync} from 'node:fs';export const DATA_COMPONENT_ROLES=[];export function readManifest(dir){return JSON.parse(readFileSync(dir+'/manifest.json','utf8'));}export function writeManifest(dir,m){throw new Error('unexpected interrupted import in reviewer check');}export async function treeDigest(){return {sha256:'fixture'};}export async function sha256File(){return 'fixture';}export function sha256Text(){return 'fixture';}`);
const composeUrl = source('apps/ops/src/compose.ts', { './layout.js': layoutUrl, './lock.js': lockUrl, './proc.js': procUrl });
const lifecycleUrl = source('apps/ops/src/lifecycle-lock.ts', { './proc.js': procUrl });
const leaseUrl = source('apps/ops/src/import-lock.ts', { './compose.js': composeUrl, './db.js': dbUrl, './layout.js': layoutUrl, './lifecycle-lock.js': lifecycleUrl, './manifest.js': manifestUrl, './proc.js': procUrl });
const activateUrl = source('apps/ops/src/activate.ts', { './compose.js': composeUrl, './import-lock.js': leaseUrl, './db.js': dbUrl, './layout.js': layoutUrl, './lifecycle-lock.js': lifecycleUrl, './lock.js': lockUrl, './photon-config.js': url("export const PHOTON_OPENSEARCH_SETTINGS=['fixture-watermark'];"), './manifest.js': manifestUrl });
const A = await import(activateUrl);
const C = await import(composeUrl);
function home(name) {
  process.env.SEYRA_HOME = join(work, name);
  process.env.SEYRA_INSTALL_DIR = join(work, 'install');
  const l = L.layout();L.ensureDirs(l);
  C.writeRuntimeEnv(l, C.runtimeEnv(l, { ...L.DEFAULT_SETTINGS }, [], 'ds-a'));
  fs.writeFileSync(l.pointersFile, JSON.stringify({ active: 'ds-a', previous: null }));
  fs.writeFileSync(join(l.active, 'release.json'), '{"dataset_id":"ds-a"}\n');
  return l;
}
function release(l,id,status='validated') {
  const dir=join(l.releases,id);
  for(const d of ['geocoder','photon/photon_data/node_1/config','tegola'])fs.mkdirSync(join(dir,d),{recursive:true});
  fs.writeFileSync(join(dir,'geocoder/photon-import.jsonl'),'fixture');
  fs.writeFileSync(join(dir,'photon/photon_data/node_1/config/opensearch.yml'),'fixture-watermark');
  fs.writeFileSync(join(dir,'tegola/tegola.toml'),'fixture');
  fs.writeFileSync(join(dir,'manifest.json'),JSON.stringify({dataset_id:id,status,components:{},source:{managed_copy:'fixture',sha256:'fixture'},identities:{tiles:'tiles-'+id,routing:'routing-'+id,geocoder:'geocoder-'+id,overpass:'overpass-'+id},artifacts:{routing:{sha256:'fixture'},overpass:{sha256:'fixture'},maps:{sha256:'fixture'},geocoder:{import_sha256:'fixture'},render:{tegola_config_sha256:'fixture'}}}));
}
let l = home('activation');release(l,'ds-b');
const before={env:fs.readFileSync(l.runtimeEnv,'utf8'),release:fs.readFileSync(join(l.active,'release.json'),'utf8')};
sim.failures=1;
await assert.rejects(A.activate('ds-b',{log(){},readinessTimeoutS:0.5,pollMs:5}),/previous release ds-a restored and ready/);
assert.equal(fs.readFileSync(l.runtimeEnv,'utf8'),before.env);assert.equal(fs.readFileSync(join(l.active,'release.json'),'utf8'),before.release);
assert.equal(A.readPointers(l).active,'ds-a');assert.equal(fs.existsSync(l.transitionFile),false);assert.equal(fs.existsSync(join(l.flags,'maintenance')),false);
evidence.checks.push({id:'R2',result:'PASS',compose_failure_restores_previous_config_and_pointers:true,journal_and_maintenance_cleared:true});
sim.unpublished=true;await A.startStack(l,()=>{});assert.equal(sim.unpublished,false);
evidence.checks.push({id:'R2-ingress',result:'PASS',unpublished_proxy_forced_recreation:true});

l=home('prune');release(l,'ds-building','building');
fs.writeFileSync(l.importLock,JSON.stringify({pid:process.pid,host:hostname(),op:'import',target:'ds-building',started_at:new Date().toISOString(),token:'live-review-import'}));
assert.deepEqual(await A.prune(()=>{}),[]);assert.equal(fs.existsSync(join(l.releases,'ds-building')),true);
evidence.checks.push({id:'R3-live-import',result:'PASS',live_build_preserved:true});

const contractsUrl=url(`export const PROVIDER_IDS=['tiles','routing','geocoder','overpass'];export class MapServiceError extends Error{constructor(code,message,opts){super(message);this.code=code;this.opts=opts;}}`);
const releaseUrl=url(`export const tegolaMapName=id=>'seyra_'+id.replaceAll('-','_');export const geocoderMarkerName=id=>'seyra-release-'+id;`);
const {HealthService}=await import(source('apps/api/src/services/health.ts',{'@seyra/contracts':contractsUrl,'../release.js':releaseUrl}));
const identities={tiles:'tiles-a',routing:'routing-a',geocoder:'geocoder-a',overpass:'overpass-a'};
const probes={tiles:async()=>({identity:identities.tiles}),routing:async()=>{throw new Error('unavailable');},geocoder:async()=>({identity:identities.geocoder}),overpass:async()=>({identity:identities.overpass}),controlDb:async()=>{}};
const health=new HealthService({dataset_id:'ds-a',identities},probes,{cacheMs:5000,probeTimeoutMs:100,gateWaitMs:50,retryFailedAfterMs:0,maintenanceFlagFile:join(work,'absent')});
await assert.rejects(health.gate('routing'),e=>e.code==='PROVIDER_UNAVAILABLE');await health.refresh();
await assert.rejects(health.gate('routing'),e=>e.code==='PROVIDER_UNAVAILABLE');await health.gate('geocoder');
evidence.checks.push({id:'R4',result:'PASS',unverified_and_down_provider_rejected:true,unrelated_healthy_provider_admitted:true});

// Two stale-lock reclaimers. A pauses after reading the old token but before unlink; B reclaims
// the abandoned lock and enters prune. A resumes, deletes B's live lock, then enters activation.
const raceDir=join(work,'stale-reclaim');fs.mkdirSync(raceDir);
fs.writeFileSync(join(raceDir,'lifecycle.lock'),JSON.stringify({pid:2147483647,host:hostname(),op:'activate',target:'ds-b',started_at:'2026-10-17T00:00:00Z',token:'crashed-owner'}));
function child(role) {
  const c=spawn(process.execPath,[fileURLToPath(import.meta.url),'--lock-worker',root,raceDir,role],{stdio:['pipe','pipe','pipe']});
  c.output='';c.errors='';c.stdout.on('data',b=>{c.output+=b;});c.stderr.on('data',b=>{c.errors+=b;});
  c.done=new Promise(res=>c.once('exit',code=>res(code)));
  return c;
}
async function until(c,needle) {
  const deadline=Date.now()+5000;
  while(!c.output.includes(needle)) {
    if(c.exitCode!==null||Date.now()>deadline)throw new Error(`child did not reach ${needle}: ${c.output} ${c.errors}`);
    await new Promise(r=>setTimeout(r,5));
  }
}
let a,b;
try {
  a=child('a');await until(a,'PAUSED_AFTER_STALE_READ');
  b=child('b');await until(b,'HOLDING');
  const bToken=JSON.parse(fs.readFileSync(join(raceDir,'lifecycle.lock'),'utf8')).token;
  a.stdin.write('g');await until(a,'HOLDING');
  const aToken=JSON.parse(fs.readFileSync(join(raceDir,'lifecycle.lock'),'utf8')).token;
  assert.ok(fs.existsSync(join(raceDir,'inside-a'))&&fs.existsSync(join(raceDir,'inside-b')));assert.notEqual(aToken,bToken);
  evidence.checks.push({id:'R3-stale-reclaim',result:'FAIL',both_live_critical_sections_entered:true,live_prune_lock_deleted_by_other_reclaimer:true,scheduling:'A stale-token read; B reclaims and holds; A unlinks and enters while B is still holding'});
} finally {
  for(const c of [a,b].filter(Boolean)){c.stdin.write('\n');c.stdin.end();}
  await Promise.all([a,b].filter(Boolean).map(c=>c.done));
}

// The default backup directory is reused. A later backup that dies after pg_dump leaves a newer
// SQL file beside the complete older set; restore currently chooses newest files independently.
l=home('restore');fs.rmSync(l.pointersFile);
for(const n of ['db_admin_password','db_render_import_password','db_api_password','tile_db_password'])fs.writeFileSync(join(l.secrets,n),'review-only');
const backupDir=join(work,'backup');const stateDir=join(work,'backup-state');fs.mkdirSync(backupDir);fs.mkdirSync(join(stateDir,'state'),{recursive:true});
fs.writeFileSync(join(stateDir,'state','pointers.json'),JSON.stringify({active:null,previous:null}));
fs.writeFileSync(join(stateDir,'state','settings.json'),JSON.stringify({...L.DEFAULT_SETTINGS,serverNames:'older.internal'}));
fs.writeFileSync(join(stateDir,'state','history.jsonl'),'{"backup":"older"}\n');
execFileSync('tar',['-C',stateDir,'-czf',join(backupDir,'state-2026-10-16.tar.gz'),'state']);
fs.mkdirSync(join(stateDir,'manifests'),{recursive:true});
execFileSync('tar',['-C',stateDir,'-czf',join(backupDir,'manifests-2026-10-16.tar.gz'),'manifests']);
fs.writeFileSync(join(backupDir,'seyra_app-2026-10-16.sql'),'-- COMPLETE_OLDER_DUMP\n');
fs.writeFileSync(join(backupDir,'seyra_app-2026-10-17.sql'),'-- PARTIAL_NEWER_BACKUP_DUMP\n');
const backupUrl=source('apps/ops/src/backup.ts',{'./activate.js':activateUrl,'./compose.js':composeUrl,'./db.js':dbUrl,'./layout.js':layoutUrl,'./manifest.js':manifestUrl,'./proc.js':procUrl});
const {restore}=await import(backupUrl);const logs=[];sim.dbCalls=[];await restore(backupDir,m=>logs.push(m));
const applied=sim.dbCalls.find(c=>c.db==='seyra_app'&&c.sql.includes('PARTIAL_NEWER_BACKUP_DUMP'));
assert.ok(applied);assert.equal(JSON.parse(fs.readFileSync(l.settingsFile,'utf8')).serverNames,'older.internal');
evidence.checks.push({id:'R5-backup-set',result:'FAIL',mixed_backup_generations_accepted:true,sql_generation:'2026-10-17 (interrupted backup)',state_generation:'2026-10-16 (older complete backup)',database_drop_issued:sim.dbCalls.some(c=>c.sql.startsWith('DROP DATABASE'))});

const output=join(work,'verification.json');fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({...evidence,evidence:output},null,2));
