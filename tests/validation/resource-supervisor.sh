#!/usr/bin/env bash
# Resource supervisor for preparation/rehearsal work on a shared VM. Samples every INTERVAL seconds
# (default 5) and, when a threshold is crossed, stops ONLY the workloads registered in REGISTRY and
# writes ABORT to OUT. It never touches Docker daemons, unregistered processes or containers.
#
#   tests/validation/resource-supervisor.sh <out-file> <registry-file> [interval-s]
#
# Registry lines (written by the caller before/while each workload runs; removed when it ends):
#   pid <pid> <label>                       a process (e.g. a docker build client)
#   container <docker-endpoint> <id> <label> a container on an explicit daemon endpoint
# Thresholds (env): MIN_AVAILABLE_MIB=1536  MAX_SWAP_GROWTH_MIB=512  MIN_DISK_BYTES (required: the
# applicable floor plus outstanding work budget)  DISK_PATH=/  READINESS_URL_CMD (optional command
# that prints "ready" while the current test service is expected ready; 3 consecutive misses abort)
set -uo pipefail
out="$1"; reg="$2"; interval="${3:-5}"
: "${MIN_AVAILABLE_MIB:=1536}" "${MAX_SWAP_GROWTH_MIB:=512}" "${MIN_DISK_BYTES:?MIN_DISK_BYTES is required}" "${DISK_PATH:=/}"
swap0="$(free -m | awk '/^Swap:/{print $3}')"
misses=0
echo "# $(date -u +%FT%TZ) supervisor pid=$$ interval=${interval}s min_available=${MIN_AVAILABLE_MIB}MiB max_swap_growth=${MAX_SWAP_GROWTH_MIB}MiB min_disk=${MIN_DISK_BYTES}B swap0=${swap0}MiB" >> "$out"
stop_registered() {
  [ -f "$reg" ] || return 0
  while read -r kind a b c; do
    case "$kind" in
      pid) if kill -0 "$a" 2>/dev/null; then echo "$(date -u +%T) stopping pid $a ($b)" >> "$out"; kill -TERM "$a" 2>/dev/null; fi ;;
      container) echo "$(date -u +%T) stopping container $b on $a ($c)" >> "$out"; docker -H "$a" stop -t 10 "$b" >/dev/null 2>&1 ;;
    esac
  done < "$reg"
}
peak_used=0; min_avail=999999
while :; do
  avail="$(free -m | awk '/^Mem:/{print $7}')"; swap="$(free -m | awk '/^Swap:/{print $3}')"
  disk="$(df -B1 --output=avail "$DISK_PATH" | tail -1 | tr -d ' ')"; load="$(cut -d' ' -f1 /proc/loadavg)"
  [ "$avail" -lt "$min_avail" ] && min_avail="$avail"
  work="$( [ -f "$reg" ] && awk '{print $NF}' "$reg" | paste -sd, - )"
  reason=""
  [ "$avail" -lt "$MIN_AVAILABLE_MIB" ] && reason="available ${avail}MiB < ${MIN_AVAILABLE_MIB}MiB"
  [ $(( swap - swap0 )) -gt "$MAX_SWAP_GROWTH_MIB" ] && reason="${reason:+$reason; }swap grew $(( swap - swap0 ))MiB"
  [ "$disk" -lt "$MIN_DISK_BYTES" ] && reason="${reason:+$reason; }disk ${disk}B < ${MIN_DISK_BYTES}B"
  if [ -n "${READINESS_URL_CMD:-}" ] && [ -n "$work" ]; then
    if [ "$(bash -c "$READINESS_URL_CMD" 2>/dev/null)" = ready ]; then misses=0; else misses=$((misses + 1)); fi
    [ "$misses" -ge 3 ] && reason="${reason:+$reason; }test service not ready 3 samples in a row"
  fi
  echo "$(date -u +%T) avail=${avail}MiB swap=${swap}MiB disk=${disk}B load=$load work=[${work}]" >> "$out"
  if [ -n "$reason" ]; then
    echo "$(date -u +%T) ABORT $reason" >> "$out"
    stop_registered
    echo "$(date -u +%T) ABORT handled; min_available=${min_avail}MiB" >> "$out"
    exit 3
  fi
  [ -f "$out.stop" ] && { echo "$(date -u +%T) supervisor stopped normally; min_available=${min_avail}MiB" >> "$out"; exit 0; }
  sleep "$interval"
done
