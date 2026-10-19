#!/usr/bin/env node
// Independent review of the corrected handoff source. No Docker/VM/production input is used.
// Node 24, OpenSSL and flock. TLS source is transformed with Node's built-in TS transform only;
// tlsCommand is the real dispatch function. A tiny adapter supplies its three layout fields.
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repo=resolve(process.argv[2]??'.'),out=process.argv[3]&&resolve(process.argv[3]);
const w=mkdtempSync(join(tmpdir(),'seyra-e6-review-'));
const results=[];
const add=(id,observed)=>results.push({id,...observed});
const write=(p,s,mode=0o600)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,s,{mode});};
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const ossl=(...a)=>execFileSync('openssl',a,{stdio:['ignore','pipe','pipe']}).toString();
const safe=s=>String(s).split(w).join('<TEMP>').split(repo).join('<CHECKOUT>');
try {
  const m=join(w,'adapter','apps','ops','dist');mkdirSync(m,{recursive:true});
  write(join(w,'adapter','package.json'),'{"type":"module"}');
  for(const name of ['tls','tls-cli','proc','lifecycle-lock']){
    let src=readFileSync(join(repo,'apps','ops','src',name+'.ts'),'utf8');
    src=stripTypeScriptTypes(src,{mode:'transform'}).replace(/from '(\.\/[^']+)\.js'/g,"from '$1.mjs'");
    write(join(m,name+'.mjs'),src);
  }
  // Keep the real legacy initializer too; its layout() uses only tls here. The provided TLS test
  // does not invoke it. Other setup/import/database functions are not loaded by this adapter.
  const setup=readFileSync(join(repo,'apps','ops','src','setup.ts'),'utf8');
  const legacy=setup.slice(setup.indexOf('export async function tlsInit('));
  const legacyJs=stripTypeScriptTypes(legacy,{mode:'transform'});
  write(join(m,'setup.mjs'),`import{mkdirSync,existsSync,writeFileSync,chmodSync,chownSync}from'node:fs';import{join}from'node:path';import{run}from'./proc.mjs';const layout=()=>({tls:join(process.env.SEYRA_HOME,'secrets','tls')});\n${legacyJs}`);
  // Same TLS dispatch used by main.ts. Ownership adapter selects the module's explicit non-root
  // branch because this sandbox cannot chown to uid 101. No TLS/file/lock result is stubbed.
  write(join(m,'main.js'),`import{join}from'node:path';import{tlsCommand}from'./tls-cli.mjs';if(process.getuid?.()===0)process.getuid=()=>1000;const h=process.env.SEYRA_HOME,l={tls:join(h,'secrets','tls'),lifecycleLock:join(h,'state','lifecycle.lock'),transitionFile:join(h,'state','transition.json')};if(process.argv[2]!=='tls')throw Error('TLS-only adapter');tlsCommand(l,process.argv.slice(3),console.log).then(code=>process.exit(code),e=>{console.error(e.message);process.exit(1)});`);
  const regression=spawnSync(process.execPath,[join(repo,'tests','ops','test-tls-cli.mjs'),join(w,'adapter')],{env:process.env,encoding:'utf8',timeout:55000});
  add('H2-H4-existing-TLS-dispatch-regression',{exit_code:regression.status,output:safe(regression.stdout),stderr:safe(regression.stderr),adapter:'Actual tlsCommand/tls/proc/flock; minimal layout/dispatch and non-root ownership adapter; not the full built main.js dependency graph'});

  const tls=await import(pathToFileURL(join(m,'tls.mjs')));
  if(process.getuid?.()===0)process.getuid=()=>1000;
  const pki=join(w,'pki');mkdirSync(pki);
  const f=n=>join(pki,n);
  for(const n of ['a','b']){
    ossl('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',f(n+'.key'),'-out',f(n+'.crt'),'-days','2','-subj','/CN=review-root-'+n,'-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
  }
  ossl('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',f('leaf.key'),'-out',f('leaf.csr'),'-subj','/CN=maps.example.test');
  write(f('leaf.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:maps.example.test\n');
  ossl('x509','-req','-in',f('leaf.csr'),'-CA',f('a.crt'),'-CAkey',f('a.key'),'-CAcreateserial','-out',f('leaf.crt'),'-days','1','-extfile',f('leaf.ext'));
  const dir=join(w,'recover-tls'),p={dir};
  await tls.tlsImport(p,{cert:f('leaf.crt'),key:f('leaf.key'),ca:f('a.crt'),names:['maps.example.test']},()=>{});
  const old={cert:sha(join(dir,'server.crt')),key:sha(join(dir,'server.key')),trust:sha(join(dir,'ca.crt'))};
  ossl('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',f('next.key'),'-out',f('next.csr'),'-subj','/CN=maps.example.test');
  ossl('x509','-req','-in',f('next.csr'),'-CA',f('b.crt'),'-CAkey',f('b.key'),'-CAcreateserial','-out',f('next.crt'),'-days','1','-extfile',f('leaf.ext'));
  await tls.tlsImport(p,{cert:f('next.crt'),key:f('next.key'),ca:f('b.crt'),names:['maps.example.test'],crashAfter:'key'},()=>{});
  const journal=JSON.parse(readFileSync(join(dir,'replace.json'),'utf8'));
  const backup=journal.backup;
  // The actual /2 import journal and backup are used. Damage the proposed staged certificate so
  // recovery needs a fallback, then corrupt that backup's root. The old leaf/key still match.
  // This tests the claimed verified fallback, not normal tls restore (which checks the chain).
  rmSync(join(dir,'next','server.crt'));
  chmodSync(join(backup,'ca.crt'),0o600);
  copyFileSync(f('b.crt'),join(backup,'ca.crt'));
  let recovery=null,error=null;try{recovery=tls.tlsRecover(p,()=>{});}catch(e){error=safe(e.message);}
  const chain=spawnSync('openssl',['verify','-purpose','sslserver','-verify_hostname','maps.example.test','-CAfile',join(dir,'ca.crt'),join(dir,'server.crt')],{encoding:'utf8'});
  add('R1-recovery-backup-trust',{defect_reproduced:recovery==='restored'&&chain.status!==0&&!existsSync(join(dir,'replace.json')),real_import_journal_schema:journal.schema,recovery_result:recovery,recovery_error:error,served_leaf_key_equal_previous:sha(join(dir,'server.crt'))===old.cert&&sha(join(dir,'server.key'))===old.key,trust_equal_previous:sha(join(dir,'ca.crt'))===old.trust,openssl_verification_exit:chain.status,journal_retained:existsSync(join(dir,'replace.json'))});

  // Build a real client handoff pack into an existing output as permitted by the current API.
  // A stale excluded operator file must not survive a claimed sanitized pack build.
  const packOut=join(w,'client-pack');mkdirSync(join(packOut,'docs','handoff'),{recursive:true});
  const stale=join(packOut,'docs','handoff','DEPLOYMENT_PLAN.md');write(stale,'SYNTHETIC STALE OPERATOR MATERIAL\n');
  const {buildClientPack}=await import(pathToFileURL(join(repo,'infra','handoff','build-client-pack.mjs')));
  let manifest=null,packError=null;try{manifest=buildClientPack(repo,packOut);}catch(e){packError=safe(e.message);}
  add('R2-reused-client-pack-output',{defect_reproduced:!!manifest&&existsSync(stale)&&!Object.hasOwn(manifest.files,'docs/handoff/DEPLOYMENT_PLAN.md'),builder_succeeded:!!manifest,stale_excluded_operator_file_retained:existsSync(stale),stale_file_in_manifest:manifest?Object.hasOwn(manifest.files,'docs/handoff/DEPLOYMENT_PLAN.md'):null,error:packError});

  // H5 independent schema-required-field comparison (no Ajv installation needed).
  const spec=JSON.parse(readFileSync(join(repo,'docs','openapi','map-services-v1.json'),'utf8'));
  const tpl=readFileSync(join(repo,'infra','images','proxy','locations.conf.template'),'utf8');
  const required=spec.paths['/api/v1/map/route'].post.responses['413'].content['application/json'].schema.properties.error.required;
  const bodies=[...tpl.matchAll(/return (\d{3}) '(\{"error"[^']+)';/g)].map(x=>({status:Number(x[1]),body:JSON.parse(x[2].replaceAll('$request_id','0123456789abcdef0123456789abcdef'))}));
  add('H5-configured-error-required-fields',{configured_errors:bodies.length,all_required_fields_present:bodies.every(x=>required.every(k=>Object.hasOwn(x.body.error,k))),all_request_ids_32_hex:bodies.every(x=>/^[0-9a-f]{32}$/.test(x.body.error.request_id)),note:'Structural comparison, not the provided Ajv/full Nginx test'});
}catch(e){add('HARNESS_ERROR',{error:safe(e.stack??e)});}
finally{
  const report={node:process.version,openssl:ossl('version').trim(),limits:'No full build, Docker/browser/VM/LAN execution. Temporary PKI only; ownership adapter skips unsupported uid-101 chown.',results};
  const json=JSON.stringify(report,null,2)+'\n';if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,json);}process.stdout.write(json);rmSync(w,{recursive:true,force:true});
}
process.exit(results.some(x=>x.id==='HARNESS_ERROR')?1:0);
