#!/usr/bin/env bash
# DEVELOPMENT certificate issuer for Seyra LAN testing. Run it on an operator machine that is NOT the
# serving host. Its private key must never reach the serving host, its containers, service or secrets
# backups, images, bundles or Git. A company CA, where available, replaces this script entirely: both
# sign the CSR from `seyra-maps tls csr`, and the server only ever receives the leaf, the chain and
# the public root through `seyra-maps tls import`.
#
#   dev-issuer.sh init <issuer-dir> [--days N]                          development root (default 365 days)
#   dev-issuer.sh sign <issuer-dir> <server.csr> --names n1,n2 [--days N]  serverAuth leaf (default 90, max 397 days)
#
# Device trust in this root is a separate owner decision with an explicit removal procedure. The root
# carries no name constraints: do not present it as restricted to one address.
set -euo pipefail
die() { echo "dev-issuer: $*" >&2; exit 2; }
cmd="${1:-}"; dir="${2:-}"
[ -n "$cmd" ] && [ -n "$dir" ] || die "usage: dev-issuer.sh init|sign <issuer-dir> ..."
# Refuse obvious serving-host contexts.
[ -z "${SEYRA_HOME:-}" ] || die "SEYRA_HOME is set: this looks like a Seyra host; run the issuer elsewhere"
[ ! -e /opt/seyra-install ] || die "/opt/seyra-install exists: this looks like a Seyra host; run the issuer elsewhere"
case "$(cd "$(dirname "$dir")" 2>/dev/null && pwd)/" in */secrets/*) die "refusing an issuer directory under a secrets/ tree";; esac
days=""; names=""
args=("${@:3}")
csr=""
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    --days) days="${args[$((i + 1))]}"; i=$((i + 1));;
    --names) names="${args[$((i + 1))]}"; i=$((i + 1));;
    *) [ -z "$csr" ] && csr="${args[$i]}" || die "unexpected argument ${args[$i]}";;
  esac
done
case "$cmd" in
  init)
    [ ! -e "$dir/root.key" ] || die "$dir already holds an issuer; refusing to overwrite it"
    days="${days:-365}"
    mkdir -p "$dir"; chmod 0700 "$dir"
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$dir/root.key" -out "$dir/root.crt" -days "$days" \
      -subj "/CN=Seyra development issuer $(date -u +%Y-%m-%d)" -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
      -addext 'subjectKeyIdentifier=hash' 2>/dev/null
    chmod 0400 "$dir/root.key"; chmod 0444 "$dir/root.crt"
    echo "dev-issuer: root $(openssl x509 -in "$dir/root.crt" -noout -fingerprint -sha256 | cut -d= -f2) valid $days days"
    echo "dev-issuer: give clients and 'tls import --ca' $dir/root.crt only; root.key stays here"
    ;;
  sign)
    [ -f "$dir/root.key" ] || die "no issuer in $dir (run init)"
    [ -f "$csr" ] || die "CSR file required"
    [ -n "$names" ] || die "--names is required (the exact names/addresses clients use)"
    days="${days:-90}"; [ "$days" -le 397 ] || die "at most 397 days for a development leaf"
    openssl req -in "$csr" -noout -verify 2>/dev/null || die "CSR signature does not verify"
    san=""
    IFS=',' read -r -a list <<<"$names"
    for n in "${list[@]}"; do
      case "$n" in *'*'*) die "wildcards are not issued";; esac
      if [[ "$n" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then san="$san${san:+,}IP:$n"; else san="$san${san:+,}DNS:$n"; fi
    done
    ext="$(mktemp)"; trap 'rm -f "$ext"' EXIT
    # Extensions are set here from --names, never copied from the CSR.
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\nauthorityKeyIdentifier=keyid\nsubjectKeyIdentifier=hash\n' "$san" > "$ext"
    out="${csr%.csr}.crt"
    openssl x509 -req -in "$csr" -CA "$dir/root.crt" -CAkey "$dir/root.key" -CAcreateserial -out "$out" -days "$days" -extfile "$ext" 2>/dev/null
    echo "dev-issuer: issued $out for $san, $days days, sha256 $(openssl x509 -in "$out" -noout -fingerprint -sha256 | cut -d= -f2)"
    ;;
  *) die "unknown command $cmd";;
esac
