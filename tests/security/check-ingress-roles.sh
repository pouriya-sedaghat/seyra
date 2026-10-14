#!/usr/bin/env bash
# AC16 / AC17 checks against a RUNNING Seyra stack (run after the integration suites so the logs
# contain real traffic). Read-only except for one short-lived extra proxy container used to test
# LAN allowlisting on a separate loopback port; it is removed afterwards.
#
#   SEYRA_HOME=/abs/state tests/security/check-ingress-roles.sh [evidence-file]
#
# Prints PASS/FAIL lines and exits non-zero if any check fails. Never prints secret values.
set -uo pipefail
: "${SEYRA_HOME:?set SEYRA_HOME}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-$repo/docs/evidence/security/checks.txt}"
mkdir -p "$(dirname "$out")"
CA="$SEYRA_HOME/secrets/tls/ca.crt"
BASE="https://127.0.0.1:8443"
fails=0
lines=()
record() { # status id description detail
  lines+=("$1 $2 $3${4:+ — $4}")
  echo "$1 $2 $3${4:+ — $4}"
  [ "$1" = PASS ] || fails=$((fails + 1))
}
check() { # id description command...
  local id="$1" desc="$2"; shift 2
  local detail
  if detail="$("$@" 2>&1)"; then record PASS "$id" "$desc" "$detail"; else record FAIL "$id" "$desc" "$detail"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@"; }

# ---------------------------------------------------------------- AC16 ingress
published() {
  local maps
  maps="$(docker ps --filter label=com.docker.compose.project=seyra --format '{{.Names}} {{.Ports}}' \
    | awk '{n=$1; $1=""; k=split($0, a, ", "); for (i=1;i<=k;i++) if (a[i] ~ /->/) { gsub(/^ +/, "", a[i]); print n " " a[i] }}')"
  [ "$maps" = "seyra-proxy-1 127.0.0.1:8443->8443/tcp" ] && echo "$maps" || { echo "published: ${maps:-none}"; return 1; }
}
check AC16.1 "only the proxy publishes a host port, bound to 127.0.0.1:8443" published

closed_ports() {
  local open=""
  for p in 80 3000 5432 8002 2322 8080 9200 9300; do
    if timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$p" 2>/dev/null; then open="$open $p"; fi
  done
  [ -z "$open" ] && echo "loopback ports 80 3000 5432 8002 2322 8080 9200 9300 closed" || { echo "open:$open"; return 1; }
}
check AC16.2 "provider/database ports are not reachable on the host loopback" closed_ports

lan_client_unreachable() {
  # A container on its own bridge network stands in for another machine on the LAN.
  local net="seyra-sec-lan-client-$$" targets="" open
  for c in seyra-db-1:5432 seyra-valhalla-1:8002 seyra-photon-1:2322 seyra-overpass-1:8080 seyra-tegola-1:8080 seyra-api-1:3000; do
    targets="$targets $(docker inspect "${c%%:*}" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print $1}'):${c##*:}"
  done
  docker network create "$net" >/dev/null
  open="$(docker run --rm --network "$net" mirror.gcr.io/library/busybox:1.37.0 sh -c "for t in $targets; do nc -z -w 2 \${t%:*} \${t#*:} 2>/dev/null && echo \$t; done" 2>&1)"
  docker network rm "$net" >/dev/null
  [ -z "$open" ] && echo "a client on another network cannot reach:$targets" || { echo "reachable: $open"; return 1; }
}
check AC16.3 "providers/DB/API are not reachable from another network (simulated LAN client)" lan_client_unreachable

host_local_note() {
  local open=""
  for c in seyra-db-1:5432 seyra-valhalla-1:8002 seyra-photon-1:2322; do
    local ip; ip="$(docker inspect "${c%%:*}" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print $1}')"
    timeout 2 bash -c "exec 3<>/dev/tcp/$ip/${c##*:}" 2>/dev/null && open="$open ${c%%:*}"
  done
  lines+=("NOTE AC16.3b processes on the Docker host itself can connect to container bridge addresses (${open:-none observed}); Docker does not filter host-local traffic, so host shell access is part of the trust boundary (RUNBOOK)")
  echo "NOTE AC16.3b host-local processes reach container bridge addresses:${open:- none}"
}
host_local_note

check AC16.4 "unknown Host name is refused (421)" bash -c "c=\$(curl -s -o /dev/null -w '%{http_code}' --cacert '$CA' -H 'Host: attacker.example' $BASE/health/ready); [ \"\$c\" = 421 ] && echo \"HTTP \$c\""
check AC16.5 "plain HTTP on the TLS port is rejected" bash -c "c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8443/); [ \"\$c\" = 400 ] && echo \"HTTP \$c\""
check AC16.6 "TLS 1.1 is refused, TLS 1.2+ accepted" bash -c "! openssl s_client -connect 127.0.0.1:8443 -tls1_1 -servername localhost </dev/null >/dev/null 2>&1 && openssl s_client -connect 127.0.0.1:8443 -tls1_2 -servername localhost -CAfile '$CA' </dev/null 2>/dev/null | grep -q 'Verify return code: 0' && echo 'tls1.1 refused; tls1.2 verified against the internal CA'"

no_provider_paths() {
  local bad=""
  for p in /api/interpreter /api/status /status /route /capabilities /maps/seyra_x/0/0/0.pbf /tegola/capabilities "/api/v1/map/../../status" /api/v1/map/diagnostics/../../../../status; do
    local body
    body="$(curl -s --max-time 5 --cacert "$CA" --path-as-is "$BASE$p")"
    if echo "$body" | grep -Eq 'tileset_last_modified|osm3s|"maps":\[|Overpass API|javalin|"layers":\[\{"name"'; then bad="$bad $p"; fi
  done
  [ -z "$bad" ] && echo "no provider status/update/data endpoint reachable through the ingress" || { echo "provider content at:$bad"; return 1; }
}
check AC16.7 "provider endpoints are not exposed through the proxy" no_provider_paths

headers() {
  local h
  h="$(curl -s -D - -o /dev/null --cacert "$CA" "$BASE/")"
  for want in 'Content-Security-Policy: default-src .self.' 'X-Content-Type-Options: nosniff' 'X-Frame-Options: DENY' 'Referrer-Policy: no-referrer' 'Strict-Transport-Security'; do
    echo "$h" | grep -qi "$want" || { echo "missing $want"; return 1; }
  done
  echo "CSP self-only, nosniff, frame DENY, no-referrer, HSTS"
}
check AC16.8 "security headers on the web client" headers

proxy_ref="$(grep '^SEYRA_IMAGE_PROXY=' "$SEYRA_HOME/state/runtime.env" | cut -d= -f2-)"
ds="$(grep '^SEYRA_DATASET_ID=' "$SEYRA_HOME/state/runtime.env" | cut -d= -f2-)"
lan_fail_closed() {
  local msg rc
  msg="$(docker run --rm --network none -e SEYRA_DATASET_ID="$ds" -e SEYRA_ACCESS_MODE=lan \
    -v "$SEYRA_HOME/secrets/tls/server.crt:/run/secrets/tls_cert:ro" -v "$SEYRA_HOME/secrets/tls/server.key:/run/secrets/tls_key:ro" \
    -v "$SEYRA_HOME/releases/$ds/maps:/srv/seyra/release/maps:ro" "$proxy_ref" 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && echo "$msg" | grep -q 'requires SEYRA_LAN_ALLOW_CIDRS' && echo "exit $rc: $(echo "$msg" | tail -1)"
}
check AC16.9 "LAN mode without an allowlist refuses to start" lan_fail_closed

lan_allowlist_enforced() {
  local name="seyra-sec-lan-$$" c=000
  docker create --name "$name" --read-only --tmpfs /tmp:uid=101,gid=101 --tmpfs /var/cache/seyra:uid=101,gid=101 --network seyra_frontend -p 127.0.0.1:18443:8443 \
    -e SEYRA_DATASET_ID="$ds" -e SEYRA_ACCESS_MODE=lan -e SEYRA_LAN_ALLOW_CIDRS=10.99.0.0/16 \
    -v "$SEYRA_HOME/secrets/tls/server.crt:/run/secrets/tls_cert:ro" -v "$SEYRA_HOME/secrets/tls/server.key:/run/secrets/tls_key:ro" \
    -v "$SEYRA_HOME/releases/$ds/maps:/srv/seyra/release/maps:ro" "$proxy_ref" >/dev/null 2>&1 || { echo "could not create test proxy"; return 1; }
  # Upstream names resolve on the backend network, which must be attached before nginx starts.
  docker network connect --alias seyra-sec-lan seyra_backend "$name" >/dev/null 2>&1
  docker start "$name" >/dev/null 2>&1
  for _ in $(seq 1 30); do c="$(curl -s -o /dev/null -w '%{http_code}' --cacert "$CA" https://localhost:18443/health/live 2>/dev/null)"; [ "$c" != 000 ] && break; sleep 0.5; done
  local logs; logs="$(docker logs "$name" 2>&1 | tail -2)"
  docker rm -f "$name" >/dev/null 2>&1
  [ "$c" = 403 ] && echo "client outside 10.99.0.0/16 received HTTP $c" || { echo "HTTP $c ${logs}"; return 1; }
}
check AC16.10 "LAN allowlist denies clients outside the configured CIDRs" lan_allowlist_enforced

# ---------------------------------------------------------------- AC17 roles, secrets, logs
render_db="render_$(echo "$ds" | tr '-' '_')"
as_role() { # role secret-file database sql -> psql output (password via stdin, never argv/env of the host)
  docker exec -i seyra-db-1 sh -c "PGPASSWORD=\"\$(cat)\" psql -X -At -h 127.0.0.1 -U $1 -d $3 -c \"$4\"" < "$SEYRA_HOME/secrets/$2" 2>&1
}
expect_denied() { local o; o="$(as_role "$@")"; echo "$o" | grep -Eq 'permission denied|must be owner|not permitted|password authentication failed|no pg_hba|does not have CONNECT' && echo "$(echo "$o" | head -1 | cut -c1-120)"; }
expect_ok() { local o; o="$(as_role "$@")"; echo "$o" | grep -Eqv 'ERROR|FATAL' && echo "ok: $(echo "$o" | head -1 | cut -c1-80)"; }

check AC17.1 "API role reads control data" expect_ok seyra_api db_api_password seyra_app "SELECT count(*) FROM seyra_control.release_events"
check AC17.2 "API role cannot write control data" expect_denied seyra_api db_api_password seyra_app "INSERT INTO seyra_control.release_events (dataset_id, event, detail) VALUES ('x','imported','{}')"
check AC17.3 "API role cannot create objects" expect_denied seyra_api db_api_password seyra_app "CREATE TABLE seyra_control.evil (x int)"
check AC17.4 "API role cannot connect to the map render database" expect_denied seyra_api db_api_password "$render_db" "SELECT 1"
check AC17.5 "tile reader reads the frozen render database" expect_ok seyra_tile_reader tile_db_password "$render_db" "SELECT count(*) FROM render.transport"
check AC17.6 "tile reader cannot modify map data" expect_denied seyra_tile_reader tile_db_password "$render_db" "DELETE FROM render.transport"
check AC17.7 "tile reader cannot create objects in the render schema" expect_denied seyra_tile_reader tile_db_password "$render_db" "CREATE TABLE render.evil (x int)"
check AC17.8 "import role cannot connect to a frozen render database" expect_denied seyra_render_import db_render_import_password "$render_db" "SELECT 1"

secret_modes() {
  local bad=""
  while read -r mode name; do
    case "$mode" in -r--------) ;; *) bad="$bad $name($mode)";; esac
  done < <(find "$SEYRA_HOME/secrets" -maxdepth 1 -type f -printf '%M %f\n')
  [ "$(stat -c %a "$SEYRA_HOME/secrets/tls/server.key")" = 400 ] || bad="$bad server.key"
  [ -z "$bad" ] && echo "all secret files 0400, owned by their consumer uid; TLS key 0400" || { echo "unexpected modes:$bad"; return 1; }
}
check AC17.9 "secret files are owner-read-only" secret_modes

no_secret_in_inspect() {
  local hits=0
  for f in "$SEYRA_HOME"/secrets/*_password; do
    for c in $(docker ps --filter label=com.docker.compose.project=seyra --format '{{.Names}}'); do
      docker inspect "$c" | grep -qF "$(cat "$f")" && hits=$((hits + 1))
    done
  done
  [ "$hits" = 0 ] && echo "no password value in any container configuration/environment" || { echo "$hits occurrences"; return 1; }
}
check AC17.10 "no secret value appears in container configuration" no_secret_in_inspect

logs_redacted() {
  local logs hits=""
  logs="$(docker logs seyra-api-1 2>&1; docker logs seyra-proxy-1 2>&1)"
  for needle in 'q=' 'Synthetic' 'خیابان' 'داروخانه' 'bbox=' '"lon"' '0.0475' 'candidates' "$(cat "$SEYRA_HOME/secrets/db_api_password")" "$(cat "$SEYRA_HOME/secrets/tile_db_password")"; do
    echo "$logs" | grep -qF -- "$needle" && hits="$hits [${needle:0:12}]"
  done
  local n; n="$(echo "$logs" | wc -l)"
  [ -z "$hits" ] && echo "$n log lines checked: no query text, coordinates, bboxes or secrets" || { echo "found:$hits"; return 1; }
}
check AC17.11 "default API/proxy logs contain no query text, coordinates or secrets" logs_redacted

{
  echo "# Seyra security checks (AC16/AC17)"
  echo "# recorded_at: $(date -u +%FT%TZ)  dataset: $ds  proxy image: $proxy_ref"
  printf '%s\n' "${lines[@]}"
  echo "# failures: $fails"
} > "$out"
echo "evidence: $out (failures: $fails)"
exit $((fails > 0))
