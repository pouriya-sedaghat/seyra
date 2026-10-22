#!/usr/bin/env bash
# Regression for the VM side of the LAN PKI handoff (infra/tls/lan-pki):
#   new-server-csr.sh   creates a 0400 EC P-256 key, an exact-SAN serverAuth CSR and the public
#                       request manifest; refuses an existing directory and non-canonical inputs; a
#                       missing/failing tool or bad output is non-zero and never publishes to-windows
#                       (review f5bd978 R4); --check validates an existing request without changes.
#   check-returned-packet.sh accepts a correct returned packet (including the importing bundle's own
#                       tls import validation, read-only) and rejects every damaged variant; structural
#                       defects (FIFO, symlink, nested, unreadable) abort promptly before any payload
#                       read or product validation, and the validator must exit 0 with the exact OK
#                       line (review f5bd978 R3; a recording docker stand-in proves what was reached).
# Fixtures are checked (review f4bd578 N2): a failed mutator is a SETUP FAILURE (the run fails); a special
# file the platform cannot create (FIFO, socket, device, symlink, unreadable as root) or of the wrong type
# makes its assertions NOT RUN, never PASS. With OPENSSL_ALT_IMAGE (an image with bash, jq and another
# OpenSSL, e.g. 3.0) the CSR script and the checker also run under that OpenSSL (review f4bd578 N1).
# The issuer side is emulated with the pinned Linux step build and test-only keys in a temp dir.
#
#   STEP_LINUX=/abs/step DOCKER_RUN_IMAGE=docker:29.8.2-dind OPS_IMAGE=seyra/ops:1.0.0-seyra1 OPS_IMAGE_ID=sha256:... \
#     [OPENSSL_ALT_IMAGE=seyra-test-runner:local] tests/tls/test-lan-pki-vm.sh
set -uo pipefail
: "${STEP_LINUX:?}" "${DOCKER_RUN_IMAGE:?}" "${OPS_IMAGE:?}" "${OPS_IMAGE_ID:?}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
w="$(mktemp -d)"; trap 'chmod -R u+w "$w" 2>/dev/null; rm -rf "$w"' EXIT
fails=0; n=0; notrun=0
: > "$w/setup.log"
nr() { notrun=$((notrun + $3)); echo "NOT RUN $1 -- $2"; }   # label why assertions
t() { local name="$1" want="$2"; shift 2; n=$((n + 1)); "$@" > "$w/out.$n" 2>&1; local rc=$?
  if { [ "$want" = ok ] && [ $rc -eq 0 ]; } || { [ "$want" = fail ] && [ $rc -ne 0 ]; }; then
    local why=""; { [ "$want" = fail ] || grep -q '^ABORT-CHECK' "$w/out.$n"; } && why=" [$(grep -m1 -E '^ABORT-CHECK|^FAIL|new-server-csr' "$w/out.$n" | cut -c1-110)]"; echo "PASS $name$why"; else fails=$((fails + 1)); echo "FAIL $name (rc=$rc) -- $(grep -m3 -E 'ABORT-CHECK|FAIL|new-server-csr' "$w/out.$n" | tr '\n' ' ')"; fi; }
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
t "CSR: --check accepts the generated request" ok bash "$CSR" --check "$w/req"
mkdir -p "$w/tampered" && cp -a "$w/req/." "$w/tampered/" && chmod u+w "$w/tampered/to-windows" "$w/tampered/to-windows/request-manifest.json" \
  && jq '.spki_sha256 = "0000000000000000000000000000000000000000000000000000000000000000"' "$w/req/to-windows/request-manifest.json" > "$w/tampered/to-windows/request-manifest.json"
t "CSR: --check rejects a manifest bound to another key" fail bash "$CSR" --check "$w/tampered"
# Review f5bd978 R4: failures must be non-zero and must not publish to-windows.
mkdir -p "$w/nojq" "$w/badjq" "$w/emptyjq" "$w/badcp"
for b in openssl sha256sum stat cp chmod mkdir mv cmp sed grep date bash dirname; do ln -s "$(command -v "$b")" "$w/nojq/$b"; done
printf '#!/bin/sh\necho "injected jq failure" >&2\nexit 42\n' > "$w/badjq/jq"
printf '#!/bin/sh\nexit 0\n' > "$w/emptyjq/jq"
printf '#!/bin/sh\necho "injected cp failure" >&2\nexit 1\n' > "$w/badcp/cp"
chmod +x "$w/badjq/jq" "$w/emptyjq/jq" "$w/badcp/cp"
for c in nojq badjq emptyjq badcp; do
  if [ "$c" = nojq ]; then tp="$w/nojq"; else tp="$w/$c:$PATH"; fi
  t "CSR: $c -> non-zero" fail env PATH="$tp" bash "$CSR" "$w/r-$c" 198.18.0.76
  t "CSR: $c -> no to-windows published, no READY message" ok bash -c "[ ! -e '$w/r-$c/to-windows' ] && ! grep -q READY '$w/out.$n'"
done
t "CSR: jq missing created nothing at all" ok bash -c "[ ! -e '$w/r-nojq' ]"
t "CSR: jq failing leaves only a marked incomplete attempt" ok bash -c "[ -d '$w/r-badjq/to-windows.incomplete' ]"

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
  if [ -n "${3:-}" ] && ! (cd "$d" && eval "$3") >> "$w/setup.log" 2>&1; then echo "SETUP FAILED: packet $1 mutator: $3" >> "$w/setup.log"; fi
  echo "$d"; }
special() { # dir name type creator...: make a special-file fixture; true only if it has exactly that type
  local d="$1" f="$2" want="$3" got; shift 3
  "$@" >> "$w/setup.log" 2>&1
  got="$(find "$d/$f" -maxdepth 0 -printf '%y' 2>/dev/null)"
  [ "$got" = "$want" ] && return 0
  echo "fixture $d/$f is '${got:-absent}', wanted '$want' (creator: $*)" > "$w/special.why"; return 1; }
pair() { # label packet-dir: the abort assertion and the product-not-reached assertion for one fixture
  t "packet: $1 aborts by itself" ok aborts good "$2"
  t "packet: $1 did not reach product validation" ok no_product; }
fixture_pair() { # label dir name type creator...: the pair only when the fixture really is that type
  local label="$1" d="$2"; shift 2
  if special "$d" "$@"; then pair "$label" "$d"; else nr "packet: $label (2 assertions)" "$(cat "$w/special.why")" 2; fi; }
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
# --- Review f5bd978 R3: structural defects abort before payload reads / product validation; the
# validator must exit 0 AND print the exact OK line. A recording docker stand-in shows what was reached.
mkdir -p "$w/rec"
cat > "$w/rec/docker" <<'RECEOF'
#!/bin/sh
echo "$*" >> "$REC_LOG"
case "$1 $2" in
  "image inspect") [ "$REC_MODE" = inspect-fail ] && { echo "Error: No such image" >&2; exit 1; }; echo "$REC_ID"; exit 0 ;;
esac
[ "$1" = run ] || exit 97
case "$REC_MODE" in
  ok-nonzero) echo "$REC_OK"; exit 42 ;;
  empty) exit 0 ;;
  two-lines) echo "$REC_OK"; echo "OK extra"; exit 0 ;;
  wrong-fp) echo "OK IP:198.18.0.76 90 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF"; exit 0 ;;
  *) echo "$REC_OK"; exit 0 ;;
esac
RECEOF
chmod +x "$w/rec/docker"
fp="$(openssl x509 -in "$w/pki/good.crt" -noout -fingerprint -sha256 | cut -d= -f2)"
rec() { # mode packet-dir: the checker against the recorder, bounded
  : > "$w/rec.log"
  REC_LOG="$w/rec.log" REC_MODE="$1" REC_ID=sha256:rec REC_OK="OK IP:198.18.0.76 90 $fp" PATH="$w/rec:$PATH" \
    timeout --kill-after=2s 20s bash "$CHK" "$2" "$w/req/to-windows" "$w/req/server/server.key" rec/ops sha256:rec; }
no_product() { ! grep -q '^run ' "$w/rec.log"; }
aborts() { # mode packet-dir: the checker itself must abort (non-zero, final line ABORTED); 124/137 = killed
  rec "$@" > "$w/rec.out" 2>&1; local rc=$?  # by the 20 s bound (a hang); a counted mismatch is not an abort
  echo "ABORT-CHECK rc=$rc $(grep -m1 '^FAIL' "$w/rec.out" | cut -c1-80)"
  [ $rc -ne 0 ] && [ $rc -ne 124 ] && [ $rc -ne 137 ] && tail -n1 "$w/rec.out" | grep -q '^# returned packet: ABORTED'; }
t "packet: recorder control: valid packet + exact OK line accepted" ok rec good "$w/packet-good"
t "packet: recorder control: product validation was reached" ok bash -c "grep -q '^run ' '$w/rec.log'"
fixture_pair "unlisted FIFO (no hang)" "$(packet fifo good.crt)" unexpected.fifo p mkfifo "$w/packet-fifo/unexpected.fifo"
fixture_pair "listed FIFO (server.crt)" "$(packet fifo2 good.crt 'rm server.crt')" server.crt p mkfifo "$w/packet-fifo2/server.crt"
fixture_pair "unlisted unix socket" "$(packet sock good.crt)" unexpected.sock s python3 -c 'import socket, sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$w/packet-sock/unexpected.sock"
# A character device (a /dev/null clone; mknod needs root, so the test's container makes it).
fixture_pair "listed character device (server.crt)" "$(packet chardev good.crt 'rm server.crt')" server.crt c \
  docker run --rm --network none -v "$w/packet-chardev:/p" --entrypoint mknod "$DOCKER_RUN_IMAGE" /p/server.crt c 1 3
fixture_pair "symlinked file" "$(packet symfile good.crt 'rm server.crt')" server.crt l ln -s ../pki/good.crt "$w/packet-symfile/server.crt"
if special "$w" packet-link l ln -s "$w/packet-good" "$w/packet-link"; then pair "symlinked packet root" "$w/packet-link"; else nr "packet: symlinked packet root (2 assertions)" "$(cat "$w/special.why")" 2; fi
fixture_pair "nested directory" "$(packet nested good.crt)" sub d mkdir "$w/packet-nested/sub"
d="$(packet unreadable good.crt)"
if special "$d" server.crt f chmod 000 "$d/server.crt" && [ ! -r "$d/server.crt" ]; then pair "unreadable file (a read error is not 'no key')" "$d"
else nr "packet: unreadable file (2 assertions)" "server.crt is still readable (running as root?)" 2; fi
pair "corrupt certificate" "$(packet corrupt good.crt 'printf "not a certificate\n" > server.crt; jq --arg s "$(sha256sum server.crt | cut -c1-64)" ".files_sha256[\"server.crt\"]=\$s" issued-manifest.json > m && mv m issued-manifest.json')"
pair "malformed issued manifest (a parse error is not a mismatch)" "$(packet badjson good.crt 'printf "{not json" > issued-manifest.json')"
t "packet: image inspection failure fails" fail rec inspect-fail "$w/packet-good"
t "packet: validator prints OK then exits 42 -> fails" fail rec ok-nonzero "$w/packet-good"
t "packet: validator exits 0 with empty output -> fails" fail rec empty "$w/packet-good"
t "packet: validator prints an extra line -> fails" fail rec two-lines "$w/packet-good"
t "packet: validator OK line for another certificate -> fails" fail rec wrong-fp "$w/packet-good"

# --- Review f4bd578 N1: the same scripts under another OpenSSL (display formats differ, e.g. 3.0 vs 3.5).
if [ -n "${OPENSSL_ALT_IMAGE:-}" ]; then
  alt() { docker run --rm --network none -u "$(id -u):$(id -g)" -v "$w:$w" -v "$repo:$repo:ro" -e PATH="$w/rec:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    -e REC_LOG="$w/rec.log" -e REC_MODE=good -e REC_ID=sha256:rec -e REC_OK="OK IP:198.18.0.76 90 $fp" --entrypoint bash "$OPENSSL_ALT_IMAGE" -c "$1"; }
  altv="$(alt 'openssl version' 2>&1 | head -1)"
  t "alt OpenSSL ($altv): CSR created" ok alt "bash '$CSR' '$w/alt-req' 198.18.0.76"
  t "alt OpenSSL: CSR with an existing DNS name created" ok alt "bash '$CSR' '$w/alt-req-dns' 198.18.0.76 map.example.test"
  t "alt OpenSSL: --check accepts its own request" ok alt "bash '$CSR' --check '$w/alt-req'"
  t "alt OpenSSL: --check accepts the request made with the host OpenSSL" ok alt "bash '$CSR' --check '$w/req'"
  t "host OpenSSL: --check accepts the request made with the alt OpenSSL" ok bash "$CSR" --check "$w/alt-req"
  t "alt OpenSSL: --check rejects a manifest bound to another key" fail alt "bash '$CSR' --check '$w/tampered'"
  t "alt OpenSSL: checker accepts the correct packet (recording validator)" ok alt ": > '$w/rec.log'; timeout 20 bash '$CHK' '$w/packet-good' '$w/req/to-windows' '$w/req/server/server.key' rec/ops sha256:rec"
  t "alt OpenSSL: checker rejects a leaf for another IP" fail alt "timeout 20 bash '$CHK' '$w/packet-wrongip' '$w/req/to-windows' '$w/req/server/server.key' rec/ops sha256:rec"
  t "alt OpenSSL: checker rejects a clientAuth leaf" fail alt "timeout 20 bash '$CHK' '$w/packet-clientauth' '$w/req/to-windows' '$w/req/server/server.key' rec/ops sha256:rec"
  t "alt OpenSSL: checker rejects a leaf longer than 90 days" fail alt "timeout 20 bash '$CHK' '$w/packet-long' '$w/req/to-windows' '$w/req/server/server.key' rec/ops sha256:rec"
else
  nr "alt OpenSSL (10 assertions)" "OPENSSL_ALT_IMAGE is not set" 10
fi

setup="$(grep -c '^SETUP FAILED' "$w/setup.log")"
grep '^SETUP FAILED' "$w/setup.log"
echo "# lan-pki vm side: checks=$n failed=$fails notrun_assertions=$notrun setup_failed=$setup"
exit $(( fails > 0 || setup > 0 ? 1 : 0 ))
