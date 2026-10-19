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
# C2 a 3 GB file created and removed inside a step (same filesystem) appears as the run's and that
#    step's free-space minimum, which boundary samples alone would not show
# C3 insufficient capacity is refused before side effects: no release directory, no render DB,
#    no control-DB event
# C4 insufficient capacity with a failed build of the same dataset present keeps that build; once
#    capacity is adequate the import replaces it, counting its bytes as reclaimable
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
cli import --pbf "$PBF" --snapshot-timestamp 2026-10-03T00:00:00Z > "$OUT/C1-import.log" 2>&1; rc=$?
C1="$(release_of "$OUT/C1-import.log")"
manifest "$C1" > "$OUT/C1-manifest.json" 2>/dev/null
if [ $rc -eq 0 ] && grep -q '\[import\] capacity: available .* >= required' "$OUT/C1-import.log" \
  && jq -e '.measurements.capacity_check.ok == true and .measurements.free_space_sampling.interval_s == 5 and (.measurements.steps | all(has("free_bytes_min")))' "$OUT/C1-manifest.json" >/dev/null; then
  result PASS C1 "adequate capacity admitted ($(grep -o 'capacity: .*' "$OUT/C1-import.log" | cut -c11-190)…); manifest records capacity_check, 5 s sampling ($(jq '.measurements.free_space_sampling.samples' "$OUT/C1-manifest.json") samples) and per-step minima$(grep -q 'warning: minFreeFactor' "$OUT/C1-import.log" && echo "; warned that the persisted minFreeFactor $orig_factor is below the reference")"
else
  result FAIL C1 "rc=$rc release=$C1"
fi

# ---------------------------------------------------------------- C2 within-step dip
set_setting minFreeFactor 120   # the operator adopts the measured reference (RUNBOOK §3)
cli import --pbf "$PBF" --snapshot-timestamp 2026-10-04T00:00:00Z > "$OUT/C2-import.log" 2>&1 &
ip=$!
for _ in $(seq 1 1200); do grep -q 'geocoder-build …' "$OUT/C2-import.log" 2>/dev/null && break; sleep 0.1; done
sleep 2
dip_start="$(date -u +%FT%T.%3NZ)"; free_pre="$(df -B1 --output=avail "$LAB" | tail -1 | tr -d ' ')"
fallocate -l 3G "$LAB/.capacity-guard-dip.bin"; sleep 15; rm -f "$LAB/.capacity-guard-dip.bin"
dip_end="$(date -u +%FT%T.%3NZ)"
wait $ip; rc=$?
C2="$(release_of "$OUT/C2-import.log")"
manifest "$C2" > "$OUT/C2-manifest.json" 2>/dev/null
min="$(jq -r '.measurements.free_bytes_min_observed' "$OUT/C2-manifest.json")"
at="$(jq -r '.measurements.free_bytes_min_observed_at' "$OUT/C2-manifest.json")"
step="$(jq -r --argjson m "$min" '.measurements.steps[] | select(.free_bytes_min == $m) | .step' "$OUT/C2-manifest.json" | head -1)"
{ echo "dip window $dip_start .. $dip_end; free before the dip $free_pre"; jq '.measurements | {free_bytes_before, free_bytes_min_observed, free_bytes_min_observed_at, free_space_sampling, steps: [.steps[] | {step, seconds, free_bytes_min}]}' "$OUT/C2-manifest.json"; } > "$OUT/C2-dip.txt"
if [ $rc -eq 0 ] && [ -n "$min" ] && [ "$min" != null ] && [ $(( free_pre - min )) -ge 2900000000 ] && [[ "$at" > "$dip_start" ]] && [[ "$at" < "$dip_end" ]]; then
  result PASS C2 "a 3 GiB file held for 15 s inside the import appears as the run minimum $min B at $at (free before the dip $free_pre B; step '$step'); the boundary samples after it were back up"
else
  result FAIL C2 "rc=$rc min=$min at=$at window=$dip_start..$dip_end free_pre=$free_pre"
fi

# ---------------------------------------------------------------- C3 insufficient, no side effects
set_setting minFreeBytes 10000000000000   # 10 TB: no disposable host has that much
dbs0="$(render_dbs)"; ev0="$(events)"; rel0="$(in_host ls "$SEYRA_HOME/releases" | sort | tr '\n' ' ')"
cli import --pbf "$PBF" --snapshot-timestamp 2026-10-05T00:00:00Z > "$OUT/C3-import.log" 2>&1; rc=$?
C3="$(release_of "$OUT/C3-import.log")"
dbs1="$(render_dbs)"; ev1="$(events)"; rel1="$(in_host ls "$SEYRA_HOME/releases" | sort | tr '\n' ' ')"
cli status > "$OUT/C3-status.log" 2>&1
if [ $rc -ne 0 ] && grep -q 'insufficient free space on .*nothing was changed' "$OUT/C3-import.log" && [ "$dbs0" = "$dbs1" ] && [ "$ev0" = "$ev1" ] && [ "$rel0" = "$rel1" ] \
  && ! in_host test -e "$SEYRA_HOME/releases/$C3" && ! grep -q '^import lease:' "$OUT/C3-status.log"; then
  result PASS C3 "insufficient capacity refused before side effects: no release directory for $C3, render DBs, release events ($ev1) and releases unchanged, lease released"
else
  result FAIL C3 "rc=$rc release_dir=$(in_host test -e "$SEYRA_HOME/releases/$C3" && echo present || echo absent) dbs_equal=$([ "$dbs0" = "$dbs1" ] && echo y || echo n) events=$ev0->$ev1"
fi

# ---------------------------------------------------------------- C4 failed build kept, then replaced
set_setting minFreeBytes "$orig_bytes"
cli import --pbf "$PBF" --snapshot-timestamp 2026-10-06T00:00:00Z > "$OUT/C4-killed-import.log" 2>&1 &
kp=$!
for _ in $(seq 1 1200); do grep -q 'routing-build …' "$OUT/C4-killed-import.log" 2>/dev/null && break; sleep 0.1; done
victim="$(D ps --no-trunc --format '{{.ID}} {{.Command}}' | awk '/ import --pbf/ {print $1}' | head -1)"
[ -n "$victim" ] && D kill "$victim" >/dev/null
wait $kp 2>/dev/null
C4="$(release_of "$OUT/C4-killed-import.log")"
set_setting minFreeBytes 10000000000000
cli import --pbf "$PBF" --snapshot-timestamp 2026-10-06T00:00:00Z > "$OUT/C4-refused.log" 2>&1; rc_ref=$?
st="$(manifest "$C4" 2>/dev/null | jq -r '.status')"
db_kept="$(render_dbs | grep -c "render_${C4//-/_}")"
set_setting minFreeBytes "$orig_bytes"
cli import --pbf "$PBF" --snapshot-timestamp 2026-10-06T00:00:00Z > "$OUT/C4-replace.log" 2>&1; rc_rep=$?
manifest "$C4" > "$OUT/C4-manifest.json" 2>/dev/null
recl="$(jq -r '.measurements.capacity_check.reclaimable_bytes' "$OUT/C4-manifest.json")"
if [ -n "$victim" ] && [ $rc_ref -ne 0 ] && grep -q "the failed build of $C4 was kept" "$OUT/C4-refused.log" && [ "$st" = failed ] && [ "$db_kept" = 1 ] \
  && [ $rc_rep -eq 0 ] && grep -q "replacing failed build of $C4" "$OUT/C4-replace.log" && [ "${recl:-0}" -gt 0 ] && jq -e '.status == "validated"' "$OUT/C4-manifest.json" >/dev/null; then
  result PASS C4 "import of $C4 killed mid-build; with insufficient capacity the next import was refused and the failed build (manifest '$st', render DB) was kept; with adequate capacity it was replaced, counting $recl reclaimable bytes"
else
  result FAIL C4 "victim=$victim refused_rc=$rc_ref status_after_refusal=$st render_db_kept=$db_kept replace_rc=$rc_rep reclaimable=$recl"
fi

in_host cp "$settings.capacity-guard.bak" "$settings" && in_host rm -f "$settings.capacity-guard.bak"
[ "$(sha256sum "$PBF" | cut -d' ' -f1)" = "$pbf_sha" ] && result PASS C5 "input file unchanged ($pbf_sha); settings restored" || result FAIL C5 "input changed"
{ echo "# capacity-guard $(date -u +%FT%TZ) host=$HOST"; printf '%s\n' "${summary[@]}"; echo "# failures: $fails"; } > "$OUT/summary.txt"
cat "$OUT/summary.txt"
exit $((fails > 0))
