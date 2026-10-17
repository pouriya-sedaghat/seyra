#!/usr/bin/env bash
# Fresh-host restore drill (RUNBOOK §7): a backup taken on one offline host is restored onto a
# second, newly created offline host that never saw the first one's Docker state or SEYRA_HOME.
# Install and rollback are NOT counted as restoration; the drill passes only when the second host
# serves the backed-up active release (same dataset id), holds the backed-up control-database rows
# and settings, and its database roles authenticate with the restored secrets.
#
# Both hosts are Docker-in-Docker daemons (test tooling) on a Docker --internal network with the
# same egress counters as offline-host.sh; they run one after the other (host 1 is destroyed before
# host 2 is created, as after a lost machine). The developer's firewall is not touched.
#
#   BUNDLE=/abs/bundle FIXTURE=/abs/synthetic-v1.osm.pbf LAB=/abs/lab DIND_IMAGE=docker:29.8.2-dind \
#     tests/offline/restore-drill.sh
#
# Writes docs/evidence/restore/*. Exits non-zero on any FAIL.
set -uo pipefail
: "${BUNDLE:?}" "${FIXTURE:?}" "${LAB:?}" "${DIND_IMAGE:?}"
repo="${SEYRA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
ev="$repo/docs/evidence/restore"
mkdir -p "$ev" "$LAB"
rm -f "$ev"/*.log "$ev"/*.txt
net=seyra_offline_lab
sock_dir="$LAB/run"
export SEYRA_HOME="$LAB/home"
inst="$LAB/install"
bk="$LAB/backup"            # what `seyra-maps backup` wrote (operator's backup medium)
sbk="$LAB/secrets-backup"   # the operator's separate secrets backup (never inside `backup`)
summary=()
fails=0
result() { summary+=("$1 $2 $3"); echo "== $1 $2 $3"; [ "$1" = PASS ] || fails=$((fails + 1)); }
D() { DOCKER_HOST="unix://$sock_dir/docker.sock" docker "$@"; }
cli() { DOCKER_HOST="unix://$sock_dir/docker.sock" "$inst/bin/seyra-maps" "$@"; }
name=""
in_host() { docker exec "$name" "$@"; }
egress_count() { in_host sh -c "iptables -L SEYRA_EGRESS -v -n -x | awk '/COUNT/ {print \$1}'"; }
ready_ds() {
  D run --rm --network host --pull never -v "$SEYRA_HOME/secrets/tls/ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt --entrypoint node \
    "$(jq -r '.images.ops.ref' "$inst/infra/dependencies.lock.json")" \
    -e "fetch('https://127.0.0.1:8443/health/ready').then(r=>r.json()).then(b=>console.log(b.status==='ready'?b.dataset_id:''),()=>console.log(''))" 2>/dev/null
}
# Control DB query as the admin over the db container's local socket.
q() { D exec -i "$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=db)" psql -X -q -At -U seyra_admin -d seyra_app -c "$1"; }
# The API role logging in over TCP with the password from the (restored) secret file.
api_login() {
  PGPASSWORD="$(cat "$SEYRA_HOME/secrets/db_api_password")" D exec -i -e PGPASSWORD "$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=db)" \
    psql -X -At -h 127.0.0.1 -U seyra_api -d seyra_app -c 'SELECT count(*) FROM seyra_control.release_events'
}
# Files in the backup (plain or inside its archives) containing any secret value or private-key line.
secret_leaks() {
  local needles; needles="$(mktemp)"
  for f in "$SEYRA_HOME"/secrets/db_* "$SEYRA_HOME"/secrets/tile_db_password; do tr -d '\n' < "$f"; echo; done > "$needles"
  for k in "$SEYRA_HOME"/secrets/tls/*.key; do sed -n 2p "$k"; done >> "$needles"
  grep -rlFf "$needles" "$bk"
  for t in "$bk"/*.tar.gz; do tar -xzOf "$t" | grep -qFf "$needles" && echo "$t"; done
  rm -f "$needles"
}

new_host() { # $1 = container name; a fresh, empty offline daemon
  name="$1"
  docker rm -f "$name" >/dev/null 2>&1
  docker volume rm "$name-docker" >/dev/null 2>&1
  rm -rf "${LAB:?}/home" "${LAB:?}/install" "${LAB:?}/run"
  docker network inspect "$net" >/dev/null 2>&1 || docker network create --internal "$net" >/dev/null
  mkdir -p "$sock_dir" "$SEYRA_HOME"
  docker run -d --privileged --name "$name" --network "$net" --pull never \
    -v "$LAB:$LAB" -v "$BUNDLE:$BUNDLE:ro" -v "$(dirname "$FIXTURE"):$(dirname "$FIXTURE"):ro" \
    -v "$name-docker:/var/lib/docker" \
    "$DIND_IMAGE" dockerd -H unix:///var/run/docker.sock -H "unix://$sock_dir/docker.sock" --tls=false >/dev/null
  for _ in $(seq 1 60); do D info >/dev/null 2>&1 && break; sleep 1; done
  local gw
  gw="$(docker inspect "$net" -f '{{(index .IPAM.Config 0).Subnet}}' | sed -E 's#\.[0-9]+/[0-9]+$#.250#')"
  in_host sh -c "ip route add default via $gw 2>/dev/null; iptables -N SEYRA_EGRESS; \
    iptables -A SEYRA_EGRESS -p igmp -d 224.0.0.0/4 -m comment --comment IGMP -j RETURN; \
    iptables -A SEYRA_EGRESS -d 127.0.0.0/8 -j RETURN; iptables -A SEYRA_EGRESS -d 172.16.0.0/12 -j RETURN; \
    iptables -A SEYRA_EGRESS -d 192.168.0.0/16 -j RETURN; iptables -A SEYRA_EGRESS -d 10.0.0.0/8 -j RETURN; \
    iptables -A SEYRA_EGRESS -m comment --comment COUNT -j DROP; \
    iptables -I OUTPUT 1 -j SEYRA_EGRESS; iptables -I DOCKER-USER 1 -j SEYRA_EGRESS 2>/dev/null || iptables -I FORWARD 1 -j SEYRA_EGRESS"
  cp -a "$BUNDLE/install" "$inst"
}
drop_host() { docker rm -f "$name" >/dev/null 2>&1; docker volume rm "$name-docker" >/dev/null 2>&1; rm -rf "${LAB:?}/home" "${LAB:?}/run"; }

rm -rf "$bk" "$sbk"
# ================================================================== host 1: build state, back up
new_host seyra-restore-src
e1="$(egress_count)"
cli bootstrap-load "$BUNDLE" > "$ev/R1-src-install.log" 2>&1 \
  && cli init --server-names "localhost 127.0.0.1 seyra-drill.internal" >> "$ev/R1-src-install.log" 2>&1 \
  && cli tls init --names localhost,127.0.0.1 >> "$ev/R1-src-install.log" 2>&1; rc=$?
cli import --pbf "$FIXTURE" --snapshot-timestamp 2026-10-01T00:00:00Z > "$ev/R1-src-import-a.log" 2>&1; rc_a=$?
A="$(grep -o 'release ds-[0-9a-z-]* built' "$ev/R1-src-import-a.log" | awk '{print $2}')"
cli import --pbf "$FIXTURE" --snapshot-timestamp 2026-10-02T00:00:00Z > "$ev/R1-src-import-b.log" 2>&1; rc_b=$?
B="$(grep -o 'release ds-[0-9a-z-]* built' "$ev/R1-src-import-b.log" | awk '{print $2}')"
{ cli activate "$A" && cli activate "$B"; } > "$ev/R1-src-activate.log" 2>&1; rc_act=$?
src_ready="$(ready_ds)"
q "SELECT id, dataset_id, event, occurred_at FROM seyra_control.release_events ORDER BY id" > "$ev/R1-src-events.txt" 2>&1
src_events="$(wc -l < "$ev/R1-src-events.txt")"
if [ $rc -eq 0 ] && [ $rc_a -eq 0 ] && [ $rc_b -eq 0 ] && [ $rc_act -eq 0 ] && [ "$src_ready" = "$B" ] && [ "$src_events" -gt 0 ]; then
  result PASS R1 "source host: active $B, previous $A, ready through the ingress; $src_events control-DB release events; non-default server names"
else
  result FAIL R1 "install=$rc importA=$rc_a importB=$rc_b activate=$rc_act ready=$src_ready events=$src_events"
fi

cli backup --out "$bk" --include-sources > "$ev/R2-backup.log" 2>&1; rc=$?
cp -a "$SEYRA_HOME/secrets" "$sbk"   # the operator's separate secret backup
(cd "$sbk" && find . -type f ! -path './tls/*' -exec sha256sum {} + | sort -k2) > "$ev/.src-secrets.sha"
secret_leaks > "$ev/.secret-leak" 2>/dev/null
ls -l "$bk" "$bk/sources" > "$ev/R2-backup-contents.txt" 2>&1
if [ $rc -eq 0 ] && [ -s "$bk/sources/$A.osm.pbf" ] && [ -s "$bk/sources/$B.osm.pbf" ] && [ ! -s "$ev/.secret-leak" ]; then
  result PASS R2 "backup with --include-sources: control DB dump, state/manifests and both managed inputs; no secret value or private-key material inside the backup or its archives"
else
  result FAIL R2 "rc=$rc (see R2-backup.log; secret files matched: $(cat "$ev/.secret-leak" 2>/dev/null | tr '\n' ' '))"
fi
e1_end="$(egress_count)"
drop_host   # the source machine is gone

# ================================================================== host 2: fresh restore
new_host seyra-restore-dst
e2="$(egress_count)"
cli bootstrap-load "$BUNDLE" > "$ev/R3-dst-install.log" 2>&1; rc=$?
# Out of order: restore before the secrets are back is refused before anything changes.
cli restore --from "$bk" > "$ev/R3-restore-without-secrets.log" 2>&1; rc_ns=$?
if [ $rc -eq 0 ] && [ $rc_ns -ne 0 ] && grep -q 'is missing: restore the secrets backup' "$ev/R3-restore-without-secrets.log" && [ -z "$(D ps -q)" ]; then
  result PASS R3 "fresh host: images loaded; restore before the secrets are restored is refused and starts nothing"
else
  result FAIL R3 "install=$rc restore-without-secrets=$rc_ns containers=$(D ps -q | wc -l)"
fi

# RUNBOOK order: secrets back first, then init (roles get the restored passwords), then restore.
mkdir -p "$SEYRA_HOME" && cp -a "$sbk" "$SEYRA_HOME/secrets"
cli init > "$ev/R4-init.log" 2>&1 && cli restore --from "$bk" > "$ev/R4-restore.log" 2>&1; rc=$?
q "SELECT id, dataset_id, event, occurred_at FROM seyra_control.release_events ORDER BY id" > "$ev/R4-dst-events.txt" 2>&1
login="$(api_login 2>&1)"
if [ $rc -eq 0 ] && cmp -s "$ev/R1-src-events.txt" "$ev/R4-dst-events.txt" && [ "$login" = "$src_events" ] \
  && grep -q 'seyra-drill.internal' "$SEYRA_HOME/state/settings.json"; then
  result PASS R4 "restore replaced the initialised control DB: all $src_events release events identical (ids, timestamps); seyra_api authenticates with the restored secret; settings restored"
else
  result FAIL R4 "rc=$rc events_equal=$(cmp -s "$ev/R1-src-events.txt" "$ev/R4-dst-events.txt" && echo yes || echo no) api_login=$login"
fi

# Rebuild the backed-up releases with the commands restore printed (previous first, then active).
cmds="$(grep -o 'rebuild with: seyra-maps import .*' "$ev/R4-restore.log" | sed 's/^rebuild with: seyra-maps //')"
rc=0; n=0
while read -r line; do
  [ -n "$line" ] || continue
  n=$((n + 1))
  # shellcheck disable=SC2086
  cli $line < /dev/null > "$ev/R5-import-$n.log" 2>&1 || rc=$?   # docker run -i must not eat the command list
done < <(printf '%s\n' "$cmds" | tac)
rA="$(grep -ho 'release ds-[0-9a-z-]* built' "$ev"/R5-import-*.log | awk '{print $2}' | grep -x "$A")"
rB="$(grep -ho 'release ds-[0-9a-z-]* built' "$ev"/R5-import-*.log | awk '{print $2}' | grep -x "$B")"
if [ $rc -eq 0 ] && [ "$n" = 2 ] && [ "$rA" = "$A" ] && [ "$rB" = "$B" ]; then
  result PASS R5 "both backed-up releases rebuilt from the backed-up inputs with the printed commands; dataset ids reproduced ($A, $B)"
else
  result FAIL R5 "rc=$rc commands=$n rebuilt=[$rA] [$rB]"
fi

{ cli activate "$A" && cli activate "$B"; } > "$ev/R6-activate.log" 2>&1; rc=$?
dst_ready="$(ready_ds)"
cli status > "$ev/R6-status.log" 2>&1
(cd "$SEYRA_HOME/secrets" && find . -type f ! -path './tls/*' -exec sha256sum {} + | sort -k2) > "$ev/.dst-secrets.sha"
head -n "$src_events" <(q "SELECT id, dataset_id, event, occurred_at FROM seyra_control.release_events ORDER BY id") > "$ev/.dst-head.txt"
if [ $rc -eq 0 ] && [ "$dst_ready" = "$B" ] && grep -q "\"active\": \"$B\"" "$SEYRA_HOME/state/pointers.json" && grep -q "\"previous\": \"$A\"" "$SEYRA_HOME/state/pointers.json" \
  && cmp -s "$ev/.src-secrets.sha" "$ev/.dst-secrets.sha" && cmp -s "$ev/R1-src-events.txt" "$ev/.dst-head.txt"; then
  result PASS R6 "restored host serves $B (previous $A) through the ingress; restored history kept and extended; secret files identical to the secrets backup"
else
  result FAIL R6 "activate=$rc ready=$dst_ready"
fi

e2_end="$(egress_count)"
in_host sh -c 'iptables -L SEYRA_EGRESS -v -n -x' > "$ev/R7-egress-counters.txt" 2>&1
if [ "$e1" = "$e1_end" ] && [ "$e2" = "$e2_end" ]; then
  result PASS R7 "zero packets to non-local destinations from either host during install, backup, restore, rebuild and activation"
else
  result FAIL R7 "egress counters host1 $e1->$e1_end host2 $e2->$e2_end"
fi
rm -f "$ev/.secret-leak" "$ev/.src-secrets.sha" "$ev/.dst-secrets.sha" "$ev/.dst-head.txt"

{
  echo "# Seyra fresh-host restore drill — $(date -u +%FT%TZ)"
  echo "# bundle=$BUNDLE A=$A B=$B backup=$bk"
  printf '%s\n' "${summary[@]}"
  echo "# failures: $fails"
} > "$ev/summary.txt"
cat "$ev/summary.txt"
drop_host
exit $((fails > 0))
