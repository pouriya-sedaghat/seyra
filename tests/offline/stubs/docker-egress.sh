#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
state="$STUB_STATE"; [ -f "$state" ] || echo 0 > "$state"
case "$1 $2" in
  "exec "*)
    shift 2
    if [ -n "${HOST_EXEC_FAIL:-}" ]; then echo "Error response from daemon: No such container: x" >&2; exit 1; fi
    case "$*" in
      "ip -4 route get "*) d="${@: -1}"
        if [ "$d" = "${HOST_ROUTABLE:-none}" ]; then echo "$d via 198.18.0.1 dev eth0"; exit 0; fi
        if [ -n "${HOST_SINK_ROUTE:-}" ]; then echo "$d via 198.18.0.250 dev eth0 src 198.18.0.3"; exit 0; fi
        echo "RTNETLINK answers: Network is unreachable" >&2; exit 2 ;;
      "ip -4 route") echo "198.18.0.0/15 dev eth0 proto kernel scope link"; exit 0 ;;
      *ip_forward*) echo 0; exit 0 ;;
      *"ip -4 neigh show"*)
        # Bounded sink probe (ping as trigger + neighbour state). Knobs: SINK_PROBE_EXEC_FAIL,
        # SINK_PRESENT (answers), PING_MISSING, NEIGH_LLADDR (silent to ICMP, resolves at L2),
        # NEIGH_EMPTY (no result), NEIGH_ERROR (ip fails). Default: absent (FAILED).
        [ -n "${SINK_PROBE_EXEC_FAIL:-}" ] && { echo "Error response from daemon: container is restarting" >&2; exit 1; }
        if [ -n "${SINK_PRESENT:-}" ]; then echo ping_rc=0; echo "neigh=198.18.0.250 dev eth0 lladdr 02:42:c6:12:00:fa REACHABLE"; echo neigh_rc=0; exit 0; fi
        [ -n "${PING_MISSING:-}" ] && { echo "sh: ping: not found" >&2; echo ping_rc=127; echo "neigh="; echo neigh_rc=0; exit 0; }
        [ -n "${NEIGH_LLADDR:-}" ] && { echo ping_rc=1; echo "neigh=198.18.0.250 dev eth0 lladdr 02:42:c6:12:00:fa STALE"; echo neigh_rc=0; exit 0; }
        [ -n "${NEIGH_EMPTY:-}" ] && { echo ping_rc=1; echo "neigh="; echo neigh_rc=0; exit 0; }
        [ -n "${NEIGH_ERROR:-}" ] && { echo ping_rc=1; echo "neigh="; echo "ip: RTNETLINK answers: Operation not permitted"; echo neigh_rc=1; exit 0; }
        echo ping_rc=1; echo "neigh=198.18.0.250 dev eth0  used 0/0/0 probes 6 FAILED"; echo neigh_rc=0; exit 0 ;;
      "ping "*) [ -n "${PING_MISSING:-}" ] && { echo "sh: ping: not found" >&2; exit 127; }; [ -n "${SINK_PROBE_EXEC_FAIL:-}" ] && { echo "Error response from daemon: container is restarting" >&2; exit 1; }; [ -n "${SINK_PRESENT:-}" ] && exit 0; exit 1 ;;
      *"nc -w 3 -z"*)
        dst="$(sed -E 's/.*nc -w 3 -z ([^ ;]+) ([0-9]+).*/\1:\2/' <<<"$*")"
        [ -n "${HOST_NC_MISSING:-}" ] && { echo "sh: nc: not found"; echo rc=127; exit 0; }
        if [ "$dst" = "${HOST_CONTROL:-none}" ]; then [ -n "${HOST_CONTROL_DOWN:-}" ] && { echo rc=1; exit 0; }; echo rc=0; exit 0; fi
        [ "$dst" = "${HOST_SINK_OK:-none}" ] && { echo rc=0; exit 0; }
        echo "nc: can't connect to remote host: Connection timed out"; echo rc=1; exit 0 ;;
    esac ;;
  "network inspect")
    case "$*" in *Containers*)
      [ -n "${NET_INVENTORY_FAIL:-}" ] && { echo "Error response from daemon: network seyra_offline_lab not found" >&2; exit 1; }
      echo "gw=198.18.0.1 198.18.0.3/24 198.18.0.60/24 ${SINK_IN_INVENTORY:+198.18.0.250/24 }"; exit 0 ;;
    esac
    [ -n "${NET_INTERNAL_FAIL:-}" ] && { echo "Error response from daemon: network seyra_offline_lab not found" >&2; exit 1; }
    [ -n "${NET_NOT_INTERNAL:-}" ] && { echo false; exit 0; }; echo true; exit 0 ;;
  "container inspect")
    for a in "$@"; do case "$a" in *IPAddress*) echo 198.18.0.50; exit 0;; *"range $k"*) [ "${@: -1}" = disposable-host ] && { echo "seyra_offline_lab "; exit 0; }; echo "seyra_edge seyra_offline_lab "; exit 0;; esac; done
    exit 0 ;;
  "rm -f") echo "$3" >> "$STUB_REMOVED"; exit 0 ;;
esac
if [ "$1" = run ]; then
  for a in "$@"; do if [ "$a" = -d ]; then echo sink-id; exit 0; fi; done
  script="${@: -1}"
  case "$script" in
    *"iptables -L OUTPUT"*)
      [ "${COUNTER:-}" = missing ] && { echo "Chain OUTPUT (policy DROP 0 packets, 0 bytes)"; exit 0; }
      echo "Chain OUTPUT (policy DROP)"; echo "    $(cat "$state")     0 DROP all -- * * 0.0.0.0/0 0.0.0.0/0 /* SEYRA_EDGE_EGRESS_DROP */"; exit 0 ;;
    *"ip -4 route"*) echo "default via 198.18.0.1 dev eth0"; echo 0; exit 0 ;;
    *"nc -w 3 -z"*)
      [ -n "${RUN_FAIL:-}" ] && { echo "docker: Error response from daemon: cannot join network namespace" >&2; exit 125; }
      dst="$(sed -E 's/.*nc -w 3 -z ([^ ;]+) ([0-9]+).*/\1:\2/' <<<"$script")"
      if [ "$dst" = "$UPSTREAM" ]; then [ -n "${UPSTREAM_DOWN:-}" ] && { echo "nc: can't connect: Connection refused"; echo rc=1; exit 0; }; echo rc=0; exit 0; fi
      [ -n "${NC_MISSING:-}" ] && { echo "sh: nc: not found"; echo rc=127; exit 0; }
      [ "$dst" = "${FORBIDDEN_OK:-none}" ] && { echo rc=0; exit 0; }
      [ "${COUNTER:-}" = frozen ] || echo $(( $(cat "$state") + 1 )) > "$state"
      echo "nc: can't connect to remote host: Operation not permitted"; echo rc=1; exit 0 ;;
  esac
fi
exit 0
