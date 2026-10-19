#!/usr/bin/env bash
# Real-Iran validation on a simulated OFFLINE host, followed by a fresh-host restore that rebuilds
# from the owner's ORIGINAL input (no --include-sources).
#
# Same isolation as tests/offline/offline-host.sh: each offline host is a Docker-in-Docker daemon
# (test tooling, not a product image) on a Docker --internal network with a sink default route and
# iptables egress counters inside its own network namespace. The VM's firewall is not touched and
# the VM/Claude session keep their own connectivity. The Seyra wrapper runs on the outer host with
# DOCKER_HOST pointing at the offline daemon. The owner's PBF is bind-mounted read-only, alone.
#
# Works as a non-root operator: files owned by container UIDs (secrets 0400, release stores) are
# copied/removed from inside the root offline-host container, never with sudo on the VM.
#
#   BUNDLE=/abs/bundle PBF=/abs/iran.osm.pbf LAB=/abs/lab DIND_IMAGE=docker:29.8.2-dind \
#   OUT=/abs/evidence-dir [PHASES="install import serve backup restore"] tests/validation/iran-offline-host.sh
#
# Phases: install | update (UPDATE_BUNDLE under $LAB + UPDATE_SUMS_DIGEST: RUNBOOK §8 on the existing
# host) | import | serve | browser (PLAYWRIGHT_IMAGE, PLAYWRIGHT_DIR) | readiness (cold-start trials;
# READINESS_TRIALS/SECONDS/CLIENTS) | backup | restore. Phases
# without `install` attach to the existing host $HOST1_NAME (default seyra-iran-host); the restore
# target is $HOST2_NAME (default seyra-iran-restore).
#
# Host safety: an existing container is replaced only if it carries this lab's label
# (seyra.validation.lab=$LAB); any other container with that name (e.g. an operator's preserved
# host) makes the run stop instead.
#
# Frozen execution: the harness never runs from the working tree. It copies tests/validation into
# $OUT/harness-<UTC stamp>/ (read-only), records the commit, dirty state and file hashes in
# $OUT/harness-<stamp>.revision, and re-executes that copy. Editing the repository during a run
# cannot change the running script.
#
# Evidence (sanitized: no secrets, no data stores) goes to $OUT. Exits non-zero on any FAIL.
set -uo pipefail
: "${BUNDLE:?}" "${PBF:?}" "${LAB:?}" "${DIND_IMAGE:?}" "${OUT:?}"
PHASES="${PHASES:-install import serve backup restore}"
SAMPLE_S="${SAMPLE_S:-10}"
repo="${SEYRA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
mkdir -p "$OUT" "$LAB"
if [ -z "${SEYRA_HARNESS_FROZEN:-}" ]; then
  src="$(cd "$(dirname "$0")" && pwd)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  frozen="$OUT/harness-$stamp"
  mkdir -p "$frozen" && cp -a "$src/." "$frozen/" && chmod -R a-w "$frozen"
  {
    # A freeze.sh copy has no .git; its revision.txt (three levels up) names the commit.
    echo "commit: $(git -C "$src" rev-parse HEAD 2>/dev/null || sed -n 's/^commit: //p' "$src/../../../revision.txt" 2>/dev/null | grep . || echo unknown)"
    echo "uncommitted changes under tests/validation: $(git -C "$src" status --porcelain -- . 2>/dev/null | wc -l)"
    echo "frozen copy: $frozen"
    (cd "$frozen" && sha256sum -- *)
  } > "$OUT/harness-$stamp.revision"
  exec env SEYRA_HARNESS_FROZEN="$frozen" SEYRA_REPO="$repo" bash "$frozen/$(basename "$0")"
fi
hdir="$SEYRA_HARNESS_FROZEN"
HOST1_NAME="${HOST1_NAME:-seyra-iran-host}"
HOST2_NAME="${HOST2_NAME:-seyra-iran-restore}"
net=seyra_offline_lab
sock_dir="$LAB/run"
export SEYRA_HOME="$LAB/home"
inst="$LAB/install"
bk="$LAB/backup"
sbk="$LAB/secrets-backup"
work="$LAB/work"
summary=()
fails=0
name=""
ts() { date -u +%FT%TZ; }
# Copy harness files from the frozen (read-only) copy into the lab: `install` replaces an existing,
# possibly read-only, earlier copy; a failed copy stops the run instead of running a stale script.
stage() { install -m 0644 "$@" "$work/" || { echo "cannot stage $* into $work" >&2; exit 2; }; }
# Write the run summary and end the run (also used to stop after a failed gate).
finish() {
  stop_sampler 2>/dev/null
  {
    echo "# Seyra real-Iran offline-host validation — $(ts)"
    echo "# harness=${SEYRA_HARNESS_FROZEN:-} bundle=$BUNDLE pbf=$(basename "$PBF") sha256=${src_sha:-} dataset_id=${DS:-}"
    printf '%s\n' "${summary[@]}"
    echo "# failures: $fails"
  } >> "$OUT/summary.txt"
  tail -n $(( ${#summary[@]} + 3 )) "$OUT/summary.txt"
  exit $((fails > 0))
}
result() { summary+=("$1 $2 $3"); echo "== $(ts) $1 $2 $3" | tee -a "$OUT/progress.log"; [ "$1" = PASS ] || [ "$1" = NOTE ] || fails=$((fails + 1)); }
D() { DOCKER_HOST="unix://$sock_dir/docker.sock" docker "$@"; }
cli() { DOCKER_HOST="unix://$sock_dir/docker.sock" "$inst/bin/seyra-maps" "$@"; }
in_host() { docker exec "$name" "$@"; }
egress_count() { in_host sh -c "iptables -L SEYRA_EGRESS -v -n -x | awk '/COUNT/ {print \$1}'"; }
igmp_count() { in_host sh -c "iptables -L SEYRA_EGRESS -v -n -x | awk '/IGMP/ {print \$1}'"; }
ops_ref() { jq -r '.images.ops.ref' "$inst/infra/dependencies.lock.json"; }
# A node one-liner from inside the offline host's network namespace, trusting the generated CA.
in_node() {
  D run --rm --network host --pull never -v "$SEYRA_HOME/secrets/tls/ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt --entrypoint node "$(ops_ref)" "$@"
}
ready_ds() { in_node -e "fetch('https://127.0.0.1:8443/health/ready').then(r=>r.json()).then(b=>console.log(b.status==='ready'?b.dataset_id:''),()=>console.log(''))" 2>/dev/null; }
health_json() { in_node -e "fetch('https://127.0.0.1:8443/api/v1/map/health').then(r=>r.text()).then(t=>console.log(t),e=>console.log('{}'))" 2>/dev/null; }
q() { D exec -i "$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=db)" psql -X -q -At -U seyra_admin -d seyra_app -c "$1"; }
free_b() { df -B1 --output=avail "$LAB" | tail -1 | tr -d ' '; }
# Pre-check with the host's configured guard (the importer enforces it again, counting a replaced
# failed build); falls back to the product defaults (120 x input, 2 GiB floor).
guard_b() {
  local s f b
  s="$(stat -c %s "$PBF")"
  f="$(in_host cat "$SEYRA_HOME/state/settings.json" 2>/dev/null | jq -r '.minFreeFactor // 120')"
  b="$(in_host cat "$SEYRA_HOME/state/settings.json" 2>/dev/null | jq -r '.minFreeBytes // 2147483648')"
  awk -v s="$s" -v f="${f:-120}" -v b="${b:-2147483648}" 'BEGIN { r = s * f; if (r < b) r = b; printf "%.0f\n", (r == int(r) ? r : int(r) + 1) }'
}

# Resource sampler: outer view (VM filesystem, memory, the offline-host container's total CPU/RAM)
# and inner view (each product/job container inside the offline host), every $SAMPLE_S seconds.
sampler_pid=""
start_sampler() { # $1 = file
  ( while :; do
      { printf '%s free_bytes=%s free_inodes=%s ' "$(ts)" "$(free_b)" "$(df --output=iavail "$LAB" | tail -1 | tr -d ' ')"
        awk '/MemAvailable/{a=$2*1024} /SwapTotal/{t=$2} /SwapFree/{f=$2} END{printf "mem_avail=%d swap_used=%d ", a, (t-f)*1024}' /proc/meminfo
        printf 'load1=%s ' "$(cut -d' ' -f1 /proc/loadavg)"
        docker stats --no-stream --format 'host_ctr={{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' "$name" 2>/dev/null
        D stats --no-stream --format '  ctr {{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' 2>/dev/null
      } >> "$1"
      sleep "$SAMPLE_S"
    done ) &
  sampler_pid=$!
}
stop_sampler() { [ -n "$sampler_pid" ] && kill "$sampler_pid" 2>/dev/null; wait "$sampler_pid" 2>/dev/null; sampler_pid=""; }
trap 'stop_sampler' EXIT

new_host() { # $1 = container name; a fresh, empty offline daemon
  name="$1"
  if docker container inspect "$name" >/dev/null 2>&1; then
    if [ "$(docker container inspect -f '{{ index .Config.Labels "seyra.validation.lab" }}' "$name")" != "$LAB" ]; then
      echo "refusing: container $name exists and was not created by this lab ($LAB); it is left untouched" >&2
      exit 2
    fi
    docker rm -f "$name" >/dev/null 2>&1
  fi
  docker volume rm "$name-docker" >/dev/null 2>&1
  [ ! -e "$SEYRA_HOME" ] && [ ! -e "$inst" ] || { echo "refusing: $SEYRA_HOME or $inst already exists (use drop_host)" >&2; exit 2; }
  docker network inspect "$net" >/dev/null 2>&1 || docker network create --internal "$net" >/dev/null
  mkdir -p "$sock_dir" "$SEYRA_HOME"
  # Same absolute paths inside and outside, so the wrapper's bind mounts resolve on the offline host.
  docker run -d --privileged --name "$name" --label "seyra.validation.lab=$LAB" --network "$net" --pull never \
    -v "$LAB:$LAB" -v "$BUNDLE:$BUNDLE:ro" -v "$PBF:$PBF:ro" -v "$name-docker:/var/lib/docker" \
    "$DIND_IMAGE" dockerd -H unix:///var/run/docker.sock -H "unix://$sock_dir/docker.sock" --group "$(id -g)" --tls=false >/dev/null
  # The shared socket belongs to the operator's group, so the non-root wrapper can reach it.
  for _ in $(seq 1 60); do D info >/dev/null 2>&1 && break; sleep 1; done
  D info >/dev/null 2>&1 || { echo "offline daemon $name is not reachable on $sock_dir/docker.sock" >&2; exit 2; }
  local gw
  gw="$(docker inspect "$net" -f '{{(index .IPAM.Config 0).Subnet}}' | sed -E 's#\.[0-9]+/[0-9]+$#.250#')"
  # IGMP membership reports to 224.0.0.0/4 are link-local (emitted when bridges/veths come up)
  # and are counted separately, never as an outbound attempt.
  in_host sh -c "ip route add default via $gw 2>/dev/null; iptables -N SEYRA_EGRESS; \
    iptables -A SEYRA_EGRESS -p igmp -d 224.0.0.0/4 -m comment --comment IGMP -j RETURN; \
    iptables -A SEYRA_EGRESS -d 127.0.0.0/8 -j RETURN; iptables -A SEYRA_EGRESS -d 172.16.0.0/12 -j RETURN; \
    iptables -A SEYRA_EGRESS -d 192.168.0.0/16 -j RETURN; iptables -A SEYRA_EGRESS -d 10.0.0.0/8 -j RETURN; \
    iptables -A SEYRA_EGRESS -m comment --comment COUNT -j DROP; \
    iptables -I OUTPUT 1 -j SEYRA_EGRESS; iptables -I DOCKER-USER 1 -j SEYRA_EGRESS 2>/dev/null || iptables -I FORWARD 1 -j SEYRA_EGRESS"
  cp -a "$BUNDLE/install" "$inst"
  {
    echo "offline host $name: $(D version --format 'engine {{.Server.Version}}') image=$DIND_IMAGE ($(docker image inspect "$DIND_IMAGE" -f '{{.Id}}'))"
    echo "network: $net (internal); sink route via $gw; egress counter chain SEYRA_EGRESS on OUTPUT + DOCKER-USER"
    echo "registry mirrors: $(D info --format '{{.RegistryConfig.Mirrors}}')  proxies: $(D info --format '{{.HTTPProxy}}{{.HTTPSProxy}}')"
    echo "images before install: $(D images -q | wc -l)"
    echo "external DNS from the offline host: $(in_host nslookup -timeout=3 example.com 2>&1 | tail -2 | tr '\n' ' ')"
    echo "http probe to example.com: $(in_host wget -q -T 3 -O /dev/null http://example.com/ 2>&1 && echo REACHABLE || echo unreachable)"
    in_host ip route
  } > "$OUT/$name-host.txt" 2>&1
}
# Remove the offline host and everything it owned (as root, from inside it), keeping backups.
drop_host() {
  in_host sh -c 'docker ps -q | xargs -r docker kill' >/dev/null 2>&1
  in_host rm -rf "$SEYRA_HOME" "$inst" "$work" 2>/dev/null
  docker rm -f "$name" >/dev/null 2>&1
  docker volume rm "$name-docker" >/dev/null 2>&1
  rm -rf "$sock_dir"
}
attach_host() { name="$1"; } # continue a phase against an existing host

timed() { # $1 = label, rest = command; appends "label seconds rc" to timings
  local t0 rc; t0=$(date +%s)
  "${@:2}"; rc=$?
  echo "$1 $(( $(date +%s) - t0 )) $rc" >> "$OUT/timings.txt"
  return $rc
}
has() { [[ " $PHASES " == *" $1 "* ]]; }

# Sanitized copies of a release's records: manifest, staging validation, catalog report and step
# logs (logs carry no secrets: passwords are only in files mounted into job containers).
collect_release() { # $1 = dataset id, $2 = evidence subdir
  local rd="$SEYRA_HOME/releases/$1" dst="$OUT/$2"
  mkdir -p "$dst/logs"
  in_host sh -c "cat '$rd/manifest.json'" > "$dst/manifest.json" 2>/dev/null
  in_host sh -c "cat '$rd/validation/staging.json'" > "$dst/staging.json" 2>/dev/null
  in_host sh -c "cat '$rd/validation/catalog-report.json'" > "$dst/catalog-report.json" 2>/dev/null
  for f in $(in_host sh -c "ls '$rd/logs' 2>/dev/null"); do
    in_host sh -c "tail -n 200 '$rd/logs/$f'" > "$dst/logs/$f.tail" 2>/dev/null
  done
  in_host sh -c "cd '$rd' && du -sb source valhalla photon overpass geocoder maps tegola logs validation 2>/dev/null" > "$dst/store-bytes.txt"
  in_host sh -c "du -sb '$SEYRA_HOME' '$SEYRA_HOME'/* 2>/dev/null" > "$dst/home-bytes.txt"
  D exec -i "$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=db | head -1)" \
    psql -X -At -U seyra_admin -d postgres -c "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datname NOT IN ('template0','template1') ORDER BY 1" \
    > "$dst/db-bytes.txt" 2>/dev/null
  D system df > "$dst/docker-df.txt" 2>&1
  df -B1 "$LAB" > "$dst/vm-df.txt"
}

src_sha="$(sha256sum "$PBF" | cut -d' ' -f1)"
echo "# $(ts) iran-offline-host start phases=[$PHASES] pbf=$(basename "$PBF") sha256=$src_sha size=$(stat -c %s "$PBF")" | tee -a "$OUT/progress.log"

# ============================================================== host 1: install, import, serve
if has install; then
  new_host "$HOST1_NAME"
  if D info >/dev/null 2>&1 && [ "$(D images -q | wc -l)" = 0 ] && ! in_host wget -q -T 3 -O /dev/null http://example.com/ 2>/dev/null; then
    result PASS I0 "offline host has no images and no outside route (probe to example.com failed)"
  else
    result FAIL I0 "offline host not clean/isolated"
  fi
  egress_count > "$OUT/.egress-start"
  timed bootstrap-load cli bootstrap-load "$BUNDLE" > "$OUT/I1-bootstrap-load.log" 2>&1; rc=$?
  cli verify-images > "$OUT/I1-verify-images.log" 2>&1; rc2=$?
  if [ $rc -eq 0 ] && [ $rc2 -eq 0 ] && grep -q 'identities match the manifest' "$OUT/I1-bootstrap-load.log"; then
    result PASS I1 "bootstrap-load verified checksums and loaded $(grep -c '^OK' "$OUT/I1-verify-images.log") images; every reference resolves to its locked image ID"
  else
    result FAIL I1 "bootstrap rc=$rc verify rc=$rc2"
  fi
  { timed init cli init && timed tls-init cli tls init --names localhost,127.0.0.1; } > "$OUT/I2-init.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then result PASS I2 "init (loopback 127.0.0.1:8443) and internal TLS CA/certificate"; else result FAIL I2 "rc=$rc"; fi
else
  attach_host "$HOST1_NAME"
fi

# >>> update-phase (extracted and exercised by tests/validation/test-update-gate.mjs)
# Gate for an incoming bundle, using only tools already trusted on the operator host (coreutils,
# findutils, grep); nothing from the incoming bundle runs and nothing is dereferenced. Prints the
# reason; rc 0 only if, in this order:
#   (1) the bundle path and its SHA256SUMS are real (not symlinked) directory/file;
#   (2) every entry under the bundle is a directory or a regular file (no symlink, dangling or not,
#       no FIFO, socket or device) with a plain name ([A-Za-z0-9._-] path components) -- checked
#       before any payload is read, so nothing can be followed out of the bundle or block a read;
#   (3) SHA256SUMS is well formed: "<64 hex>  <relative path>" lines with plain components, no
#       absolute path, no "." or ".." segment, no duplicates;
#   (4) its digest equals the value received out of band;
#   (5) every listed file matches its checksum, and (6) no regular file is left unlisted.
update_gate() { # bundle expected-digest
  local b="$1" want="$2" got listed present bad
  { [ -d "$b" ] && [ ! -L "$b" ]; } || { echo "bundle path $b is not a real directory"; return 1; }
  { [ -f "$b/SHA256SUMS" ] && [ ! -L "$b/SHA256SUMS" ]; } || { echo "no regular SHA256SUMS file in $b"; return 1; }
  bad="$(find "$b" -mindepth 1 ! -type d ! -type f -printf '%y:%P\0' | tr '\0' ' ')"
  [ -z "$bad" ] || { echo "bundle holds entries that are neither directories nor regular files (type:path): $bad"; return 1; }
  bad="$(find "$b" -mindepth 1 -printf '%P\0' | LC_ALL=C grep -z -c -v -E '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$')"
  [ "$bad" = 0 ] || { echo "bundle holds $bad entry name(s) outside the plain [A-Za-z0-9._-] character set"; return 1; }
  [ -s "$b/SHA256SUMS" ] || { echo "SHA256SUMS is empty"; return 1; }
  bad="$(LC_ALL=C grep -c -v -E '^[0-9a-f]{64}  [A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' "$b/SHA256SUMS")"
  [ "$bad" = 0 ] || { echo "SHA256SUMS has $bad malformed line(s)"; return 1; }
  bad="$(sed -E 's/^[0-9a-f]{64}  //' "$b/SHA256SUMS" | LC_ALL=C grep -c -E '(^|/)\.\.?(/|$)')"
  [ "$bad" = 0 ] || { echo "SHA256SUMS names $bad path(s) with a . or .. segment"; return 1; }
  bad="$(sed -E 's/^[0-9a-f]{64}  //' "$b/SHA256SUMS" | LC_ALL=C sort | uniq -d | grep -c .)"
  [ "$bad" = 0 ] || { echo "SHA256SUMS lists $bad path(s) more than once"; return 1; }
  got="$(sha256sum "$b/SHA256SUMS" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { echo "SHA256SUMS digest $got does not match the out-of-band value $want"; return 1; }
  (cd "$b" && sha256sum --quiet --strict -c SHA256SUMS) > "$OUT/U0-sha256sum-check.txt" 2>&1 \
    || { echo "listed file checksums do not match: $(grep -c . "$OUT/U0-sha256sum-check.txt") line(s) in U0-sha256sum-check.txt"; return 1; }
  listed="$(sed -E 's/^[0-9a-f]{64}  //' "$b/SHA256SUMS" | LC_ALL=C sort)"
  present="$(cd "$b" && find . -type f ! -path ./SHA256SUMS -printf '%P\n' | LC_ALL=C sort)"
  [ "$listed" = "$present" ] || { echo "bundle files differ from SHA256SUMS: $(comm -3 <(printf '%s\n' "$listed") <(printf '%s\n' "$present") | tr -d '\t' | tr '\n' ' ')"; return 1; }
  echo "SHA256SUMS digest $got matches the out-of-band value; $(printf '%s\n' "$listed" | grep -c .) listed regular files verified; only directories and listed regular files present"
}
if has update; then
  # RUNBOOK §8 software update on the existing offline host: the new bundle arrives on transfer
  # media (a directory under $LAB, visible inside the host). Verification comes first; a refused
  # bundle changes nothing (no install files, no wrapper run, no image load, BUNDLE unchanged) and
  # ends the run, so dependent phases are skipped.
  : "${UPDATE_BUNDLE:?}" "${UPDATE_SUMS_DIGEST:?}"
  [ -f "$OUT/.egress-start" ] || egress_count > "$OUT/.egress-start"
  gate="$(update_gate "$UPDATE_BUNDLE" "$UPDATE_SUMS_DIGEST")"; grc=$?
  echo "$gate" > "$OUT/U0-gate.txt"
  if [ $grc -ne 0 ]; then
    result FAIL U1 "update refused before any install change: $gate"
    finish
  fi
  # Replace the install tree via a staged copy: copy, re-verify the copy against SHA256SUMS, then
  # swap. Every step is checked; a failure leaves the old install tree in place and ends the run.
  staged="$inst.incoming"
  in_host rm -rf "$staged" || { result FAIL U1 "could not clear $staged (old install kept)"; finish; }
  cp -a "$UPDATE_BUNDLE/install" "$staged" || { result FAIL U1 "copying the verified install tree failed (old install kept)"; finish; }
  (cd "$staged" && sed -n -E 's#^([0-9a-f]{64})  install/#\1  #p' "$UPDATE_BUNDLE/SHA256SUMS" | sha256sum --quiet --strict -c -) > "$OUT/U0-staged-check.txt" 2>&1 \
    || { in_host rm -rf "$staged"; result FAIL U1 "the staged install copy does not match SHA256SUMS (old install kept)"; finish; }
  in_host rm -rf "$inst" || { result FAIL U1 "could not remove the old install tree"; finish; }
  mv "$staged" "$inst" || { result FAIL U1 "could not move the staged install tree into place"; finish; }
  timed update-bootstrap-load cli bootstrap-load "$UPDATE_BUNDLE" > "$OUT/U1-bootstrap-load.log" 2>&1; rc=$?
  cli verify-images > "$OUT/U1-verify-images.log" 2>&1; rc2=$?
  cli status > "$OUT/U1-status.log" 2>&1
  if [ $rc -eq 0 ] && [ $rc2 -eq 0 ] && grep -q 'identities match the manifest' "$OUT/U1-bootstrap-load.log"; then
    result PASS U1 "software update: $gate; install tree replaced; all locked images verified"
  else
    result FAIL U1 "verified bundle failed to load: bootstrap=$rc verify=$rc2"
    finish
  fi
  BUNDLE="$UPDATE_BUNDLE"   # later phases (a restore target) install from the updated bundle
fi
# <<< update-phase
if has import; then
  free0="$(free_b)"; guard="$(guard_b)"
  echo "pre-import free_bytes=$free0 guard_bytes=$guard (max(2 GiB, 40 x $(stat -c %s "$PBF")))" > "$OUT/I3-capacity.txt"
  df -B1 -T "$LAB" >> "$OUT/I3-capacity.txt"; D system df >> "$OUT/I3-capacity.txt" 2>&1
  if [ "$free0" -ge "$guard" ]; then result PASS I3a "free space $free0 B >= import guard $guard B at the managed home"; else result FAIL I3a "free space $free0 B < guard $guard B; import not started"; fi
  if [ "$free0" -ge "$guard" ]; then
    start_sampler "$OUT/I3-import-samples.txt"
    timed import cli import --pbf "$PBF" > "$OUT/I3-import.log" 2>&1; rc=$?
    stop_sampler
    DS="$(grep -o 'release ds-[0-9a-z-]* built' "$OUT/I3-import.log" | awk '{print $2}')"
    [ -n "$DS" ] || DS="$(grep -o 'dataset_id ds-[0-9a-z-]*' "$OUT/I3-import.log" | head -1 | awk '{print $2}')"
    [ -n "$DS" ] && collect_release "$DS" "release-$DS"
    if [ $rc -eq 0 ] && grep -q "release $DS built" "$OUT/I3-import.log"; then
      echo "$DS" > "$OUT/.dataset_id"   # later phases run only on a successfully built release
      result PASS I3 "full Iran import with staging validation: $DS ($(awk '$1=="import"{print $2}' "$OUT/timings.txt" | tail -1) s)"
    else
      result FAIL I3 "import rc=$rc dataset=$DS (failed-release state preserved on the offline host)"
    fi
  fi
fi
DS="$(cat "$OUT/.dataset_id" 2>/dev/null)"

if has serve && [ -n "$DS" ]; then
  timed verify-release cli verify-release "$DS" > "$OUT/I4-verify-release.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then result PASS I4 "verify-release $DS"; else result FAIL I4 "rc=$rc"; fi
  start_sampler "$OUT/I5-activate-samples.txt"
  timed activate cli activate "$DS" > "$OUT/I5-activate.log" 2>&1; rc=$?
  stop_sampler
  r="$(ready_ds)"
  health_json > "$OUT/I5-health.json"
  if [ $rc -eq 0 ] && [ "$r" = "$DS" ]; then result PASS I5 "activated $DS; /health/ready reports it through https://127.0.0.1:8443 with all four providers"; else result FAIL I5 "activate=$rc ready=$r"; fi
  # Sequential exploratory smoke on real Iran geography (script and output inside the lab).
  mkdir -p "$work"; stage "$hdir/iran-smoke.mjs"
  start_sampler "$OUT/I6-smoke-samples.txt"
  D run --rm --network host --pull never -v "$SEYRA_HOME/secrets/tls/ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt \
    -v "$work:$work" --entrypoint node "$(ops_ref)" "$work/iran-smoke.mjs" https://127.0.0.1:8443 "$work/iran-smoke.json" > "$OUT/I6-smoke.log" 2>&1; rc=$?
  stop_sampler
  cp "$work/iran-smoke.json" "$OUT/I6-iran-smoke.json" 2>/dev/null
  if [ $rc -eq 0 ] && grep -q "\"dataset_id\":\"$DS\"" "$OUT/I6-smoke.log"; then result PASS I6 "exploratory Iran smoke completed: $(tail -1 "$OUT/I6-smoke.log")"; else result FAIL I6 "rc=$rc"; fi
  # Restart: the same release and provider identities after stop/start.
  { timed stop cli stop && timed start cli start; } > "$OUT/I7-restart.log" 2>&1; rc=$?
  for _ in $(seq 1 150); do [ "$(ready_ds)" = "$DS" ] && break; sleep 2; done
  health_json > "$OUT/I7-health.json"
  ids() { jq -c '[.providers[] | {p: .provider, s: .status, id: .observed_identity}] | sort_by(.p)' "$1" 2>/dev/null; }
  if [ $rc -eq 0 ] && [ "$(ready_ds)" = "$DS" ] && [ "$(ids "$OUT/I5-health.json")" = "$(ids "$OUT/I7-health.json")" ]; then
    result PASS I7 "stop/start: ready again on $DS with the same provider identities"
  else
    result FAIL I7 "rc=$rc ready=$(ready_ds)"
  fi
  cli status > "$OUT/I7-status.log" 2>&1
  collect_release "$DS" "release-$DS"
fi

if has browser && [ -n "$DS" ]; then
  # Test tooling only: the Playwright image is side-loaded from the VM's daemon over the Docker
  # socket (no network), and the browser runs in the offline host's network namespace.
  : "${PLAYWRIGHT_IMAGE:?}" "${PLAYWRIGHT_DIR:?}"
  if ! D image inspect "$PLAYWRIGHT_IMAGE" >/dev/null 2>&1; then
    timed playwright-sideload sh -c "docker save '$PLAYWRIGHT_IMAGE' | DOCKER_HOST='unix://$sock_dir/docker.sock' docker load -q" > "$OUT/B0-sideload.log" 2>&1
  fi
  mkdir -p "$work/browser"; stage "$hdir/iran-browser.mjs" "$hdir/browser-verdict.mjs"; rm -rf "$work/pw"; cp -a "$PLAYWRIGHT_DIR" "$work/pw"
  start_sampler "$OUT/B1-browser-samples.txt"
  D run --rm --init --network host --shm-size 1g --pull never -v "$work:$work" -e PLAYWRIGHT_MODULE="$work/pw/node_modules/playwright" \
    "$PLAYWRIGHT_IMAGE" node "$work/iran-browser.mjs" https://127.0.0.1:8443 "$work/browser" > "$OUT/B1-browser.log" 2>&1; rc=$?
  stop_sampler
  mkdir -p "$OUT/browser"; cp "$work/browser/"* "$OUT/browser/" 2>/dev/null
  if [ $rc -eq 0 ]; then result PASS B1 "real-Iran web client views: $(tail -1 "$OUT/B1-browser.log")"; else result FAIL B1 "rc=$rc $(tail -1 "$OUT/B1-browser.log")"; fi
fi

if has readiness && [ -n "$DS" ]; then
  # Cold-start readiness trials (unresolved 503 observation): stop, then start while the bounded
  # diagnostic polls readiness/provider health from the first second and a browser-like client
  # requests uncached tiles and cancels part of them. Disposable hosts only: this restarts the stack.
  mkdir -p "$work"; stage "$hdir/readiness-diag.mjs"
  for t in $(seq 1 "${READINESS_TRIALS:-3}"); do
    cli stop > "$OUT/D$t-stop.log" 2>&1
    cli start > "$OUT/D$t-start.log" 2>&1 & sp=$!
    D run --rm --network host --pull never -v "$SEYRA_HOME/secrets/tls/ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt -v "$work:$work" \
      --entrypoint node "$(ops_ref)" "$work/readiness-diag.mjs" --base https://127.0.0.1:8443 --seconds "${READINESS_SECONDS:-150}" \
      --tile-clients "${READINESS_CLIENTS:-6}" --out "$work/D$t-readiness.json" --label "cold start trial $t ($DS)" > "$OUT/D$t-readiness.log" 2>&1; drc=$?
    wait $sp; src=$?
    cp "$work/D$t-readiness.json" "$OUT/" 2>/dev/null
    flaps="$(jq -r '.not_ready_after_first_ready // "?"' "$OUT/D$t-readiness.json" 2>/dev/null)"
    if [ $src -eq 0 ] && [ $drc -eq 0 ] && [ -s "$OUT/D$t-readiness.json" ]; then
      result PASS "D$t" "cold start trial completed: first ready $(jq -r '.first_ready_at' "$OUT/D$t-readiness.json"); not-ready polls after first ready: $flaps; $(tail -1 "$OUT/D$t-readiness.log" | cut -c1-200)"
      [ "$flaps" = 0 ] || result NOTE "D$t" "readiness left 200 after first ready ($flaps polls); see D$t-readiness.json not_ready_events_after_first_ready"
    else
      result FAIL "D$t" "start=$src diagnostic=$drc"
    fi
  done
fi

if has backup && [ -n "$DS" ]; then
  in_host rm -rf "$bk" "$sbk"
  timed backup cli backup --out "$bk" > "$OUT/I8-backup.log" 2>&1; rc=$?
  in_host cp -a "$SEYRA_HOME/secrets" "$sbk"   # the operator's separate secrets backup (root inside the host)
  # The backup is written by the root ops container; read it from inside the offline host.
  gen="$(in_host sh -c "ls -1 '$bk' | grep '^seyra-backup-' | sort | tail -1")"
  in_host cat "$bk/$gen/backup-manifest.json" > "$OUT/I8-backup-manifest.json" 2>/dev/null
  q "SELECT id, dataset_id, event, occurred_at FROM seyra_control.release_events ORDER BY id" > "$OUT/I8-src-events.txt" 2>&1
  in_host sh -c "du -sb '$bk/$gen'; ls -la '$bk/$gen'" > "$OUT/I8-backup-bytes.txt" 2>&1
  if [ $rc -eq 0 ] && [ -n "$gen" ] && in_host test -s "$bk/$gen/backup-manifest.json" && ! in_host test -d "$bk/$gen/sources"; then
    result PASS I8 "backup generation $gen (without --include-sources) and a separate secrets copy"
  else
    result FAIL I8 "rc=$rc generation=$gen"
  fi
  end="$(egress_count)"
  in_host sh -c 'iptables -L SEYRA_EGRESS -v -n -x' > "$OUT/I9-egress-counters-host1.txt" 2>&1
  if [ "$end" = "$(cat "$OUT/.egress-start" 2>/dev/null)" ]; then
    result PASS I9 "zero packets to non-local destinations from offline host 1 during install/import/activate/smoke/restart/backup ($(igmp_count) link-local IGMP reports counted separately)"
  else
    result FAIL I9 "outbound attempts counted: $(cat "$OUT/.egress-start") -> $end"
  fi
fi

# ============================================================== host 2: restore from the original input
if has restore && [ -n "$DS" ]; then
  drop_host   # the first machine is gone; only the backup root and the secrets copy remain
  new_host "$HOST2_NAME"
  e2="$(egress_count)"
  timed restore-bootstrap-load cli bootstrap-load "$BUNDLE" > "$OUT/R1-install.log" 2>&1; rc=$?
  cli restore --from "$bk" > "$OUT/R2-restore-without-secrets.log" 2>&1; rc_ns=$?
  if [ $rc -eq 0 ] && [ $rc_ns -ne 0 ] && [ -z "$(D ps -q)" ]; then result PASS R2 "restore before the secrets are back is refused and starts nothing"; else result FAIL R2 "install=$rc restore=$rc_ns"; fi
  in_host sh -c "mkdir -p '$SEYRA_HOME' && cp -a '$sbk' '$SEYRA_HOME/secrets'"
  timed restore-init cli init > "$OUT/R3-init.log" 2>&1; rc_i=$?
  timed restore cli restore --from "$bk" > "$OUT/R3-restore.log" 2>&1; rc=$?
  q "SELECT id, dataset_id, event, occurred_at FROM seyra_control.release_events ORDER BY id" > "$OUT/R3-dst-events.txt" 2>&1
  if [ $rc_i -eq 0 ] && [ $rc -eq 0 ] && cmp -s "$OUT/I8-src-events.txt" "$OUT/R3-dst-events.txt" && grep -q "$src_sha" "$OUT/R3-restore.log"; then
    result PASS R3 "secrets -> init -> restore: control DB events identical; restore names the original input by SHA-256 ($src_sha)"
  else
    result FAIL R3 "init=$rc_i restore=$rc events_equal=$(cmp -s "$OUT/I8-src-events.txt" "$OUT/R3-dst-events.txt" && echo yes || echo no)"
  fi
  # Rebuild from the OWNER'S ORIGINAL file (the backup holds no sources), as restore instructs.
  start_sampler "$OUT/R4-import-samples.txt"
  timed restore-import cli import --pbf "$PBF" > "$OUT/R4-import.log" 2>&1; rc=$?
  stop_sampler
  DS2="$(grep -o 'release ds-[0-9a-z-]* built' "$OUT/R4-import.log" | awk '{print $2}')"
  if [ $rc -eq 0 ] && [ "$DS2" = "$DS" ]; then result PASS R4 "rebuilt from the owner's original input without included sources; dataset_id reproduced ($DS)"; else result FAIL R4 "rc=$rc rebuilt=$DS2 expected=$DS"; fi
  timed restore-activate cli activate "$DS" > "$OUT/R5-activate.log" 2>&1; rc=$?
  r="$(ready_ds)"
  cli status > "$OUT/R5-status.log" 2>&1
  if [ $rc -eq 0 ] && [ "$r" = "$DS" ]; then result PASS R5 "restored host serves $DS through the ingress"; else result FAIL R5 "activate=$rc ready=$r"; fi
  collect_release "$DS" "restore-release-$DS"
  e2_end="$(egress_count)"
  in_host sh -c 'iptables -L SEYRA_EGRESS -v -n -x' > "$OUT/R6-egress-counters-host2.txt" 2>&1
  if [ "$e2" = "$e2_end" ]; then result PASS R6 "zero packets to non-local destinations from offline host 2 during install/restore/rebuild/activate"; else result FAIL R6 "counter $e2 -> $e2_end"; fi
fi

finish
