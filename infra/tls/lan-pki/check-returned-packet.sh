#!/usr/bin/env bash
# Check the PUBLIC packet returned from the Windows issuer before any cutover use (read-only):
#
#   infra/tls/lan-pki/check-returned-packet.sh <packet-dir> <request-dir> <server.key> <ops-image-ref> <ops-image-id>
#
# <packet-dir>   server.crt, intermediate_ca.crt, root_ca.crt, root_ca.cer, issued-manifest.json (only)
# <request-dir>  the VM's to-windows directory (server.csr, request-manifest.json)
# <server.key>   the VM-local server key (read here and by the read-only validation container only)
# <ops-image-*>  the OPS image of the bundle that will import it (checked by id); its own import
#                validation (validateProposedCertificate) runs in a --network none container
#
# Checks: only the expected public files, no private key; manifest checksums; leaf public key equals
# the CSR and the VM key; SAN exactly the requested set; CA false, digitalSignature, serverAuth only;
# leaf <= 90 days (+15 min skew) and within the issuing CA's validity; issuing CA path length 0 and
# root path length 1, both CAs EC P-256; chain verifies (purpose sslserver) for every requested
# name; root DER == root PEM and its SHA-256 equals the manifest. Exits non-zero on any failure.
set -uo pipefail
pk="${1:?packet dir}"; rq="${2:?request dir}"; key="${3:?server key}"; ops="${4:?ops image ref}"; opsid="${5:?ops image id}"
fails=0
ok() { echo "PASS $*"; }
bad() { echo "FAIL $*"; fails=$((fails + 1)); }
chk() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
x() { openssl x509 -in "$pk/$1" -noout "${@:2}" 2>/dev/null; }
m="$pk/issued-manifest.json"; rqm="$rq/request-manifest.json"

files="$(cd "$pk" 2>/dev/null && find . -mindepth 1 -printf '%y %P\n' | sort | paste -sd'|')"
[ "$files" = "f intermediate_ca.crt|f issued-manifest.json|f root_ca.cer|f root_ca.crt|f server.crt" ] && ok "packet holds exactly the five public files" || bad "packet contents: $files"
grep -lE 'PRIVATE KEY' "$pk"/* >/dev/null 2>&1 && bad "a packet file contains a private key" || ok "no private key in the packet"
for f in server.crt intermediate_ca.crt root_ca.crt root_ca.cer; do
  [ "$(sha256sum "$pk/$f" | cut -c1-64)" = "$(jq -r --arg f "$f" '.files_sha256[$f]' "$m")" ] && ok "$f checksum equals the manifest" || bad "$f checksum differs from the manifest"
done
ip="$(jq -r '.sans | if length == 1 and .[0].type == "ip" then .[0].value else "" end' "$rqm")"; dns="$(jq -r '.dns_names | join(",")' "$rqm")"
[ -n "$ip" ] && ok "request: IP SAN $ip${dns:+, DNS $dns}" || bad "request manifest does not name exactly one IP SAN"
[ "$(jq -r '.request.csr_file_sha256' "$m")" = "$(sha256sum "$rq/server.csr" | cut -c1-64)" ] && ok "packet is bound to this CSR (file SHA-256)" || bad "packet names another CSR"
s_leaf="$(openssl x509 -in "$pk/server.crt" -noout -pubkey | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -c1-64)"
s_csr="$(openssl req -in "$rq/server.csr" -noout -pubkey | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -c1-64)"
s_key="$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-64)"
[ "$s_leaf" = "$s_csr" ] && [ "$s_csr" = "$s_key" ] && [ "$s_key" = "$(jq -r '.spki_sha256' "$rqm")" ] && ok "leaf public key == CSR == VM server key == request manifest" || bad "public keys differ (leaf $s_leaf, csr $s_csr, key $s_key)"
want="IP Address:$ip"; [ -n "$dns" ] && want="$want, DNS:$dns"
got="$(x server.crt -ext subjectAltName | sed -n '2{s/^ *//;p}')"
[ "$got" = "$want" ] || [ -n "$dns" -a "$got" = "DNS:$dns, IP Address:$ip" ] && ok "leaf SAN exactly '$got'" || bad "leaf SAN '$got' != '$want'"
[ "$(x server.crt -ext basicConstraints | sed -n '2{s/^ *//;p}')" = "CA:FALSE" ] && ok "leaf CA:FALSE" || bad "leaf basic constraints"
[ "$(x server.crt -ext keyUsage | sed -n '2{s/^ *//;p}')" = "Digital Signature" ] && ok "leaf key usage exactly digitalSignature" || bad "leaf key usage"
[ "$(x server.crt -ext extendedKeyUsage | sed -n '2{s/^ *//;p}')" = "TLS Web Server Authentication" ] && ok "leaf extended key usage exactly serverAuth" || bad "leaf extended key usage"
ep() { date -d "$(x "$1" -"$2" | cut -d= -f2)" +%s; }
life=$(( $(ep server.crt enddate) - $(ep server.crt startdate) ))
[ "$life" -gt $((89 * 86400)) ] && [ "$life" -le $((90 * 86400 + 900)) ] && ok "leaf lifetime $((life / 3600)) h (90 days + skew)" || bad "leaf lifetime $life s"
[ "$(ep server.crt enddate)" -le "$(ep intermediate_ca.crt enddate)" ] && [ "$(ep intermediate_ca.crt enddate)" -le "$(ep root_ca.crt enddate)" ] && ok "leaf within issuing CA within root validity" || bad "a certificate outlives its issuer"
[ "$(date +%s)" -ge "$(ep server.crt startdate)" ] && [ "$(date +%s)" -lt "$(ep server.crt enddate)" ] && ok "leaf currently valid" || bad "leaf not currently valid"
[ "$(x intermediate_ca.crt -ext basicConstraints | sed -n '2{s/^ *//;p}')" = "CA:TRUE, pathlen:0" ] && ok "issuing CA: CA, path length 0" || bad "issuing CA basic constraints"
[ "$(x root_ca.crt -ext basicConstraints | sed -n '2{s/^ *//;p}')" = "CA:TRUE, pathlen:1" ] && ok "root: CA, path length 1" || bad "root basic constraints"
for f in intermediate_ca.crt root_ca.crt; do x "$f" -text | grep -q 'NIST CURVE: P-256' && ok "$f EC P-256" || bad "$f key type"; done
for n in $ip $(tr ',' ' ' <<<"$dns"); do
  flag=-verify_ip; [ "$n" = "$ip" ] || flag=-verify_hostname
  chk "chain verifies for $n (purpose sslserver)" openssl verify -CAfile "$pk/root_ca.crt" -untrusted "$pk/intermediate_ca.crt" -purpose sslserver $flag "$n" "$pk/server.crt"
done
[ "$(openssl x509 -in "$pk/root_ca.crt" -outform DER | sha256sum | cut -c1-64)" = "$(sha256sum "$pk/root_ca.cer" | cut -c1-64)" ] && ok "root_ca.cer is the DER of root_ca.crt" || bad "root_ca.cer differs from root_ca.crt"
[ "$(sha256sum "$pk/root_ca.cer" | cut -c1-64)" = "$(jq -r '.root_ca.sha256_fingerprint' "$m")" ] && ok "root fingerprint equals the manifest ($(jq -r '.root_ca.sha256_fingerprint' "$m"))" || bad "root fingerprint differs from the manifest"
# The importing bundle's own validation (read-only container, no network; the key stays on this VM).
if [ "$(docker image inspect -f '{{.Id}}' "$ops" 2>/dev/null)" != "$opsid" ]; then bad "OPS image $ops is not $opsid"
else
  names="$(jq -cn --arg ip "$ip" --arg dns "$dns" '[$ip] + ($dns | split(",") | map(select(. != "")))')"
  out="$(docker run --rm --network none --read-only -v "$(cd "$pk" && pwd):/p:ro" -v "$(readlink -f "$key"):/k/server.key:ro" --entrypoint node "$ops" --input-type=module -e "
const t = await import('/opt/seyra/apps/ops/dist/tls.js');
const r = await t.validateProposedCertificate({ cert: '/p/server.crt', chain: '/p/intermediate_ca.crt', ca: '/p/root_ca.crt', key: '/k/server.key', names: $names });
console.log('OK', r.san.join(' '), r.days_total, r.sha256_fingerprint);" 2>&1)"
  grep -q '^OK ' <<<"$out" && ok "the bundle's tls import validation accepts it ($out)" || bad "tls import validation: $out"
fi
echo "# returned packet: failures=$fails"
exit $(( fails > 0 ? 1 : 0 ))
