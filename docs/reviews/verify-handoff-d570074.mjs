#!/usr/bin/env node
// Re-run the desired-behavior shell/helper suites against a candidate and optional old baseline.
// Also exercise actual edge.sh with real file ctimes and recording Docker responses. No daemon,
// network, owner data or live certificate is accessed. Node 24, GNU coreutils and jq are required.
//   TMPDIR=<writable-dir> node verify-handoff-d570074.mjs <candidate> [c73db85-tree] [report.json]
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
const current=resolve(process.argv[2]??'.'),old=process.argv[3]&&resolve(process.argv[3]),out=process.argv[4]&&resolve(process.argv[4]);
const work=mkdtempSync(join(tmpdir(),'seyra-d570-review-')),rows=[];
const safe=s=>String(s??'').split(work).join('<TEMP>').split(current).join('<CURRENT>').split(old??'\0').join('<BASELINE>');
function execute(label,script,target,expected){
 const r=spawnSync(process.execPath,[join(current,script),...(target?[target]:[])],{encoding:'utf8',timeout:60000,env:process.env});
 const m=/#.*checks=(\d+) failed=(\d+)/.exec(r.stdout);
 const x={label,exit_code:r.status,expected_exit:expected,ok:expected===0?r.status===0:r.status!==0&&r.status!==null,checks:m?+m[1]:null,failed:m?+m[2]:null,stdout:safe(r.stdout),stderr:safe(r.stderr)};
 rows.push(x);console.log(JSON.stringify({label,exit_code:r.status,ok:x.ok,checks:x.checks,failed:x.failed}));
}
const suite=[['edge','tests/security/test-edge-stop.mjs','infra/edge/edge.sh'],['egress','tests/offline/test-namespace-egress.mjs','tests/offline/namespace-egress.sh'],['rehearsal-guards','tests/rehearsal/test-rehearsal-guards.mjs','tests/rehearsal/handoff-rehearsal.sh']];
try{
 if(old)for(const [label,script,target]of suite)execute(`${label}-before`,script,join(old,target),1);
 for(const [label,script,target]of suite)execute(`${label}-after`,script,join(current,target),0);
 execute('swagger-helper-after','tests/browser/test-swagger-checks.mjs',null,0);
 const bin=join(work,'bin'),home=join(work,'home'),envFile=join(work,'edge.env'),log=join(work,'docker.log');mkdirSync(bin);mkdirSync(join(home,'state'),{recursive:true});
 writeFileSync(join(home,'state','settings.json'),'{"relayPeer":""}\n');
 const runtime=join(home,'state','runtime.env');
 writeFileSync(envFile,`EDGE_OWNER=review\nEDGE_NAME=review-edge\nEDGE_IMAGE=proxy:test\nEDGE_IMAGE_ID=sha256:1\nEDGE_GUARD_IMAGE=guard:test\nEDGE_GUARD_IMAGE_ID=sha256:2\nEDGE_PUBLISH_ADDR=198.18.0.1\nEDGE_PUBLISH_PORT=18443\nEDGE_CLIENT_CIDRS=198.18.0.128/25\nEDGE_UPSTREAM=198.18.1.2:8444\nEDGE_CONF_DIR=/nonexistent\nEDGE_LAB_NETWORK=review-lab\nEDGE_INNER_DOCKER_HOST=unix:///review-inner.sock\nEDGE_INNER_HOME=${home}\n`);
 writeFileSync(join(bin,'docker'),String.raw`#!/usr/bin/env bash
echo "$*" >> "$REVIEW_LOG"
if [ "$1" = -H ]; then
 shift 2
 case "$1 $2" in
  'ps -a') echo review-proxy; exit 0;;
  'container inspect')
   case "$*" in
    *State.Status*) echo "running true false false $REVIEW_CREATED";;
    *Config.Env*) printf 'SEYRA_DATASET_ID=ds-review\nSEYRA_RELAY_PEER=\n';;
    *PortBindings*) echo '{"8443/tcp":[{"HostIp":"127.0.0.1","HostPort":"8443"}]}' ;;
    *) exit 98;;
   esac;exit 0;;
 esac
 exit 99
fi
case "$1 $2" in
 'container inspect')
  case "$*" in *seyra.edge.owner*) echo review;; *State.Running*) echo true;; *NetworkSettings.Networks*) echo 198.18.1.3;; *) exit 97;; esac;exit 0;;
 'stop review-edge') echo review-edge;exit 0;;
esac
exit 96
`);chmodSync(join(bin,'docker'),0o755);
 for(const stale of [false,true]){
  writeFileSync(runtime,stale?'SEYRA_RELAY_PEER=198.18.1.3\n':'SEYRA_RELAY_PEER=\n');
  const ctime=statSync(runtime,{bigint:true}).ctimeNs;
  // These metadata values are synthetic Docker creation records on the same real clock. The
  // file ctime is genuine: neither date nor stat is replaced. A 10 ms difference tests fractional
  // ordering, rather than the hour-scale timestamp in the submitted regression.
  const createdMs=Number(ctime/1000000n)+(stale?-10:10);
  writeFileSync(log,'');
  const r=spawnSync('bash',[join(current,'infra/edge/edge.sh'),envFile,'stop'],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,REVIEW_LOG:log,REVIEW_CREATED:new Date(createdMs).toISOString()}});
  const stopped=/^stop review-edge$/m.test(readFileSync(log,'utf8'));
  const x={label:stale?'fractional-ctime-stale-refused':'fractional-ctime-applied-accepted',ok:stale?r.status!==0&&!stopped:r.status===0&&stopped,exit_code:r.status,edge_stopped:stopped,runtime_ctime_ns:ctime.toString(),proxy_created:new Date(createdMs).toISOString(),stdout:safe(r.stdout),stderr:safe(r.stderr)};
  rows.push(x);console.log(JSON.stringify({label:x.label,ok:x.ok,exit_code:r.status,edge_stopped:stopped}));
 }
}catch(e){rows.push({label:'HARNESS_ERROR',ok:false,error:safe(e.stack)});}
finally{
 const report={node:process.version,scope:'Actual candidate scripts and submitted desired-behavior tests; Docker/ip recording stand-ins; extra real-ctime checks. No Docker/VM/browser execution.',results:rows};
 if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
 rmSync(work,{recursive:true,force:true});
}
process.exit(rows.length&&rows.every(x=>x.ok)?0:1);
