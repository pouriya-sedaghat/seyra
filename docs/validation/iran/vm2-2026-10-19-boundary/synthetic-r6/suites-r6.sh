#!/usr/bin/env bash
# OPS-affected synthetic suites on bundle r6 from the frozen copy of 948443a (test tooling).
set -u
M=/home/owner/seyra; S=/home/owner/seyra-prep/boundary/frozen-948443a/src; B=/home/owner/seyra-prep/bundle-2026-10-19-vm2-r6
E=/home/owner/seyra-synth/ev6; FX=/home/owner/seyra-synth/fx
mkdir -p $E/integration
RUN() { docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v $S:$S -w $S "$@"; }
log() { echo "$(date -u +%T) $*" | tee -a $E/summary.txt; }
export SEYRA_HOME=/home/owner/seyra-synth/home
$S/bin/seyra-maps verify-images > $E/verify-images.log 2>&1; log "verify-images rc=$?"
$S/bin/seyra-maps start > $E/start.log 2>&1; log "start rc=$?"
for i in $(seq 1 60); do s=$(curl -s --cacert $SEYRA_HOME/secrets/tls/ca.crt https://127.0.0.1:8443/health/ready | jq -r '.status' 2>/dev/null); [ "$s" = ready ] && break; sleep 3; done; log "ready=$s"
# Integration needs the checkout's node_modules; its sources are unchanged since 9f0d792.
(cd $M/tests/integration && SEYRA_IT_EVIDENCE=$E/integration NODE_EXTRA_CA_CERTS=$SEYRA_HOME/secrets/tls/ca.crt PATH=/home/owner/seyra-prep/node-v24.21.0-linux-x64/bin:$PATH npx vitest run > $E/integration.log 2>&1); log "integration rc=$? $(grep -E 'Tests ' $E/integration.log)"
cp $M/docs/evidence/integration/vitest-report.json $E/integration/ && (cd $M && git checkout -- docs/evidence/integration/vitest-report.json)
RUN --network host -v $SEYRA_HOME:$SEYRA_HOME -v $E:$E -e SEYRA_HOME -e SEYRA_REPO=$S seyra-test-runner:local tests/security/check-ingress-roles.sh $E/security-checks.txt > $E/security.log 2>&1
log "security rc=$? PASS=$(grep -c '^PASS' $E/security-checks.txt) FAIL=$(grep -c '^FAIL' $E/security-checks.txt)"
t0=$(date +%s); RUN --network host -v $SEYRA_HOME:$SEYRA_HOME -v $FX:$FX -e SEYRA_HOME -e SEYRA_REPO=$S -e FIXTURE=$FX/synthetic-v1.osm.pbf -e SNAPSHOT_TS=2026-10-18T00:00:00Z -e SNAPSHOT_TS_L9=2026-10-19T00:00:00Z -e NODE_BIN=/usr/local/bin/node seyra-test-runner:local tests/lifecycle/lifecycle.sh > $E/lifecycle.log 2>&1
log "lifecycle rc=$? $(( $(date +%s)-t0 ))s $(grep -c '^PASS' $S/docs/evidence/lifecycle/summary.txt) PASS $(grep -c '^FAIL' $S/docs/evidence/lifecycle/summary.txt) FAIL"
$S/bin/seyra-maps stop > $E/stop.log 2>&1; log "stop rc=$?"
# Tamper as the plain non-root operator: the r5 bundle is operator-owned (no runner, no chown).
T=/home/owner/seyra-synth/tamper-r6; rm -rf $T; cp -a $B $T
(SEYRA_HOME=/home/owner/seyra-prep/home BUNDLE=$T SEYRA_REPO=$S bash $S/tests/offline/bundle-tamper.sh > $E/tamper.log 2>&1); log "tamper (as $(id -un)) rc=$? $(grep -c '^PASS' $S/docs/evidence/offline/tamper.txt) PASS; bundle copy digest $(cd $T && sha256sum SHA256SUMS | cut -c1-16)"
L=/home/owner/seyra-synth/offline-lab6; mkdir -p $L; t0=$(date +%s)
RUN -v $B:$B -v $L:$L -v $FX:$FX -e BUNDLE=$B -e FIXTURE=$FX/synthetic-v1.osm.pbf -e LAB=$L -e DIND_IMAGE=docker:29.8.2-dind -e SEYRA_REPO=$S seyra-test-runner:local tests/offline/offline-host.sh > $E/offline-host.log 2>&1
log "offline-host rc=$? $(( $(date +%s)-t0 ))s $(grep -c '^PASS' $S/docs/evidence/offline/summary.txt) PASS"
docker rm -f seyra-offline-host >/dev/null 2>&1; docker volume rm seyra-offline-docker >/dev/null 2>&1
L=/home/owner/seyra-synth/restore-lab6; mkdir -p $L; t0=$(date +%s)
RUN -v $B:$B -v $L:$L -v $FX:$FX -e BUNDLE=$B -e FIXTURE=$FX/synthetic-v1.osm.pbf -e LAB=$L -e DIND_IMAGE=docker:29.8.2-dind -e SEYRA_REPO=$S seyra-test-runner:local tests/offline/restore-drill.sh > $E/restore-drill.log 2>&1
log "restore-drill rc=$? $(( $(date +%s)-t0 ))s $(grep -c '^PASS' $S/docs/evidence/restore/summary.txt) PASS"
log DONE
