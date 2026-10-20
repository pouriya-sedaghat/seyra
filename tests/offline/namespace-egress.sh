#!/usr/bin/env bash
# Namespace-specific egress test for the nested-host relay topology (PREPARED; run on disposable
# rehearsal hosts first, and on the serving host only inside an approved window).
#
#   tests/offline/namespace-egress.sh <out-dir> <nested-host-container> [<edge-container> <edge-upstream ip:port> <guard-image>]
#
# The historical SEYRA_EGRESS counter treats private destinations as local, so it cannot show that a
# namespace is unable to start corporate-LAN connections. This test asks each namespace directly:
#   1. route lookups (`ip route get`, no packet is sent) for representative destinations: the
#      approved-subnet range, other private ranges and documentation ("public") ranges;
#   2. NEW TCP connections only towards controlled destinations: RFC 5737 documentation addresses
#      (never assigned to any device) and disposable sinks created by this test on the namespace's
#      own networks. No company device is contacted and nothing is scanned;
#   3. for the edge: its namespace guard counter must rise, and the one allowed upstream must connect.
# Lab hosts have a deliberate default route to an absent "sink" address on an --internal network
# (SINK_GATEWAY); such routes count as isolated only with positive evidence that nothing holds that
# address (internal networks, Docker's address inventory, failed link-layer resolution after a
# bounded probe); ICMP silence alone is not evidence. CONTROLLED_SINKS / HOST_CONTROL add real
# NEW-connection probes from the host.
# Allowed ingress replies (ESTABLISHED) are not exercised here; the relay boundary test covers them.
# The VM's global firewall is never read or changed.
#
# Verdict: every required assertion is counted; the exit status is 1 if any failed. A tool or exec
# error is a failure, never a successful denial. Only sinks this run created are removed.
set -uo pipefail
out="$1"; host="$2"; edge="${3:-}"; upstream="${4:-}"; guard_image="${5:-}"
mkdir -p "$out"
: "${APPROVED_SAMPLE:?APPROVED_SAMPLE (one address inside the approved client subnet, for route lookups only) is required}"
probe_dsts=("$APPROVED_SAMPLE" 10.0.0.1 172.16.0.1 172.31.0.1 192.168.0.1 192.0.2.1 198.51.100.1 203.0.113.1 1.1.1.1 8.8.8.8)
connect_dsts=(192.0.2.1:443 198.51.100.1:443 203.0.113.1:80)
res="$out/summary.txt"; : > "$res"
failures=0
pass() { echo "PASS $*" | tee -a "$res"; }
fail() { echo "FAIL $*" | tee -a "$res"; failures=$((failures + 1)); }
finish() { echo "# failures: $failures" | tee -a "$res"; exit $(( failures > 0 ? 1 : 0 )); }
sinks=()
cleanup() { for s in "${sinks[@]}"; do docker rm -f "$s" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT

# --- nested host: no route anywhere outside its internal lab network ------------------------------
if docker exec "$host" ip -4 route > "$out/host-routes.txt" 2>&1; then pass "nested host: route table read"; else fail "nested host: cannot read the route table ($(tail -1 "$out/host-routes.txt"))"; fi
if fwd="$(docker exec "$host" cat /proc/sys/net/ipv4/ip_forward 2>&1)"; then echo "$fwd" > "$out/host-ip-forward.txt"; else fail "nested host: cannot read ip_forward ($fwd)"; fi
routable=0; sinkrouted=0; toolerr=0
: > "$out/host-route-get.txt"
for d in "${probe_dsts[@]}"; do
  r="$(docker exec "$host" ip -4 route get "$d" 2>&1)"; rc=$?
  echo "$d: rc=$rc $r" >> "$out/host-route-get.txt"
  # Unreachable only when ip itself says so (exit 2, "Network is unreachable"). A docker/exec error
  # or a missing tool is not evidence of isolation. A route through the lab's deliberate sink
  # address (SINK_GATEWAY; it exists so attempts can be counted) is judged separately below.
  if [ "$rc" -eq 0 ]; then
    if [ -n "${SINK_GATEWAY:-}" ] && grep -q " via $SINK_GATEWAY " <<<"$r "; then sinkrouted=$((sinkrouted + 1)); else routable=$((routable + 1)); fi
  elif ! grep -q 'Network is unreachable' <<<"$r" || grep -qiE 'Error response from daemon|No such container|executable file not found|not found' <<<"$r"; then toolerr=$((toolerr + 1)); fi
done
[ "$toolerr" -eq 0 ] || fail "nested host: $toolerr route lookups failed as commands, not as 'unreachable' ($out/host-route-get.txt)"
[ "$routable" -eq 0 ] || fail "nested host: $routable destinations are routable ($out/host-route-get.txt)"
if [ "$sinkrouted" -gt 0 ]; then
  # A sink route isolates only with positive evidence that nothing holds the sink address:
  #  (a) every network of the host is --internal (no gateway route out, no NAT);
  #  (b) Docker's address inventory of those networks lists no container and no gateway with it;
  #  (c) a bounded probe from the host namespace ends in failed link-layer resolution of the address
  #      (neighbour state FAILED/INCOMPLETE, no lladdr). ICMP silence alone is never taken as
  #      absence: ping only triggers the resolution, and it must have run (exit 0 or 1).
  # Every inspect, exec, daemon or tool error, and an empty (inconclusive) result, fails the check.
  sinkok=1
  hnets="$(docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$host" 2>&1)" || { fail "nested host: cannot inspect its networks ($hnets)"; hnets=""; sinkok=0; }
  [ -n "$hnets" ] || { [ "$sinkok" = 0 ] || fail "nested host: no networks found"; sinkok=0; }
  notinternal=""
  for n in $hnets; do
    i="$(docker network inspect -f '{{.Internal}}' "$n" 2>&1)"; [ "$i" = true ] || notinternal="$notinternal $n($i)"
    inv="$(docker network inspect -f '{{range .IPAM.Config}}gw={{.Gateway}} {{end}}{{range .Containers}}{{.IPv4Address}} {{end}}' "$n" 2>&1)" \
      || { fail "nested host: cannot read the address inventory of $n ($inv)"; sinkok=0; continue; }
    echo "$n: $inv" >> "$out/host-sink-inventory.txt"
    if grep -qE "(^|[ =])${SINK_GATEWAY//./\\.}(/[0-9]+)?( |$)" <<<"$inv"; then fail "nested host: the sink address $SINK_GATEWAY is assigned on $n"; sinkok=0; fi
  done
  [ -z "$notinternal" ] || { fail "nested host: sink-routed destinations on a network that is not internal:$notinternal"; sinkok=0; }
  probe="$(docker exec "$host" sh -c "ping -c 2 -W 2 $SINK_GATEWAY >/dev/null 2>&1; echo ping_rc=\$?; for t in 1 2 3 4 5; do nb=\$(ip -4 neigh show $SINK_GATEWAY); case \"\$nb\" in *FAILED*) break;; esac; sleep 1; done; echo \"neigh=\$nb\"; ip -4 neigh show $SINK_GATEWAY >/dev/null; echo neigh_rc=\$?" 2>&1)"; prc=$?
  echo "$probe" > "$out/host-sink-probe.txt"
  ping_rc="$(sed -n 's/^ping_rc=//p' <<<"$probe")"; neigh="$(sed -n 's/^neigh=//p' <<<"$probe")"; neigh_rc="$(sed -n 's/^neigh_rc=//p' <<<"$probe")"
  if [ "$prc" -ne 0 ] || [ -z "$ping_rc" ] || [ "$neigh_rc" != 0 ]; then fail "nested host: the sink probe did not run (exec rc=$prc ping_rc=${ping_rc:-none} neigh_rc=${neigh_rc:-none}): inconclusive"; sinkok=0
  elif [ "$ping_rc" = 0 ]; then fail "nested host: the sink address $SINK_GATEWAY answers; it must not exist"; sinkok=0
  elif [ "$ping_rc" != 1 ]; then fail "nested host: the sink probe tool failed (ping exit $ping_rc): inconclusive"; sinkok=0
  elif grep -q 'lladdr' <<<"$neigh"; then fail "nested host: $SINK_GATEWAY resolves at the link layer ($neigh), so something holds it"; sinkok=0
  elif ! grep -qE 'FAILED|INCOMPLETE' <<<"$neigh"; then fail "nested host: no neighbour resolution result for $SINK_GATEWAY ('$neigh'): inconclusive"; sinkok=0
  fi
  [ "$sinkok" = 1 ] && pass "nested host: $sinkrouted destinations route only to the sink $SINK_GATEWAY, which nothing holds (internal network(s): $hnets; not in Docker's address inventory; link-layer resolution: ${neigh##* })"
fi
[ "$routable" -eq 0 ] && [ "$sinkrouted" -eq 0 ] && [ "$toolerr" -eq 0 ] && pass "nested host: no route to the approved subnet, other private ranges or public ranges (${#probe_dsts[@]} lookups, no packet sent)"
# NEW connections from the host namespace to controlled sinks outside its networks (CONTROLLED_SINKS,
# "ip:port ...", created by the caller) must fail; HOST_CONTROL (ip:port reachable on the host's own
# network) must connect, proving the probe path works at all.
if [ -n "${CONTROLLED_SINKS:-}${HOST_CONTROL:-}" ]; then
  hprobe() { docker exec "$host" sh -c "nc -w 3 -z ${1%:*} ${1##*:} 2>&1; echo rc=\$?" 2>&1; }
  if [ -n "${HOST_CONTROL:-}" ]; then
    r="$(hprobe "$HOST_CONTROL")"; echo "control $HOST_CONTROL: $r" >> "$out/host-connect.txt"
    case "$r" in *rc=0) pass "nested host: control destination $HOST_CONTROL connects (probe path works)";; *) fail "nested host: control destination $HOST_CONTROL did not connect ($r); probes are not conclusive";; esac
  fi
  hc=0; hb=0; ht=0
  for d in ${CONTROLLED_SINKS:-}; do
    r="$(hprobe "$d")"; echo "$d: $r" >> "$out/host-connect.txt"
    case "$r" in *rc=0) hc=$((hc + 1));; *rc=1) hb=$((hb + 1));; *) ht=$((ht + 1));; esac
  done
  [ "$hc" -eq 0 ] || fail "nested host: $hc NEW connections to controlled sinks outside its networks succeeded ($out/host-connect.txt)"
  [ "$ht" -eq 0 ] || fail "nested host: $ht connection probes did not run ($out/host-connect.txt)"
  [ "$hc" -eq 0 ] && [ "$ht" -eq 0 ] && [ "$hb" -gt 0 ] && pass "nested host: $hb NEW connections to controlled sinks outside its networks refused"
fi

[ -n "$edge" ] || finish
[ -n "$upstream" ] && [ -n "$guard_image" ] || { fail "edge mode needs <edge-upstream> and <guard-image>"; finish; }

# --- edge: routes exist (published bridge), so the namespace guard must stop NEW connections --------
ns_sh() { docker run --rm --network "container:$1" --cap-drop ALL --entrypoint sh "$guard_image" -c "$2"; }
drop_count() { docker run --rm --network "container:$edge" --cap-drop ALL --cap-add NET_ADMIN --entrypoint sh "$guard_image" -c 'iptables -L OUTPUT -v -n -x' 2>/dev/null | awk '/SEYRA_EDGE_EGRESS_DROP/{print $1; exit}'; }
ns_sh "$edge" 'ip -4 route; cat /proc/sys/net/ipv4/ip_forward' > "$out/edge-routes.txt" 2>&1 || fail "edge: cannot read its route table"
before="$(drop_count)"
case "$before" in ''|*[!0-9]*) fail "edge: guard drop counter missing or unreadable ('$before'); is the egress guard applied?"; before="";; esac
# Disposable sinks on the edge's own networks (same L2 segment, so routing alone would allow them).
nets="$(docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$edge" 2>&1)" || { fail "edge: cannot inspect its networks ($nets)"; nets=""; }
for net in $nets; do
  name="seyra-egress-sink-$net-$$"
  if docker run -d --rm --name "$name" --label seyra.egress-test=1 --network "$net" --cap-drop ALL --entrypoint sh "$guard_image" -c 'nc -lk -p 9 -e true' >/dev/null 2>&1; then
    sinks+=("$name")
    ip="$(docker container inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$name" 2>/dev/null)"
    if [ -n "$ip" ]; then connect_dsts+=("$ip:9"); else fail "edge: sink on $net has no address"; fi
  else
    fail "edge: could not start a controlled sink on $net"
  fi
done
blocked=0; connected=0; toolerr=0
: > "$out/edge-connect.txt"
for d in "${connect_dsts[@]}"; do
  r="$(ns_sh "$edge" "nc -w 3 -z ${d%:*} ${d##*:} 2>&1; echo rc=\$?" 2>&1)"
  echo "$d: $r" >> "$out/edge-connect.txt"
  # nc exits 1 when the connection is refused or blocked; 126/127 (or no marker) means the probe
  # itself did not run. Blocking is then confirmed by the namespace's drop counter below.
  case "$r" in
    *rc=0) connected=$((connected + 1)) ;;
    *rc=1) blocked=$((blocked + 1)) ;;
    *) toolerr=$((toolerr + 1)) ;;
  esac
done
[ "$connected" -eq 0 ] || fail "edge: $connected NEW connections to forbidden destinations succeeded ($out/edge-connect.txt)"
[ "$toolerr" -eq 0 ] || fail "edge: $toolerr connection probes did not run ($out/edge-connect.txt)"
[ "$connected" -eq 0 ] && [ "$toolerr" -eq 0 ] && [ "$blocked" -eq "${#connect_dsts[@]}" ] && pass "edge: ${#connect_dsts[@]} NEW connections (documentation addresses and own-network sinks) refused"
after="$(drop_count)"
case "$after" in ''|*[!0-9]*) fail "edge: guard drop counter missing after the probes ('$after')";; *)
  if [ -n "$before" ]; then
    if [ $(( after - before )) -ge "$blocked" ] && [ "$blocked" -gt 0 ]; then pass "edge: guard drop counter rose by $(( after - before )) (packets stopped inside the namespace)"
    else fail "edge: guard drop counter ${before} -> ${after} does not account for $blocked refused connections"; fi
  fi ;;
esac
r="$(ns_sh "$edge" "nc -w 3 -z ${upstream%:*} ${upstream##*:}; echo rc=\$?" 2>&1)"
case "$r" in
  *rc=0) pass "edge: the one allowed upstream $upstream connects" ;;
  *rc=1) fail "edge: upstream $upstream not reachable ($r)" ;;
  *) fail "edge: upstream probe did not run ($r)" ;;
esac
finish
