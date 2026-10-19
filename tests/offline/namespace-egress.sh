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
#   3. for the edge: its namespace guard counter, and that the one allowed upstream still connects.
# Allowed ingress replies (ESTABLISHED) are not exercised here; the relay boundary test covers them.
# The VM's global firewall is never read or changed.
set -euo pipefail
out="$1"; host="$2"; edge="${3:-}"; upstream="${4:-}"; guard_image="${5:-}"
mkdir -p "$out"
: "${APPROVED_SAMPLE:?APPROVED_SAMPLE (one address inside the approved client subnet, for route lookups only) is required}"
probe_dsts=("$APPROVED_SAMPLE" 10.0.0.1 172.16.0.1 172.31.0.1 192.168.0.1 192.0.2.1 198.51.100.1 203.0.113.1 1.1.1.1 8.8.8.8)
connect_dsts=(192.0.2.1:443 198.51.100.1:443 203.0.113.1:80)
res="$out/summary.txt"; : > "$res"
pass() { echo "PASS $*" | tee -a "$res"; }
fail() { echo "FAIL $*" | tee -a "$res"; }

ns_sh() { # <container> <script>: run in that container's network namespace with the guard image's tools
  docker run --rm --network "container:$1" --cap-drop ALL --entrypoint sh "${guard_image:-docker:29.8.2-dind}" -c "$2"
}

# --- nested host: no route anywhere outside its internal lab network ------------------------------
docker exec "$host" ip -4 route > "$out/host-routes.txt"
docker exec "$host" sh -c 'cat /proc/sys/net/ipv4/ip_forward' > "$out/host-ip-forward.txt"
bad=0
for d in "${probe_dsts[@]}"; do
  r="$(docker exec "$host" ip -4 route get "$d" 2>&1 || true)"
  echo "$d: $r" >> "$out/host-route-get.txt"
  case "$r" in *unreachable*) ;; *) bad=$((bad+1));; esac
done
[ "$bad" -eq 0 ] && pass "nested host: no route to the approved subnet, other private ranges or public ranges (${#probe_dsts[@]} lookups, no packet sent)" \
                 || fail "nested host: $bad destinations are routable ($out/host-route-get.txt)"

[ -n "$edge" ] || exit 0
# --- edge: routes exist (published bridge), so the namespace guard must stop NEW connections --------
ns_sh "$edge" 'ip -4 route; cat /proc/sys/net/ipv4/ip_forward' > "$out/edge-routes.txt"
before="$(docker run --rm --network "container:$edge" --cap-drop ALL --cap-add NET_ADMIN --entrypoint sh "$guard_image" -c 'iptables -L OUTPUT -v -n -x' | awk '/SEYRA_EDGE_EGRESS_DROP/{print $1}')"
# Disposable sinks on the edge's own networks (same L2 segment, so routing alone would allow them).
sinks=()
for net in $(docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$edge"); do
  name="seyra-egress-sink-$net-$$"
  docker run -d --rm --name "$name" --label seyra.egress-test=1 --network "$net" --cap-drop ALL --entrypoint sh "$guard_image" -c 'nc -lk -p 9 -e true' >/dev/null
  sinks+=("$name")
  ip="$(docker container inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$name")"
  connect_dsts+=("$ip:9")
done
trap 'for s in "${sinks[@]}"; do docker rm -f "$s" >/dev/null 2>&1 || true; done' EXIT
blocked=0
for d in "${connect_dsts[@]}"; do
  r="$(ns_sh "$edge" "nc -w 3 -z ${d%:*} ${d##*:} 2>&1; echo rc=\$?" || true)"
  echo "$d: $r" >> "$out/edge-connect.txt"
  case "$r" in *rc=0*) ;; *) blocked=$((blocked+1));; esac
done
after="$(docker run --rm --network "container:$edge" --cap-drop ALL --cap-add NET_ADMIN --entrypoint sh "$guard_image" -c 'iptables -L OUTPUT -v -n -x' | awk '/SEYRA_EDGE_EGRESS_DROP/{print $1}')"
[ "$blocked" -eq "${#connect_dsts[@]}" ] && pass "edge: ${#connect_dsts[@]} NEW connections (documentation addresses and own-network sinks) refused" \
                                       || fail "edge: $(( ${#connect_dsts[@]} - blocked )) NEW connections succeeded ($out/edge-connect.txt)"
[ "$(( after - before ))" -ge "${#connect_dsts[@]}" ] && pass "edge: guard drop counter rose by $(( after - before )) (packets stopped inside the namespace)" \
                                                     || fail "edge: guard counter ${before} -> ${after}"
r="$(ns_sh "$edge" "nc -w 3 -z ${upstream%:*} ${upstream##*:}; echo rc=\$?" || true)"
case "$r" in *rc=0*) pass "edge: the one allowed upstream $upstream connects";; *) fail "edge: upstream $upstream not reachable ($r)";; esac
