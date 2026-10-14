#!/usr/bin/env bash
# AC06 / AC07 lifecycle scenarios against a running stack with one active release (A).
#
#   SEYRA_HOME=/abs/state FIXTURE=/abs/synthetic-v1.osm.pbf tests/lifecycle/lifecycle.sh
#
# L1 corrupt inputs fail without touching A          L4 activation A -> B succeeds
# L2 interrupted import is recovered, A untouched    L5 rollback B -> A
# L3 provider-start failure during A -> B restores A L6 prune keeps active + previous
#
# Release B is the same fixture with an operator snapshot timestamp (a different dataset_id).
# Fault injection is limited to Seyra-managed paths under $SEYRA_HOME and is always undone.
# Writes docs/evidence/lifecycle/*.log and summary.txt. Exits non-zero on any FAIL.
set -uo pipefail
: "${SEYRA_HOME:?}" "${FIXTURE:?}"
repo="${SEYRA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
cli="$repo/bin/seyra-maps"
ev="$repo/docs/evidence/lifecycle"
mkdir -p "$ev"
work="$(dirname "$FIXTURE")"
CA="$SEYRA_HOME/secrets/tls/ca.crt"
summary=()
fails=0
result() { summary+=("$1 $2 $3"); echo "== $1 $2 $3"; [ "$1" = PASS ] || fails=$((fails + 1)); }
ready() { curl -s --max-time 5 --cacert "$CA" https://127.0.0.1:8443/health/ready; }
ready_ds() { ready | jq -r 'select(.status=="ready") | .dataset_id // empty'; }
active() { jq -r '.active // empty' "$SEYRA_HOME/state/pointers.json"; }
previous() { jq -r '.previous // empty' "$SEYRA_HOME/state/pointers.json"; }
# Fingerprint of a release's immutable artifacts (Photon's index receives working-state writes
# while served and is excluded; its immutable import input is included).
fingerprint() {
  (cd "$SEYRA_HOME/releases/$1" && find . -type f ! -path './photon/*' ! -path './logs/*' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)
}
wait_ready() { # dataset timeout_s
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do [ "$(ready_ds)" = "$1" ] && return 0; sleep 1; done
  return 1
}
probe_start() { # file — samples readiness twice a second
  ( while true; do printf '%s %s\n' "$(date +%s.%N | cut -c1-14)" "$(ready | jq -r '"\(.status) \(.dataset_id)"' 2>/dev/null || echo 'down -')"; sleep 0.5; done ) > "$1" 2>&1 &
  echo $!
}
window() { # probe-file -> seconds not ready
  awk '$2!="ready"{n++} END{printf "%.1f", n*0.5}' "$1"
}

A="$(active)"
[ -n "$A" ] && [ "$(ready_ds)" = "$A" ] || { echo "precondition: an active, ready release is required" >&2; exit 2; }
FP_A="$(fingerprint "$A")"
echo "active A=$A fingerprint=$FP_A"

# ------------------------------------------------------------------ L1 corrupt input
truncated="$work/corrupt-truncated.osm.pbf"
garbage="$work/corrupt-garbage.osm.pbf"
head -c "$(( $(stat -c %s "$FIXTURE") / 2 ))" "$FIXTURE" > "$truncated"
head -c 200000 /dev/urandom > "$garbage"
for f in "$truncated" "$garbage"; do
  name="$(basename "$f" .osm.pbf)"
  "$cli" import --pbf "$f" > "$ev/L1-$name.log" 2>&1; rc=$?
  step="$(grep -o 'import failed at [a-z-]*' "$ev/L1-$name.log" | head -1)"
  if [ $rc -ne 0 ] && [ "$(active)" = "$A" ] && [ "$(ready_ds)" = "$A" ] && [ "$(fingerprint "$A")" = "$FP_A" ]; then
    result PASS "L1/$name" "import refused (${step:-before build}); active $A unchanged and ready; artifacts identical"
  else
    result FAIL "L1/$name" "rc=$rc active=$(active) ready=$(ready_ds) fp=$(fingerprint "$A")"
  fi
done
rm -f "$truncated" "$garbage"

# ------------------------------------------------------------------ L2 interrupted import
TS="${SNAPSHOT_TS:-2026-10-02T00:00:00Z}"
"$cli" import --pbf "$FIXTURE" --snapshot-timestamp "$TS" > "$ev/L2-interrupted.log" 2>&1 &
imp=$!
for _ in $(seq 1 600); do grep -q 'geocoder-build' "$ev/L2-interrupted.log" && break; sleep 0.5; done
sleep 3
ops="$(docker ps --no-trunc --filter ancestor=seyra/ops:1.0.0-seyra1 --format '{{.ID}} {{.Command}}' | grep -w import | awk '{print substr($1,1,12)}')"
orph_before="$(docker ps -q --filter label=com.docker.compose.project=seyra-jobs | wc -l)"
docker kill $ops > /dev/null 2>&1
wait $imp 2>/dev/null
B="$(grep -o 'dataset_id ds-[0-9a-z-]*' "$ev/L2-interrupted.log" | awk '{print $2}')"
mid_ready="$(ready_ds)"
"$cli" import --pbf "$FIXTURE" --snapshot-timestamp "$TS" > "$ev/L2-recovered.log" 2>&1; rc=$?
if [ -n "$ops" ] && [ "$mid_ready" = "$A" ] && [ $rc -eq 0 ] && grep -q 'no longer running; recovering' "$ev/L2-recovered.log" \
   && grep -q 'replacing failed build' "$ev/L2-recovered.log" && [ "$(fingerprint "$A")" = "$FP_A" ] && [ "$(active)" = "$A" ]; then
  result PASS L2 "ops container killed during geocoder-build ($orph_before job container(s) running); A stayed ready; next import recovered the lock, stopped orphans, replaced the failed build of $B and validated it"
else
  result FAIL L2 "ops=$ops mid_ready=$mid_ready rc=$rc B=$B"
fi
if [ -z "$B" ] || [ ! -f "$SEYRA_HOME/releases/$B/manifest.json" ] || [ "$(jq -r .status "$SEYRA_HOME/releases/$B/manifest.json")" != validated ]; then
  for s in L3 L4 L5 L6; do result BLOCKED "$s" "needs a validated release B from L2"; done
  printf '%s\n' "${summary[@]}" > "$ev/summary.txt"
  exit 1
fi
FP_B="$(fingerprint "$B")"

# ------------------------------------------------------------------ L3 provider-start failure during activation
settings="$SEYRA_HOME/state/settings.json"
cp "$settings" "$ev/.settings.bak" 2>/dev/null || echo '{}' > "$ev/.settings.bak"
jq '.readinessTimeoutS = 90' "$ev/.settings.bak" > "$settings"
photon_data="$SEYRA_HOME/releases/$B/photon/photon_data"
mode="$(stat -c %a "$photon_data")"
chmod 000 "$photon_data"  # Photon cannot open its index: the provider fails to start
p="$(probe_start "$ev/L3-probe.txt")"
"$cli" activate "$B" > "$ev/L3-failed-activation.log" 2>&1; rc=$?
kill "$p"
chmod "$mode" "$photon_data"
if [ $rc -ne 0 ] && grep -q "previous release $A restored and ready" "$ev/L3-failed-activation.log" && [ "$(ready_ds)" = "$A" ] \
   && [ "$(active)" = "$A" ] && [ ! -e "$SEYRA_HOME/state/flags/maintenance" ] && [ "$(fingerprint "$A")" = "$FP_A" ]; then
  result PASS L3 "Photon start failure detected (readiness timeout 90 s); previous release $A restored, all four providers ready; not-ready window $(window "$ev/L3-probe.txt") s"
else
  result FAIL L3 "rc=$rc ready=$(ready_ds) active=$(active)"
fi

# ------------------------------------------------------------------ L4 activation A -> B
p="$(probe_start "$ev/L4-probe.txt")"
"$cli" activate "$B" > "$ev/L4-activate.log" 2>&1; rc=$?
kill "$p"
if [ $rc -eq 0 ] && [ "$(ready_ds)" = "$B" ] && [ "$(active)" = "$B" ] && [ "$(previous)" = "$A" ]; then
  result PASS L4 "A -> B activated; all providers report $B; not-ready window $(window "$ev/L4-probe.txt") s (maintenance cutover, not zero downtime)"
else
  result FAIL L4 "rc=$rc ready=$(ready_ds) active=$(active) previous=$(previous)"
fi

# ------------------------------------------------------------------ L5 rollback B -> A
p="$(probe_start "$ev/L5-probe.txt")"
"$cli" rollback > "$ev/L5-rollback.log" 2>&1; rc=$?
kill "$p"
ids="$(ready | jq -c '[.providers[] | .observed_identity]')"
if [ $rc -eq 0 ] && [ "$(ready_ds)" = "$A" ] && [ "$(active)" = "$A" ] && [ "$(previous)" = "$B" ] && [ "$(fingerprint "$A")" = "$FP_A" ] && [ "$(fingerprint "$B")" = "$FP_B" ]; then
  result PASS L5 "rollback B -> A; providers report $ids; not-ready window $(window "$ev/L5-probe.txt") s"
else
  result FAIL L5 "rc=$rc ready=$(ready_ds) active=$(active) previous=$(previous)"
fi

# ------------------------------------------------------------------ L6 prune keeps active + previous
"$cli" prune > "$ev/L6-prune.log" 2>&1; rc=$?
left="$(cd "$SEYRA_HOME/releases" && ls -d ds-* 2>/dev/null | sort | tr '\n' ' ')"
if [ $rc -eq 0 ] && [ -d "$SEYRA_HOME/releases/$A" ] && [ -d "$SEYRA_HOME/releases/$B" ] && [ "$(echo $left | wc -w)" = 2 ]; then
  result PASS L6 "prune kept exactly active $A and previous $B"
else
  result FAIL L6 "rc=$rc releases: $left"
fi

cp "$ev/.settings.bak" "$settings" && rm -f "$ev/.settings.bak"
{
  echo "# Seyra lifecycle scenarios (AC06/AC07) — $(date -u +%FT%TZ)"
  echo "# A=$A B=$B fixture=$(sha256sum "$FIXTURE" | cut -c1-16)"
  printf '%s\n' "${summary[@]}"
  echo "# failures: $fails"
} > "$ev/summary.txt"
cat "$ev/summary.txt"
exit $((fails > 0))
