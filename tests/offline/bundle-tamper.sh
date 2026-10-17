#!/usr/bin/env bash
# AC18: offline bundle integrity. Each case modifies the bundle, expects `bundle verify` (and for
# T4 `bundle load`) to refuse it, then restores the exact original bytes.
#
#   SEYRA_HOME=/abs/state BUNDLE=/abs/bundle tests/offline/bundle-tamper.sh
set -uo pipefail
: "${SEYRA_HOME:?}" "${BUNDLE:?}"
repo="${SEYRA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
cli="$repo/bin/seyra-maps"
ev="$repo/docs/evidence/offline"
mkdir -p "$ev"
out=()
fails=0
expect_refused() { # id description
  local o rc
  o="$("$cli" bundle verify "$BUNDLE" 2>&1)"; rc=$?
  if [ $rc -ne 0 ]; then out+=("PASS $1 $2 — $(echo "$o" | grep -v '^BUNDLE INVALID' | head -1)"); else out+=("FAIL $1 $2 — accepted"); fails=$((fails + 1)); fi
}
sums_before="$(sha256sum "$BUNDLE/SHA256SUMS" | cut -d' ' -f1)"

"$cli" bundle verify "$BUNDLE" >/dev/null 2>&1 && out+=("PASS T0 untouched bundle verifies") || { out+=("FAIL T0 untouched bundle rejected"); fails=$((fails + 1)); }

f="$BUNDLE/install/docs/RUNBOOK.md"; cp -p "$f" "$f.orig"; printf 'X' >> "$f"
expect_refused T1 "modified install file is detected"
mv "$f.orig" "$f"

a="$BUNDLE/images/proxy.tar"; size="$(stat -c %s "$a")"; printf '\0' >> "$a"
expect_refused T2 "corrupted image archive is detected"
truncate -s "$size" "$a"

touch "$BUNDLE/install/unexpected-file"
expect_refused T3 "unlisted extra file is detected"
rm -f "$BUNDLE/install/unexpected-file"

# T4: an attacker rewrites the manifest identity AND recomputes SHA256SUMS consistently. The
# checksum layer cannot catch that; the load-time identity check must (the loaded image's real ID
# differs from the claimed one). Authenticity therefore relies on comparing the SHA256SUMS digest
# out of band (RUNBOOK §2).
m="$BUNDLE/bundle-manifest.json"; bak="$(mktemp -d)"; cp -p "$m" "$bak/manifest"; cp -p "$BUNDLE/SHA256SUMS" "$bak/sums"
fake="sha256:$(printf '%064d' 0)"
jq --arg f "$fake" '(.images[] | select(.role=="TEGOLA") | .image_id) = $f' "$bak/manifest" > "$m"
(cd "$BUNDLE" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs sha256sum) > "$BUNDLE/SHA256SUMS"
"$cli" bundle verify "$BUNDLE" >/dev/null 2>&1 && v=accepted || v=refused
o="$("$cli" bundle load "$BUNDLE" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && echo "$o" | grep -q "expected $fake"; then
  out+=("PASS T4 consistent manifest+checksum rewrite (checksum verify: $v) is refused at load: $(echo "$o" | grep -o 'loaded seyra/tegola[^;]*' | head -1)")
else
  out+=("FAIL T4 manifest identity rewrite not refused at load (rc=$rc: $(echo "$o" | tail -1 | cut -c1-160))"); fails=$((fails + 1))
fi
cp -p "$bak/manifest" "$m"; cp -p "$bak/sums" "$BUNDLE/SHA256SUMS"; rm -rf "$bak"

[ "$(sha256sum "$BUNDLE/SHA256SUMS" | cut -d' ' -f1)" = "$sums_before" ] && "$cli" bundle verify "$BUNDLE" >/dev/null 2>&1 \
  && out+=("PASS T5 bundle restored byte-identical (SHA256SUMS digest $sums_before)") || { out+=("FAIL T5 bundle not restored"); fails=$((fails + 1)); }

{
  echo "# Seyra offline bundle tamper checks (AC18) — $(date -u +%FT%TZ)"
  echo "# bundle=$BUNDLE"
  printf '%s\n' "${out[@]}"
  echo "# failures: $fails"
} | tee "$ev/tamper.txt"
exit $((fails > 0))
