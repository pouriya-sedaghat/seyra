#!/usr/bin/env bash
# Extract nginx (and its musl runtime) from an exact local image, without creating or starting a
# container: `docker image save` streams the image layers, which are unpacked into OUT. The locked
# image id is checked first. Used by tests/security/test-proxy-boundary.mjs to run the exact
# image's nginx binary on loopback test ports.
#
#   tests/security/extract-image-nginx.sh <image-ref> <expected-image-id> <out-dir>
set -euo pipefail
ref="$1"; want="$2"; out="$3"
got="$(docker image inspect -f '{{.Id}}' "$ref")"
[ "$got" = "$want" ] || { echo "image $ref is $got, expected $want" >&2; exit 1; }
rm -rf "$out"; mkdir -p "$out/root" "$out/layers"
docker image save "$ref" | tar -x -C "$out/layers"
# OCI layout (index.json/manifest.json); apply layers in manifest order.
for l in $(jq -r '.[0].Layers[]' "$out/layers/manifest.json"); do
  tar -x -C "$out/root" -f "$out/layers/$l" --exclude='dev/*' 2>/dev/null || tar -x -C "$out/root" -f "$out/layers/$l" --exclude='dev/*'
done
rm -rf "$out/layers"
loader="$(ls "$out"/root/lib/ld-musl-*.so.1)"
cat > "$out/nginx" <<EOF
#!/bin/sh
exec "$loader" --library-path "$out/root/lib:$out/root/usr/lib" "$out/root/usr/sbin/nginx" "\$@"
EOF
chmod 0755 "$out/nginx"
printf '%s\n' "$got" > "$out/image-id.txt"
"$out/nginx" -V 2>&1 | tee "$out/nginx-V.txt"
