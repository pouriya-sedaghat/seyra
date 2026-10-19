#!/usr/bin/env bash
# AC06 / AC07 lifecycle scenarios against a running stack with one active release (A).
#
#   SEYRA_HOME=/abs/state FIXTURE=/abs/synthetic-v1.osm.pbf tests/lifecycle/lifecycle.sh
#
# L1 corrupt inputs fail without touching A          L4 activation A -> B succeeds
# L2 interrupted import is recovered, A untouched    L5 rollback B -> A
# L3 provider-start failure during A -> B restores A L6 prune keeps active + previous
# L7 real `compose up` failure after the switch restores A (review R2)
# L8 recovery failure: maintenance + journal kept, mutators refuse, `recover` restores A (R2)
# L9 prune during a live import / L10 prune during activation / L11 competing rollback and
#    activate (review R3, real concurrent processes) / L12 prune after the transitions
# L13 activation's container killed holding the lock mid-transition; recover/prune/activate race
# L14 stop's container killed holding the lock; start takes it over, prune launched while start holds it is refused
#
# Requires: NODE_BIN (Node for the port squatter), SNAPSHOT_TS (B) and SNAPSHOT_TS_L9 (C) not
# already imported.
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

# ------------------------------------------------------------------ review R2: real command failures
squatter="$repo/tests/lifecycle/port-squatter.mjs"
node_bin="${NODE_BIN:-node}"
wait_file() { for _ in $(seq 1 "${2:-600}"); do [ -e "$1" ] && return 0; sleep 0.2; done; return 1; }
hist="$SEYRA_HOME/state/history.jsonl"

# L7: the new proxy cannot publish 127.0.0.1:8443 (port taken right after the old proxy stops), so
# `docker compose up` itself fails; the squatter lets go once the failure is journalled.
before_l7="$(cat "$SEYRA_HOME/state/runtime.env" "$SEYRA_HOME/state/active/release.json" "$SEYRA_HOME/state/pointers.json" | sha256sum | cut -c1-16)"
rm -f "$ev/.squat-ready"
"$node_bin" "$squatter" 127.0.0.1 8443 "$ev/.squat-ready" "$hist" activation_failed > /dev/null 2>&1 &
sq=$!
"$cli" activate "$B" > "$ev/L7-compose-up-failure.log" 2>&1; rc=$?
kill $sq 2>/dev/null; wait $sq 2>/dev/null
after_l7="$(cat "$SEYRA_HOME/state/runtime.env" "$SEYRA_HOME/state/active/release.json" "$SEYRA_HOME/state/pointers.json" | sha256sum | cut -c1-16)"
if [ $rc -ne 0 ] && grep -q "previous release $A restored and ready" "$ev/L7-compose-up-failure.log" && grep -qiE "address already in use|port is already allocated|bind" "$ev/L7-compose-up-failure.log" \
   && [ "$(ready_ds)" = "$A" ] && [ "$(active)" = "$A" ] && [ ! -e "$SEYRA_HOME/state/transition.json" ] && [ ! -e "$SEYRA_HOME/state/flags/maintenance" ] && [ "$before_l7" = "$after_l7" ]; then
  result PASS L7 "real compose-up failure (8443 taken) after the config switch: previous release $A restored, config/pointers byte-identical ($after_l7), no journal, ready"
else
  result FAIL L7 "rc=$rc ready=$(ready_ds) active=$(active) cfg $before_l7 -> $after_l7"
fi

# L8: the port stays taken, so recovery fails too: maintenance and the journal must remain, other
# mutators must refuse, and `recover` must restore A once the cause is gone.
rm -f "$ev/.squat-ready"
"$node_bin" "$squatter" 127.0.0.1 8443 "$ev/.squat-ready" > /dev/null 2>&1 &
sq=$!
"$cli" activate "$B" > "$ev/L8-recovery-failure.log" 2>&1; rc=$?
journal_kept=no; [ -e "$SEYRA_HOME/state/transition.json" ] && journal_kept=yes
maint_kept=no; [ -e "$SEYRA_HOME/state/flags/maintenance" ] && maint_kept=yes
"$cli" status > "$ev/L8-status.log" 2>&1
"$cli" activate "$B" > "$ev/L8-activate-refused.log" 2>&1; rc_a=$?
"$cli" prune > "$ev/L8-prune-refused.log" 2>&1; rc_p=$?
"$cli" start > "$ev/L8-start-refused.log" 2>&1; rc_s=$?
kill $sq 2>/dev/null; wait $sq 2>/dev/null
"$cli" recover > "$ev/L8-recover.log" 2>&1; rc_r=$?
if [ $rc -ne 0 ] && grep -q "AND restoring $A failed" "$ev/L8-recovery-failure.log" && [ $journal_kept = yes ] && [ $maint_kept = yes ] \
   && grep -q "UNFINISHED activate" "$ev/L8-status.log" && [ $rc_a -ne 0 ] && [ $rc_p -ne 0 ] && [ $rc_s -ne 0 ] && grep -q "seyra-maps recover" "$ev/L8-activate-refused.log" \
   && [ $rc_r -eq 0 ] && [ "$(ready_ds)" = "$A" ] && [ "$(active)" = "$A" ] && [ ! -e "$SEYRA_HOME/state/transition.json" ] && [ ! -e "$SEYRA_HOME/state/flags/maintenance" ]; then
  result PASS L8 "recovery failure kept maintenance + journal and reported both errors; activate/prune/start refused; 'recover' restored $A after the cause was removed and it answers through the ingress (proxy rebinds by recover: $(grep -c '\[ingress\]' "$ev/L8-recover.log"))"
else
  result FAIL L8 "rc=$rc journal=$journal_kept maint=$maint_kept refusals=$rc_a/$rc_p/$rc_s recover=$rc_r ready=$(ready_ds)"
fi

# ------------------------------------------------------------------ review R3: real concurrent processes
# L9: prune while an import is building: the live build must be protected and still complete.
"$cli" import --pbf "$FIXTURE" --snapshot-timestamp "${SNAPSHOT_TS_L9:-2026-10-05T00:00:00Z}" > "$ev/L9-import.log" 2>&1 &
imp=$!
for _ in $(seq 1 600); do grep -q 'render-import' "$ev/L9-import.log" && break; sleep 0.5; done
C="$(grep -o 'dataset_id ds-[0-9a-z-]*' "$ev/L9-import.log" | awk '{print $2}')"
"$cli" prune > "$ev/L9-prune-during-import.log" 2>&1; rc_p=$?
building_during="$(jq -r .status "$SEYRA_HOME/releases/$C/manifest.json" 2>/dev/null)"
wait $imp; rc_i=$?
if [ -n "$C" ] && [ $rc_p -eq 0 ] && grep -q "skipping $C: being built by the running import" "$ev/L9-prune-during-import.log" && [ "$building_during" = building ] \
   && [ $rc_i -eq 0 ] && [ "$(jq -r .status "$SEYRA_HOME/releases/$C/manifest.json")" = validated ] && "$cli" verify-release "$C" > /dev/null 2>&1; then
  result PASS L9 "prune during a live import skipped the building release $C; the import completed and $C verifies (render DB intact)"
else
  result FAIL L9 "C=$C prune=$rc_p during=$building_during import=$rc_i"
fi

# L10: prune while an activation is in flight is refused; the activation completes.
"$cli" activate "$B" > "$ev/L10-activate.log" 2>&1 &
act=$!
wait_file "$SEYRA_HOME/state/flags/maintenance"
"$cli" prune > "$ev/L10-prune-during-activation.log" 2>&1; rc_p=$?
wait $act; rc_a=$?
if [ $rc_p -ne 0 ] && grep -q "another lifecycle operation is running: activate $B" "$ev/L10-prune-during-activation.log" && [ $rc_a -eq 0 ] && [ "$(ready_ds)" = "$B" ] && [ -d "$SEYRA_HOME/releases/$A" ]; then
  result PASS L10 "prune during the A -> B activation was refused (lifecycle lock); activation completed; nothing removed"
else
  result FAIL L10 "prune=$rc_p activate=$rc_a ready=$(ready_ds)"
fi

# L11: a second transition while one is running is refused (competing activation/rollback).
"$cli" rollback > "$ev/L11-rollback.log" 2>&1 &
rb=$!
wait_file "$SEYRA_HOME/state/flags/maintenance"
"$cli" activate "$B" > "$ev/L11-competing-activate.log" 2>&1; rc_c=$?
wait $rb; rc_r=$?
if [ $rc_c -ne 0 ] && grep -q "another lifecycle operation is running: rollback" "$ev/L11-competing-activate.log" && [ $rc_r -eq 0 ] && [ "$(ready_ds)" = "$A" ] && [ "$(active)" = "$A" ] && [ "$(previous)" = "$B" ]; then
  result PASS L11 "activation competing with a running rollback was refused; rollback completed (active $A, previous $B)"
else
  result FAIL L11 "competing=$rc_c rollback=$rc_r ready=$(ready_ds) active=$(active) previous=$(previous)"
fi

# Ordinary post-transition pruning still works: C (validated, not active/previous) is removed.
"$cli" prune > "$ev/L11-final-prune.log" 2>&1
[ ! -d "$SEYRA_HOME/releases/$C" ] && result PASS L12 "post-transition prune removed $C and kept $A/$B" || result FAIL L12 "C still present"

# ------------------------------------------------------------------ review R3 follow-up: crashed lock owners
# The lifecycle lock is a kernel flock held by the command's ops container. Kill that container while
# it holds the lock, then start competing mutating commands at the same time, each in its own
# container. The owner record is sampled every 0.1 s (L13/L14-owners.txt: who held it, in order).
lock="$SEYRA_HOME/state/lifecycle.lock"
owners_start() { ( while true; do { [ -s "$lock" ] && jq -c '{op, target, host}' "$lock"; } 2>/dev/null || echo '{"op":null}'; sleep 0.1; done ) > "$1.raw" 2>/dev/null & echo $!; }
owners_stop() { kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; uniq "$2.raw" > "$2"; rm -f "$2.raw"; }
kill_lock_holder() { # op: kill the ops container recorded as holding the lifecycle lock for op
  local h=""
  for _ in $(seq 1 600); do h="$(jq -r --arg op "$1" 'select(.op == $op) | .host' "$lock" 2>/dev/null)"; [ -n "$h" ] && break; sleep 0.1; done
  [ -n "$h" ] && docker kill "$h" > /dev/null 2>&1 && echo "$h"
}
refused_for_recover() { grep -qE "another lifecycle operation is running: recover|ended without finishing; run: seyra-maps recover" "$1"; }

# L13: an activation's ops container killed mid-transition (journal written, lock held); then
# recover, prune and activate start together. Only recover may run; A must serve again.
ow="$(owners_start "$ev/L13-owners.txt")"
"$cli" activate "$B" > "$ev/L13-killed-activate.log" 2>&1 &
ka=$!
wait_file "$SEYRA_HOME/state/transition.json"
killed="$(kill_lock_holder activate)"
wait $ka 2>/dev/null
"$cli" status > "$ev/L13-status-after-kill.log" 2>&1
"$cli" recover > "$ev/L13-recover.log" 2>&1 & r1=$!
"$cli" prune > "$ev/L13-prune.log" 2>&1 & r2=$!
"$cli" activate "$B" > "$ev/L13-activate.log" 2>&1 & r3=$!
wait $r1; rc_r=$?; wait $r2; rc_p=$?; wait $r3; rc_a=$?
owners_stop "$ow" "$ev/L13-owners.txt"
if [ -n "$killed" ] && grep -q "lifecycle lock: free (record of activate $B" "$ev/L13-status-after-kill.log" && grep -q "UNFINISHED activate" "$ev/L13-status-after-kill.log" \
   && [ $rc_r -eq 0 ] && [ $rc_p -ne 0 ] && [ $rc_a -ne 0 ] && refused_for_recover "$ev/L13-prune.log" && refused_for_recover "$ev/L13-activate.log" \
   && [ "$(ready_ds)" = "$A" ] && [ "$(active)" = "$A" ] && [ "$(previous)" = "$B" ] && [ -d "$SEYRA_HOME/releases/$B" ] \
   && [ ! -e "$SEYRA_HOME/state/transition.json" ] && [ ! -e "$SEYRA_HOME/state/flags/maintenance" ] && [ ! -s "$lock" ]; then
  result PASS L13 "activate's ops container $killed killed while holding the lock mid-transition: the lock was free at once (status: record only, UNFINISHED activate); of recover/prune/activate started together only recover ran (prune: $(grep -oE 'another lifecycle operation is running: recover|ended without finishing' "$ev/L13-prune.log" | head -1); activate: $(grep -oE 'another lifecycle operation is running: recover|ended without finishing' "$ev/L13-activate.log" | head -1)); A ready again, B kept, journal/maintenance cleared, no owner left"
else
  result FAIL L13 "killed=$killed recover=$rc_r prune=$rc_p activate=$rc_a ready=$(ready_ds) active=$(active) journal=$([ -e "$SEYRA_HOME/state/transition.json" ] && echo yes || echo no)"
fi

# L14: a stop's ops container killed while holding the lock (no transition). `start` takes the lock
# over; `prune` is launched only once `start` is observed holding it, so the two overlap by
# construction and prune must be refused as busy. If start had already released the lock before
# prune asked for it, the overlap was not demonstrated and the case FAILs instead of passing.
ow="$(owners_start "$ev/L14-owners.txt")"
"$cli" stop > "$ev/L14-killed-stop.log" 2>&1 &
ks=$!
killed2="$(kill_lock_holder stop)"
wait $ks 2>/dev/null
"$cli" status > "$ev/L14-status-after-kill.log" 2>&1
"$cli" start > "$ev/L14-start.log" 2>&1 & s1=$!
held=""
for _ in $(seq 1 600); do [ "$(jq -r '.op // empty' "$lock" 2>/dev/null)" = start ] && { held="$(jq -r '.host' "$lock")"; break; }; sleep 0.1; done
"$cli" prune > "$ev/L14-prune.log" 2>&1 & s2=$!
wait $s2; rc_p=$?; wait $s1; rc_s=$?
"$cli" start > "$ev/L14-final-start.log" 2>&1; rc_f=$?
wait_ready "$A" 300
owners_stop "$ow" "$ev/L14-owners.txt"
if [ -n "$killed2" ] && grep -q "lifecycle lock: free (record of stop" "$ev/L14-status-after-kill.log" && [ -n "$held" ] && [ $rc_s -eq 0 ] \
   && [ $rc_p -ne 0 ] && grep -q "another lifecycle operation is running: start" "$ev/L14-prune.log" \
   && [ $rc_f -eq 0 ] && [ "$(ready_ds)" = "$A" ] && [ "$(active)" = "$A" ] && [ "$(previous)" = "$B" ] && [ ! -s "$lock" ]; then
  result PASS L14 "stop's ops container $killed2 killed while holding the lock: start took the lock over at once (holder $held); prune, launched while start held it, was refused ('another lifecycle operation is running: start'); A ready after start, no owner left"
elif [ -n "$held" ] && [ $rc_p -eq 0 ]; then
  result FAIL L14 "overlap not demonstrated: prune ran (rc=0) although it was launched while start ($held) held the lock; start=$rc_s"
else
  result FAIL L14 "killed=$killed2 start_held=${held:-never observed} start=$rc_s prune=$rc_p final_start=$rc_f ready=$(ready_ds)"
fi

cp "$ev/.settings.bak" "$settings" && rm -f "$ev/.settings.bak" "$ev/.squat-ready"
{
  echo "# Seyra lifecycle scenarios (AC06/AC07) — $(date -u +%FT%TZ)"
  echo "# A=$A B=$B C=${C:-} fixture=$(sha256sum "$FIXTURE" | cut -c1-16)"
  printf '%s\n' "${summary[@]}"
  echo "# failures: $fails"
} > "$ev/summary.txt"
cat "$ev/summary.txt"
exit $((fails > 0))
