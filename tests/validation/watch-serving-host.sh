#!/usr/bin/env bash
# Read-only watcher for the preserved serving host while builds or rehearsals run on the same VM
# (PREPARED; DEPLOYMENT_PLAN.md §2). Every INTERVAL seconds it records the serving host's readiness
# (from inside its API container, no TLS path or port involved), VM available memory, swap use and
# load. It never changes the host. When a threshold is crossed it writes ABORT and exits 3 so the
# caller stops its own workload; recovery is then awaited, not forced.
#
#   tests/validation/watch-serving-host.sh <host-container> <out-file> [interval-s]
#   thresholds (env): MIN_AVAILABLE_MIB=1536  MAX_SWAP_GROWTH_MIB=512  MAX_NOT_READY=2
set -uo pipefail
host="$1"; out="$2"; interval="${3:-10}"
: "${MIN_AVAILABLE_MIB:=1536}" "${MAX_SWAP_GROWTH_MIB:=512}" "${MAX_NOT_READY:=2}"
swap0="$(free -m | awk '/^Swap:/{print $3}')"
notready=0
echo "# $(date -u +%FT%TZ) watch $host interval=${interval}s min_available=${MIN_AVAILABLE_MIB}MiB max_swap_growth=${MAX_SWAP_GROWTH_MIB}MiB max_not_ready=$MAX_NOT_READY swap0=${swap0}MiB" >> "$out"
while :; do
  ts="$(date -u +%T)"
  avail="$(free -m | awk '/^Mem:/{print $7}')"; swap="$(free -m | awk '/^Swap:/{print $3}')"; load="$(cut -d' ' -f1 /proc/loadavg)"
  ready="$(docker exec "$host" docker exec seyra-api-1 node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r=>{const b=await r.json();process.stdout.write(r.status+' '+b.status+' '+b.providers.filter(p=>p.status!=='ok').map(p=>p.provider).join(','))},()=>process.stdout.write('000 unreachable'))" 2>/dev/null || echo "000 exec-failed")"
  echo "$ts ready=[$ready] available=${avail}MiB swap=${swap}MiB load=$load" >> "$out"
  case "$ready" in 200*) notready=0;; *) notready=$((notready + 1));; esac
  reason=""
  [ "$avail" -lt "$MIN_AVAILABLE_MIB" ] && reason="available memory ${avail}MiB < ${MIN_AVAILABLE_MIB}MiB"
  [ $(( swap - swap0 )) -gt "$MAX_SWAP_GROWTH_MIB" ] && reason="${reason:+$reason; }swap grew $(( swap - swap0 ))MiB"
  [ "$notready" -ge "$MAX_NOT_READY" ] && reason="${reason:+$reason; }serving host not ready $notready times in a row"
  if [ -n "$reason" ]; then echo "$ts ABORT $reason" >> "$out"; exit 3; fi
  sleep "$interval"
done
