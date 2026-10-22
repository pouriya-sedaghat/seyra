#!/usr/bin/env bash
# Operator commands for the Seyra edge relay (nested-host topology only; RUNBOOK §6.2). All values
# come from an operator-local env file (see edge.env.example); nothing operational is committed.
#
#   infra/edge/edge.sh <env-file> check      exact-image checks: identity, stream module, nginx -t
#   infra/edge/edge.sh <env-file> up         start the edge, apply its namespace egress guard, attach it
#                                            to the lab network and print the relay peer address
#   infra/edge/edge.sh <env-file> status     container, publication, peer address, guard counters
#   infra/edge/edge.sh <env-file> stop       stop the edge, only with evidence that the serving
#                                            installation no longer trusts its exact lab address
#                                            (see trust_removed); --force: emergency only
#   infra/edge/edge.sh <env-file> remove     remove the stopped edge and its publish network
#
# Rollback order: seyra-maps init --no-relay; access apply; proxy restart (the inner proxy stops
# trusting the edge address and the LAN path closes), THEN edge.sh stop and remove. A stopped
# container releases its lab address at once and Docker hands it to the next container, so the
# inner relay must never trust that address while the edge is stopped. An ordinary stop therefore
# reads the serving installation's state (read-only: EDGE_INNER_DOCKER_HOST, the nested daemon, and
# EDGE_INNER_HOME, its SEYRA_HOME); it never changes that installation.
#
# Fail closed: every container/network this script changes must carry its owner label, and the
# preserved serving host is never modified (it is only the upstream address).
set -euo pipefail
envfile="${1:?usage: edge.sh <env-file> check|up|status|stop [--force]|remove}"
cmd="${2:?usage: edge.sh <env-file> check|up|status|stop [--force]|remove}"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1090
set -a; . "$envfile"; set +a
: "${EDGE_NAME:=seyra-edge}" "${EDGE_PUBLISH_NETWORK:=seyra_edge}" "${EDGE_LAB_NETWORK:=seyra_offline_lab}"
: "${EDGE_OWNER:?EDGE_OWNER (owner label value) is required}"
: "${EDGE_IMAGE:?}" "${EDGE_IMAGE_ID:?}" "${EDGE_GUARD_IMAGE:?}" "${EDGE_GUARD_IMAGE_ID:?}"
: "${EDGE_PUBLISH_ADDR:?}" "${EDGE_PUBLISH_PORT:?}" "${EDGE_CLIENT_CIDRS:?}" "${EDGE_UPSTREAM:?}" "${EDGE_CONF_DIR:?}"
LABEL="seyra.edge.owner=$EDGE_OWNER"
die() { echo "edge: $*" >&2; exit 2; }
image_ok() { [ "$(docker image inspect -f '{{.Id}}' "$1" 2>/dev/null)" = "$2" ] || die "image $1 is not the expected $2"; }
owned_container() { [ "$(docker container inspect -f '{{index .Config.Labels "seyra.edge.owner"}}' "$EDGE_NAME" 2>/dev/null)" = "$EDGE_OWNER" ]; }
owned_network() { [ "$(docker network inspect -f '{{index .Labels "seyra.edge.owner"}}' "$EDGE_PUBLISH_NETWORK" 2>/dev/null)" = "$EDGE_OWNER" ]; }
up_ip=${EDGE_UPSTREAM%:*}; up_port=${EDGE_UPSTREAM##*:}

check() {
  image_ok "$EDGE_IMAGE" "$EDGE_IMAGE_ID"
  image_ok "$EDGE_GUARD_IMAGE" "$EDGE_GUARD_IMAGE_ID"
  EDGE_SOURCE="" sh "$here/render-edge.sh" "$EDGE_CONF_DIR"
  local v; v="$(docker run --rm --network none --entrypoint nginx "$EDGE_IMAGE" -V 2>&1)"
  grep -q -- '--with-stream' <<<"$v" || die "edge image nginx lacks the stream module"
  # The exact image parses the exact rendered configuration (stream + proxy_protocol + access).
  docker run --rm --network none --read-only --tmpfs /tmp:uid=101,gid=101 -v "$EDGE_CONF_DIR/edge.conf:/etc/seyra-edge/edge.conf:ro" \
    --entrypoint nginx "$EDGE_IMAGE" -t -c /etc/seyra-edge/edge.conf
  echo "edge: check passed ($EDGE_IMAGE_ID; upstream $EDGE_UPSTREAM; publish $EDGE_PUBLISH_ADDR:$EDGE_PUBLISH_PORT)"
}

guard() {
  # Namespace-local egress guard (the edge's own network namespace, not the VM's firewall): new
  # outbound connections are allowed only to the relay upstream; replies to accepted client
  # connections stay allowed. A blocked connect fails with EPERM before any packet leaves.
  docker run --rm --network "container:$EDGE_NAME" --cap-drop ALL --cap-add NET_ADMIN --cap-add NET_RAW --entrypoint sh "$EDGE_GUARD_IMAGE" -c "
    set -e
    for t in iptables ip6tables; do
      \$t -F OUTPUT
      \$t -A OUTPUT -o lo -j ACCEPT
      \$t -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    done
    iptables -A OUTPUT -p tcp -d $up_ip --dport $up_port -m conntrack --ctstate NEW -j ACCEPT
    iptables -A OUTPUT -m comment --comment SEYRA_EDGE_EGRESS_DROP -j DROP
    ip6tables -A OUTPUT -m comment --comment SEYRA_EDGE_EGRESS_DROP -j DROP
    iptables -P OUTPUT DROP; ip6tables -P OUTPUT DROP
    iptables -S OUTPUT"
}

up() {
  check
  docker container inspect "$EDGE_NAME" >/dev/null 2>&1 && die "container $EDGE_NAME already exists; inspect it (status) or remove it deliberately"
  if docker network inspect "$EDGE_PUBLISH_NETWORK" >/dev/null 2>&1; then
    owned_network || die "network $EDGE_PUBLISH_NETWORK exists without this owner's label; refusing to use it"
  else
    # Publishing needs a non-internal bridge; no masquerade (the edge has no business initiating
    # outbound traffic) and no inter-container traffic on it.
    docker network create --label "$LABEL" -o com.docker.network.bridge.enable_ip_masquerade=false -o com.docker.network.bridge.enable_icc=false "$EDGE_PUBLISH_NETWORK" >/dev/null
  fi
  docker run -d --name "$EDGE_NAME" --label "$LABEL" --restart no \
    --read-only --tmpfs /tmp:uid=101,gid=101 --cap-drop ALL --security-opt no-new-privileges \
    --memory 64m --pids-limit 64 --network "$EDGE_PUBLISH_NETWORK" \
    -p "$EDGE_PUBLISH_ADDR:$EDGE_PUBLISH_PORT:8443" \
    -v "$EDGE_CONF_DIR/edge.conf:/etc/seyra-edge/edge.conf:ro" \
    --entrypoint nginx "$EDGE_IMAGE" -c /etc/seyra-edge/edge.conf -g 'daemon off;' >/dev/null
  guard || { docker rm -f "$EDGE_NAME" >/dev/null; die "egress guard failed; edge removed"; }
  # The lab network has no user-configured subnet, so the address is assigned here: it becomes the
  # inner proxy's exact relay peer. Recreating the edge requires re-checking it.
  docker network connect "$EDGE_LAB_NETWORK" "$EDGE_NAME"
  local ip; ip="$(docker container inspect -f "{{(index .NetworkSettings.Networks \"$EDGE_LAB_NETWORK\").IPAddress}}" "$EDGE_NAME")"
  [ -n "$ip" ] || die "no address on $EDGE_LAB_NETWORK"
  echo "edge: up; relay peer address on $EDGE_LAB_NETWORK: $ip"
  echo "edge: configure the inner proxy with --relay-peer $ip, then seyra-maps access apply && seyra-maps proxy restart"
}

status() {
  owned_container || { echo "edge: no container $EDGE_NAME with owner $EDGE_OWNER"; return 0; }
  docker container inspect -f 'edge: {{.Name}} {{.State.Status}} started={{.State.StartedAt}} restarts={{.RestartCount}} image={{.Image}}' "$EDGE_NAME"
  docker port "$EDGE_NAME" 8443/tcp || true
  docker container inspect -f "edge: lab address {{(index .NetworkSettings.Networks \"$EDGE_LAB_NETWORK\").IPAddress}}" "$EDGE_NAME" 2>/dev/null || true
  docker run --rm --network "container:$EDGE_NAME" --cap-drop ALL --cap-add NET_ADMIN --entrypoint sh "$EDGE_GUARD_IMAGE" -c 'iptables -L OUTPUT -v -n -x | grep -E "SEYRA_EDGE_EGRESS_DROP|policy"' || true
}

# Evidence that the serving installation no longer trusts this edge's exact lab address. A refused or
# timed-out TCP connection proves nothing (a stopped or restarting proxy keeps its configured trust
# and re-applies it on start), so the relay port is not probed. Required, for address $1:
#   1. persistent intent: <home>/state/settings.json is read and its relayPeer is not $1;
#   2. applied state: exactly one proxy container of the installation exists, running (not
#      restarting, paused or dead); its SEYRA_RELAY_PEER is not $1; and with no relay peer it
#      publishes no relay port (container port 8444);
#   3. persistent applied config: <home>/state/runtime.env (root-only; not read) has not changed
#      (ctime, which a copy or rename cannot preserve) since that proxy container was created, so
#      the running environment is exactly what a restart would apply.
# Prints the evidence; returns 1 with the reason on anything else (unreadable, failed inspection,
# stale, inconsistent or still trusted).
trust_removed() { # edge-lab-address
  local addr="$1" inner="${EDGE_INNER_DOCKER_HOST:-}" home="${EDGE_INNER_HOME:-}" peer ids n pid st env_peer ports created ctime_rt created_s
  [ -n "$inner" ] && [ -n "$home" ] || { echo "EDGE_INNER_DOCKER_HOST and EDGE_INNER_HOME are not set, so the trust state cannot be read"; return 1; }
  command -v jq >/dev/null || { echo "jq is required to read settings.json"; return 1; }
  peer="$(jq -er '.relayPeer // ""' "$home/state/settings.json" 2>&1)" || { echo "cannot read $home/state/settings.json ($peer)"; return 1; }
  [ "$peer" != "$addr" ] || { echo "settings.json still names $addr as the relay peer"; return 1; }
  ids="$(docker -H "$inner" ps -a -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=proxy 2>&1)" || { echo "cannot list the serving proxy ($ids)"; return 1; }
  n="$(printf '%s\n' "$ids" | grep -c . || true)"
  [ "$n" = 1 ] || { echo "expected exactly one serving proxy container, found $n"; return 1; }
  pid="$ids"
  st="$(docker -H "$inner" container inspect -f '{{.State.Status}} {{.State.Running}} {{.State.Restarting}} {{.State.Paused}} {{.Created}}' "$pid" 2>&1)" || { echo "cannot inspect the serving proxy ($st)"; return 1; }
  local status running restarting paused
  read -r status running restarting paused created <<<"$st"
  [ "$status $running $restarting $paused" = "running true false false" ] && [ -n "$created" ] || { echo "the serving proxy is not plainly running (${status:-?} running=${running:-?} restarting=${restarting:-?} paused=${paused:-?}); its configured trust would apply on start"; return 1; }
  env_peer="$(docker -H "$inner" container inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$pid" 2>&1)" || { echo "cannot read the serving proxy environment"; return 1; }
  printf '%s\n' "$env_peer" | grep -q '^SEYRA_DATASET_ID=' || { echo "the serving proxy environment is not readable as expected"; return 1; }
  env_peer="$(printf '%s\n' "$env_peer" | sed -n 's/^SEYRA_RELAY_PEER=//p')"
  [ "$env_peer" != "$addr" ] || { echo "the running proxy still trusts $addr (SEYRA_RELAY_PEER)"; return 1; }
  ports="$(docker -H "$inner" container inspect -f '{{json .HostConfig.PortBindings}}' "$pid" 2>&1)" || { echo "cannot read the serving proxy port bindings"; return 1; }
  if [ -z "$env_peer" ] && grep -q '"8444/tcp"' <<<"$ports"; then echo "the running proxy has no relay peer but still publishes the relay port"; return 1; fi
  ctime_rt="$(stat -c '%.9Z' "$home/state/runtime.env" 2>&1)" || { echo "cannot stat $home/state/runtime.env ($ctime_rt)"; return 1; }
  created_s="$(date -d "$created" +%s.%N 2>&1)" || { echo "cannot parse the proxy creation time ($created)"; return 1; }
  awk -v a="$ctime_rt" -v b="$created_s" 'BEGIN { exit !(a < b) }' || { echo "runtime.env changed after the running proxy was created (apply it with proxy restart first)"; return 1; }
  echo "settings relayPeer='${peer}', running proxy SEYRA_RELAY_PEER='${env_peer}', relay port $( [ -z "$env_peer" ] && echo unpublished || echo "for another peer"), runtime.env unchanged since the proxy was created"
}

stop() {
  owned_container || die "no container $EDGE_NAME with owner $EDGE_OWNER; nothing changed"
  local running addr why
  running="$(docker container inspect -f '{{.State.Running}}' "$EDGE_NAME" 2>&1)" || die "cannot inspect $EDGE_NAME ($running); nothing changed"
  case "$running" in
    true) ;;
    false) echo "edge: $EDGE_NAME is not running; nothing to stop"; return 0 ;;
    *) die "cannot establish whether $EDGE_NAME is running ('$running'); nothing changed" ;;
  esac
  if [ "${1:-}" != --force ]; then
    addr="$(docker container inspect -f "{{with index .NetworkSettings.Networks \"$EDGE_LAB_NETWORK\"}}{{.IPAddress}}{{end}}" "$EDGE_NAME" 2>&1)" || die "cannot read the edge's address on $EDGE_LAB_NETWORK ($addr); nothing changed"
    [ -n "$addr" ] || die "the edge has no address on $EDGE_LAB_NETWORK; nothing changed"
    why="$(trust_removed "$addr")" || die "refusing to stop: $why. Stopping would release $addr for reuse while it may still be trusted. First: seyra-maps init --no-relay; access apply; proxy restart. Nothing changed (emergency only: stop --force)"
    echo "edge: relay trust for $addr removed: $why"
  else
    echo "edge: WARNING --force: stopping without evidence; if the serving proxy still trusts this edge's address, any container that receives it can claim approved clients. Remove that trust now (init --no-relay; access apply; proxy restart)" >&2
  fi
  docker stop "$EDGE_NAME" >/dev/null
  echo "edge: stopped; the LAN path is closed. Next: edge.sh remove"
}

remove() {
  owned_container || die "no container $EDGE_NAME with owner $EDGE_OWNER; nothing changed"
  [ "$(docker container inspect -f '{{.State.Running}}' "$EDGE_NAME")" = false ] || die "stop the edge first"
  docker rm "$EDGE_NAME" >/dev/null
  if owned_network && [ -z "$(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$EDGE_PUBLISH_NETWORK")" ]; then
    docker network rm "$EDGE_PUBLISH_NETWORK" >/dev/null
  fi
  echo "edge: removed"
}

case "$cmd" in check) check;; up) up;; status) status;; stop) stop "${3:-}";; remove) remove;; *) die "unknown command $cmd";; esac
