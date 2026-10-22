#!/bin/sh
# Validate edge relay settings and render edge.conf (fail closed). Inputs come from an operator-local
# env file (never committed; see edge.env.example):
#   EDGE_CLIENT_CIDRS  approved client networks (canonical a.b.c.d/n, n 8-32, comma separated)
#   EDGE_UPSTREAM      relay listener of the Seyra proxy, IPv4:port (the nested host's lab address)
#   EDGE_SOURCE        optional: source address for upstream connections (proxy_bind)
#
#   EDGE_TEMPLATE=infra/edge/edge.conf.template infra/edge/render-edge.sh <out-dir>
set -eu
out="${1:?usage: render-edge.sh <out-dir>}"
template="${EDGE_TEMPLATE:-$(dirname "$0")/edge.conf.template}"
fail() { echo "edge: $*; refusing to render (fail closed)" >&2; exit 2; }
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
valid_cidr() {
  _ip=${1%/*}; _p=${1#*/}
  [ "$_ip" != "$1" ] || return 1
  case "$_p" in ""|*[!0-9]*|0?*) return 1;; esac
  [ "$_p" -ge 8 ] && [ "$_p" -le 32 ] || return 1
  _v=$(ipv4_int "$_ip") || return 1
  [ $(( _v % (1 << (32 - _p)) )) -eq 0 ]
}
: "${EDGE_CLIENT_CIDRS:?EDGE_CLIENT_CIDRS is required}"
: "${EDGE_UPSTREAM:?EDGE_UPSTREAM is required}"
: "${EDGE_SOURCE:=}"
case "$EDGE_CLIENT_CIDRS" in ,*|*,|*,,*) fail "EDGE_CLIENT_CIDRS has an empty entry";; esac
rules=""
for c in $(echo "$EDGE_CLIENT_CIDRS" | tr ',' ' '); do
  valid_cidr "$c" || fail "invalid CIDR '$c'"
  rules="$rules    allow $c;
"
done
rules="$rules    deny all;"
up_ip=${EDGE_UPSTREAM%:*}; up_port=${EDGE_UPSTREAM##*:}
[ "$up_ip" != "$EDGE_UPSTREAM" ] || fail "EDGE_UPSTREAM must be IPv4:port"
ipv4_int "$up_ip" >/dev/null || fail "invalid upstream address '$up_ip'"
case "$up_port" in ""|*[!0-9]*|0*) fail "invalid upstream port '$up_port'";; esac
[ "$up_port" -le 65535 ] || fail "invalid upstream port '$up_port'"
bind=""
if [ -n "$EDGE_SOURCE" ]; then
  ipv4_int "$EDGE_SOURCE" >/dev/null || fail "invalid EDGE_SOURCE '$EDGE_SOURCE'"
  bind="    proxy_bind $EDGE_SOURCE;"
fi
mkdir -p "$out"
EDGE_ACCESS_RULES="$rules" EDGE_UPSTREAM="$up_ip:$up_port" EDGE_PROXY_BIND="$bind" \
  envsubst '${EDGE_ACCESS_RULES} ${EDGE_UPSTREAM} ${EDGE_PROXY_BIND}' < "$template" > "$out/edge.conf"
echo "edge: rendered $out/edge.conf (upstream $up_ip:$up_port)"
