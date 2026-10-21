#!/usr/bin/env bash
# Check the PUBLIC packet returned from the Windows issuer before any cutover use (read-only):
#
#   infra/tls/lan-pki/check-returned-packet.sh <packet-dir> <request-dir> <server.key> <ops-image-ref> <ops-image-id>
#
# <packet-dir>   server.crt, intermediate_ca.crt, root_ca.crt, root_ca.cer, issued-manifest.json (only)
# <request-dir>  the VM's to-windows directory (server.csr, request-manifest.json are read from it)
# <server.key>   the VM-local server key (read here and by the read-only validation container only)
# <ops-image-*>  the OPS image of the bundle that will import it (checked by id); its own import
#                validation (validateProposedCertificate) runs in a --network none container
#
# Fail-closed order:
#   1. structure: the packet and request roots are real directories (no symlink); the packet holds
#      exactly the five names as regular files (no symlink, FIFO, device, extra or nested entry); the
#      request files and the key are regular files. Any defect or inspection error ABORTS here,
#      before any payload is read (nothing can block on a FIFO or follow a link).
#   2. content: private-key scan, checksums, CSR/key/leaf binding, SANs, purposes, lifetimes, CA
#      constraints, chain for every requested name, root DER/PEM/fingerprint. A tool or read error
#      aborts (it is never taken as "absent" or "valid empty output"); mismatches are counted.
#   3. product validation, ONLY if 1-2 passed: the image id must inspect successfully and match, and
#      the validator container must exit 0 AND print exactly the expected OK line (requested SANs,
#      <= 90 days, the leaf's fingerprint). Bounded by timeouts.
# Exits non-zero on any failure. The root fingerprint printed at the end is compared by the operator
# with the one the issuer noted independently (chat), not taken from this packet alone.
set -uo pipefail
pk="${1:?packet dir}"; rq="${2:?request dir}"; key="${3:?server key}"; ops="${4:?ops image ref}"; opsid="${5:?ops image id}"
fails=0
ok() { echo "PASS $*"; }
bad() { echo "FAIL $*"; fails=$((fails + 1)); }
# abort writes to stderr so that it is never captured as a value: the helpers below run inside $(...),
# where exit only leaves the subshell, so every helper result is assigned with `|| exit 1`.
abort() { { echo "FAIL $*"; echo "# returned packet: ABORTED (nothing further was read or run)"; } >&2; exit 1; }
# must <what> cmd...: stdout of a command that has to succeed; any failure aborts.
must() { local what="$1" out; shift; out="$("$@" 2>/dev/null)" || abort "cannot $what (exit $?)"; printf '%s' "$out"; }
for t in find stat sha256sum openssl jq date grep sed timeout readlink docker; do command -v "$t" >/dev/null 2>&1 || abort "required tool '$t' is not available"; done
typ() { find "$1" -maxdepth 0 -printf '%y' 2>/dev/null; }   # type without following links: d f l p ...

# ---- 1. structure (no payload read) --------------------------------------------------------------
[ "$(typ "$pk")" = d ] || abort "packet root $pk is not a real directory (type '$(typ "$pk")')"
[ "$(typ "$rq")" = d ] || abort "request root $rq is not a real directory (type '$(typ "$rq")')"
entries="$(find "$pk" -mindepth 1 -printf '%y %P\n' 2>/dev/null)" || abort "cannot list $pk"
entries="$(sort <<<"$entries" | paste -sd'|')"
[ "$entries" = "f intermediate_ca.crt|f issued-manifest.json|f root_ca.cer|f root_ca.crt|f server.crt" ] || abort "packet must hold exactly five regular files; found: $entries"
for f in "$rq/server.csr" "$rq/request-manifest.json" "$key"; do [ "$(typ "$f")" = f ] || abort "$f is not a regular file (type '$(typ "$f")')"; done
ok "structure: five regular public files; request files and key are regular files"

# ---- 2. content ------------------------------------------------------------------------------------
m="$pk/issued-manifest.json"; rqm="$rq/request-manifest.json"
grep -l -E -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$pk/server.crt" "$pk/intermediate_ca.crt" "$pk/root_ca.crt" "$pk/root_ca.cer" "$m" >/dev/null 2>&1; g=$?
case $g in 0) abort "a packet file contains a private key";; 1) ok "no private key in the packet";; *) abort "private-key scan failed (grep exit $g)";; esac
must "parse the issued manifest" jq -e '(.schema == "seyra.lan-issued/1") and (.files_sha256 | type) == "object" and (.request.csr_file_sha256 | type) == "string" and (.root_ca.sha256_fingerprint | type) == "string"' "$m" >/dev/null
must "parse the request manifest" jq -e '(.schema == "seyra.lan-csr-request/1") and (.sans | length) == 1 and .sans[0].type == "ip" and (.dns_names | type) == "array"' "$rqm" >/dev/null
sha() { local o; o="$(sha256sum "$1" 2>/dev/null)" || abort "cannot hash $1"; printf '%s' "${o:0:64}"; }
for f in server.crt intermediate_ca.crt root_ca.crt root_ca.cer; do
  want="$(must "read the manifest checksum of $f" jq -er --arg f "$f" '.files_sha256[$f]' "$m")" || exit 1; got="$(sha "$pk/$f")" || exit 1
  [ "$got" = "$want" ] && ok "$f checksum equals the manifest" || bad "$f checksum differs from the manifest"
done
ip="$(must "read the requested IP" jq -er '.sans[0].value' "$rqm")" || exit 1; dns="$(must "read the requested DNS names" jq -er '.dns_names | join(",")' "$rqm")" || exit 1
ok "request: IP SAN $ip${dns:+, DNS $dns}"
want="$(must "read the CSR binding" jq -er '.request.csr_file_sha256' "$m")" || exit 1; got="$(sha "$rq/server.csr")" || exit 1
[ "$want" = "$got" ] && ok "packet is bound to this CSR (file SHA-256)" || bad "packet names another CSR"
spki() { local p o; p="$(openssl "$@" 2>/dev/null)" || abort "cannot read a public key ($*)"; o="$(openssl pkey -pubin -outform DER <<<"$p" 2>/dev/null | sha256sum)" || abort "cannot hash a public key"; printf '%s' "${o:0:64}"; }
s_leaf="$(spki x509 -in "$pk/server.crt" -noout -pubkey)" || exit 1; s_csr="$(spki req -in "$rq/server.csr" -noout -pubkey)" || exit 1
s_key="$(spki pkey -in "$key" -pubout)" || exit 1; s_man="$(must "read the request public key" jq -er '.spki_sha256' "$rqm")" || exit 1
[ "$s_leaf" = "$s_csr" ] && [ "$s_csr" = "$s_key" ] && [ "$s_key" = "$s_man" ] && ok "leaf public key == CSR == VM server key == request manifest" || bad "public keys differ (leaf $s_leaf, csr $s_csr, key $s_key)"
ext() { local o; o="$(openssl x509 -in "$pk/$1" -noout -ext "$2" 2>/dev/null)" || abort "cannot read $2 of $1"; sed -n '2{s/^ *//;p}' <<<"$o"; }
want="IP Address:$ip"; [ -n "$dns" ] && want="$want, DNS:$dns"
got="$(ext server.crt subjectAltName)" || exit 1
{ [ "$got" = "$want" ] || { [ -n "$dns" ] && [ "$got" = "DNS:$dns, IP Address:$ip" ]; }; } && ok "leaf SAN exactly '$got'" || bad "leaf SAN '$got' != '$want'"
got="$(ext server.crt basicConstraints)" || exit 1; [ "$got" = "CA:FALSE" ] && ok "leaf CA:FALSE" || bad "leaf basic constraints"
got="$(ext server.crt keyUsage)" || exit 1; [ "$got" = "Digital Signature" ] && ok "leaf key usage exactly digitalSignature" || bad "leaf key usage"
got="$(ext server.crt extendedKeyUsage)" || exit 1; [ "$got" = "TLS Web Server Authentication" ] && ok "leaf extended key usage exactly serverAuth" || bad "leaf extended key usage"
ep() { local d; d="$(openssl x509 -in "$pk/$1" -noout -"$2" 2>/dev/null)" || abort "cannot read $2 of $1"; date -d "${d#*=}" +%s 2>/dev/null || abort "cannot parse $2 of $1"; }
ls_=$(ep server.crt startdate) || exit 1; le=$(ep server.crt enddate) || exit 1; ie=$(ep intermediate_ca.crt enddate) || exit 1; re=$(ep root_ca.crt enddate) || exit 1; now=$(date +%s)
life=$(( le - ls_ ))
[ "$life" -gt $((89 * 86400)) ] && [ "$life" -le $((90 * 86400 + 900)) ] && ok "leaf lifetime $((life / 3600)) h (90 days + skew)" || bad "leaf lifetime $life s"
[ "$le" -le "$ie" ] && [ "$ie" -le "$re" ] && ok "leaf within issuing CA within root validity" || bad "a certificate outlives its issuer"
[ "$now" -ge "$ls_" ] && [ "$now" -lt "$le" ] && ok "leaf currently valid" || bad "leaf not currently valid"
got="$(ext intermediate_ca.crt basicConstraints)" || exit 1; [ "$got" = "CA:TRUE, pathlen:0" ] && ok "issuing CA: CA, path length 0" || bad "issuing CA basic constraints"
got="$(ext root_ca.crt basicConstraints)" || exit 1; [ "$got" = "CA:TRUE, pathlen:1" ] && ok "root: CA, path length 1" || bad "root basic constraints"
for f in intermediate_ca.crt root_ca.crt; do t="$(openssl x509 -in "$pk/$f" -noout -text 2>/dev/null)" || abort "cannot read $f"; grep -q 'NIST CURVE: P-256' <<<"$t" && ok "$f EC P-256" || bad "$f key type"; done
for n in $ip $(tr ',' ' ' <<<"$dns"); do
  flag=-verify_ip; [ "$n" = "$ip" ] || flag=-verify_hostname
  if openssl verify -CAfile "$pk/root_ca.crt" -untrusted "$pk/intermediate_ca.crt" -purpose sslserver $flag "$n" "$pk/server.crt" >/dev/null 2>&1; then ok "chain verifies for $n (purpose sslserver)"; else bad "chain does not verify for $n"; fi
done
der="$(openssl x509 -in "$pk/root_ca.crt" -outform DER 2>/dev/null | sha256sum)" || abort "cannot convert root_ca.crt"
rootfp="$(sha "$pk/root_ca.cer")" || exit 1
[ "${der:0:64}" = "$rootfp" ] && ok "root_ca.cer is the DER of root_ca.crt" || bad "root_ca.cer differs from root_ca.crt"
want="$(must "read the root fingerprint" jq -er '.root_ca.sha256_fingerprint' "$m")" || exit 1
[ "$rootfp" = "$want" ] && ok "root fingerprint equals the manifest" || bad "root fingerprint differs from the manifest"

# ---- 3. product validation (only on an otherwise valid packet) -------------------------------------
if [ "$fails" -gt 0 ]; then echo "# returned packet: failures=$fails (product validation not run)"; exit 1; fi
id="$(timeout 60 docker image inspect -f '{{.Id}}' "$ops" 2>/dev/null)"; rc=$?
[ $rc -eq 0 ] || abort "cannot inspect OPS image $ops (exit $rc)"
[ "$id" = "$opsid" ] || abort "OPS image $ops is $id, not $opsid"
names="$(jq -cn --arg ip "$ip" --arg dns "$dns" '[$ip] + ($dns | split(",") | map(select(. != "")))')" || abort "cannot build the name list"
leaffp="$(openssl x509 -in "$pk/server.crt" -noout -fingerprint -sha256 2>/dev/null)" || abort "cannot fingerprint the leaf"; leaffp="${leaffp#*=}"
wantsan="IP:$ip"; [ -n "$dns" ] && wantsan="$wantsan DNS:$dns"
out="$(timeout 300 docker run --rm --network none --read-only -v "$(cd "$pk" && pwd):/p:ro" -v "$(readlink -f "$key"):/k/server.key:ro" --entrypoint node "$ops" --input-type=module -e "
const t = await import('/opt/seyra/apps/ops/dist/tls.js');
const r = await t.validateProposedCertificate({ cert: '/p/server.crt', chain: '/p/intermediate_ca.crt', ca: '/p/root_ca.crt', key: '/k/server.key', names: $names });
console.log('OK', r.san.join(' '), r.days_total, r.sha256_fingerprint);" 2>&1)"; rc=$?
[ $rc -eq 0 ] || abort "the bundle's tls import validation exited $rc: $(head -c 300 <<<"$out")"
lines="$(grep -c . <<<"$out")"
[[ "$lines" = 1 && "$out" =~ ^OK\ (.+)\ ([0-9]+)\ ([0-9A-F:]{95})$ ]] || abort "unexpected validation output: $(head -c 300 <<<"$out")"
[ "${BASH_REMATCH[1]}" = "$wantsan" ] && [ "${BASH_REMATCH[2]}" -le 90 ] && [ "${BASH_REMATCH[3]}" = "$leaffp" ] || abort "validation output does not match this packet: $out"
ok "the bundle's tls import validation accepts it ($out)"
echo "root SHA-256 fingerprint (compare with the issuer's independent note): $rootfp"
echo "# returned packet: failures=0"
