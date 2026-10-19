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
routable=0; toolerr=0
: > "$out/host-route-get.txt"
for d in "${probe_dsts[@]}"; do
  r="$(docker exec "$host" ip -4 route get "$d" 2>&1)"; rc=$?
  echo "$d: rc=$rc $r" >> "$out/host-route-get.txt"
  # Unreachable only when ip itself says so (exit 2, "Network is unreachable"). A docker/exec error
  # or a missing tool is not evidence of isolation.
  if [ "$rc" -eq 0 ]; then routable=$((routable + 1))
  elif ! grep -q 'Network is unreachable' <<<"$r" || grep -qiE 'Error response from daemon|No such container|executable file not found|not found' <<<"$r"; then toolerr=$((toolerr + 1)); fi
done
[ "$toolerr" -eq 0 ] || fail "nested host: $toolerr route lookups failed as commands, not as 'unreachable' ($out/host-route-get.txt)"
[ "$routable" -eq 0 ] && [ "$toolerr" -eq 0 ] && pass "nested host: no route to the approved subnet, other private ranges or public ranges (${#probe_dsts[@]} lookups, no packet sent)"
[ "$routable" -eq 0 ] || fail "nested host: $routable destinations are routable ($out/host-route-get.txt)"

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
