#!/usr/bin/env node
// Independent review of actual VM scripts plus source-backed Windows obligations.
// No VM, Windows certificate store, Docker daemon, owner key or live endpoint is touched.
// Usage: node verify-lan-pki-f5bd978.mjs <candidate-tree> <d570074-tree> <step-0.31.0-linux> [report.json]
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,rmSync,copyFileSync,readdirSync,statSync} from 'node:fs';
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
  put(backend,`import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,appendFileSync}from'node:fs';import{join}from'node:path';
const a=process.argv.slice(2);appendFileSync(process.env.REVIEW_DOCKER_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='image'&&a[1]==='inspect'){console.log(process.env.REVIEW_OPS_ID);process.exit(0);}
if(a[0]!=='run')process.exit(97);
if(process.env.REVIEW_DOCKER_MODE==='fail-after-ok'){console.log('OK fixture validation output before container failure');process.exit(42);}
const mounts=new Map();for(let i=0;i<a.length;i++)if(a[i]==='-v'){const [src,dst]=a[++i].split(':');mounts.set(dst,src);}
const entry=a[a.indexOf('--entrypoint')+1];let r;
if(entry==='sh'){
 const root=mounts.get('/w'),path=a.at(-1).replace('/w',root),body=readFileSync(path,'utf8').replaceAll('/w',root);
 const host=join(root,'pki','build.host.sh');writeFileSync(host,body,{mode:0o600});r=spawnSync('sh',[host],{stdio:'inherit',env:process.env});
}else if(entry==='node'){
 let code=a[a.indexOf('-e')+1].replace('/opt/seyra/apps/ops/dist/tls.js',process.env.REVIEW_TLS_MODULE);
 for(const [dst,src]of mounts)code=code.split(dst).join(src);
 r=spawnSync(process.execPath,['--input-type=module','-e',code],{stdio:'inherit',env:process.env});
}else process.exit(98);
process.exit(r.status??99);`);
  put(join(bin,'docker'),`#!/bin/sh\nexec ${q(process.execPath)} ${q(backend)} "$@"\n`,0o755);
  const boundaryEnv={...env,PATH:`${bin}:${env.PATH}`,REVIEW_DOCKER_LOG:join(w,'docker.log'),REVIEW_OPS_ID:'sha256:review-boundary',REVIEW_TLS_MODULE:join(dist,'tls.mjs')};
  const author=run('bash',[join(candidate,'tests/tls/test-lan-pki-vm.sh')],{env:{...boundaryEnv,STEP_LINUX:step,DOCKER_RUN_IMAGE:'review/host-step',OPS_IMAGE:'review/ops',OPS_IMAGE_ID:boundaryEnv.REVIEW_OPS_ID}});
  const match=/# lan-pki vm side: checks=(\d+) failed=(\d+)/.exec(author.stdout);
  row('submitted-vm-suite-host-adapter',author.status===0,{exit_code:author.status,checks:match?+match[1]:null,failed:match?+match[2]:null,stdout:clean(author.stdout),stderr:clean(author.stderr),summary:{exit_code:author.status,checks:match?+match[1]:null,failed:match?+match[2]:null}});
  const csrScript=join(candidate,'infra/tls/lan-pki/new-server-csr.sh');
  const checker=join(candidate,'infra/tls/lan-pki/check-returned-packet.sh');
  const req=join(w,'req');must('bash',[csrScript,req,'198.18.0.76']);
  const key=join(req,'server/server.key'),rq=join(req,'to-windows'),pki=join(w,'pki');mkdirSync(pki);
  put(join(pki,'pw.root'),'review-only-root\n');put(join(pki,'pw.int'),'review-only-int\n');
  must(step,['certificate','create','Review Root',join(pki,'root_ca.crt'),join(pki,'root_ca.key'),'--profile','root-ca','--kty','EC','--curve','P-256','--not-after','43800h','--password-file',join(pki,'pw.root')]);
  must(step,['certificate','create','Review Issuing',join(pki,'intermediate_ca.crt'),join(pki,'intermediate_ca.key'),'--profile','intermediate-ca','--ca',join(pki,'root_ca.crt'),'--ca-key',join(pki,'root_ca.key'),'--ca-password-file',join(pki,'pw.root'),'--kty','EC','--curve','P-256','--not-after','8760h','--password-file',join(pki,'pw.int')]);
  put(join(pki,'server.crt'),must(step,['certificate','sign',join(rq,'server.csr'),join(pki,'intermediate_ca.crt'),join(pki,'intermediate_ca.key'),'--template',join(candidate,'infra/tls/lan-pki/windows/server-leaf.tpl'),'--set','ip=198.18.0.76','--not-before','-5m','--not-after','2160h','--password-file',join(pki,'pw.int')]));
  must(step,['certificate','format',join(pki,'root_ca.crt'),'--out',join(pki,'root_ca.cer')]);
  function packet(name){const d=join(w,name);mkdirSync(d);const files={};for(const f of ['server.crt','intermediate_ca.crt','root_ca.crt','root_ca.cer']){copyFileSync(join(pki,f),join(d,f));files[f]=sha(readFileSync(join(d,f)));}put(join(d,'issued-manifest.json'),JSON.stringify({schema:'seyra.lan-issued/1',request:{csr_file_sha256:sha(readFileSync(join(rq,'server.csr')))},root_ca:{sha256_fingerprint:files['root_ca.cer']},files_sha256:files}));return d;}
  function check(d,e=boundaryEnv,args=[]){return run('bash',[checker,d,rq,key,'review/ops',boundaryEnv.REVIEW_OPS_ID,...args],{env:e});}
  const good=packet('good'),g=check(good);
  row('valid-packet-positive-control',g.status===0,{exit_code:g.status,stdout:clean(g.stdout),stderr:clean(g.stderr)});
  const bad=packet('bad-hash'),bm=JSON.parse(readFileSync(join(bad,'issued-manifest.json')));bm.files_sha256['server.crt']='00';put(join(bad,'issued-manifest.json'),JSON.stringify(bm));
  const b=check(bad);row('bad-hash-negative-control',b.status!==0,{exit_code:b.status,stdout:clean(b.stdout)});
  const fifo=packet('unlisted-fifo');must('mkfifo',[join(fifo,'unexpected.fifo')]);
  const fr=run('timeout',['--kill-after=1s','2s','bash',checker,fifo,rq,key,'review/ops',boundaryEnv.REVIEW_OPS_ID],{env:boundaryEnv,timeout:6000});
  row('R3-packet-FIFO-blocks-after-rejection',fr.status===124||fr.status===137,{exit_code:fr.status,stdout:clean(fr.stdout),stderr:clean(fr.stderr),summary:{exit_code:fr.status}});
  const failedValidator=check(good,{...boundaryEnv,REVIEW_DOCKER_MODE:'fail-after-ok'});
  row('R3-validator-nonzero-exit-accepted',failedValidator.status===0,{exit_code:failedValidator.status,stdout:clean(failedValidator.stdout),stderr:clean(failedValidator.stderr),summary:{exit_code:failedValidator.status}});
  const brokenBin=join(w,'broken-bin');mkdirSync(brokenBin);put(join(brokenBin,'jq'),'#!/bin/sh\necho "injected jq failure" >&2\nexit 42\n',0o755);
  const jqReq=join(w,'jq-failure'),jr=run('bash',[csrScript,jqReq,'198.18.0.76'],{env:{...env,PATH:`${brokenBin}:${env.PATH}`}});
  row('R4-CSR-manifest-failure-reported-success',jr.status===0&&statSync(join(jqReq,'to-windows/request-manifest.json')).size===0,{exit_code:jr.status,manifest_size:statSync(join(jqReq,'to-windows/request-manifest.json')).size,stdout:clean(jr.stdout),stderr:clean(jr.stderr),summary:{exit_code:jr.status,manifest_size:statSync(join(jqReq,'to-windows/request-manifest.json')).size}});
  const acl=readFileSync(join(candidate,'infra/tls/lan-pki/windows/New-PkiFolder.ps1'),'utf8');
  row('R1-ACL-source-obligation',/icacls\.exe \$Base \/inheritance:r \/grant:r/.test(acl)&&/Get-Acl -LiteralPath \$Base/.test(acl),{scope:'Source review, NOT actual Windows/NTFS execution',detail:'The sole Get-Acl checks Base, while icacls changes inherited entries plus the named owner grant. Existing foreign explicit child ACEs are neither enumerated nor refused.'});
  const trust=readFileSync(join(candidate,'infra/tls/lan-pki/windows/Add-RootTrust.ps1'),'utf8');
  row('R2-trust-record-source-obligation',trust.indexOf('Import-Certificate -FilePath')<trust.indexOf('Write-SeyraUtf8 $record')&&!/pending|journal|finally/.test(trust),{scope:'Source review, NOT actual Windows certificate-store execution',detail:'No pre-import durable ownership record; if import succeeds then final record write fails/dies, retry labels the new root pre_existing and undo refuses it.'});
}catch(e){row('HARNESS_ERROR',false,{error:clean(e.stack)});}
finally{
  const report={node:process.version,scope:'Actual added Bash scripts, pinned Linux step and retained real TLS validation with Docker/image/namespace adapter. Windows ACL/trust findings are explicitly source-backed; no Windows execution claimed.',results:rows};
  if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
  rmSync(w,{recursive:true,force:true});
}
process.exit(rows.length&&rows.every(x=>x.observed)?0:1);
