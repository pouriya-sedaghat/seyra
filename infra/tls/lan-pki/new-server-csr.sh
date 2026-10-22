#!/usr/bin/env bash
# Create the serving VM's TLS server key and CSR with the host's OpenSSL (no Seyra CLI needed), for
# the Windows issuing CA to sign (infra/tls/lan-pki/windows/Sign-ServerCsr.ps1). The key never leaves
# the VM; the cutover imports it with `seyra-maps tls import --key`.
#
#   infra/tls/lan-pki/new-server-csr.sh <new-private-dir> <ipv4> [<existing-internal-dns-name>]
#   infra/tls/lan-pki/new-server-csr.sh --check <existing-request-dir>     (validate only; changes nothing)
#
# Writes <dir>/server/server.key (0400), <dir>/server/server.csr, and the public transfer copy
# <dir>/to-windows/{server.csr, request-manifest.json}; <dir>/from-windows is created for the
# returned public packet. Refuses an existing <dir> (nothing is overwritten).
#
# Publication discipline: the public files are assembled in <dir>/to-windows.incomplete; every
# generation, copy, chmod, serialization and write is checked; the complete request (key, CSR,
# manifest schema/content and all bindings) is validated; only then is the directory renamed to
# <dir>/to-windows and success printed. Any failure exits non-zero and leaves no to-windows
# directory: an <dir>/to-windows.incomplete is an abandoned attempt, never a ready request.
# Checks are independent of OpenSSL's exit status (key parse/check, CSR signature, exact SANs and
# extensions, key/CSR/manifest public-key agreement). Add a DNS name only if it already resolves in
# the internal DNS to this address; never invent one. Diagnostics never print key material.
set -uo pipefail
umask 0077
die() { echo "new-server-csr: $*" >&2; [ -n "${incomplete:-}" ] && echo "new-server-csr: INCOMPLETE: $incomplete is an abandoned attempt, not a ready request" >&2; exit 2; }
for t in openssl jq sha256sum stat cp chmod mkdir mv cmp sed grep date; do command -v "$t" >/dev/null 2>&1 || die "required tool '$t' is not available"; done
ipre='^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$'
dnsre='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
spki_of_key() { local o; o="$(openssl pkey -in "$1" -pubout -outform DER 2>/dev/null | sha256sum)" || return 1; [ "${#o}" -ge 64 ] || return 1; echo "${o:0:64}"; }
spki_of_csr() { local p o; p="$(openssl req -in "$1" -noout -pubkey 2>/dev/null)" || return 1; o="$(openssl pkey -pubin -outform DER <<<"$p" 2>/dev/null | sha256sum)" || return 1; echo "${o:0:64}"; }

# Validate a complete request: <server-dir> <public-dir>. Prints the SAN line; non-zero on any defect.
validate_request() {
  local sd="$1" pd="$2" k c pc m text want got spk spc spm ip dns sha
  k="$sd/server.key"; c="$sd/server.csr"; pc="$pd/server.csr"; m="$pd/request-manifest.json"
  for f in "$k" "$c" "$pc" "$m"; do [ -f "$f" ] && [ ! -L "$f" ] && [ -s "$f" ] || { echo "missing, empty or not a regular file: $f"; return 1; }; done
  [ "$(stat -c %a "$k" 2>/dev/null)" = 400 ] || { echo "server.key is not mode 0400"; return 1; }
  openssl pkey -in "$k" -noout -check 2>/dev/null | grep -q 'Key is valid' || { echo "server.key does not parse as a valid key"; return 1; }
  openssl pkey -in "$k" -noout -text 2>/dev/null | grep -q 'NIST CURVE: P-256' || { echo "server.key is not EC P-256"; return 1; }
  cmp -s "$c" "$pc" || { echo "the public CSR differs from the server CSR"; return 1; }
  openssl req -in "$c" -noout -verify 2>&1 | grep -q 'verify OK' || { echo "CSR self-signature does not verify"; return 1; }
  jq -e '(.schema == "seyra.lan-csr-request/1") and (.csr_file == "server.csr") and ((.sans | type) == "array") and ((.sans | length) == 1)
         and (.sans[0].type == "ip") and ((.sans[0].value | type) == "string") and ((.dns_names | type) == "array") and ((.dns_names | length) <= 1)
         and ((.spki_sha256 | test("^[0-9a-f]{64}$"))) and ((.csr_file_sha256 | test("^[0-9a-f]{64}$"))) and (.key.curve == "P-256")
         and (.requested.extended_key_usage == ["serverAuth"])' "$m" >/dev/null 2>&1 || { echo "request manifest is malformed or incomplete"; return 1; }
  ip="$(jq -er '.sans[0].value' "$m" 2>/dev/null)" && [[ "$ip" =~ $ipre ]] || { echo "manifest IP is not a canonical IPv4 address"; return 1; }
  dns="$(jq -er '.dns_names | join(",")' "$m" 2>/dev/null)" || { echo "manifest dns_names unreadable"; return 1; }
  [ -z "$dns" ] || [[ "$dns" =~ $dnsre ]] || { echo "manifest DNS name is not plain"; return 1; }
  [ "$(jq -er .subject_cn "$m" 2>/dev/null)" = "$ip" ] || { echo "manifest subject differs from its IP"; return 1; }
  sha="$(sha256sum "$pc" 2>/dev/null)" && [ "${sha:0:64}" = "$(jq -er .csr_file_sha256 "$m")" ] || { echo "manifest csr_file_sha256 does not match the public CSR"; return 1; }
  text="$(openssl req -in "$c" -noout -text 2>/dev/null)" || { echo "CSR text unreadable"; return 1; }
  # Explicit RFC 2253 name format: the default display differs between OpenSSL 3.0 ("CN = x") and 3.5 ("CN=x").
  [ "$(openssl req -in "$c" -noout -subject -nameopt RFC2253 2>/dev/null)" = "subject=CN=$ip" ] || { echo "CSR subject is not CN=$ip"; return 1; }
  want="IP Address:$ip"; [ -n "$dns" ] && want="$want, DNS:$dns"
  got="$(sed -n '/Subject Alternative Name/{n;s/^ *//;p}' <<<"$text")"
  [ "$got" = "$want" ] || { echo "CSR SANs '$got' != manifest '$want'"; return 1; }
  grep -A1 'Extended Key Usage' <<<"$text" | grep -qx ' *TLS Web Server Authentication' || { echo "CSR extended key usage is not exactly serverAuth"; return 1; }
  grep -A1 'Key Usage: critical' <<<"$text" | grep -qx ' *Digital Signature' || { echo "CSR key usage is not exactly digitalSignature"; return 1; }
  grep -A1 'Basic Constraints: critical' <<<"$text" | grep -qx ' *CA:FALSE' || { echo "CSR basic constraints are not CA:FALSE"; return 1; }
  spk="$(spki_of_key "$k")" && spc="$(spki_of_csr "$c")" && spm="$(jq -er .spki_sha256 "$m")" || { echo "public keys unreadable"; return 1; }
  [ "$spk" = "$spc" ] && [ "$spc" = "$spm" ] || { echo "key, CSR and manifest public keys differ"; return 1; }
  echo "$got"
}

if [ "${1:-}" = --check ]; then
  d="${2:?usage: new-server-csr.sh --check <existing-request-dir>}"
  san="$(validate_request "$d/server" "$d/to-windows")" || die "request in $d is NOT valid: $san"
  echo "request in $d is valid: SANs $san; CSR SHA-256 $(jq -r .csr_file_sha256 "$d/to-windows/request-manifest.json"); public key SHA-256 $(jq -r .spki_sha256 "$d/to-windows/request-manifest.json")"
  exit 0
fi

dir="${1:?usage: new-server-csr.sh <new-private-dir> <ipv4> [<dns-name>]}"; ip="${2:?ipv4 required}"; dns="${3:-}"
[[ "$ip" =~ $ipre ]] || die "not a canonical IPv4 address: $ip"
[ -z "$dns" ] || [[ "$dns" =~ $dnsre ]] || die "not a plain lower-case DNS name: $dns"
[ -e "$dir" ] || [ -L "$dir" ] && die "$dir exists; refusing to overwrite anything"
mkdir -m 0700 -p "$dir" && mkdir -m 0700 "$dir/server" "$dir/from-windows" "$dir/to-windows.incomplete" || die "cannot create $dir"
incomplete="$dir/to-windows.incomplete"
san="IP:$ip"; [ -n "$dns" ] && san="$san,DNS:$dns"
( cd "$dir/server" && set -o noclobber && openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout server.key -out server.csr -subj "/CN=$ip" -addext "subjectAltName=$san" -addext "extendedKeyUsage=serverAuth" \
    -addext "keyUsage=critical,digitalSignature" -addext "basicConstraints=critical,CA:FALSE" ) > "$dir/server/openssl.log" 2>&1
[ -s "$dir/server/server.key" ] && [ -s "$dir/server/server.csr" ] || die "key or CSR missing (see $dir/server/openssl.log)"
chmod 0400 "$dir/server/server.key" || die "cannot set server.key to 0400"
chmod 0444 "$dir/server/server.csr" || die "cannot set server.csr mode"
cp "$dir/server/server.csr" "$incomplete/server.csr" || die "cannot copy the CSR to the public directory"
chmod 0444 "$incomplete/server.csr" || die "cannot set the public CSR mode"
spki="$(spki_of_csr "$dir/server/server.csr")" || die "cannot read the CSR public key"
csrsha="$(sha256sum "$incomplete/server.csr")" || die "cannot hash the public CSR"; csrsha="${csrsha:0:64}"
sans_json="$(jq -cn --arg ip "$ip" '[{type:"ip", value:$ip}]')" || die "jq failed (SAN list)"
dns_json='[]'; if [ -n "$dns" ]; then dns_json="$(jq -cn --arg d "$dns" '[$d]')" || die "jq failed (DNS list)"; fi
now="$(date -u +%FT%TZ)" || die "date failed"
jq -n --arg ip "$ip" --argjson sans "$sans_json" --argjson dns "$dns_json" --arg csr "$csrsha" --arg spki "$spki" --arg now "$now" \
  '{schema:"seyra.lan-csr-request/1", created_at:$now, purpose:"Seyra map services LAN HTTPS server (single VM)", subject_cn:$ip, sans:$sans, dns_names:$dns,
    key:{algorithm:"EC", curve:"P-256"}, spki_sha256:$spki, csr_file:"server.csr", csr_file_sha256:$csr,
    requested:{basic_constraints:"critical, CA:FALSE", key_usage:"critical, digitalSignature", extended_key_usage:["serverAuth"]},
    issue_with:{issuer:"Seyra LAN Issuing CA (intermediate)", lifetime:"90 days", not_before_skew:"-5m", eku:["serverAuth"], key_usage:["digitalSignature"]},
    note:"The server private key never leaves the VM. Only this CSR and manifest are public."}' > "$incomplete/request-manifest.json" \
  || die "jq failed while writing the request manifest"
chmod 0444 "$incomplete/request-manifest.json" || die "cannot set the manifest mode"
got="$(validate_request "$dir/server" "$incomplete")" || die "the generated request does not validate: $got"
mv -T "$incomplete" "$dir/to-windows" || die "cannot publish $incomplete as $dir/to-windows"
incomplete=""
got="$(validate_request "$dir/server" "$dir/to-windows")" || die "the published request does not validate: $got"
echo "server key: $dir/server/server.key (0400, stays on this VM)"
echo "READY public transfer: $dir/to-windows/{server.csr,request-manifest.json}"
echo "CSR SHA-256 $csrsha; public key SHA-256 $spki; SANs: $got"
