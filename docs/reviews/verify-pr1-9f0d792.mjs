// Independent, targeted follow-up checks for Seyra PR #1 at 9f0d792.
// Usage: node verify-pr1-9f0d792.mjs /absolute/path/to/checkout
// Linux with util-linux flock and Node 24 required. No Docker/network/database needed.
// Lock code and flock are real; backup/restore code, filesystem, tar and hashes are real.
// SQL/Docker calls and the unrelated release-manifest schema dependency are isolated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { hostname } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const worker=process.argv[2]==='--worker';
const root=resolve(process.argv[worker?3:2]??'.');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
function source(path,imports={}) {
  const js=stripTypeScriptTypes(fs.readFileSync(join(root,path),'utf8'),{mode:'transform',sourceUrl:path});
  return url(js.replace(/from (['"])([^'"]+)\1/g,(m,_q,spec)=>imports[spec]?`from ${JSON.stringify(imports[spec])}`:m));
}
const procUrl=source('apps/ops/src/proc.ts');
const lifecycleUrl=source('apps/ops/src/lifecycle-lock.ts',{'./proc.js':procUrl});
if(worker) {
  const [dir,role,op,pause]=process.argv.slice(4);
  const path=join(dir,'lifecycle.lock');
  const say=s=>fs.writeSync(1,s+'\n');
  let paused=false;
  const block=()=>{if(paused)return;paused=true;say('PAUSED');fs.readSync(0,Buffer.alloc(1),0,1,null);};
  if(pause==='before-unlink') {
    const original=fs.rmSync;
    fs.rmSync=function(p,...args){if(String(p)===path)block();return original(p,...args);};
  } else if(pause==='after-stale-read') {
    const original=fs.readFileSync;
    fs.readFileSync=function(p,...args){const v=original(p,...args);if(String(p)===path&&String(v).includes('crashed-owner'))block();return v;};
  }
  syncBuiltinESMExports();
  const lock=await import(lifecycleUrl);
  try {
    await lock.withLifecycleLock({lifecycleLock:path,transitionFile:join(dir,'transition.json')},op,null,async()=>{
      fs.writeFileSync(join(dir,'inside-'+role),lock.lifecycleLockHeld().token);
      say('HOLDING');await new Promise(r=>process.stdin.once('data',r));
      fs.rmSync(join(dir,'inside-'+role));
    },{pollMs:20});
    process.exit(0);
  } catch(e) {say((/another lifecycle operation/.test(e.message)?'BUSY ':'ERROR ')+e.message);process.exit(3);}
}

const work=fs.mkdtempSync(join(resolve(process.env.SEYRA_REVIEW_TMPDIR??process.cwd()),'seyra-round3-'));
const evidence={reviewed_commit:'9f0d7925eef0d43fc157cdd64b557b962df457a6',node:process.version,checks:[],source_sha256:{},limitations:'Targeted reviewer checks only. Full workspace and Docker/provider/browser/offline suites not repeated by reviewer.'};
for(const p of ['apps/ops/src/lifecycle-lock.ts','apps/ops/src/backup.ts','apps/ops/src/main.ts','infra/dependencies.lock.json'])evidence.source_sha256[p]=createHash('sha256').update(fs.readFileSync(join(root,p))).digest('hex');
const check=(id,detail)=>evidence.checks.push({id,result:'PASS',detail});
const children=[];
function start(dir,role,op='prune',pause='none') {
  const p=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',root,dir,role,op,pause],{stdio:['pipe','pipe','pipe']});
  p.out='';p.err='';p.stdout.on('data',b=>p.out+=b);p.stderr.on('data',b=>p.err+=b);
  p.done=new Promise(r=>p.once('exit',r));children.push(p);return p;
}
async function next(p,offset=0) {
  const end=Date.now()+8000;
  for(;;){const state=p.out.slice(offset).split('\n').find(x=>/^(PAUSED|HOLDING|BUSY|ERROR)/.test(x));if(state)return state;
    if(p.exitCode!==null||Date.now()>end)throw new Error('worker did not reach state: '+p.out+' '+p.err);
    await new Promise(r=>setTimeout(r,5));}
}
async function finish(p){if(p.exitCode===null)p.stdin.end('\n');await p.done;}
function fixture(name,transition=false){const dir=join(work,name);fs.mkdirSync(dir);fs.writeFileSync(join(dir,'lifecycle.lock'),JSON.stringify({pid:2147483647,host:hostname(),op:'activate',target:'ds-b',started_at:'2026-10-17T00:00:00Z',token:'crashed-owner'}));if(transition)fs.writeFileSync(join(dir,'transition.json'),'{}');return dir;}
try {
  for(const pause of ['before-unlink','after-stale-read']) {
    const dir=fixture(pause);const a=start(dir,'a','activate',pause);const afirst=await next(a);
    const b=start(dir,'b');const bfirst=await next(b);
    if(afirst==='PAUSED'){const offset=a.out.length;a.stdin.write('g');await next(a,offset);}
    const inside=fs.readdirSync(dir).filter(n=>n.startsWith('inside-'));
    assert.equal(inside.length,1);assert.equal(bfirst.startsWith('BUSY'),true);
    const record=JSON.parse(fs.readFileSync(join(dir,'lifecycle.lock'),'utf8'));
    assert.equal(record.token,fs.readFileSync(join(dir,inside[0]),'utf8'));
    await finish(a);await finish(b);check('R3-'+pause,'One real process holds the kernel lock; the contender is refused and cannot remove the holder record.');
  }
  const dir=fixture('killed-owner');const a=start(dir,'a','stop');assert.equal(await next(a),'HOLDING');a.kill('SIGKILL');await a.done;
  fs.rmSync(join(dir,'inside-a'));const b=start(dir,'b','start');assert.equal(await next(b),'HOLDING');await finish(b);check('R3-crash-release','SIGKILL automatically releases the real flock; the next process enters.');
  const trans=fixture('unfinished-transition',true);const p=start(trans,'p','prune');assert.match(await next(p),/^ERROR .*recover/);await p.done;
  const r=start(trans,'r','recover');assert.equal(await next(r),'HOLDING');await finish(r);check('R3-transition','A stale owner record plus an unfinished transition refuses prune and admits recover.');
  const lock=await import(lifecycleUrl);const nested=fixture('nested');await lock.withLifecycleLock({lifecycleLock:join(nested,'lifecycle.lock'),transitionFile:join(nested,'transition.json')},'rollback',null,()=>lock.withLifecycleLock({lifecycleLock:join(nested,'lifecycle.lock'),transitionFile:join(nested,'transition.json')},'activate',null,async()=>assert.equal(lock.lifecycleLockHeld().op,'rollback')));check('R3-nested','Nested calls retain the original owner in one async chain.');
} finally {for(const p of children){if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');}await Promise.all(children.map(p=>p.done));}

const layoutUrl=source('apps/ops/src/layout.ts',{'./net.js':source('apps/ops/src/net.ts')});
const L=await import(layoutUrl);
const sim=globalThis.__seyraReview3={generation:1,failArchive:false,calls:[],replay:''};
const composeUrl=url(`export async function composeRuntime(l,args){const s=globalThis.__seyraReview3;if(args.includes('pg_dump'))return {code:0,stderr:'',stdout:'--\\n-- PostgreSQL database dump\\n--\\n-- generation '+s.generation+'\\nCREATE SCHEMA seyra_control;\\n--\\n-- PostgreSQL database dump complete\\n--\\n'};s.calls.push(['compose',args]);return {code:0,stdout:'',stderr:''};}`);
const dbUrl=url(`export async function psql(l,db,sql){const s=globalThis.__seyraReview3;s.calls.push(['sql',db,sql]);if(sql.includes('PostgreSQL database dump'))s.replay=sql;return '6';}export async function waitForDb(){}export async function initDatabase(){return [];}`);
const pointersUrl=url(`import {existsSync,readFileSync} from 'node:fs';export const readPointers=l=>existsSync(l.pointersFile)?JSON.parse(readFileSync(l.pointersFile,'utf8')):{active:null,previous:null};`);
const manifestsUrl=url(`import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';export const readManifest=d=>JSON.parse(readFileSync(d+'/manifest.json','utf8'));export const sha256File=async p=>createHash('sha256').update(readFileSync(p)).digest('hex');`);
const processWrapper=url(`import {run as actual} from ${JSON.stringify(procUrl)};export async function run(cmd,args,opts){if(globalThis.__seyraReview3.failArchive&&cmd==='tar'&&args.includes('state'))throw new Error('injected interruption after SQL');return actual(cmd,args,opts);}`);
const B=await import(source('apps/ops/src/backup.ts',{'./activate.js':pointersUrl,'./compose.js':composeUrl,'./db.js':dbUrl,'./layout.js':layoutUrl,'./manifest.js':manifestsUrl,'./proc.js':processWrapper}));
const hash=b=>createHash('sha256').update(b).digest('hex');
const out=join(work,'backups');
function use(name){process.env.SEYRA_HOME=join(work,name);const l=L.layout();L.ensureDirs(l);for(const key of B.REQUIRED_SECRETS)fs.writeFileSync(join(l.secrets,key),'review-placeholder');return l;}
const src=use('source');fs.writeFileSync(src.pointersFile,JSON.stringify({active:'ds-a',previous:null}));
const rel=join(src.releases,'ds-a');fs.mkdirSync(join(rel,'source'),{recursive:true});const pbf=join(rel,'source/input.osm.pbf');fs.writeFileSync(pbf,'local synthetic source bytes');
fs.writeFileSync(join(rel,'manifest.json'),JSON.stringify({dataset_id:'ds-a',source:{filename:'input.osm.pbf',size_bytes:fs.statSync(pbf).size,sha256:hash(fs.readFileSync(pbf)),managed_copy:pbf,snapshot_timestamp:'2026-10-01T00:00:00Z',snapshot_timestamp_source:'operator'}}));
async function backup(generation,includeSources){process.env.SEYRA_HOME=src.home;sim.generation=generation;fs.writeFileSync(src.settingsFile,JSON.stringify({...L.DEFAULT_SETTINGS,serverNames:'generation'+generation+'.internal'}));fs.writeFileSync(src.historyFile,JSON.stringify({generation})+'\n');return B.backup(out,{includeSources,log(){}});}
const gen1=await backup(1,false);await new Promise(r=>setTimeout(r,5));const gen2=await backup(2,true);
sim.failArchive=true;await assert.rejects(backup(3,true),/interruption/);sim.failArchive=false;
const partial=join(out,'.seyra-backup-29991231T000000000Z-ffffff.partial');fs.mkdirSync(partial);fs.writeFileSync(join(partial,'seyra_app.sql'),'newer interrupted SQL');
use('destination-newest');sim.calls=[];const logs=[];await B.restore(out,m=>logs.push(m));assert.match(sim.replay,/generation 2/);assert.equal(JSON.parse(fs.readFileSync(L.layout().settingsFile,'utf8')).serverNames,'generation2.internal');assert.ok(logs.some(m=>m.includes('ignoring incomplete')));check('R5-generation-selection','Two real generated sets plus an interrupted attempt: newest complete set restores matching SQL/settings; partial output ignored.');
use('destination-explicit');sim.calls=[];await B.restore(out,()=>{},{generation:basename(gen1)});assert.match(sim.replay,/generation 1/);assert.equal(JSON.parse(fs.readFileSync(L.layout().settingsFile,'utf8')).serverNames,'generation1.internal');check('R5-explicit-generation','An explicitly selected older generation restores its own SQL and settings.');
const mf=JSON.parse(fs.readFileSync(join(gen2,'backup-manifest.json'),'utf8'));
for(const [label,change,reason] of [
 ['missing-sql',d=>fs.rmSync(join(d,'seyra_app.sql')),/is missing/],
 ['corrupt-sql',d=>{const p=join(d,'seyra_app.sql');const b=fs.readFileSync(p);b[10]^=255;fs.writeFileSync(p,b);},/SHA-256/],
 ['missing-state',d=>fs.rmSync(join(d,'state.tar.gz')),/is missing/],
 ['corrupt-manifests',d=>{const p=join(d,'manifests.tar.gz');const b=fs.readFileSync(p);b[10]^=255;fs.writeFileSync(p,b);},/SHA-256/],
 ['missing-source',d=>fs.rmSync(join(d,'sources/ds-a.osm.pbf')),/is missing/],
 ['corrupt-source',d=>{const p=join(d,'sources/ds-a.osm.pbf');const b=fs.readFileSync(p);b[0]^=255;fs.writeFileSync(p,b);},/SHA-256/],
 ['missing-completion',d=>fs.rmSync(join(d,'backup-manifest.json')),/no complete backup generation/],
 ['unlisted-file',d=>fs.writeFileSync(join(d,'extra.sql'),'extra'),/unlisted files/],
 ['incomplete-dump-with-matching-hash',d=>{const p=join(d,'seyra_app.sql');const text='--\n-- PostgreSQL database dump\n-- no trailer\n';fs.writeFileSync(p,text);const m=JSON.parse(fs.readFileSync(join(d,'backup-manifest.json'),'utf8'));const f=m.files.find(x=>x.role==='control-db');f.size=Buffer.byteLength(text);f.sha256=hash(text);fs.writeFileSync(join(d,'backup-manifest.json'),JSON.stringify(m));},/complete pg_dump/],
]) {
  const parent=join(work,'damaged-'+label);fs.mkdirSync(parent);const d=join(parent,basename(gen2));fs.cpSync(gen2,d,{recursive:true});change(d);
  const dst=use('dst-'+label);const prior=JSON.stringify({...L.DEFAULT_SETTINGS});fs.writeFileSync(dst.settingsFile,prior);sim.calls=[];
  await assert.rejects(B.restore(d,()=>{}),reason);assert.equal(sim.calls.length,0);assert.equal(fs.readFileSync(dst.settingsFile,'utf8'),prior);check('R5-'+label,'Rejected before any Docker/SQL call; destination settings unchanged.');
}
const legacy=join(work,'legacy');fs.mkdirSync(legacy);fs.writeFileSync(join(legacy,'seyra_app-2026-10-17.sql'),'newer SQL');fs.copyFileSync(join(gen1,'state.tar.gz'),join(legacy,'state-2026-10-16.tar.gz'));fs.copyFileSync(join(gen1,'manifests.tar.gz'),join(legacy,'manifests-2026-10-16.tar.gz'));use('dst-legacy');sim.calls=[];await assert.rejects(B.restore(legacy,()=>{}),/older backup layout/);assert.equal(sim.calls.length,0);check('R5-legacy-mix','The previously reproduced mixed flat layout is refused before any Docker/SQL call.');
assert.equal(mf.files.length,5);check('R5-published-set','Actual backup output includes checksummed SQL, state, manifests, source and source metadata in one published directory.');
const file=join(work,'verification.json');fs.writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({...evidence,evidence:file},null,2));
