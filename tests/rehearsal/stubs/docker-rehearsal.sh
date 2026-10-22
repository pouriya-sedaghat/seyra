#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG"
outer=0
if [ "$1" = -H ]; then [ "$2" = unix:///var/run/docker.sock ] && outer=1; shift 2; fi
cnt() { local f="$STUB_DIR/count-$1"; local n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo $n > "$f"; echo $n; }
VOL=seyra-rh-vm-docker
case "$1 $2" in
  "network inspect")
    [ -n "${STUB_NET_INSPECT_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    if [ "${STUB_PHASE:-}" = vm ]; then echo "Error response from daemon: network $3 not found" >&2; exit 1; fi
    echo "${STUB_NET_LABEL-$LAB}"; exit 0 ;;
  "network create") echo net-id; exit 0 ;;
  "network rm") [ -n "${STUB_RM_FAIL:-}" ] && { echo "Error response from daemon: network has active endpoints" >&2; exit 125; }; echo "$3"; exit 0 ;;
  "network ls") [ -n "${STUB_LS_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }; printf '%s' "${STUB_REMAIN_NET:-}"; exit 0 ;;
  "volume ls") [ -n "${STUB_LS_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }; printf '%s' "${STUB_REMAIN_VOL:-}"; exit 0 ;;
  "volume inspect")
    n=$(cnt vinspect)
    case "${STUB_VOL:-absent}" in
      error) echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1 ;;
      absent|race-foreign|postcreate-error)
        if [ ! -f "$STUB_DIR/created" ]; then echo "Error response from daemon: get $VOL: no such volume" >&2; exit 1; fi
        [ "${STUB_VOL}" = postcreate-error ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
        [ "${STUB_VOL}" = race-foreign ] && { echo "$VOL|local|/other/lab"; exit 0; }
        case "$*" in *'.Name'*) echo "$VOL|local|$LAB";; *) echo "$LAB";; esac; exit 0 ;;
      owned) case "$*" in *'.Name'*) echo "$VOL|local|$LAB";; *) echo "$LAB";; esac; exit 0 ;;
      foreign) case "$*" in *'.Name'*) echo "$VOL|local|/other/lab";; *) echo /other/lab;; esac; exit 0 ;;
      unlabelled) case "$*" in *'.Name'*) echo "$VOL|local|<no value>";; *) echo "<no value>";; esac; exit 0 ;;
      otherdriver) echo "$VOL|nfs|$LAB"; exit 0 ;;
      gone) echo "Error response from daemon: get $VOL: no such volume" >&2; exit 1 ;;
    esac ;;
  "volume create") [ -n "${STUB_CREATE_FAIL:-}" ] && { echo "Error response from daemon: create failed" >&2; exit 1; }; touch "$STUB_DIR/created"; echo "$VOL"; exit 0 ;;
  "volume rm") [ -n "${STUB_RM_FAIL:-}" ] && { echo "Error response from daemon: volume is in use" >&2; exit 125; }; echo "$3"; exit 0 ;;
  "container inspect")
    case "$*" in *Config.Hostname*) echo stub-vm; exit 0;; esac
    if [ "$outer" = 1 ]; then
      if [ "${STUB_PHASE:-}" = vm ]; then echo "Error response from daemon: No such container: seyra-rh-vm" >&2; exit 1; fi
      [ -n "${STUB_VM_GONE:-}" ] && { echo "Error response from daemon: No such container: seyra-rh-vm" >&2; exit 1; }
      echo "$LAB"; exit 0
    fi
    [ -n "${STUB_VM_GONE:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    echo "$LAB"; exit 0 ;;
  "exec seyra-rh-host") [ -n "${STUB_INNER_FAIL:-}" ] && { echo "rm: cannot remove: Device or resource busy" >&2; exit 1; }; exit 0 ;;
  "rm -f") [ -n "${STUB_RM_FAIL:-}" ] && { echo "Error response from daemon: removal of container failed" >&2; exit 125; }; echo "$3"; exit 0 ;;
  "ps -a"|"ps -aq")
    if [ "$*" != "${*/volume=/}" ]; then [ -n "${STUB_USERS_FAIL:-}" ] && { echo "Cannot connect" >&2; exit 1; }; printf '%s' "${STUB_VOL_USERS:-}"; exit 0; fi
    [ -n "${STUB_LS_FAIL:-}" ] && [ "$(cnt psq)" -gt 1 ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    printf '%s' "${STUB_REMAIN_CTR:-}"; exit 0 ;;
esac
if [ "$1" = info ]; then [ -n "${STUB_VM_GONE:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }; echo stub-vm; exit 0; fi
if [ "$1" = run ]; then echo "stand-in: docker run recorded and refused" >&2; exit 125; fi
echo "unexpected docker $*" >&2; exit 99
