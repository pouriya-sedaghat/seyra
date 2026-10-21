#!/usr/bin/env node
// Independent follow-up review: actual corrected VM scripts and explicit host adapters.
// No VM, Windows certificate store, Docker daemon, owner key or live endpoint is touched.
// Usage: node verify-lan-pki-f4bd578.mjs <candidate-tree> <d570074-tree> <step-0.31.0-linux> [report.json]
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,rmSync,copyFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
const [candidateArg,baselineArg,stepArg,outArg]=process.argv.slice(2);
if(!candidateArg||!baselineArg||!stepArg)throw Error('candidate, baseline and pinned step required');
const candidate=resolve(candidateArg),baseline=resolve(baselineArg),step=resolve(stepArg);
const out=outArg&&resolve(outArg),w=mkdtempSync(join(tmpdir(),'seyra-pki-review-')),rows=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const clean=s=>String(s??'').split(w).join('<TEMP>').split(candidate).join('<CANDIDATE>').split(baseline).join('<BASELINE>');
function put(p,t,mode=0o600){mkdirSync(dirname(p),{recursive:true});writeFileSync(p,t,{mode});}
const env={...process.env,TMPDIR:w,STEPPATH:join(w,'step-home')};
function run(cmd,args,more={}){return spawnSync(cmd,args,{encoding:'utf8',timeout:60000,maxBuffer:4e6,env,...more});}
function must(cmd,args,more={}){const r=run(cmd,args,more);if(r.status!==0)throw Error(`${cmd} failed: ${r.status}\n${r.stdout}\n${r.stderr}`);return r.stdout;}
function row(label,observed,extra={}){const r={label,observed,...extra};rows.push(r);console.log(JSON.stringify({label,observed,...extra.summary}));return r;}
try{
  const version=must(step,['version']);
  if(!version.includes('Smallstep CLI/0.31.0'))throw Error('Wrong step version');
  const dist=join(w,'adapter');mkdirSync(dist);
  for(const name of ['tls','proc']){
    const ts=readFileSync(join(baseline,'apps/ops/src',name+'.ts'),'utf8');
    put(join(dist,name+'.mjs'),stripTypeScriptTypes(ts,{mode:'transform'}).replaceAll("'./proc.js'","'./proc.mjs'"));
  }
  // Only the Docker boundary is adapted. The actual build script is run by host sh, and the
  // actual retained validateProposedCertificate implementation runs in Node with its own OpenSSL.
  // Image identity strings are recorder responses, not independently inspected image evidence.
  const bin=join(w,'bin');mkdirSync(bin);
  const backend=join(w,'docker-recorder.mjs');
  put(backend,`import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,appendFileSync,existsSync}from'node:fs';import{join}from'node:path';
const a=process.argv.slice(2);appendFileSync(process.env.REVIEW_DOCKER_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='image'&&a[1]==='inspect'){console.log(process.env.REVIEW_OPS_ID);process.exit(0);}
if(a[0]!=='run')process.exit(97);
if(process.env.REVIEW_DOCKER_MODE==='fail-after-ok'){console.log('OK fixture validation output before container failure');process.exit(42);}
const mounts=new Map();for(let i=0;i<a.length;i++)if(a[i]==='-v'){const [src,dst]=a[++i].split(':');mounts.set(dst,src);}
const entry=a[a.indexOf('--entrypoint')+1];let r;
if(entry==='sh'){
 const root=mounts.get('/w'),path=a.at(-1).replace('/w',root),body=readFileSync(path,'utf8').replaceAll('/w',root);
 const host=join(root,'pki','build.host.sh');writeFileSync(host,body,{mode:0o600});r=spawnSync('sh',[host],{stdio:'inherit',env:process.env});
}else if(entry==='mknod'){
 const target=a[a.indexOf('--entrypoint')+3].replace('/p',mounts.get('/p'));
 r=spawnSync('mknod',[target,'c','1','3'],{stdio:'inherit',env:process.env});
 appendFileSync(process.env.REVIEW_DOCKER_LOG,JSON.stringify({event:'mknod-fixture',exit_code:r.status,target_exists:existsSync(target)})+'\\n');
}else if(entry==='node'){
 let code=a[a.indexOf('-e')+1].replace('/opt/seyra/apps/ops/dist/tls.js',process.env.REVIEW_TLS_MODULE);
 for(const [dst,src]of mounts)code=code.split(dst).join(src);
 r=spawnSync(process.execPath,['--input-type=module','-e',code],{stdio:'inherit',env:process.env});
}else process.exit(98);
process.exit(r.status??99);`);
  put(join(bin,'docker'),`#!/bin/sh\nexec ${q(process.execPath)} ${q(backend)} "$@"\n`,0o755);
  const csrScript=join(candidate,'infra/tls/lan-pki/new-server-csr.sh');
  const native=run('bash',[csrScript,join(w,'native-openssl-request'),'198.18.0.76']);
  row('native-openssl-3.0-subject-format',native.status!==0&&native.stderr.includes('CSR subject is not'),{exit_code:native.status,scope:'Compatibility observation; current VM uses OpenSSL 3.5.5',stdout:clean(native.stdout),stderr:clean(native.stderr)});
  put(join(bin,'openssl'),`#!/bin/bash\nfor x in "$@"; do if [ "$x" = -subject ] && [ "$1" = req ]; then exec /usr/bin/openssl "$@" -nameopt RFC2253; fi; done\nexec /usr/bin/openssl "$@"\n`,0o755);
  const boundaryEnv={...env,PATH:`${bin}:${env.PATH}`,REVIEW_DOCKER_LOG:join(w,'docker.log'),REVIEW_OPS_ID:'sha256:review-boundary',REVIEW_TLS_MODULE:join(dist,'tls.mjs')};
  const author=run('bash',[join(candidate,'tests/tls/test-lan-pki-vm.sh')],{env:{...boundaryEnv,STEP_LINUX:step,DOCKER_RUN_IMAGE:'review/host-step',OPS_IMAGE:'review/ops',OPS_IMAGE_ID:boundaryEnv.REVIEW_OPS_ID},timeout:110000});
  const match=/# lan-pki vm side: checks=(\d+) failed=(\d+)/.exec(author.stdout);
  const failures=author.stdout.split('\n').filter(s=>s.startsWith('FAIL '));
  const platformOnly=failures.length===2&&failures.every(s=>s.includes('unix socket'));
  row('submitted-vm-suite-with-explicit-host-adapters',author.status===0||platformOnly,{exit_code:author.status,checks:match?+match[1]:null,failed:match?+match[2]:null,unexercised_assertions:4,supported_checks:55,platform_only_failures:platformOnly,stdout:clean(author.stdout),stderr:clean(author.stderr),summary:{exit_code:author.status,checks:match?+match[1]:null,failed:match?+match[2]:null}});
  const log=readFileSync(join(w,'docker.log'),'utf8');
  const device=log.split('\n').filter(x=>x.includes('mknod-fixture'));
  row('device-fixture-coverage-observation',device.length>0,{events:device.map(clean),detail:'Host mknod is not permitted; this records whether the stock test checks fixture creation. Do not count a missing file as a real character-device test.'});
  const req=join(w,'good-request');
  must('bash',[csrScript,req,'198.18.0.76'],{env:boundaryEnv});
  const chk=run('bash',[csrScript,'--check',req],{env:boundaryEnv});
  row('correct-request-check',chk.status===0,{exit_code:chk.status,stdout:clean(chk.stdout),stderr:clean(chk.stderr)});
  const badBin=join(w,'bad-jq');mkdirSync(badBin);put(join(badBin,'jq'),'#!/bin/sh\nexit 42\n',0o755);
  const badReq=join(w,'bad-request'),r=run('bash',[csrScript,badReq,'198.18.0.76'],{env:{...boundaryEnv,PATH:`${badBin}:${boundaryEnv.PATH}`}});
  row('R4-jq-failure-not-published',r.status!==0&&!existsSync(join(badReq,'to-windows'))&&!r.stdout.includes('READY'),{exit_code:r.status,ready_directory_exists:existsSync(join(badReq,'to-windows')),stdout:clean(r.stdout),stderr:clean(r.stderr)});
  const add=readFileSync(join(candidate,'infra/tls/lan-pki/windows/Add-RootTrust.ps1'),'utf8');
  const module=readFileSync(join(candidate,'infra/tls/lan-pki/windows/SeyraPki.psm1'),'utf8');
  row('F1-root-import-source-obligation',add.includes('Add-SeyraRootStoreEntry $RootCer')&&module.includes('[IO.File]::ReadAllBytes($CerPath)'),{scope:'SOURCE FINDING, not Windows or PowerShell execution',detail:'The checked certificate is discarded at the store boundary, which reopens the mutable input path. A changed path can install root B while checks and journal still refer to A.'});
  const accept=readFileSync(join(candidate,'tests/tls/windows/Test-LanPkiOnWindows.ps1'),'utf8');
  row('F2-acceptance-cleanup-source-obligation',accept.indexOf('if (& $inStore) { Write-Host "CLEANUP NEEDED:')>=0&&accept.indexOf('Remove-Item -LiteralPath $T -Recurse -Force')>accept.indexOf('CLEANUP NEEDED:'),{scope:'SOURCE FINDING, not actual Windows store execution',detail:'A failed/refused test-root removal still reaches recursive deletion of the folder containing its recovery record.'});
}catch(e){row('HARNESS_ERROR',false,{error:clean(e.stack)});}
finally{
  const report={node:process.version,scope:'Actual added Bash scripts, real Linux Step 0.31.0/OpenSSL and retained TLS validation; Docker/image boundary and explicit OpenSSL subject-format adapter. No Windows/NTFS/store or actual image validation performed.',results:rows};
  if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
  rmSync(w,{recursive:true,force:true});
}
process.exit(rows.length&&rows.every(x=>x.observed)?0:1);
