#!/usr/bin/env bash
# AC03 / AC18: install, import, start, update and rollback on a simulated OFFLINE host.
#
# The offline host is a Docker-in-Docker daemon (test tooling, not a product image) in its own
# network namespace on a Docker --internal network: it has no route to anything outside. Inside
# it a sink default route plus iptables counters record every packet that tries to leave the
# host's own bridges (OUTPUT for host processes, DOCKER-USER for containers). The developer's
# firewall is not touched. The Seyra wrapper runs on the outer host with DOCKER_HOST pointing at
# the offline daemon, exactly as an operator's shell would on the offline machine.
#
#   BUNDLE=/abs/bundle FIXTURE=/abs/synthetic-v1.osm.pbf LAB=/abs/lab DIND_IMAGE=docker:29.8.2-dind \
#     tests/offline/offline-host.sh
#
# Writes docs/evidence/offline/*. Exits non-zero on any FAIL.
set -uo pipefail
: "${BUNDLE:?}" "${FIXTURE:?}" "${LAB:?}" "${DIND_IMAGE:?}"
repo="${SEYRA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
ev="$repo/docs/evidence/offline"
mkdir -p "$ev" "$LAB"
name=seyra-offline-host
net=seyra_offline_lab
sock_dir="$LAB/run"
export SEYRA_HOME="$LAB/home"
inst="$LAB/install"
summary=()
fails=0
result() { summary+=("$1 $2 $3"); echo "== $1 $2 $3"; [ "$1" = PASS ] || fails=$((fails + 1)); }
D() { DOCKER_HOST="unix://$sock_dir/docker.sock" docker "$@"; }
cli() { DOCKER_HOST="unix://$sock_dir/docker.sock" "$inst/bin/seyra-maps" "$@"; }
in_host() { docker exec "$name" "$@"; }
egress_count() { in_host sh -c "iptables -L SEYRA_EGRESS -v -n -x | awk '/COUNT/ {print \$1}'"; }
igmp_count() { in_host sh -c "iptables -L SEYRA_EGRESS -v -n -x | awk '/IGMP/ {print \$1}'"; }
# Readiness through the TLS ingress from inside the offline host, trusting the generated CA.
ready_ds() {
  D run --rm --network host --pull never -v "$SEYRA_HOME/secrets/tls/ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt --entrypoint node \
    "$(jq -r '.images.ops.ref' "$inst/infra/dependencies.lock.json")" \
    -e "fetch('https://127.0.0.1:8443/health/ready').then(r=>r.json()).then(b=>console.log(b.status==='ready'?b.dataset_id:''),()=>console.log(''))" 2>/dev/null
}

# ------------------------------------------------------------------ offline host
docker rm -f "$name" >/dev/null 2>&1
docker volume rm seyra-offline-docker >/dev/null 2>&1   # a fresh, empty offline daemon every run
rm -rf "${LAB:?}/home" "${LAB:?}/install" "${LAB:?}/run"
docker network inspect "$net" >/dev/null 2>&1 || docker network create --internal "$net" >/dev/null
mkdir -p "$sock_dir" "$SEYRA_HOME"
# Same absolute paths inside and outside, so the wrapper's bind mounts resolve on the offline host.
docker run -d --privileged --name "$name" --network "$net" --pull never \
  -v "$LAB:$LAB" -v "$BUNDLE:$BUNDLE:ro" -v "$(dirname "$FIXTURE"):$(dirname "$FIXTURE"):ro" \
  -v seyra-offline-docker:/var/lib/docker \
  "$DIND_IMAGE" dockerd -H unix:///var/run/docker.sock -H "unix://$sock_dir/docker.sock" --tls=false >/dev/null
for _ in $(seq 1 60); do D info >/dev/null 2>&1 && break; sleep 1; done
gw="$(docker inspect "$net" -f '{{(index .IPAM.Config 0).Subnet}}' | sed -E 's#\.[0-9]+/[0-9]+$#.250#')"
# IGMP membership reports to 224.0.0.0/4 are emitted by the kernel whenever a bridge/veth comes
# up; they are link-local and counted separately (IGMP), never as an outbound attempt.
in_host sh -c "ip route add default via $gw 2>/dev/null; iptables -N SEYRA_EGRESS; \
  iptables -A SEYRA_EGRESS -p igmp -d 224.0.0.0/4 -m comment --comment IGMP -j RETURN; \
  iptables -A SEYRA_EGRESS -d 127.0.0.0/8 -j RETURN; iptables -A SEYRA_EGRESS -d 172.16.0.0/12 -j RETURN; \
  iptables -A SEYRA_EGRESS -d 192.168.0.0/16 -j RETURN; iptables -A SEYRA_EGRESS -d 10.0.0.0/8 -j RETURN; \
  iptables -A SEYRA_EGRESS -m comment --comment COUNT -j DROP; \
  iptables -I OUTPUT 1 -j SEYRA_EGRESS; iptables -I DOCKER-USER 1 -j SEYRA_EGRESS 2>/dev/null || iptables -I FORWARD 1 -j SEYRA_EGRESS"
{
  echo "offline host: $(D version --format 'engine {{.Server.Version}}') image=$DIND_IMAGE ($(docker image inspect "$DIND_IMAGE" -f '{{.Id}}'))"
  echo "network: $net (internal); sink route via $gw; egress counter chain SEYRA_EGRESS on OUTPUT + DOCKER-USER"
  echo "registry mirrors: $(D info --format '{{.RegistryConfig.Mirrors}}')  proxies: $(D info --format '{{.HTTPProxy}}{{.HTTPSProxy}}')"
  echo "images before install: $(D images -q | wc -l)"
  echo "external DNS from the offline host: $(in_host nslookup -timeout=3 example.com 2>&1 | tail -2 | tr '\n' ' ')"
  in_host ip route
} > "$ev/host.txt" 2>&1
if [ "$(D images -q | wc -l)" = 0 ] && ! in_host wget -q -T 3 -O /dev/null http://example.com/ 2>/dev/null; then
  result PASS O0 "offline host has no images and no outside route (probe to example.com failed)"
else
  result FAIL O0 "offline host not clean/isolated"
fi
base0="$(egress_count)"

# ------------------------------------------------------------------ install from bundle
rm -rf "$inst"; cp -a "$BUNDLE/install" "$inst"
cli bootstrap-load "$BUNDLE" > "$ev/O1-bootstrap-load.log" 2>&1; rc=$?
cli verify-images > "$ev/O1-verify-images.log" 2>&1; rc2=$?
if [ $rc -eq 0 ] && [ $rc2 -eq 0 ] && grep -q 'identities match the manifest' "$ev/O1-bootstrap-load.log"; then
  result PASS O1 "bootstrap-load verified checksums and loaded $(grep -c '^OK' "$ev/O1-verify-images.log") images; every reference resolves to its locked image ID"
else
  result FAIL O1 "bootstrap rc=$rc verify rc=$rc2"
fi

# ------------------------------------------------------------------ init, TLS, import, activate
cli init > "$ev/O2-init.log" 2>&1 && cli tls init --names localhost,127.0.0.1 >> "$ev/O2-init.log" 2>&1; rc=$?
cli import --pbf "$FIXTURE" > "$ev/O2-import.log" 2>&1; rc_i=$?
A="$(grep -o 'release ds-[0-9a-z-]* built' "$ev/O2-import.log" | awk '{print $2}')"
cli activate "$A" > "$ev/O2-activate.log" 2>&1; rc_a=$?
if [ $rc -eq 0 ] && [ $rc_i -eq 0 ] && [ $rc_a -eq 0 ] && [ "$(ready_ds)" = "$A" ]; then
  result PASS O2 "init, TLS, fixture import (staging validated) and activation of $A offline; ready through https://127.0.0.1:8443"
else
  result FAIL O2 "init=$rc import=$rc_i activate=$rc_a ready=$(ready_ds)"
fi

# ------------------------------------------------------------------ restart
cli stop > "$ev/O3-restart.log" 2>&1 && cli start >> "$ev/O3-restart.log" 2>&1; rc=$?
for _ in $(seq 1 120); do [ "$(ready_ds)" = "$A" ] && break; sleep 2; done
if [ $rc -eq 0 ] && [ "$(ready_ds)" = "$A" ]; then result PASS O3 "stop/start: all four providers ready again on $A"; else result FAIL O3 "rc=$rc"; fi

# ------------------------------------------------------------------ update and rollback
cli import --pbf "$FIXTURE" --snapshot-timestamp 2026-10-02T00:00:00Z > "$ev/O4-update-import.log" 2>&1; rc_i=$?
B="$(grep -o 'release ds-[0-9a-z-]* built' "$ev/O4-update-import.log" | awk '{print $2}')"
cli activate "$B" > "$ev/O4-update-activate.log" 2>&1; rc_a=$?
r_b="$(ready_ds)"
cli rollback > "$ev/O4-rollback.log" 2>&1; rc_r=$?
r_a="$(ready_ds)"
if [ $rc_i -eq 0 ] && [ $rc_a -eq 0 ] && [ "$r_b" = "$B" ] && [ $rc_r -eq 0 ] && [ "$r_a" = "$A" ]; then
  result PASS O4 "update to $B and rollback to $A, each verified ready through the ingress"
else
  result FAIL O4 "import=$rc_i activate=$rc_a ready_b=$r_b rollback=$rc_r ready_a=$r_a"
fi

# ------------------------------------------------------------------ egress capture
after="$(egress_count)"
in_host sh -c 'iptables -L SEYRA_EGRESS -v -n -x; iptables -L OUTPUT -v -n -x | head -4; iptables -L DOCKER-USER -v -n -x 2>/dev/null | head -4' > "$ev/O5-egress-counters.txt" 2>&1
if [ "${after:-x}" = "${base0:-y}" ]; then
  result PASS O5 "zero packets to non-local destinations from the offline host or any container during install/import/start/update/rollback (counter $base0 -> $after; $(igmp_count) link-local IGMP reports from interface creation counted separately)"
else
  result FAIL O5 "outbound attempts counted: $base0 -> $after (see O5-egress-counters.txt)"
fi

{
  echo "# Seyra offline host scenarios (AC03/AC18) — $(date -u +%FT%TZ)"
  echo "# bundle=$BUNDLE A=$A B=${B:-}"
  printf '%s\n' "${summary[@]}"
  echo "# failures: $fails"
} > "$ev/summary.txt"
cat "$ev/summary.txt"
exit $((fails > 0))
