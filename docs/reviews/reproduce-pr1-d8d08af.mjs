// Isolated reviewer checks for Seyra PR #1 at d8d08af. No Docker or network access.
// Loads the actual TypeScript under review with Node's built-in type transformer.
// External provider/process operations are stubbed; checked control-flow stays unchanged.
// This asserts PRE-FIX defects, not desired behavior. Failed assertions after a fix are expected.
// Usage (Node 24): node --disable-warning=ExperimentalWarning reproduce-pr1-d8d08af.mjs /path/to/pinned/checkout
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const work = mkdtempSync(join(resolve(process.env.SEYRA_REVIEW_TMPDIR ?? process.cwd()), 'seyra-review-repro-'));
const url = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
function source(path, imports = {}) {
  const js = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'), { mode: 'transform', sourceUrl: path });
  return url(js.replace(/from (['"])([^'"]+)\1/g, (m, q, spec) => imports[spec] ? `from ${JSON.stringify(imports[spec])}` : m));
}
const layoutUrl = source('apps/ops/src/layout.ts');
const layouts = await import(layoutUrl);
const output = { reviewed_commit: 'd8d08afa7316ba33740932d8f129b8c5ae0f4e2c', checks: [] };

// R1: loopback mode plus a public bind is accepted without a LAN allowlist.
const unsafeSettings = { ...layouts.DEFAULT_SETTINGS, accessMode: 'loopback', bindAddr: '0.0.0.0', lanCidrs: '' };
assert.doesNotThrow(() => layouts.validateSettings(unsafeSettings));
output.checks.push({ id: 'R1', reproduced: true, accepted_mode: unsafeSettings.accessMode, accepted_bind: unsafeSettings.bindAddr, allowlist: unsafeSettings.lanCidrs });

// R2/R3: keep actual activate/prune implementation and local filesystem operations;
// stub image inspection, checksums and Docker/SQL solely to avoid external side effects.
const state = globalThis.__seyraReviewer = { calls: [], l: null, manifest: null, failUp: true };
const compose = url(`
import {writeFileSync} from 'node:fs';
export const NO_RELEASE='none';
export function runtimeEnv(l,s,images,dataset){ return {dataset}; }
export function writeRuntimeEnv(l,env){ writeFileSync(l.runtimeEnv,JSON.stringify(env)); }
export async function composeRuntime(l,args){
 const s=globalThis.__seyraReviewer; s.calls.push(args);
 if(args[0]==='up' && s.failUp) throw new Error('injected compose up failure');
 return {code:0,stdout:'',stderr:''};
}`);
const db = url(`
export function renderDbName(id){return 'render_'+id.replaceAll('-','_');}
export async function psql(l,db,sql){globalThis.__seyraReviewer.calls.push(['sql',sql]);return globalThis.__seyraReviewer.manifest.dataset_id;}
export async function recordEvent(){}`);
const layoutProxy = url(`export * from ${JSON.stringify(layoutUrl)}; export function layout(){return globalThis.__seyraReviewer.l;}`);
const lock = url(`export function lockedImages(){return [];} export async function verifyImages(){return [];}`);
const photon = url(`export const PHOTON_OPENSEARCH_SETTINGS=['fixture-watermark'];`);
const manifest = url(`
export const DATA_COMPONENT_ROLES=[];
export function readManifest(){return globalThis.__seyraReviewer.manifest;}
export async function treeDigest(){return {sha256:'fixture'};}
export async function sha256File(){return 'fixture';}
export function sha256Text(){return 'fixture';}`);
const activate = await import(source('apps/ops/src/activate.ts', {
 './compose.js': compose, './db.js': db, './layout.js': layoutProxy,
 './lock.js': lock, './photon-config.js': photon, './manifest.js': manifest,
}));
function fixture(name) {
 const home=join(work,name); const fs=join(home,'state');
 const l={home,install:join(home,'install'),releases:join(home,'releases'),work:join(home,'work'),
 state:fs,active:join(fs,'active'),previous:join(fs,'previous'),flags:join(fs,'flags'),
 cache:join(home,'cache'),pointersFile:join(fs,'pointers.json'),runtimeEnv:join(fs,'runtime.env'),
 historyFile:join(fs,'history.jsonl'),settingsFile:join(fs,'settings.json'),importLock:join(fs,'import.lock')};
 for(const p of [l.active,l.previous,l.flags,l.releases,l.work,join(l.cache,'tiles')]) mkdirSync(p,{recursive:true});
 writeFileSync(l.pointersFile,JSON.stringify({active:'ds-a',previous:null}));
 writeFileSync(l.runtimeEnv,'old-runtime');
 writeFileSync(join(l.active,'release.json'),JSON.stringify({dataset_id:'ds-a'}));
 return l;
}
state.l=fixture('activation');
const target=join(state.l.releases,'ds-b');
for(const d of ['geocoder','photon/photon_data/node_1/config','tegola']) mkdirSync(join(target,d),{recursive:true});
writeFileSync(join(target,'geocoder/photon-import.jsonl'),'fixture');
writeFileSync(join(target,'photon/photon_data/node_1/config/opensearch.yml'),'fixture-watermark');
writeFileSync(join(target,'tegola/tegola.toml'),'fixture');
state.manifest={dataset_id:'ds-b',status:'validated',identities:{},components:{},
 source:{managed_copy:'fixture',sha256:'fixture'},artifacts:{routing:{sha256:'fixture'},overpass:{sha256:'fixture'},maps:{sha256:'fixture'},geocoder:{import_sha256:'fixture'},render:{tegola_config_sha256:'fixture'}}};
await assert.rejects(activate.activate('ds-b',{log(){}}),/injected compose up failure/);
const after=JSON.parse(readFileSync(join(state.l.active,'release.json'),'utf8'));
assert.equal(after.dataset_id,'ds-b');
assert.equal(JSON.parse(readFileSync(state.l.pointersFile,'utf8')).active,'ds-a');
assert.ok(existsSync(join(state.l.flags,'maintenance')));
assert.equal(state.calls.filter(c=>c[0]==='up').length,1);
output.checks.push({id:'R2',reproduced:true,active_descriptor:after.dataset_id,pointer:'ds-a',maintenance:true,recovery_up_calls:0});

state.l=fixture('prune'); state.calls=[]; state.failUp=false;
const building=join(state.l.releases,'ds-building');
mkdirSync(building,{recursive:true});
writeFileSync(join(building,'manifest.json'),JSON.stringify({dataset_id:'ds-building',status:'building'}));
writeFileSync(state.l.importLock,'live-import-test-lock');
const removed=await activate.prune(()=>{});
assert.ok(removed.includes('ds-building'));
assert.equal(existsSync(building),false);
assert.ok(existsSync(state.l.importLock));
output.checks.push({id:'R3',reproduced:true,pruned:removed,import_lock_present:true,render_db_drop_issued:state.calls.some(c=>c[0]==='sql'&&c[1].includes('DROP DATABASE'))});

// R4: the actual provider gate admits requests before a first successful identity
// check, and continues admitting them when that provider's check is unavailable.
const contracts=url(`
export const PROVIDER_IDS=['tiles','routing','geocoder','overpass'];
export class MapServiceError extends Error {constructor(code,message,opts){super(message);this.code=code;this.opts=opts;}}
`);
const release=url(`export const tegolaMapName=id=>'seyra_'+id.replaceAll('-','_');export const geocoderMarkerName=id=>'seyra-release-'+id;`);
const {HealthService}=await import(source('apps/api/src/services/health.ts',{'@seyra/contracts':contracts,'../release.js':release}));
const health=new HealthService({dataset_id:'ds-a',identities:{tiles:'tiles-a',routing:'routing-a',geocoder:'geocoder-a',overpass:'overpass-a'}},
 {tiles:async()=>({identity:'tiles-a'}),routing:async()=>{throw new Error('status probe unavailable');},geocoder:async()=>({identity:'geocoder-a'}),overpass:async()=>({identity:'overpass-a'}),controlDb:async()=>{}},
 {cacheMs:5000,probeTimeoutMs:50,maintenanceFlagFile:join(work,'absent-maintenance')});
assert.doesNotThrow(()=>health.gate('routing'));
const readiness=await health.readiness();
assert.equal(readiness.providers.find(p=>p.provider==='routing').status,'unavailable');
assert.doesNotThrow(()=>health.gate('routing'));
output.checks.push({id:'R4',reproduced:true,admitted_before_initial_probe:true,provider_status:'unavailable',admitted_after_failed_probe:true});
const evidence=join(work,'review-reproductions.json');
writeFileSync(evidence,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({...output,evidence},null,2));
