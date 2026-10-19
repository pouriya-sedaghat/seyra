#!/usr/bin/env node
// Independent negative cases against the actual shell scripts. Docker and ip are recording
// stand-ins; no Docker daemon, network, VM, owner file, live certificate or package is touched.
// Exit 0 means all documented counterexamples reproduced, not that the product passed.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
const repo=resolve(process.argv[2]??'review-pr1-c73db85');
const output=process.argv[3]&&resolve(process.argv[3]);
const work=mkdtempSync(join(tmpdir(),'seyra-build-review-'));
const rows=[];
const write=(p,s,mode=0o644)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,s);chmodSync(p,mode);};
const scrub=s=>String(s??'').split(work).join('<TEMP>').split(repo).join('<REVIEWED>');
function run(script,extra,env){return spawnSync('bash',[join(repo,script),...extra],{encoding:'utf8',timeout:15000,env:{...process.env,...env}});}
function record(name,r,reproduced,detail){const row={name,exit_code:r.status,reproduced,detail,stdout:scrub(r.stdout),stderr:scrub(r.stderr)};rows.push(row);console.log(JSON.stringify({name,exit_code:r.status,reproduced,detail}));}
try{
  // R1: Docker volume create returns success for an existing volume without changing ownership.
  const w=join(work,'volume');mkdirSync(w);const bin=join(w,'bin'),log=join(w,'docker.log');
  write(join(bin,'ip'),'#!/bin/sh\necho "198.18.10.0/24 dev test0 scope link"\n',0o755);
  write(join(bin,'docker'),String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REVIEW_LOG"
[ "$1" = -H ] && shift 2
case "$1 $2" in
 'network inspect'|'container inspect') exit 1;;
 'network create') echo synthetic-network; exit 0;;
 'volume create') echo seyra-rh-vm-docker; exit 0;;
 'volume inspect') echo foreign-owner; exit 0;;
esac
if [ "$1" = run ]; then echo 'deliberately stop after recording the attempted foreign-volume mount' >&2; exit 125; fi
echo 'unexpected command' >&2; exit 99
`,0o755);
  const lab=join(w,'lab'),out=join(w,'out');
  const common={LAB:lab,OUT:out,OLD_BUNDLE:join(w,'old'),NEW_BUNDLE:join(w,'new'),NEW_SUMS_DIGEST:'a'.repeat(64),FIXTURE:join(w,'fixture.pbf'),DIND_IMAGE:'dind:test',RUNNER:'node:test',NODE_MODULES:join(w,'nm'),SEYRA_REHEARSAL_FROZEN:repo,PHASES:'vm',PATH:`${bin}:${process.env.PATH}`,REVIEW_LOG:log};
  const r=run('tests/rehearsal/handoff-rehearsal.sh',[],common),calls=readFileSync(log,'utf8');
  record('R1 existing foreign volume is mounted before any ownership check',r,/run .*seyra-rh-vm-docker:\/var\/lib\/docker/.test(calls)&&!calls.includes('volume inspect'),{volume_create_called:calls.includes('volume create'),volume_inspect_called:calls.includes('volume inspect'),foreign_volume_mount_attempted:/run .*seyra-rh-vm-docker:\/var\/lib\/docker/.test(calls)});

  // R2: a stopped/restarting inner proxy has no listening TCP socket but retains relay trust in
  // its persisted installation. Probe exit 1 must not be used as proof that trust was removed.
  const e=join(work,'edge'),eb=join(e,'bin');mkdirSync(e);
  const ee=join(e,'edge.env');write(ee,'EDGE_OWNER=test-owner\nEDGE_NAME=review-edge\nEDGE_IMAGE=proxy:test\nEDGE_IMAGE_ID=sha256:1\nEDGE_GUARD_IMAGE=guard:test\nEDGE_GUARD_IMAGE_ID=sha256:2\nEDGE_PUBLISH_ADDR=198.18.0.1\nEDGE_PUBLISH_PORT=18443\nEDGE_CLIENT_CIDRS=198.18.0.128/25\nEDGE_UPSTREAM=198.18.1.2:8444\nEDGE_CONF_DIR=/nonexistent\n');
  const config=join(e,'inner-runtime.env');write(config,'SEYRA_RELAY_PEER=198.18.1.3\nSEYRA_RELAY_PORT=8444\n');
  write(join(eb,'docker'),String.raw`#!/usr/bin/env bash
echo "$*" >> "$REVIEW_LOG"
case "$1 $2" in
 'container inspect') echo test-owner; exit 0;;
 'run --rm')
  if [ "$REVIEW_PROBE" = error ]; then echo 'probe failed to run' >&2; exit 125; fi
  [ "$REVIEW_PROBE" = 1 ] && echo 'nc: connection refused (proxy temporarily stopped)'
  echo "rc=$REVIEW_PROBE"; exit 0;;
 'stop review-edge') echo review-edge; exit 0;;
esac
exit 99
`,0o755);
  for(const probe of ['0','error','1']){
    const el=join(e,`calls-${probe}`);const before=readFileSync(config,'utf8');
    const x=run('infra/edge/edge.sh',[ee,'stop'],{PATH:`${eb}:${process.env.PATH}`,REVIEW_LOG:el,REVIEW_PROBE:probe});
    const stopped=/^stop review-edge$/m.test(readFileSync(el,'utf8'));
    const unchanged=before===readFileSync(config,'utf8');
    record(probe==='1'?'R2 closed TCP listener releases edge while persisted trust remains':`R2 control: probe ${probe}`,x,probe==='1'?x.status===0&&stopped&&unchanged:x.status!==0&&!stopped,{edge_stopped:stopped,persisted_trust_unchanged:unchanged,listener_probe:probe});
  }

  // R3: the actual sink-route implementation treats every failing ping as an absent sink.
  // Retain its existing stand-in for all other positive/negative controls, changing ping alone.
  const n=join(work,'egress'),nb=join(n,'bin');mkdirSync(n);
  const original=readFileSync(join(repo,'tests/offline/stubs/docker-egress.sh'),'utf8');
  const needle='"ping "*) [ -n "${SINK_PRESENT:-}" ] && exit 0; exit 1 ;;';
  if(!original.includes(needle))throw Error('ping stub changed; review adapter needs inspection');
  write(join(nb,'docker'),original.replace(needle,'"ping "*) echo "sh: ping: not found" >&2; exit 127 ;;'),0o755);
  const ne={PATH:`${nb}:${process.env.PATH}`,APPROVED_SAMPLE:'192.0.2.10',HOST_SINK_ROUTE:'1',SINK_GATEWAY:'198.18.0.250',CONTROLLED_SINKS:'198.18.10.250:9 10.250.0.10:9',HOST_CONTROL:'198.18.0.60:8443',STUB_LOG:join(n,'calls'),STUB_STATE:join(n,'state'),STUB_REMOVED:join(n,'removed')};
  const nr=run('tests/offline/namespace-egress.sh',[join(n,'out'),'disposable-host'],ne);
  record('R3 missing ping executable is accepted as verified absent sink',nr,nr.status===0&&/absent sink/.test(nr.stdout)&&!/^FAIL/m.test(nr.stdout),{ping_command:'exit 127',verdict:nr.status===0?'PASS':'FAIL'});

  // R4: real cleanup code records even total cleanup failure / route changes as NOTE and exit 0.
  const c=join(work,'cleanup'),cb=join(c,'bin'),cl=join(c,'lab'),co=join(c,'out');mkdirSync(c);mkdirSync(co);
  write(join(co,'vm-routes-before.txt'),'baseline routes\n');
  write(join(cb,'ip'),'#!/bin/sh\necho "changed routes"\n',0o755);
  write(join(cb,'docker'),String.raw`#!/usr/bin/env bash
outer=0; [ "$1" = -H ] && { outer=1; shift 2; }
case "$1 $2" in
 'container inspect')
  if [ "$outer" = 0 ]; then echo "$LAB"; exit 0; fi
  case "$*" in *Hostname*) echo review-vm;; *) echo "$LAB";; esac; exit 0;;
 'network inspect'|'volume inspect') echo "$LAB"; exit 0;;
 'exec seyra-rh-host') exit 0;;
 'network ls'|'volume ls') echo remaining-owned-object; exit 0;;
 'rm -f'|'network rm'|'volume rm') echo 'deliberate daemon removal failure' >&2; exit 125;;
esac
if [ "$1" = info ]; then echo review-vm; exit 0; fi
if [ "$1" = ps ]; then echo remaining-owned-container; exit 0; fi
exit 99
`,0o755);
  const cr=run('tests/rehearsal/handoff-rehearsal.sh',[],{...common,LAB:cl,OUT:co,PHASES:'cleanup',PATH:`${cb}:${process.env.PATH}`});
  record('R4 cleanup failures and changed outer routes still yield success',cr,cr.status===0&&/NOTE RC1/.test(cr.stdout)&&/1 containers, 1 networks, 1 volumes/.test(cr.stdout)&&/CHANGED/.test(cr.stdout),{cleanup_verdict:'NOTE',removal_commands:'exit 125',routes:'CHANGED'});
}catch(e){rows.push({name:'HARNESS_ERROR',reproduced:false,error:scrub(e.stack)});console.error(e.stack);}
finally{
 const report={node:process.version,scope:'Actual shell scripts with recording Docker/ip stand-ins; no real Docker, VM or LAN execution.',results:rows};
 if(output){mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 rmSync(work,{recursive:true,force:true});
}
process.exit(rows.length>0&&rows.every(x=>x.reproduced)?0:1);
