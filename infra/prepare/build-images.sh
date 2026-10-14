#!/usr/bin/env bash
# PREPARATION ENVIRONMENT ONLY. Build every Seyra image from the pinned sources in dependency
# order (osmtools and photon before geocoder-build). Base images are pinned by digest in the
# Dockerfiles. SEYRA_PREP_CA may point to a TLS-intercepting proxy CA used only during npm ci.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
src="${SEYRA_SOURCES:?}"
secret=()
if [ -n "${SEYRA_PREP_CA:-}" ]; then secret=(--secret "id=prep_ca,src=$SEYRA_PREP_CA"); fi
b() { echo "== building $1"; shift; docker build "$@"; }
b osmtools -t seyra/osmtools:2.3.1-1.19.1-seyra1 -f "$repo/infra/images/osmtools/Dockerfile" \
  --build-context osm2pgsql_src="$src/osm2pgsql" --build-context osmium_tool_src="$src/osmium-tool" "$repo/infra"
b valhalla -t seyra/valhalla:3.9.1-seyra1 --build-context valhalla_src="$src/valhalla" \
  --build-context prime_server_src="$src/prime_server" "$repo/infra/images/valhalla"
b overpass -t seyra/overpass:0.7.62.4-seyra1 --build-context overpass_src="$src/overpass" "$repo/infra/images/overpass"
b tegola -t seyra/tegola:0.21.2-seyra1 --build-arg TEGOLA_REVISION="$(git -C "$src/tegola" rev-parse HEAD)" \
  --build-context tegola_src="$src/tegola" "$repo/infra/images/tegola"
b photon -t seyra/photon:1.3.0-seyra1 --build-context photon_artifacts="$src/artifacts" \
  --build-context photon_src="$src/photon" "$repo/infra/images/photon"
b geocoder-build -t seyra/geocoder-build:5.3.2-1.3.0-seyra1 --build-context nominatim_artifacts="$src/artifacts" \
  "$repo/infra/images/geocoder-build"
b api "${secret[@]}" -t seyra/api:1.0.0-seyra1 -f "$repo/infra/images/api/Dockerfile" "$repo"
b proxy "${secret[@]}" -t seyra/proxy:1.0.0-seyra1 -f "$repo/infra/images/proxy/Dockerfile" "$repo"
b ops "${secret[@]}" -t seyra/ops:1.0.0-seyra1 -f "$repo/infra/images/ops/Dockerfile" "$repo"
echo "all images built; now run: node infra/prepare/write-lock.mjs"
