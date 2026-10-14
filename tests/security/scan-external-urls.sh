#!/usr/bin/env bash
# AC04: inventory every absolute URL in what the product executes or serves — the built web
# client, generated release map metadata (styles/TileJSON), proxy and provider configuration,
# compose files and image entrypoints — and classify each as runtime fetch or not.
#
#   SEYRA_HOME=/abs/state tests/security/scan-external-urls.sh [evidence-file]
#
# Documentation/licence/attribution/namespace URLs are listed but not runtime fetches. Exits
# non-zero if an unclassified URL appears.
set -uo pipefail
: "${SEYRA_HOME:?}"
repo="${SEYRA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
out="${1:-$repo/docs/evidence/security/external-urls.txt}"
active="$(jq -r .active "$SEYRA_HOME/state/pointers.json")"
targets=(
  "$repo/apps/web/dist"
  "$SEYRA_HOME/releases/$active/maps"
  "$repo/infra/images/proxy/nginx.conf.template" "$repo/infra/images/proxy/security-headers.conf" "$repo/infra/images/proxy/entrypoint.sh"
  "$repo/infra/compose/runtime.yml" "$repo/infra/compose/jobs.yml"
  "$repo/infra/valhalla/valhalla.json" "$SEYRA_HOME/releases/$active/tegola/tegola.toml"
  "$repo/infra/images/overpass/entrypoint.sh" "$repo/infra/images/overpass/nginx.conf"
  "$repo/infra/images/photon/serve.sh" "$repo/infra/images/tegola/serve.sh" "$repo/infra/images/geocoder-build/geocoder-build.sh"
  "$repo/bin/seyra-maps"
)
# Known non-fetch URL classes (string constants, never requested by the product at runtime).
classify() {
  case "$1" in
    http://www.w3.org/*|https://www.w3.org/*) echo "namespace (XML/SVG/MathML constant)" ;;
    https://www.openstreetmap.org/copyright*) echo "attribution link (user-clicked)" ;;
    https://maplibre.org/*|https://github.com/maplibre/*|https://github.com/mapbox/mapbox-gl-js/issues/*) echo "library error-message/doc link" ;;
    https://wiki.openstreetmap.org/wiki/This_map_requires_WebGL*) echo "library error-message link (no-WebGL message)" ;;
    https://maplibre.invalid/*) echo "URL-parsing base on the reserved .invalid TLD (RFC 2606; never resolvable)" ;;
    https://reactjs.org/*|https://react.dev/*) echo "library error-message/doc link" ;;
    https://www.opensearch.org*|https://opensearch.org*) echo "comment/doc link" ;;
    https://127.0.0.1*|http://127.0.0.1*|http://localhost*|https://localhost*) echo "loopback" ;;
    http://api:*|http://tegola:*|http://valhalla:*|http://photon:*|http://overpass:*|http://seyra_*|postgres://seyra_*) echo "internal service (private network; DSN host is the internal db service)" ;;
    *) echo "UNCLASSIFIED" ;;
  esac
}
declare -A seen
unclassified=0
{
  echo "# External URL inventory (AC04) — $(date -u +%FT%TZ); active release $active"
  for t in "${targets[@]}"; do
    [ -e "$t" ] || { echo "MISSING $t"; continue; }
    while IFS= read -r line; do
      f="${line%%:*}"; u="${line#*:}"
      key="$f|$u"; [ -n "${seen[$key]:-}" ] && continue; seen[$key]=1
      c="$(classify "$u")"; [ "$c" = UNCLASSIFIED ] && unclassified=$((unclassified + 1))
      echo "$c | ${f#"$repo"/} | $u"
    done < <(grep -rHIoE "(https?|postgres)://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+" "$t" 2>/dev/null | sed -E "s/[),;'\"]+$//")
  done
  echo "# unclassified: $unclassified"
} > "$out"
sort -t'|' -k1,1 "$out" | cut -d'|' -f1 | sort | uniq -c
echo "evidence: $out"
exit $((unclassified > 0))
