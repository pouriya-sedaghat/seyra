#!/usr/bin/env bash
# Create the serving VM's TLS server key and CSR with the host's OpenSSL (no Seyra CLI needed), for
# the Windows issuing CA to sign (infra/tls/lan-pki/windows/Sign-ServerCsr.ps1). The key never leaves
# the VM; the cutover imports it with `seyra-maps tls import --key`.
#
#   infra/tls/lan-pki/new-server-csr.sh <new-private-dir> <ipv4> [<existing-internal-dns-name>]
#
# Writes <dir>/server/server.key (0400), <dir>/server/server.csr, and the public transfer copy
# <dir>/to-windows/{server.csr, request-manifest.json}; <dir>/from-windows is created for the
# returned public packet. Refuses an existing <dir> (nothing is overwritten). Every result is
# checked independently of OpenSSL's exit status (key parse/check, CSR signature, exact SANs and
# extensions, key/CSR public-key agreement). Add a DNS name only if it already resolves in the
# internal DNS to this address; never invent one.
set -uo pipefail
umask 0077
dir="${1:?usage: new-server-csr.sh <new-private-dir> <ipv4> [<dns-name>]}"; ip="${2:?ipv4 required}"; dns="${3:-}"
die() { echo "new-server-csr: $*" >&2; exit 2; }
[[ "$ip" =~ ^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$ ]] || die "not a canonical IPv4 address: $ip"
[ -z "$dns" ] || [[ "$dns" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "not a plain lower-case DNS name: $dns"
[ -e "$dir" ] && die "$dir exists; refusing to overwrite anything"
mkdir -m 0700 -p "$dir" && mkdir -m 0700 "$dir/server" "$dir/to-windows" "$dir/from-windows" || die "cannot create $dir"
san="IP:$ip"; [ -n "$dns" ] && san="$san,DNS:$dns"
( cd "$dir/server" && set -o noclobber && openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout server.key -out server.csr -subj "/CN=$ip" -addext "subjectAltName=$san" -addext "extendedKeyUsage=serverAuth" \
    -addext "keyUsage=critical,digitalSignature" -addext "basicConstraints=critical,CA:FALSE" ) > "$dir/server/openssl.log" 2>&1
chmod 0400 "$dir/server/server.key" 2>/dev/null; chmod 0444 "$dir/server/server.csr" 2>/dev/null
k="$dir/server/server.key"; c="$dir/server/server.csr"
[ -s "$k" ] && [ -s "$c" ] || die "key or CSR missing (see $dir/server/openssl.log)"
[ "$(stat -c %a "$k")" = 400 ] || die "server.key is not 0400"
openssl pkey -in "$k" -noout -check 2>/dev/null | grep -q 'Key is valid' || die "server.key does not parse as a valid key"
openssl pkey -in "$k" -noout -text 2>/dev/null | grep -q 'NIST CURVE: P-256' || die "server.key is not EC P-256"
openssl req -in "$c" -noout -verify 2>&1 | grep -q 'verify OK' || die "CSR self-signature does not verify"
text="$(openssl req -in "$c" -noout -text)"
want_san="IP Address:$ip"; [ -n "$dns" ] && want_san="IP Address:$ip, DNS:$dns"
got_san="$(sed -n '/Subject Alternative Name/{n;s/^ *//;p}' <<<"$text")"
[ "$got_san" = "$want_san" ] || die "CSR SANs '$got_san' != '$want_san'"
grep -A1 'Extended Key Usage' <<<"$text" | grep -qx ' *TLS Web Server Authentication' || die "CSR extended key usage is not exactly serverAuth"
grep -A1 'Key Usage: critical' <<<"$text" | grep -qx ' *Digital Signature' || die "CSR key usage is not exactly digitalSignature"
grep -A1 'Basic Constraints: critical' <<<"$text" | grep -qx ' *CA:FALSE' || die "CSR basic constraints are not CA:FALSE"
spki_k="$(openssl pkey -in "$k" -pubout -outform DER | sha256sum | cut -c1-64)"
spki_c="$(openssl req -in "$c" -noout -pubkey | openssl pkey -pubin -outform DER | sha256sum | cut -c1-64)"
[ "$spki_k" = "$spki_c" ] && [ ${#spki_k} = 64 ] || die "key and CSR public keys differ"
cp "$c" "$dir/to-windows/server.csr" && chmod 0444 "$dir/to-windows/server.csr"
dns_json='[]'; sans_json="$(jq -n --arg ip "$ip" '[{type:"ip", value:$ip}]')"
[ -n "$dns" ] && { dns_json="$(jq -n --arg d "$dns" '[$d]')"; }
jq -n --arg ip "$ip" --argjson sans "$sans_json" --argjson dns "$dns_json" --arg csr "$(sha256sum "$dir/to-windows/server.csr" | cut -c1-64)" \
  --arg spki "$spki_c" --arg now "$(date -u +%FT%TZ)" \
  '{schema:"seyra.lan-csr-request/1", created_at:$now, purpose:"Seyra map services LAN HTTPS server (single VM)", subject_cn:$ip, sans:$sans, dns_names:$dns,
    key:{algorithm:"EC", curve:"P-256"}, spki_sha256:$spki, csr_file:"server.csr", csr_file_sha256:$csr,
    requested:{basic_constraints:"critical, CA:FALSE", key_usage:"critical, digitalSignature", extended_key_usage:["serverAuth"]},
    issue_with:{issuer:"Seyra LAN Issuing CA (intermediate)", lifetime:"90 days", not_before_skew:"-5m", eku:["serverAuth"], key_usage:["digitalSignature"]},
    note:"The server private key never leaves the VM. Only this CSR and manifest are public."}' > "$dir/to-windows/request-manifest.json"
chmod 0444 "$dir/to-windows/request-manifest.json"
echo "server key: $k (0400, stays on this VM)"
echo "public transfer: $dir/to-windows/{server.csr,request-manifest.json}"
echo "CSR SHA-256 $(sha256sum "$dir/to-windows/server.csr" | cut -c1-64); public key SHA-256 $spki_c; SANs: $got_san"
