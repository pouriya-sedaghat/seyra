#!/usr/bin/env bash
# Import capacity admission and within-step measurement on a DISPOSABLE offline host that already
# has an install (iran-offline-host.sh PHASES=install, or install + update). Uses the small synthetic
# fixture and changes the host's state/settings.json (restored at the end). Never point this at a
# host whose releases or settings matter.
#
#   LAB=/abs/lab HOST=container-name PBF=/abs/synthetic-v1.osm.pbf OUT=/abs/evidence \
#     tests/validation/capacity-guard.sh
#
# C1 adequate capacity passes; the manifest records the admission figures and sampling
# C2 a 3 GiB file created and removed inside one long step (staging validation; same filesystem)
#    appears as the run's and that step's free-space minimum, while the neighbouring boundary values
#    (the previous step's minimum, free space after the import) stay ~3 GiB higher: a sampler that
#    only looked at step boundaries would have missed it
# C3 insufficient capacity is refused before side effects: no release directory, no render DB,
#    no control-DB event
# C4 insufficient capacity with a failed build of the same dataset present keeps that build; once
#    capacity is adequate the import replaces it, counting its bytes as reclaimable
# C6 (review F1) a failed build holding an 8 GiB SPARSE file, required = free + 4 GiB: refused (only
#    allocated blocks are credited), build and render DB kept, no new build started
# C7 (review F1) the same failed build plus 3 GiB of ALLOCATED data, required = free + 2 GiB:
#    admitted on the conservative estimate, replaced, and the observed free space after the
#    cleanup is checked before the new build
# Exits non-zero on any FAIL. The fixture file is only read.
set -uo pipefail
: "${LAB:?}" "${HOST:?}" "${PBF:?}" "${OUT:?}"
mkdir -p "$OUT"
export SEYRA_HOME="$LAB/home"
sock="unix://$LAB/run/docker.sock"
D() { DOCKER_HOST="$sock" docker "$@"; }
cli() { DOCKER_HOST="$sock" "$LAB/install/bin/seyra-maps" "$@"; }
in_host() { docker exec "$HOST" "$@"; }
q() { D exec -i "$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=db)" psql -X -q -At -U seyra_admin -d "${2:-seyra_app}" -c "$1"; }
settings="$SEYRA_HOME/state/settings.json"
set_setting() { in_host sed -i -E "s/(\"$1\": )[0-9.]+/\\1$2/" "$settings"; }
get_setting() { in_host cat "$settings" | sed -nE "s/.*\"$1\": ([0-9.]+).*/\\1/p"; }
manifest() { in_host cat "$SEYRA_HOME/releases/$1/manifest.json"; }
release_of() { grep -oE 'dataset_id ds-[0-9a-z-]+' "$1" | head -1 | awk '{print $2}'; }
# Snapshot dates unique to this run (dataset_id = ds-<date>-<hash of inputs and images>), so a rerun
# never collides with a release an earlier run left on the host.
BASE=$(( $(date +%s) / 60 % 300 ))
day() { date -u -d "2025-01-01 +$(( BASE + $1 )) days" +%Y-%m-%dT00:00:00Z; }
render_dbs() { q "SELECT datname FROM pg_database WHERE datname LIKE 'render_%' ORDER BY 1" postgres | tr '\n' ' '; }
events() { q "SELECT count(*) FROM seyra_control.release_events"; }
summary=(); fails=0
result() { summary+=("$1 $2 $3"); echo "== $1 $2 $3" | tee -a "$OUT/progress.log"; [ "$1" = PASS ] || fails=$((fails + 1)); }

docker container inspect "$HOST" >/dev/null 2>&1 || { echo "no host $HOST" >&2; exit 2; }
[ "$(docker container inspect -f '{{ index .Config.Labels "seyra.validation.lab" }}' "$HOST")" = "$LAB" ] || { echo "refusing: $HOST is not a disposable host of $LAB" >&2; exit 2; }
pbf_sha="$(sha256sum "$PBF" | cut -d' ' -f1)"
in_host cp "$settings" "$settings.capacity-guard.bak"
orig_factor="$(get_setting minFreeFactor)"; orig_bytes="$(get_setting minFreeBytes)"
echo "# $(date -u +%FT%TZ) host=$HOST ops=$(jq -r .images.ops.image_id "$LAB/install/infra/dependencies.lock.json") settings: minFreeFactor=$orig_factor minFreeBytes=$orig_bytes" | tee "$OUT/progress.log"

# ---------------------------------------------------------------- C1 adequate capacity
cli import --pbf "$PBF" --snapshot-timestamp "$(day 0)" > "$OUT/C1-import.log" 2>&1; rc=$?
C1="$(release_of "$OUT/C1-import.log")"
manifest "$C1" > "$OUT/C1-manifest.json" 2>/dev/null
if [ $rc -eq 0 ] && grep -q '\[import\] capacity: available .* >= required' "$OUT/C1-import.log" \
  && jq -e '.measurements.capacity_check.admission.ok == true and .measurements.free_space_sampling.interval_s == 5 and (.measurements.steps | all(has("free_bytes_min")))' "$OUT/C1-manifest.json" >/dev/null; then
  result PASS C1 "adequate capacity admitted ($(grep -o 'capacity: .*' "$OUT/C1-import.log" | cut -c11-190)…); manifest records capacity_check, 5 s sampling ($(jq '.measurements.free_space_sampling.samples' "$OUT/C1-manifest.json") samples) and per-step minima$(grep -q 'warning: minFreeFactor' "$OUT/C1-import.log" && echo "; warned that the persisted minFreeFactor $orig_factor is below the reference")"
else
  result FAIL C1 "rc=$rc release=$C1"
fi

# ---------------------------------------------------------------- C2 within-step dip
set_setting minFreeFactor 120   # the operator adopts the measured reference (RUNBOOK §3)
cli import --pbf "$PBF" --snapshot-timestamp "$(day 1)" > "$OUT/C2-import.log" 2>&1 &
ip=$!
for _ in $(seq 1 3000); do grep -q 'staging-validation …' "$OUT/C2-import.log" 2>/dev/null && break; sleep 0.1; done
sleep 3
dip_start="$(date -u +%FT%T.%3NZ)"; free_pre="$(df -B1 --output=avail "$LAB" | tail -1 | tr -d ' ')"
fallocate -l 3G "$LAB/.capacity-guard-dip.bin"; sleep 15; rm -f "$LAB/.capacity-guard-dip.bin"
dip_end="$(date -u +%FT%T.%3NZ)"
still_running="$(kill -0 $ip 2>/dev/null && echo yes || echo no)"   # the dip must end inside the step
wait $ip; rc=$?
free_after="$(df -B1 --output=avail "$LAB" | tail -1 | tr -d ' ')"
C2="$(release_of "$OUT/C2-import.log")"
manifest "$C2" > "$OUT/C2-manifest.json" 2>/dev/null
min="$(jq -r '.measurements.free_bytes_min_observed' "$OUT/C2-manifest.json")"
at="$(jq -r '.measurements.free_bytes_min_observed_at' "$OUT/C2-manifest.json")"
step="$(jq -r --argjson m "$min" '.measurements.steps[] | select(.free_bytes_min == $m) | .step' "$OUT/C2-manifest.json" | head -1)"
prev="$(jq -r '.measurements.steps[] | select(.step == "map-styles") | .free_bytes_min' "$OUT/C2-manifest.json")"
{ echo "dip window $dip_start .. $dip_end (import still running at dip end: $still_running); free before the dip $free_pre; free after the import $free_after"; jq '.measurements | {free_bytes_before, free_bytes_min_observed, free_bytes_min_observed_at, free_space_sampling, steps: [.steps[] | {step, seconds, free_bytes_min}]}' "$OUT/C2-manifest.json"; } > "$OUT/C2-dip.txt"
if [ $rc -eq 0 ] && [ -n "$min" ] && [ "$min" != null ] && [ "$still_running" = yes ] && [ "$step" = staging-validation ] \
  && [ $(( free_pre - min )) -ge 2900000000 ] && [ $(( prev - min )) -ge 2900000000 ] && [ $(( free_after - min )) -ge 2900000000 ] \
  && [[ "$at" > "$dip_start" ]] && [[ "$at" < "$dip_end" ]]; then
  result PASS C2 "a 3 GiB file held for 15 s inside staging-validation is the run minimum $min B at $at; the previous step's minimum ($prev B) and free space after the import ($free_after B) are >= 2.9 GB higher, so step-boundary sampling alone would have missed it"
else
  result FAIL C2 "rc=$rc min=$min at=$at step=$step still_running=$still_running window=$dip_start..$dip_end free_pre=$free_pre prev=$prev after=$free_after"
fi

# ---------------------------------------------------------------- C3 insufficient, no side effects
set_setting minFreeBytes 10000000000000   # 10 TB: no disposable host has that much
dbs0="$(render_dbs)"; ev0="$(events)"; rel0="$(in_host ls "$SEYRA_HOME/releases" | sort | tr '\n' ' ')"
cli import --pbf "$PBF" --snapshot-timestamp "$(day 2)" > "$OUT/C3-import.log" 2>&1; rc=$?
C3="ds-$(date -u -d "$(day 2)" +%Y%m%d)-${C1##*-}"   # a refused import never logs its id (admission precedes it)
dbs1="$(render_dbs)"; ev1="$(events)"; rel1="$(in_host ls "$SEYRA_HOME/releases" | sort | tr '\n' ' ')"
cli status > "$OUT/C3-status.log" 2>&1
if [ $rc -ne 0 ] && grep -q "import failed at setup: insufficient free space for $C3 on .*nothing was changed" "$OUT/C3-import.log" && [ "$dbs0" = "$dbs1" ] && [ "$ev0" = "$ev1" ] && [ "$rel0" = "$rel1" ] \
  && ! in_host test -e "$SEYRA_HOME/releases/$C3" && ! grep -q '^import lease:' "$OUT/C3-status.log"; then
  result PASS C3 "insufficient capacity refused before side effects: no release directory for $C3, render DBs, release events ($ev1) and releases unchanged, lease released"
else
  result FAIL C3 "rc=$rc release_dir=$(in_host test -e "$SEYRA_HOME/releases/$C3" && echo present || echo absent) dbs_equal=$([ "$dbs0" = "$dbs1" ] && echo y || echo n) events=$ev0->$ev1"
fi

# ---------------------------------------------------------------- C4 failed build kept, then replaced
set_setting minFreeBytes "$orig_bytes"
cli import --pbf "$PBF" --snapshot-timestamp "$(day 3)" > "$OUT/C4-killed-import.log" 2>&1 &
kp=$!
for _ in $(seq 1 1200); do grep -q 'routing-build …' "$OUT/C4-killed-import.log" 2>/dev/null && break; sleep 0.1; done
victim="$(D ps --no-trunc --format '{{.ID}} {{.Command}}' | awk '/ import --pbf/ {print $1}' | head -1)"
[ -n "$victim" ] && D kill "$victim" >/dev/null
wait $kp 2>/dev/null
C4="$(release_of "$OUT/C4-killed-import.log")"
set_setting minFreeBytes 10000000000000
cli import --pbf "$PBF" --snapshot-timestamp "$(day 3)" > "$OUT/C4-refused.log" 2>&1; rc_ref=$?
st="$(manifest "$C4" 2>/dev/null | jq -r '.status')"
db_kept="$(render_dbs | grep -c "render_${C4//-/_}")"
set_setting minFreeBytes "$orig_bytes"
cli import --pbf "$PBF" --snapshot-timestamp "$(day 3)" > "$OUT/C4-replace.log" 2>&1; rc_rep=$?
manifest "$C4" > "$OUT/C4-manifest.json" 2>/dev/null
recl="$(jq -r '.measurements.capacity_check.admission.reclaimable_bytes' "$OUT/C4-manifest.json")"
if [ -n "$victim" ] && [ $rc_ref -ne 0 ] && grep -q "the failed build of $C4 was kept" "$OUT/C4-refused.log" && [ "$st" = failed ] && [ "$db_kept" = 1 ] \
  && [ $rc_rep -eq 0 ] && grep -q "replacing failed build of $C4" "$OUT/C4-replace.log" && [ "${recl:-0}" -gt 0 ] && jq -e '.status == "validated"' "$OUT/C4-manifest.json" >/dev/null; then
  result PASS C4 "import of $C4 killed mid-build; with insufficient capacity the next import was refused and the failed build (manifest '$st', render DB) was kept; with adequate capacity it was replaced, counting $recl reclaimable bytes"
else
  result FAIL C4 "victim=$victim refused_rc=$rc_ref status_after_refusal=$st render_db_kept=$db_kept replace_rc=$rc_rep reclaimable=$recl"
fi

# ---------------------------------------------------------------- C6/C7 reclaim credit near the boundary
set_setting minFreeBytes "$orig_bytes"
cli import --pbf "$PBF" --snapshot-timestamp "$(day 4)" > "$OUT/C6-killed-import.log" 2>&1 &
kp=$!
for _ in $(seq 1 1200); do grep -q 'routing-build …' "$OUT/C6-killed-import.log" 2>/dev/null && break; sleep 0.1; done
victim6="$(D ps --no-trunc --format '{{.ID}} {{.Command}}' | awk '/ import --pbf/ {print $1}' | head -1)"
[ -n "$victim6" ] && D kill "$victim6" >/dev/null
wait $kp 2>/dev/null
C6="$(release_of "$OUT/C6-killed-import.log")"
rel6="$SEYRA_HOME/releases/$C6"
# The next import recovers the abandoned lease itself (marks the build failed, stops orphaned jobs).
in_host truncate -s 8G "$rel6/sparse-store.bin"
in_host sh -c "du -B1 --apparent-size '$rel6/sparse-store.bin'; du -B1 '$rel6/sparse-store.bin'" > "$OUT/C6-sparse-file.txt" 2>&1
free6="$(df -B1 --output=avail "$LAB" | tail -1 | tr -d ' ')"
set_setting minFreeBytes $(( free6 + 4 * 1024 * 1024 * 1024 ))
dbs6="$(render_dbs)"
cli import --pbf "$PBF" --snapshot-timestamp "$(day 4)" > "$OUT/C6-refused.log" 2>&1; rc6=$?
st6="$(manifest "$C6" 2>/dev/null | jq -r '.status')"
if [ -n "$victim6" ] && [ $rc6 -ne 0 ] && grep -q "nothing was changed (the failed build of $C6 was kept)" "$OUT/C6-refused.log" && [ "$st6" = failed ] \
  && in_host test -f "$rel6/sparse-store.bin" && [ "$(render_dbs)" = "$dbs6" ] && ! grep -q 'source-copy\|replacing failed build' "$OUT/C6-refused.log"; then
  result PASS C6 "failed build $C6 with an 8 GiB sparse file (allocated: $(tail -1 "$OUT/C6-sparse-file.txt" | cut -f1) B) and required = free + 4 GiB: refused; build, its sparse file and render DB kept; no new build started ($(grep -o 'reclaim estimate of the failed build: [^;]*' "$OUT/C6-refused.log" | head -1))"
else
  result FAIL C6 "victim=$victim6 rc=$rc6 status=$st6"
fi
in_host sh -c "dd if=/dev/zero of='$rel6/allocated-store.bin' bs=1M count=3072 status=none && sync"
free7="$(df -B1 --output=avail "$LAB" | tail -1 | tr -d ' ')"
set_setting minFreeBytes $(( free7 + 2 * 1024 * 1024 * 1024 ))
cli import --pbf "$PBF" --snapshot-timestamp "$(day 4)" > "$OUT/C7-import.log" 2>&1; rc7=$?
manifest "$C6" > "$OUT/C7-manifest.json" 2>/dev/null
if [ $rc7 -eq 0 ] && grep -q "replacing failed build of $C6" "$OUT/C7-import.log" \
  && jq -e '.status == "validated" and .measurements.capacity_check.admission.ok and .measurements.capacity_check.after_cleanup.ok and .measurements.capacity_check.reclaim.bytes >= 3221225472 and .measurements.capacity_check.render_db_credit_bytes == 0' "$OUT/C7-manifest.json" >/dev/null; then
  result PASS C7 "same failed build plus 3 GiB allocated, required = free + 2 GiB: admitted on $(jq '.measurements.capacity_check.reclaim.bytes' "$OUT/C7-manifest.json") B of allocated reclaim (apparent $(jq '.measurements.capacity_check.reclaim.logical_bytes' "$OUT/C7-manifest.json") B not credited, render DB credited 0); after the cleanup the observed free space $(jq '.measurements.capacity_check.after_cleanup.free_bytes' "$OUT/C7-manifest.json") B >= required $(jq '.measurements.capacity_check.after_cleanup.required_bytes' "$OUT/C7-manifest.json") B; rebuilt and validated"
else
  result FAIL C7 "rc=$rc7 $(jq -c '.measurements.capacity_check | {a: .admission.ok, r: .reclaim.bytes, after: .after_cleanup.ok}' "$OUT/C7-manifest.json" 2>/dev/null)"
fi

in_host cp "$settings.capacity-guard.bak" "$settings" && in_host rm -f "$settings.capacity-guard.bak"
[ "$(sha256sum "$PBF" | cut -d' ' -f1)" = "$pbf_sha" ] && result PASS C5 "input file unchanged ($pbf_sha); settings restored" || result FAIL C5 "input changed"
{ echo "# capacity-guard $(date -u +%FT%TZ) host=$HOST"; printf '%s\n' "${summary[@]}"; echo "# failures: $fails"; } > "$OUT/summary.txt"
cat "$OUT/summary.txt"
exit $((fails > 0))
