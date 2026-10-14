#!/bin/sh
# Render and start the Seyra proxy. Fails closed on incomplete access configuration.
set -eu
: "${SEYRA_DATASET_ID:?SEYRA_DATASET_ID is required}"
: "${SEYRA_ACCESS_MODE:=loopback}"
: "${SEYRA_SERVER_NAMES:=localhost 127.0.0.1}"
: "${SEYRA_TILE_CACHE_MAX:=2g}"
case "$SEYRA_DATASET_ID" in *[!a-z0-9-]*|"") echo "invalid dataset id" >&2; exit 2;; esac
for f in /run/secrets/tls_cert /run/secrets/tls_key; do
  [ -r "$f" ] || { echo "missing TLS material: $f (run: seyra-maps tls init)" >&2; exit 2; }
done
[ -f /srv/seyra/release/maps/tiles.json ] || { echo "active release map metadata missing" >&2; exit 2; }
SEYRA_TEGOLA_MAP="seyra_$(echo "$SEYRA_DATASET_ID" | tr '-' '_')"
case "$SEYRA_ACCESS_MODE" in
  loopback)
    # Host port is published on 127.0.0.1 only (compose); no additional client allowlist.
    SEYRA_ACCESS_RULES="    # access mode: loopback (host-side binding restricts clients)"
    ;;
  lan)
    if [ -z "${SEYRA_LAN_ALLOW_CIDRS:-}" ]; then
      echo "LAN access mode requires SEYRA_LAN_ALLOW_CIDRS; refusing to start (fail closed)" >&2; exit 2
    fi
    rules=""
    for cidr in $(echo "$SEYRA_LAN_ALLOW_CIDRS" | tr ',' ' '); do
      echo "$cidr" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$' || { echo "invalid CIDR: $cidr" >&2; exit 2; }
      rules="$rules    allow $cidr;\n"
    done
    SEYRA_ACCESS_RULES="$(printf "    # access mode: lan (network control only, not Seyra Authentication)\n${rules}    deny all;")"
    ;;
  *) echo "unknown SEYRA_ACCESS_MODE '$SEYRA_ACCESS_MODE'" >&2; exit 2;;
esac
echo "$SEYRA_SERVER_NAMES" | grep -Eq '^[A-Za-z0-9. -]+$' || { echo "invalid SEYRA_SERVER_NAMES" >&2; exit 2; }
export SEYRA_DATASET_ID SEYRA_TEGOLA_MAP SEYRA_ACCESS_RULES SEYRA_SERVER_NAMES SEYRA_TILE_CACHE_MAX
mkdir -p /tmp/nginx /var/cache/seyra/tiles
envsubst '${SEYRA_DATASET_ID} ${SEYRA_TEGOLA_MAP} ${SEYRA_ACCESS_RULES} ${SEYRA_SERVER_NAMES} ${SEYRA_TILE_CACHE_MAX}' \
  < /etc/seyra/nginx.conf.template > /tmp/nginx/nginx.conf
nginx -t -c /tmp/nginx/nginx.conf
exec nginx -c /tmp/nginx/nginx.conf -g 'daemon off;'
