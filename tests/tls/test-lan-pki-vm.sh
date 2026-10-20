#!/usr/bin/env bash
# Regression for the VM side of the LAN PKI handoff (infra/tls/lan-pki):
#   new-server-csr.sh   creates a 0400 EC P-256 key, an exact-SAN serverAuth CSR and the public
#                       request manifest; refuses an existing directory and non-canonical inputs.
#   check-returned-packet.sh accepts a correct returned packet (including the importing bundle's own
#                       tls import validation, read-only) and rejects every damaged variant.
# The issuer side is emulated with the pinned Linux step build and test-only keys in a temp dir.
#
#   STEP_LINUX=/abs/step DOCKER_RUN_IMAGE=docker:29.8.2-dind OPS_IMAGE=seyra/ops:1.0.0-seyra1 OPS_IMAGE_ID=sha256:... \
#     tests/tls/test-lan-pki-vm.sh
set -uo pipefail
: "${STEP_LINUX:?}" "${DOCKER_RUN_IMAGE:?}" "${OPS_IMAGE:?}" "${OPS_IMAGE_ID:?}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
w="$(mktemp -d)"; trap 'chmod -R u+w "$w" 2>/dev/null; rm -rf "$w"' EXIT
fails=0; n=0
t() { local name="$1" want="$2"; shift 2; n=$((n + 1)); "$@" > "$w/out.$n" 2>&1; local rc=$?
  if { [ "$want" = ok ] && [ $rc -eq 0 ]; } || { [ "$want" = fail ] && [ $rc -ne 0 ]; }; then
    local why=""; [ "$want" = fail ] && why=" [$(grep -m1 -E '^FAIL|new-server-csr' "$w/out.$n" | cut -c1-110)]"; echo "PASS $name$why"; else fails=$((fails + 1)); echo "FAIL $name (rc=$rc) -- $(grep -m3 -E 'FAIL|new-server-csr' "$w/out.$n" | tr '\n' ' ')"; fi; }
CSR="$repo/infra/tls/lan-pki/new-server-csr.sh"; CHK="$repo/infra/tls/lan-pki/check-returned-packet.sh"

# --- new-server-csr.sh
t "CSR: created for a documentation IP" ok bash "$CSR" "$w/req" 198.18.0.76
t "CSR: key is 0400, dirs 0700" ok bash -c "[ \$(stat -c %a '$w/req/server/server.key') = 400 ] && [ \$(stat -c %a '$w/req') = 700 ] && [ \$(stat -c %a '$w/req/server') = 700 ]"
t "CSR: manifest binds the CSR file and key" ok bash -c "[ \$(jq -r .csr_file_sha256 '$w/req/to-windows/request-manifest.json') = \$(sha256sum '$w/req/to-windows/server.csr' | cut -c1-64) ] && [ \$(jq -r .spki_sha256 '$w/req/to-windows/request-manifest.json') = \$(openssl pkey -in '$w/req/server/server.key' -pubout -outform DER | sha256sum | cut -c1-64) ]"
t "CSR: to-windows holds no private key" ok bash -c "! grep -rl 'PRIVATE KEY' '$w/req/to-windows'"
t "CSR: existing directory refused" fail bash "$CSR" "$w/req" 198.18.0.76
t "CSR: non-canonical IP refused" fail bash "$CSR" "$w/req2" 198.18.000.76
t "CSR: invented-looking DNS name syntax refused" fail bash "$CSR" "$w/req3" 198.18.0.76 'Bad_Name'
t "CSR: with an existing DNS name, both SANs exact" ok bash -c "bash '$CSR' '$w/req4' 198.18.0.76 map.example.test >/dev/null && openssl req -in '$w/req4/server/server.csr' -noout -text | grep -q 'IP Address:198.18.0.76, DNS:map.example.test'"

# --- issuer emulation (test-only keys/passwords)
mkdir -p "$w/pki" "$w/bin"; cp "$STEP_LINUX" "$w/bin/step"; chmod 0755 "$w/bin/step"
cp "$repo/infra/tls/lan-pki/windows/server-leaf.tpl" "$w/req/to-windows/server.csr" "$w/pki/"
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$w/pki/other.key" -out "$w/pki/other.csr" -subj /CN=198.18.0.76 -addext subjectAltName=IP:198.18.0.76 2>/dev/null
cat > "$w/pki/build.sh" <<'EOF'
set -eu; S=/w/bin/step; cd /w/pki; printf 'r\n' > pw.r; printf 'i\n' > pw.i
$S certificate create "Seyra LAN Root CA" root_ca.crt root_ca.key --profile root-ca --kty EC --curve P-256 --not-after 43800h --password-file pw.r
$S certificate create "Seyra LAN Issuing CA 2026" intermediate_ca.crt intermediate_ca.key --profile intermediate-ca --ca root_ca.crt --ca-key root_ca.key --ca-password-file pw.r --kty EC --curve P-256 --not-after 8760h --password-file pw.i
$S certificate create "Other Root" other_root.crt other_root.key --profile root-ca --kty EC --curve P-256 --not-after 43800h --no-password --insecure
sign() { $S certificate sign "$1" intermediate_ca.crt intermediate_ca.key --template server-leaf.tpl --set ip="$2" --not-before -5m --not-after "$3" --password-file pw.i > "$4"; }
sign server.csr 198.18.0.76 2160h good.crt
sign server.csr 198.18.0.99 2160h wrongip.crt
sign server.csr 198.18.0.76 3000h long.crt
sign other.csr 198.18.0.76 2160h otherkey.crt
$S certificate sign server.csr intermediate_ca.crt intermediate_ca.key --not-after 2160h --password-file pw.i > clientauth.crt
$S certificate format root_ca.crt --out root_ca.cer
EOF
docker run --rm --network none -u "$(id -u):$(id -g)" -v "$w:/w" --entrypoint sh "$DOCKER_RUN_IMAGE" /w/pki/build.sh >/dev/null 2>&1 || { echo "FAIL building the test PKI"; exit 1; }
packet() { # name leaf-file [mutator]
  local d="$w/packet-$1"; mkdir -p "$d"
  cp "$w/pki/$2" "$d/server.crt"; cp "$w/pki/intermediate_ca.crt" "$w/pki/root_ca.crt" "$w/pki/root_ca.cer" "$d/"
  jq -n --arg csr "$(sha256sum "$w/req/to-windows/server.csr" | cut -c1-64)" --arg root "$(sha256sum "$d/root_ca.cer" | cut -c1-64)" \
    --arg a "$(sha256sum "$d/server.crt" | cut -c1-64)" --arg b "$(sha256sum "$d/intermediate_ca.crt" | cut -c1-64)" --arg c "$(sha256sum "$d/root_ca.crt" | cut -c1-64)" --arg e "$(sha256sum "$d/root_ca.cer" | cut -c1-64)" \
    '{schema:"seyra.lan-issued/1", request:{csr_file_sha256:$csr}, root_ca:{sha256_fingerprint:$root}, files_sha256:{"server.crt":$a,"intermediate_ca.crt":$b,"root_ca.crt":$c,"root_ca.cer":$e}}' > "$d/issued-manifest.json"
  [ -n "${3:-}" ] && (cd "$d" && eval "$3")
  echo "$d"; }
run() { bash "$CHK" "$1" "$w/req/to-windows" "$w/req/server/server.key" "$OPS_IMAGE" "$OPS_IMAGE_ID"; }
t "packet: correct packet accepted (incl. bundle tls import validation)" ok run "$(packet good good.crt)"
t "packet: clientAuth leaf rejected" fail run "$(packet clientauth clientauth.crt)"
t "packet: leaf for another IP rejected" fail run "$(packet wrongip wrongip.crt)"
t "packet: leaf longer than 90 days rejected" fail run "$(packet long long.crt)"
t "packet: leaf for another key rejected" fail run "$(packet otherkey otherkey.crt)"
t "packet: extra file rejected" fail run "$(packet extra good.crt 'cp root_ca.crt extra.pem')"
t "packet: private key in the packet rejected" fail run "$(packet withkey good.crt 'cp ../pki/other.key server.key')"
t "packet: missing intermediate rejected" fail run "$(packet noint good.crt 'rm intermediate_ca.crt')"
t "packet: wrong root (chain does not verify) rejected" fail run "$(packet wrongroot good.crt 'cp ../pki/other_root.crt root_ca.crt; jq --arg c $(sha256sum ../pki/other_root.crt | cut -c1-64) ".files_sha256[\"root_ca.crt\"]=\$c" issued-manifest.json > m && mv m issued-manifest.json')"
t "packet: checksum differing from its manifest rejected" fail run "$(packet badsum good.crt 'jq ".files_sha256[\"server.crt\"]=\"00\"" issued-manifest.json > m && mv m issued-manifest.json')"
t "packet: bound to another CSR rejected" fail run "$(packet othercsr good.crt 'jq ".request.csr_file_sha256=\"00\"" issued-manifest.json > m && mv m issued-manifest.json')"
t "packet: wrong OPS image id rejected" fail bash "$CHK" "$w/packet-good" "$w/req/to-windows" "$w/req/server/server.key" "$OPS_IMAGE" sha256:0000
echo "# lan-pki vm side: checks=$n failed=$fails"
exit $(( fails > 0 ? 1 : 0 ))
