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

fail() { echo "$*; refusing to start (fail closed)" >&2; exit 2; }
# Strict IPv4: four decimal octets 0-255, no leading zeros. Prints the 32-bit value.
ipv4_int() {
  case "$1" in ""|*[!0-9.]*|.*|*.|*..*) return 1;; esac
  _ifs=$IFS; IFS=.; set -- $1; IFS=$_ifs
  [ $# -eq 4 ] || return 1
  _n=0
  for _o in "$@"; do
    case "$_o" in 0[0-9]*|????*) return 1;; esac
    [ "$_o" -le 255 ] || return 1
    _n=$(( _n * 256 + _o ))
  done
  echo "$_n"
}
# Canonical CIDR (host bits zero), prefix 8..32 — broader entries such as 0.0.0.0/0 are refused.
valid_cidr() {
  _ip=${1%/*}; _p=${1#*/}
  [ "$_ip" != "$1" ] || return 1
  case "$_p" in ""|*[!0-9]*|0?*) return 1;; esac
  [ "$_p" -ge 8 ] && [ "$_p" -le 32 ] || return 1
  _v=$(ipv4_int "$_ip") || return 1
  [ $(( _v % (1 << (32 - _p)) )) -eq 0 ]
}

# The published bind address comes from the same variable compose uses for the port binding.
: "${SEYRA_BIND_ADDR:?SEYRA_BIND_ADDR (published bind address) is required}"
bind_int=$(ipv4_int "$SEYRA_BIND_ADDR") || fail "invalid SEYRA_BIND_ADDR '$SEYRA_BIND_ADDR'"
case "$SEYRA_ACCESS_MODE" in
  loopback)
    # Only a loopback publication may rely on the host binding instead of a client allowlist.
    [ $(( bind_int >> 24 )) -eq 127 ] || fail "loopback access mode with non-loopback bind address $SEYRA_BIND_ADDR (use lan mode with SEYRA_LAN_ALLOW_CIDRS)"
    [ -z "${SEYRA_LAN_ALLOW_CIDRS:-}" ] || fail "SEYRA_LAN_ALLOW_CIDRS is only valid in lan mode"
    SEYRA_ACCESS_RULES="    # access mode: loopback (published on $SEYRA_BIND_ADDR only)"
    ;;
  lan)
    [ -n "${SEYRA_LAN_ALLOW_CIDRS:-}" ] || fail "LAN access mode requires SEYRA_LAN_ALLOW_CIDRS"
    [ $(( bind_int >> 24 )) -ne 127 ] || fail "LAN access mode needs a non-loopback bind address"
    case "$SEYRA_LAN_ALLOW_CIDRS" in ,*|*,|*,,*) fail "SEYRA_LAN_ALLOW_CIDRS has an empty entry";; esac
    rules=""
    for cidr in $(echo "$SEYRA_LAN_ALLOW_CIDRS" | tr ',' ' '); do
      valid_cidr "$cidr" || fail "invalid CIDR '$cidr' (canonical a.b.c.d/n, n 8-32)"
      rules="$rules    allow $cidr;\n"
    done
    SEYRA_ACCESS_RULES="$(printf "    # access mode: lan (network control only, not Seyra Authentication)\n${rules}    deny all;")"
    ;;
  *) fail "unknown SEYRA_ACCESS_MODE '$SEYRA_ACCESS_MODE'";;
esac
echo "$SEYRA_SERVER_NAMES" | grep -Eq '^[A-Za-z0-9. -]+$' || { echo "invalid SEYRA_SERVER_NAMES" >&2; exit 2; }
export SEYRA_DATASET_ID SEYRA_TEGOLA_MAP SEYRA_ACCESS_RULES SEYRA_SERVER_NAMES SEYRA_TILE_CACHE_MAX
mkdir -p /tmp/nginx /var/cache/seyra/tiles
envsubst '${SEYRA_DATASET_ID} ${SEYRA_TEGOLA_MAP} ${SEYRA_ACCESS_RULES} ${SEYRA_SERVER_NAMES} ${SEYRA_TILE_CACHE_MAX}' \
  < /etc/seyra/nginx.conf.template > /tmp/nginx/nginx.conf
nginx -t -c /tmp/nginx/nginx.conf
exec nginx -c /tmp/nginx/nginx.conf -g 'daemon off;'
