#!/usr/bin/env node
// Re-run the final R1/R2 regressions against the exact reviewed source and optional old checkout.
// No Docker, VM, LAN, owner data, package installation or live certificate is used.
// Node 24 + OpenSSL + flock. Dependencies are isolated by loading the real TLS dispatcher with
// the same minimal layout adapter as the preceding review; not the full built main.js graph.
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

const current=resolve(process.argv[2]??'.');
const old=process.argv[3]&&resolve(process.argv[3]);
const out=process.argv[4]&&resolve(process.argv[4]);
const work=mkdtempSync(join(tmpdir(),'seyra-final-handoff-review-'));
const rows=[];
const write=(p,s)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,s);};
const safe=s=>String(s??'').split(work).join('<TEMP>').split(current).join('<CURRENT>').split(old??'\u0000').join('<OLD>');
function adapter(repo,label){
  const root=join(work,label),dist=join(root,'apps','ops','dist');mkdirSync(dist,{recursive:true});
  write(join(root,'package.json'),'{"type":"module"}');
  for(const name of ['tls','tls-cli','proc','lifecycle-lock']){
    const src=readFileSync(join(repo,'apps','ops','src',name+'.ts'),'utf8');
    const js=stripTypeScriptTypes(src,{mode:'transform'}).replace(/from '(\.\/[^']+)\.js'/g,"from '$1.mjs'");
    // The sandbox cannot chown to uid 101; select the explicit unprivileged-test branch only.
    write(join(dist,name+'.mjs'),(name==='tls'?'if(process.getuid?.()===0)process.getuid=()=>1000;\n':'')+js);
  }
  const setup=readFileSync(join(repo,'apps','ops','src','setup.ts'),'utf8');
  const at=setup.indexOf('export async function tlsInit(');if(at<0)throw Error('missing legacy initializer');
  write(join(dist,'setup.mjs'),`import{mkdirSync,existsSync,writeFileSync,chmodSync,chownSync}from'node:fs';import{join}from'node:path';import{run}from'./proc.mjs';const layout=()=>({tls:join(process.env.SEYRA_HOME,'secrets','tls')});\n${stripTypeScriptTypes(setup.slice(at),{mode:'transform'})}`);
  write(join(dist,'tls.js'),"export * from './tls.mjs';\n");
  write(join(dist,'main.js'),"import{join}from'node:path';import{tlsCommand}from'./tls-cli.mjs';const h=process.env.SEYRA_HOME,l={tls:join(h,'secrets','tls'),lifecycleLock:join(h,'state','lifecycle.lock'),transitionFile:join(h,'state','transition.json')};if(process.argv[2]!=='tls')throw Error('TLS-only adapter');tlsCommand(l,process.argv.slice(3),console.log).then(code=>process.exit(code),e=>{console.error(e.message);process.exit(1)});\n");
  return root;
}
function run(label,script,target,expect){
  const r=spawnSync(process.execPath,[join(current,script),target],{encoding:'utf8',env:process.env,timeout:55000});
  const counts=/#.*checks=(\d+) failed=(\d+)/.exec(r.stdout);
  const row={label,expected_exit:expect,exit_code:r.status,expected_outcome_observed:expect===0?r.status===0:r.status!==0&&r.status!==null,checks:counts?Number(counts[1]):null,failed:counts?Number(counts[2]):null,stdout:safe(r.stdout),stderr:safe(r.stderr)};
  rows.push(row);process.stdout.write(JSON.stringify({label,exit_code:row.exit_code,checks:row.checks,failed:row.failed,expected_outcome_observed:row.expected_outcome_observed})+'\n');
}
try{
  if(old){
    const a=adapter(old,'old');
    run('R1-before','tests/ops/test-tls-recover.mjs',a,1);
    run('R2-before','tests/client/test-handoff-artifacts.mjs',old,1);
  }
  const a=adapter(current,'current');
  run('R1-after','tests/ops/test-tls-recover.mjs',a,0);
  run('H2-H4-retained','tests/ops/test-tls-cli.mjs',a,0);
  run('R2-after','tests/client/test-handoff-artifacts.mjs',current,0);
}catch(e){rows.push({label:'HARNESS_ERROR',expected_outcome_observed:false,error:safe(e.stack??e)});}
finally{
  const report={node:process.version,scope:'Actual TLS functions/dispatcher, real temporary PKI/kernel flock and actual pack builder. Minimal layout/entry and non-root ownership adapter; no full build, Docker or live host access.',checks_after:rows.filter(x=>x.expected_exit===0).reduce((n,x)=>n+(x.checks??0),0),results:rows};
  if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
  rmSync(work,{recursive:true,force:true});
}
process.exit(rows.length>0&&rows.every(x=>x.expected_outcome_observed)?0:1);
