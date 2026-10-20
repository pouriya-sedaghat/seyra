#!/usr/bin/env bash
# Disposable client-handoff rehearsal on a synthetic fixture (no Iran data, no LAN publication).
#
#   LAB=/abs/rehearsal-lab OUT=/abs/evidence OLD_BUNDLE=/abs/rN NEW_BUNDLE=/abs/rM NEW_SUMS_DIGEST=<sha256> \
#   FIXTURE=/abs/fixture.osm.pbf DIND_IMAGE=docker:… RUNNER=<node image> NODE_MODULES=/abs/repo/node_modules \
#   [PHASES="vm install gate update tls relay egress rollback cleanup"] tests/rehearsal/handoff-rehearsal.sh
#
# Topology. A disposable "rehearsal VM" (a privileged Docker-in-Docker container with its own daemon
# and firewall) stands in for the serving VM. It is attached ONLY to three --internal, no-gateway
# networks of the outer daemon (inhibit_ipv4: the outer VM gets no address or route on them):
#   clients 198.18.10.0/24  rehearsal VM .2 = its "LAN address"; approved stand-in subnet
#                           198.18.10.128/25 (client .200); outsider .20 on the same segment
#   outside 198.18.20.0/24  rehearsal VM .2, nothing may be published there; outsider .20
#   private 10.250.0.0/24   rehearsal VM .2; a controlled sink for the egress test
# Inside the rehearsal VM, exactly as on the serving VM: the nested Seyra host is a disposable host
# of tests/validation/iran-offline-host.sh on its --internal lab network; the edge
# (infra/edge/edge.sh) publishes the LAN address port and relays with PROXY protocol to the inner
# relay listener. A client packet therefore crosses: client -> rehearsal VM interface -> its Docker
# DNAT -> edge -> lab network -> nested host -> nested Docker DNAT -> proxy relay listener, with the
# client source address preserved (no masquerade anywhere on that path). Temporary PKI only.
#
# Every transition records readiness samples (0.5 s) through the ordinary loopback listener, the
# inner container ids per service and provider identities before/after (transitions.txt).
#
# Frozen execution: the script copies the harnesses it uses into $OUT/frozen-<stamp> (read-only),
# records the commit, and re-executes from there.
set -uo pipefail
: "${LAB:?}" "${OUT:?}" "${OLD_BUNDLE:?}" "${NEW_BUNDLE:?}" "${NEW_SUMS_DIGEST:?}" "${FIXTURE:?}" "${DIND_IMAGE:?}" "${RUNNER:?}" "${NODE_MODULES:?}"
PHASES="${PHASES:-vm install gate update tls relay egress rollback cleanup}"
mkdir -p "$OUT" "$LAB"
if [ -z "${SEYRA_REHEARSAL_FROZEN:-}" ]; then
  repo="$(cd "$(dirname "$0")/../.." && pwd)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  frozen="$OUT/frozen-$stamp"
  for d in tests/rehearsal tests/validation tests/offline infra/edge infra/images/proxy docs/openapi; do mkdir -p "$frozen/$d" && cp -a "$repo/$d/." "$frozen/$d/"; done
  chmod -R a-w "$frozen"
  { echo "commit: $(git -C "$repo" rev-parse HEAD)"
    echo "uncommitted changes in copied paths: $(git -C "$repo" status --porcelain -- tests/rehearsal tests/validation tests/offline infra/edge infra/images/proxy docs/openapi | wc -l)"
    echo "frozen copy: $frozen"; } > "$OUT/frozen-$stamp.revision"
  exec env SEYRA_REHEARSAL_FROZEN="$frozen" bash "$frozen/tests/rehearsal/$(basename "$0")"
fi
F="$SEYRA_REHEARSAL_FROZEN"
LABEL="seyra.validation.lab=$LAB"
VM=seyra-rh-vm; VMVOL=seyra-rh-vm-docker; VMRUN="$LAB/vm-run"
CLIENTS=seyra-rh-clients; OUTSIDE=seyra-rh-outside; PRIVATE=seyra-rh-private
VM_LAN=198.18.10.2; VM_OUT=198.18.20.2; VM_PRIV=10.250.0.2
PUBLISH=$VM_LAN; EDGE_PORT=18443; RELAY_PORT=8444; APPROVED=198.18.10.128/25
CLIENT_IP=198.18.10.200; NEAR_OUTSIDER=198.18.10.20; FAR_OUTSIDER=198.18.20.20
NAME=seyra-rh.example.test
HOST=seyra-rh-host; NET=seyra_offline_lab   # inside the rehearsal VM
GUARD_IMAGE="$DIND_IMAGE"
O() { docker -H unix:///var/run/docker.sock "$@"; }   # the outer (real VM) daemon
export DOCKER_HOST="unix://$VMRUN/docker.sock"       # everything else: the rehearsal VM's daemon
export SEYRA_HOME="$LAB/home"; inst="$LAB/install"; sock="unix://$LAB/run/docker.sock"
cli() { DOCKER_HOST="$sock" "$inst/bin/seyra-maps" "$@"; }
D() { docker -H "$sock" "$@"; }
fails=0
ts() { date -u +%FT%TZ; }
result() { echo "$1 $2 $3" | tee -a "$OUT/summary.txt"; [ "$1" = PASS ] || [ "$1" = NOTE ] || fails=$((fails + 1)); }
finish() { echo "# $(ts) phases=[$PHASES] failures=$fails" | tee -a "$OUT/summary.txt"; exit $(( fails > 0 ? 1 : 0 )); }
has() { [[ " $PHASES " == *" $1 "* ]]; }
o_owned() { [ "$(O "$1" inspect -f '{{index .Labels "seyra.validation.lab"}}' "$2" 2>/dev/null)" = "$LAB" ]; }
o_owned_ctr() { [ "$(O container inspect -f '{{index .Config.Labels "seyra.validation.lab"}}' "$1" 2>/dev/null)" = "$LAB" ]; }
own() { [ "$(docker container inspect -f '{{index .Config.Labels "seyra.validation.lab"}}' "$1" 2>/dev/null)" = "$LAB" ]; }
host_ip() { docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$HOST"; }
ds() { cat "$OUT/.dataset_id" 2>/dev/null; }
ids() { D ps --filter label=com.docker.compose.project=seyra --format '{{.Label "com.docker.compose.service"}}={{.ID}}' | sort; }
idents() { node_in_host fetch-health | jq -c '[.providers[]? | {p: .provider, id: .observed_identity}] | sort_by(.p)'; }
secret_cat() { docker exec "$HOST" cat "$1"; }
fp_file() { docker exec "$HOST" openssl x509 -in "$1" -noout -fingerprint -sha256 | cut -d= -f2; }
echo "# $(ts) rehearsal start phases=[$PHASES] frozen=$F" >> "$OUT/summary.txt"

# Ownership preflight for the rehearsal VM's /var/lib/docker volume (review c73db85 R1), on the
# outer daemon's explicit endpoint. `docker volume create` returns an existing volume of the same
# name without error, so creating proves nothing: an absent volume is created with this lab's label
# and inspected again; an existing one must already be this lab's (local driver) and unused. An
# unlabelled, foreign or in-use volume, and any inspect/create/list error other than "no such
# volume" (uncertain state), is refused before the privileged VM could mount it. Prints the state.
prepare_vm_volume() {
  local out rc users vstate
  out="$(O volume inspect -f '{{.Name}}|{{.Driver}}|{{index .Labels "seyra.validation.lab"}}' "$VMVOL" 2>&1)"; rc=$?
  if [ $rc -ne 0 ]; then
    grep -qi 'no such volume' <<<"$out" || { echo "cannot establish whether volume $VMVOL exists ($out)"; return 1; }
    out="$(O volume create --label "$LABEL" "$VMVOL" 2>&1)" || { echo "cannot create volume $VMVOL ($out)"; return 1; }
    vstate="created"
  else vstate="existing"; fi
  out="$(O volume inspect -f '{{.Name}}|{{.Driver}}|{{index .Labels "seyra.validation.lab"}}' "$VMVOL" 2>&1)" || { echo "cannot inspect volume $VMVOL after it was found/created ($out)"; return 1; }
  [ "$out" = "$VMVOL|local|$LAB" ] || { echo "volume $VMVOL ($vstate) is not this lab's: $out"; return 1; }
  users="$(O ps -a -q --filter "volume=$VMVOL" 2>&1)" || { echo "cannot list the users of volume $VMVOL ($users)"; return 1; }
  [ -z "$users" ] || { echo "volume $VMVOL is in use by container(s) $(echo $users)"; return 1; }
  echo "volume $VMVOL $vstate, labelled for this lab, unused"
}

# The rehearsal VM's daemon must be the one this lab created (never the outer daemon, never the
# serving host's nested daemon).
vm_guard() {
  o_owned_ctr "$VM" || { result FAIL RV0 "$VM is not this lab's rehearsal VM; refusing"; finish; }
  [ "$(docker info -f '{{.Name}}' 2>/dev/null)" = "$(O container inspect -f '{{.Config.Hostname}}' "$VM")" ] || { result FAIL RV0 "DOCKER_HOST is not the rehearsal VM daemon; refusing"; finish; }
}

# Node inside the nested host's network namespace (ordinary loopback listener, Host localhost).
# Trust: every CA this rehearsal serves ($OUT/.poll-ca.pem); readiness polling does not check the
# name (the relay client does, strictly). Prints/appends the served leaf fingerprint too.
node_in_host() { # fetch-health | fingerprint | poll <file> <stopfile>
  docker run --rm --network "container:$HOST" --label "$LABEL" -v "$OUT:$OUT" --entrypoint node "$RUNNER" --input-type=module -e "
import { request } from 'node:https'; import { readFileSync, existsSync, appendFileSync } from 'node:fs';
const ca = readFileSync('$OUT/.poll-ca.pem');
const get = (path) => new Promise((res) => { const r = request({ host: '127.0.0.1', port: 8443, path, ca, checkServerIdentity: () => undefined, headers: { Host: 'localhost' }, timeout: 3000 }, (x) => { const fp = x.socket.getPeerCertificate().fingerprint256; let b = ''; x.on('data', (d) => b += d); x.on('end', () => res({ status: x.statusCode, body: b, fp })); }); r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', (e) => res({ status: 0, body: String(e.code ?? e.message), fp: '-' })); r.end(); });
const mode = process.argv[1];
if (mode === 'fetch-health') { const r = await get('/api/v1/map/health'); console.log(r.status === 200 ? r.body : '{}'); }
else if (mode === 'fingerprint') { const r = await get('/health/live'); console.log(r.fp); }
else { const [file, stop] = process.argv.slice(2); while (!existsSync(stop)) { const r = await get('/health/ready'); let s = r.status; try { if (s === 200) s = JSON.parse(r.body).status === 'ready' ? 200 : 503; } catch {} appendFileSync(file, Date.now() + ' ' + s + ' ' + (r.fp ?? '-').slice(0, 11) + '\n'); await new Promise((z) => setTimeout(z, 500)); } }
" "$@"
}
start_poll() { rm -f "$OUT/$1.stop"; : > "$OUT/$1.samples"; node_in_host poll "$OUT/$1.samples" "$OUT/$1.stop" & poll_pid=$!; sleep 3; }
stop_poll() { # label -> "not_ready_ms=<longest gap> samples=<n> final=<status>"
  touch "$OUT/$1.stop"; wait "$poll_pid" 2>/dev/null
  awk '{ if ($2 != 200) { if (start == 0) start = $1; last = $1 } else if (start) { gap = $1 - start; if (gap > max) max = gap; start = 0 } n++; fin = $2 } END { if (start) { gap = last - start; if (gap > max) max = gap; open = 1 } printf "not_ready_ms=%d samples=%d final=%s%s\n", max, n, fin, open ? " (not ready at end)" : "" }' "$OUT/$1.samples"
}
transition() { # label command... : readiness samples, ids and identities before/after
  local label="$1"; shift
  rm -f "$OUT/.expect-ready"
  ids > "$OUT/$label.ids-before"; idents > "$OUT/$label.idents-before"
  start_poll "$label"
  "$@" > "$OUT/$label.log" 2>&1; local rc=$?
  for _ in $(seq 1 180); do [ "$(tail -1 "$OUT/$label.samples" | awk '{print $2}')" = 200 ] && break; sleep 1; done
  sleep 3
  local m; m="$(stop_poll "$label")"
  ids > "$OUT/$label.ids-after"; idents > "$OUT/$label.idents-after"
  local rec; rec="$(recreated "$OUT/$label.ids-before" "$OUT/$label.ids-after")"
  echo "$label rc=$rc $m recreated=[${rec}] identities_equal=$(cmp -s "$OUT/$label.idents-before" "$OUT/$label.idents-after" && echo yes || echo no)" | tee -a "$OUT/transitions.txt"
  touch "$OUT/.expect-ready"
  return $rc
}
tline() { grep "^$1 " "$OUT/transitions.txt" | tail -1; }
# Services whose container id changed (or that appeared/disappeared), from "service=id" lists.
recreated() { awk -F= 'NR==FNR { b[$1] = $2; next } { a[$1] = $2 } END { for (k in b) if (!(k in a) || a[k] != b[k]) print k (k in a ? "" : "(gone)"); for (k in a) if (!(k in b)) print k "(new)" }' "$1" "$2" | sort | paste -sd, -; }

# ------------------------------------------------------------------------------------------------
if has vm; then
  ip -4 route > "$OUT/vm-routes-before.txt"
  for spec in "$CLIENTS 198.18.10.0/24" "$OUTSIDE 198.18.20.0/24" "$PRIVATE 10.250.0.0/24"; do
    set -- $spec
    if O network inspect "$1" >/dev/null 2>&1; then o_owned network "$1" || { result FAIL RV1 "network $1 exists without this lab's label"; finish; }
    else O network create --internal --label "$LABEL" --subnet "$2" -o com.docker.network.bridge.inhibit_ipv4=true "$1" >/dev/null || { result FAIL RV1 "cannot create $1"; finish; }; fi
  done
  O container inspect "$VM" >/dev/null 2>&1 && { result FAIL RV1 "$VM already exists; remove it deliberately (cleanup phase) first"; finish; }
  vstate="$(prepare_vm_volume)" || { result FAIL RV0 "rehearsal VM volume refused before any mount: $vstate"; finish; }
  echo "$vstate" > "$OUT/rv0-volume.txt"
  mkdir -p "$VMRUN"
  O run -d --privileged --name "$VM" --label "$LABEL" --network "$CLIENTS" --ip "$VM_LAN" --pull never \
    -v "$VMVOL:/var/lib/docker" -v "$LAB:$LAB" -v "$OUT:$OUT" -v "$OLD_BUNDLE:$OLD_BUNDLE:ro" -v "$FIXTURE:$FIXTURE:ro" -v "$NODE_MODULES:$NODE_MODULES:ro" \
    "$DIND_IMAGE" dockerd -H unix:///var/run/docker.sock -H "unix://$VMRUN/docker.sock" --group "$(id -g)" --tls=false >/dev/null \
    || { result FAIL RV1 "cannot start the rehearsal VM"; finish; }
  O network connect --ip "$VM_OUT" "$OUTSIDE" "$VM" && O network connect --ip "$VM_PRIV" "$PRIVATE" "$VM"
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
  vm_guard
  for img in "$DIND_IMAGE" "$RUNNER"; do O image save "$img" | docker image load -q >/dev/null; done
  ip -4 route > "$OUT/vm-routes-after.txt"
  { echo "rehearsal VM: $(docker version -f 'engine {{.Server.Version}}') image=$DIND_IMAGE"
    echo "routes inside the rehearsal VM:"; O exec "$VM" ip -4 route
    echo "images loaded: $(docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | paste -sd' ')"; } > "$OUT/rv1-vm.txt" 2>&1
  if cmp -s "$OUT/vm-routes-before.txt" "$OUT/vm-routes-after.txt" && ! O exec "$VM" ip -4 route | grep -q '^default' \
     && [ "$(docker image inspect -f '{{.Id}}' "$RUNNER")" = "$(O image inspect -f '{{.Id}}' "$RUNNER")" ]; then
    result PASS RV1 "rehearsal VM on internal no-gateway networks only (no default route; outer VM routing table unchanged); images loaded by identity"
  else result FAIL RV1 "rehearsal VM isolation or image identity check failed ($OUT/rv1-vm.txt)"; finish; fi
fi
# Every phase except a cleanup-only run works through the rehearsal VM's daemon and the lab host.
needs_vm=0; for ph in vm install gate update tls relay egress rollback; do has "$ph" && needs_vm=1; done
[ "$needs_vm" = 1 ] && vm_guard

if has install; then
  ( BUNDLE="$OLD_BUNDLE" PBF="$FIXTURE" LAB="$LAB" DIND_IMAGE="$DIND_IMAGE" OUT="$OUT/p1-host" PHASES="install import" \
    HOST1_NAME="$HOST" HOST2_NAME=seyra-rh-restore bash "$F/tests/validation/iran-offline-host.sh" ) > "$OUT/p1-host.log" 2>&1
  cp "$OUT/p1-host/.dataset_id" "$OUT/.dataset_id" 2>/dev/null
  if [ -n "$(ds)" ] && own "$HOST"; then result PASS RH1 "disposable host $HOST installed from the old bundle and imported the fixture ($(ds))"; else result FAIL RH1 "install/import failed ($OUT/p1-host/summary.txt)"; finish; fi
  secret_cat "$SEYRA_HOME/secrets/tls/ca.crt" > "$OUT/.poll-ca.pem"
  cli activate "$(ds)" > "$OUT/rh1-activate.log" 2>&1
  r="$(node_in_host fetch-health | jq -r '.status')"
  if [ "$r" = ready ]; then result PASS RH1b "activated $(ds); ready through the ordinary loopback listener"; touch "$OUT/.expect-ready"; else result FAIL RH1b "not ready after activation ($r)"; finish; fi
fi
needs_host=0; for ph in install gate update tls relay egress rollback; do has "$ph" && needs_host=1; done
[ "$needs_host" = 1 ] && { own "$HOST" || { result FAIL RH0 "$HOST is not a host of this lab; refusing"; finish; }; }

if has gate; then
  # A tampered copy of the NEW bundle: one extra unlisted symlink (payloads hard-linked, unchanged).
  t="$LAB/transfer/new-tampered"; rm -rf "$t"; mkdir -p "$LAB/transfer"; cp -al "$NEW_BUNDLE" "$t"; ln -s /etc/hostname "$t/install/unlisted-link"
  before_tree="$(cd "$inst" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)"; before_imgs="$(D images -q --no-trunc | sort | sha256sum)"
  ( BUNDLE="$OLD_BUNDLE" PBF="$FIXTURE" LAB="$LAB" DIND_IMAGE="$DIND_IMAGE" OUT="$OUT/p2-gate-refused" PHASES="update" UPDATE_BUNDLE="$t" UPDATE_SUMS_DIGEST="$NEW_SUMS_DIGEST" \
    HOST1_NAME="$HOST" HOST2_NAME=seyra-rh-restore bash "$F/tests/validation/iran-offline-host.sh" ) > "$OUT/p2-gate-refused.log" 2>&1; rc=$?
  after_tree="$(cd "$inst" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)"; after_imgs="$(D images -q --no-trunc | sort | sha256sum)"
  if [ $rc -ne 0 ] && grep -q 'FAIL U1 update refused before any install change' "$OUT/p2-gate-refused/summary.txt" 2>/dev/null && [ "$before_tree" = "$after_tree" ] && [ "$before_imgs" = "$after_imgs" ]; then
    result PASS RH2 "tampered new bundle refused by the gate before install ($(cut -c1-90 "$OUT/p2-gate-refused/U0-gate.txt")); install tree and nested images unchanged"
  else result FAIL RH2 "gate rc=$rc tree_same=$([ "$before_tree" = "$after_tree" ] && echo y || echo n) images_same=$([ "$before_imgs" = "$after_imgs" ] && echo y || echo n)"; fi
  rm -rf "$t"
fi

if has update; then
  u="$LAB/transfer/new"; rm -rf "$u"; mkdir -p "$LAB/transfer"; cp -al "$NEW_BUNDLE" "$u"
  ( BUNDLE="$OLD_BUNDLE" PBF="$FIXTURE" LAB="$LAB" DIND_IMAGE="$DIND_IMAGE" OUT="$OUT/p3-update" PHASES="update" UPDATE_BUNDLE="$u" UPDATE_SUMS_DIGEST="$NEW_SUMS_DIGEST" \
    HOST1_NAME="$HOST" HOST2_NAME=seyra-rh-restore bash "$F/tests/validation/iran-offline-host.sh" ) > "$OUT/p3-update.log" 2>&1; rc=$?
  if [ $rc -eq 0 ] && grep -q 'PASS U1' "$OUT/p3-update/summary.txt"; then result PASS RH3 "new bundle verified before install, install tree swapped, images loaded (old stack kept serving)"; else result FAIL RH3 "update rc=$rc"; finish; fi
  transition t1-update-start cli start; rc=$?
  line="$(tline t1-update-start)"
  if [ $rc -eq 0 ] && grep -q 'identities_equal=yes' <<<"$line" && grep -q 'final=200' <<<"$line"; then result PASS RH3b "cutover to the new build: $line"; else result FAIL RH3b "$line"; fi
fi

if has tls; then
  pki="$LAB/pki"; mkdir -p "$pki"
  o() { openssl "$@" >/dev/null 2>&1; }
  o req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$pki/root.key" -out "$pki/root.crt" -days 3 -subj /CN=seyra-rehearsal-root -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign
  o req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$pki/int.key" -out "$pki/int.csr" -subj /CN=seyra-rehearsal-intermediate
  printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n' > "$pki/int.ext"
  o x509 -req -in "$pki/int.csr" -CA "$pki/root.crt" -CAkey "$pki/root.key" -CAcreateserial -out "$pki/int.crt" -days 3 -extfile "$pki/int.ext"
  o req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$pki/other.key" -out "$pki/other.crt" -days 3 -subj /CN=seyra-rehearsal-unrelated -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s,IP:%s\nauthorityKeyIdentifier=keyid\n' "$NAME" "$PUBLISH" > "$pki/leaf.ext"
  [ -s "$pki/root.crt" ] && [ -s "$pki/int.crt" ] && [ -s "$pki/other.crt" ] || { result FAIL RT0 "temporary PKI could not be created"; finish; }
  cat "$pki/root.crt" >> "$OUT/.poll-ca.pem"
  tdir="$SEYRA_HOME/secrets/tls"; pend="$tdir/pending"
  sign() { # n: the CSR is read by the operator directly (0711 pending dir, 0444 CSR) and signed off-host
    cp "$pend/server.csr" "$pki/leaf$1.csr" && o x509 -req -in "$pki/leaf$1.csr" -CA "$pki/int.crt" -CAkey "$pki/int.key" -CAcreateserial -out "$pki/leaf$1.crt" -days 2 -extfile "$pki/leaf.ext"; }
  imp() { cli tls import --cert "$pki/leaf$1.crt" --chain "$pki/int.crt" --ca "$pki/root.crt" --names "$NAME,$PUBLISH"; }
  sha() { docker exec "$HOST" sha256sum "$1" | cut -c1-64; }
  ncerts() { docker exec "$HOST" grep -c 'BEGIN CERTIFICATE' "$1"; }
  lfp() { openssl x509 -in "$pki/leaf$1.crt" -noout -fingerprint -sha256 | cut -d= -f2; }
  fp_file "$tdir/server.crt" > "$OUT/.fixture-fingerprint"; sha "$tdir/ca.crt" > "$OUT/.fixture-ca-sha"
  # RT1: CSR -> external issuer (root -> intermediate -> leaf) -> import.
  cli tls csr --names "$NAME,$PUBLISH" > "$OUT/t-csr1.log" 2>&1 && sign 1 && imp 1 > "$OUT/t-import1.log" 2>&1; rc=$?
  b1="$(sed -n 's/^\[tls\] previous pair kept in //p' "$OUT/t-import1.log")"; echo "$b1" > "$OUT/.backup-fixture"
  meta="$(secret_cat "$tdir/served.json" 2>/dev/null)"
  if [ $rc -eq 0 ] && [ -n "$b1" ] && [ "$(ncerts "$tdir/server.crt")" = 2 ] && [ "$(sha "$tdir/ca.crt")" = "$(sha256sum < "$pki/root.crt" | cut -c1-64)" ] \
     && [ "$(jq -r '.names | join(",")' <<<"$meta")" = "$NAME,$PUBLISH" ] && [ "$(jq -r .sha256_fingerprint <<<"$meta")" = "$(fp_file "$tdir/server.crt")" ]; then
    result PASS RT1 "operator read the CSR directly; external-issuer import installed leaf+intermediate, the root as trust anchor and matching metadata; fixture set backed up"
  else result FAIL RT1 "csr/import rc=$rc ($OUT/t-import1.log)"; fi
  # RT2: renewal; the previous full-chain set is the backup.
  cli tls csr --names "$NAME,$PUBLISH" > "$OUT/t-csr2.log" 2>&1 && sign 2 && imp 2 > "$OUT/t-import2.log" 2>&1; rc=$?
  b2="$(sed -n 's/^\[tls\] previous pair kept in //p' "$OUT/t-import2.log")"
  if [ $rc -eq 0 ] && [ -n "$b2" ] && [ "$(ncerts "$b2/server.crt")" = 2 ] && [ "$(ncerts "$b2/leaf.crt")" = 1 ] && [ "$(sha "$b2/chain.pem")" = "$(sha256sum < "$pki/int.crt" | cut -c1-64)" ] \
     && [ "$(sha "$b2/ca.crt")" = "$(sha256sum < "$pki/root.crt" | cut -c1-64)" ] && [ "$(fp_file "$b2/server.crt")" = "$(lfp 1)" ]; then
    result PASS RT2 "renewal imported; backup holds the previous full chain (served file, leaf, intermediate), root and metadata"
  else result FAIL RT2 "renewal rc=$rc backup=$b2"; fi
  # RT3: interrupted replacement (the installed OPS image's own import, stopped after the first
  # rename), start refused while the journal exists, then completed by tls recover.
  cli tls csr --names "$NAME,$PUBLISH" > "$OUT/t-csr3.log" 2>&1 && sign 3
  ops="$(jq -r '.images.ops.ref' "$inst/infra/dependencies.lock.json")"
  crash() { D run --rm --network none --user 0:0 -v "$SEYRA_HOME:$SEYRA_HOME" -v "$pki:$pki:ro" --entrypoint node "$ops" --input-type=module -e "
const t = await import('/opt/seyra/apps/ops/dist/tls.js');
await t.tlsImport({ dir: '$tdir' }, { cert: '$pki/leaf$1.crt', chain: '$pki/int.crt', ca: '$pki/root.crt', names: ['$NAME', '$PUBLISH'], crashAfter: 'key' }, () => {});"; }
  crash 3 > "$OUT/t-crash3.log" 2>&1
  j3="$(docker exec "$HOST" test -f "$tdir/replace.json" && echo journal)"
  cli start > "$OUT/t-start-refused.log" 2>&1; s_rc=$?
  cli tls recover > "$OUT/t-recover3.log" 2>&1; r_rc=$?
  if [ "$j3" = journal ] && [ $s_rc -ne 0 ] && grep -q 'did not finish' "$OUT/t-start-refused.log" && [ $r_rc -eq 0 ] && grep -q 'completed' "$OUT/t-recover3.log" \
     && [ "$(fp_file "$tdir/server.crt")" = "$(lfp 3)" ]; then
    result PASS RT3 "interrupted replacement: journal left, start refused, tls recover completed the validated new set"
  else result FAIL RT3 "journal=$j3 start_rc=$s_rc recover_rc=$r_rc"; fi
  # RT4: refusal. A second interruption, then the staged certificate removed AND the backup's root
  # replaced: recover must refuse and change nothing.
  cli tls csr --names "$NAME,$PUBLISH" --replace-pending > "$OUT/t-csr4.log" 2>&1 && sign 4 && crash 4 > "$OUT/t-crash4.log" 2>&1
  jb="$(secret_cat "$tdir/replace.json" | jq -r .backup)"
  docker exec "$HOST" sh -c "cp -p '$jb/ca.crt' '$jb/ca.crt.keep' && rm -f '$tdir/next/server.crt' && chmod 600 '$jb/ca.crt' && cat '$pki/other.crt' > '$jb/ca.crt'"
  act() { docker exec "$HOST" sh -c "cd '$tdir' && sha256sum server.crt server.key ca.crt served.json replace.json 2>&1"; }
  a0="$(act)"; cli tls recover > "$OUT/t-recover4-refused.log" 2>&1; rr=$?; a1="$(act)"
  if [ $rr -ne 0 ] && grep -q 'cannot recover' "$OUT/t-recover4-refused.log" && [ "$a0" = "$a1" ]; then result PASS RT4 "recover refused an incomplete new set with a wrong-root backup; active files and journal unchanged"
  else result FAIL RT4 "rc=$rr unchanged=$([ "$a0" = "$a1" ] && echo y || echo n)"; fi
  # RT5: backup intact again -> recover restores the complete previous set.
  docker exec "$HOST" sh -c "cat '$jb/ca.crt.keep' > '$jb/ca.crt' && chmod --reference='$jb/ca.crt.keep' '$jb/ca.crt' && rm -f '$jb/ca.crt.keep'"
  cli tls recover > "$OUT/t-recover4.log" 2>&1; rr=$?
  if [ $rr -eq 0 ] && grep -q restored "$OUT/t-recover4.log" && [ "$(fp_file "$tdir/server.crt")" = "$(lfp 3)" ] && ! docker exec "$HOST" test -e "$tdir/replace.json"; then
    result PASS RT5 "with the backup intact, recover restored the complete previous set (leaf 3) and removed the journal"
  else result FAIL RT5 "rc=$rr"; fi
  transition t2-proxy-restart-tls cli proxy restart; rc=$?
  line="$(tline t2-proxy-restart-tls)"; served="$(node_in_host fingerprint)"
  if [ $rc -eq 0 ] && grep -q 'final=200' <<<"$line" && [ "$served" = "$(fp_file "$tdir/server.crt")" ]; then result PASS RT6 "proxy serves the imported certificate after proxy restart; $line"
  else result FAIL RT6 "served=$served $line"; fi
  fp_file "$tdir/server.crt" > "$OUT/.served-fingerprint"
fi

runc() { # daemon(O|docker) name network ip role [cfg]
  local dk="$1" netargs=(--network "$3"); [ -n "$4" ] && netargs+=(--ip "$4")
  "$dk" run --rm --label "$LABEL" "${netargs[@]}" -v "$F:/frozen:ro" -v "$NODE_MODULES:/nm/node_modules:ro" -v "$LAB/pki/root.crt:/pki/root.crt:ro" \
    -v "${6:-$LAB/relay-client.json}:/cfg.json:ro" -v "$OUT:/out" --entrypoint node "$RUNNER" /frozen/tests/rehearsal/relay-client.mjs "$5" /cfg.json "/out/r-$2.json" > "$OUT/r-$2.log" 2>&1; }
fl() { grep ^FAIL "$OUT/r-$1.log" | head -3 | tr '\n' ' '; }

if has relay; then
  hip="$(host_ip)"
  pimg="$(jq -r '.images.proxy.ref' "$inst/infra/dependencies.lock.json")"; pid_="$(jq -r '.images.proxy.image_id' "$inst/infra/dependencies.lock.json")"
  D image save "$pimg" | docker image load -q >/dev/null   # the exact installed proxy image, from the host
  cat > "$LAB/edge.env" <<EOF
EDGE_OWNER=seyra-rehearsal
EDGE_NAME=seyra-rh-edge
EDGE_IMAGE=$pimg
EDGE_IMAGE_ID=$pid_
EDGE_GUARD_IMAGE=$GUARD_IMAGE
EDGE_GUARD_IMAGE_ID=$(docker image inspect -f '{{.Id}}' "$GUARD_IMAGE")
EDGE_PUBLISH_ADDR=$PUBLISH
EDGE_PUBLISH_PORT=$EDGE_PORT
EDGE_CLIENT_CIDRS=$APPROVED
EDGE_UPSTREAM=$hip:$RELAY_PORT
EDGE_LAB_NETWORK=$NET
EDGE_INNER_DOCKER_HOST=$sock
EDGE_INNER_HOME=$SEYRA_HOME
EDGE_PUBLISH_NETWORK=seyra_rh_edge
EDGE_CONF_DIR=$LAB/edge
EOF
  bash "$F/infra/edge/edge.sh" "$LAB/edge.env" up > "$OUT/r-edge-up.log" 2>&1; rc=$?
  eip="$(sed -n 's/^edge: up; relay peer address on [^:]*: //p' "$OUT/r-edge-up.log")"
  if [ $rc -eq 0 ] && [ -n "$eip" ]; then result PASS RR1 "edge started from the exact installed proxy image with its egress guard; relay peer $eip"; else result FAIL RR1 "edge up rc=$rc"; finish; fi
  echo "$eip" > "$OUT/.edge-ip"
  { cli init --access loopback --bind 127.0.0.1 --server-names "localhost 127.0.0.1" --relay-peer "$eip" --relay-bind "$hip" --relay-port "$RELAY_PORT" \
      --relay-client-cidrs "$APPROVED" --relay-server-names "$NAME $PUBLISH" && cli access apply; } > "$OUT/r-init.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then result PASS RR2 "relay settings validated and applied to runtime.env"; else result FAIL RR2 "rc=$rc ($OUT/r-init.log)"; finish; fi
  transition t3-relay-on cli proxy restart; rc=$?
  line="$(tline t3-relay-on)"
  if [ $rc -eq 0 ] && grep -q 'final=200' <<<"$line"; then result PASS RR3 "relay listener published on the host's lab address; $line"; else result FAIL RR3 "$line"; fi
  csp="$(sed -n 's/.*Content-Security-Policy "\([^"]*\)".*/\1/p' "$F/infra/images/proxy/security-headers.conf")"
  mkcfg() { # out edge-host
    jq -n --arg sni "$NAME" --arg hh "$NAME:$EDGE_PORT" --arg ds "$(ds)" --arg fp "$(cat "$OUT/.served-fingerprint")" --arg csp "$csp" \
      --arg eh "$2" --argjson ep "$EDGE_PORT" --arg rh "$hip" --argjson rp "$RELAY_PORT" --arg out "$NEAR_OUTSIDER" --arg ok "$CLIENT_IP" \
      '{ca:"/pki/root.crt", sni:$sni, hostHeader:$hh, datasetId:$ds, expectedFingerprint:$fp, csp:$csp, edge:{host:$eh, port:$ep}, relay:{host:$rh, port:$rp},
        exportedSpec:"/frozen/docs/openapi/map-services-v1.json", ajvFrom:"/nm/package.json", outsiderAddress:$out, approvedAddress:$ok, controlHost:"localhost"}' > "$1"; }
  mkcfg "$LAB/relay-client.json" "$PUBLISH"; mkcfg "$LAB/relay-client-far.json" "$VM_OUT"
  runc O approved "$CLIENTS" "$CLIENT_IP" approved; rc=$?
  [ $rc -eq 0 ] && result PASS RR4 "approved client $CLIENT_IP via the rehearsal VM's LAN address and the edge: $(grep -c ^PASS "$OUT/r-approved.log") checks (TLS name/fingerprint, web, docs+CSP, spec, API, map assets, 421, spoofed headers, diagnostics, 413, direct bypass)" || result FAIL RR4 "$(fl approved)"
  runc O near-outsider "$CLIENTS" "$NEAR_OUTSIDER" outsider; rc=$?
  [ $rc -eq 0 ] && result PASS RR5 "outsider $NEAR_OUTSIDER on the same segment, outside the approved /25: no response on 8 path classes, also with spoofed forwarding headers" || result FAIL RR5 "$(fl near-outsider)"
  runc O far-outsider "$OUTSIDE" "$FAR_OUTSIDER" outsider "$LAB/relay-client-far.json"; rc=$?
  [ $rc -eq 0 ] && result PASS RR6 "outsider $FAR_OUTSIDER on another segment: nothing is published on the rehearsal VM's address there" || result FAIL RR6 "$(fl far-outsider)"
  runc docker forger "$NET" "" forger; rc=$?
  [ $rc -eq 0 ] && result PASS RR7 "untrusted lab peer forging the approved client: 403 on 8 path classes; missing/malformed PROXY: no response; ordinary listener unreachable from the lab network" || result FAIL RR7 "$(fl forger)"
  runc docker control "container:$HOST" "" control; rc=$?
  [ $rc -eq 0 ] && result PASS RR8 "ordinary loopback control listener still serves without PROXY" || result FAIL RR8 "$(fl control)"
  docker logs seyra-rh-edge > "$OUT/r-edge.log" 2>&1
fi

if has egress; then
  hip="$(host_ip)"; eip="$(cat "$OUT/.edge-ip")"
  sinkgw="$(docker network inspect "$NET" -f '{{(index .IPAM.Config 0).Subnet}}' | sed -E 's#\.[0-9]+/[0-9]+$#.250#')"
  sinks=()
  for spec in "$CLIENTS 198.18.10.250" "$PRIVATE 10.250.0.10"; do
    set -- $spec; n="seyra-rh-sink-$1"
    O run -d --rm --name "$n" --label "$LABEL" --label seyra.egress-test=1 --network "$1" --ip "$2" --cap-drop ALL --entrypoint sh "$GUARD_IMAGE" -c 'nc -lk -p 9 -e true' >/dev/null && sinks+=("$n")
  done
  APPROVED_SAMPLE="$CLIENT_IP" SINK_GATEWAY="$sinkgw" CONTROLLED_SINKS="198.18.10.250:9 10.250.0.10:9" HOST_CONTROL="$eip:8443" \
    bash "$F/tests/offline/namespace-egress.sh" "$OUT/egress" "$HOST" seyra-rh-edge "$hip:$RELAY_PORT" "$GUARD_IMAGE" > "$OUT/egress.log" 2>&1; rc=$?
  # The outer sinks are reachable from the rehearsal VM itself, so a refusal from its namespaces is
  # the namespace's own doing, not a missing segment.
  vm_reach="$(O exec "$VM" sh -c 'nc -w 3 -z 198.18.10.250 9; echo rc=$?; nc -w 3 -z 10.250.0.10 9; echo rc=$?' 2>&1 | paste -sd' ')"
  sinks_rm=0; for s in "${sinks[@]}"; do O rm -f "$s" >/dev/null 2>&1 || sinks_rm=$((sinks_rm + 1)); done
  [ $rc -eq 0 ] && result PASS RE1 "namespace egress (host + edge; route lookups, sink evidence, documentation addresses, own-network and outer controlled sinks, guard counter, allowed upstream): $(grep -c ^PASS "$OUT/egress/summary.txt") checks" || result FAIL RE1 "$(grep ^FAIL "$OUT/egress/summary.txt" | head -3 | tr '\n' ' ')"
  # The refusals above count only if the same sinks are reachable from the rehearsal VM itself.
  [ "${#sinks[@]}" = 2 ] && [ "$vm_reach" = "rc=0 rc=0" ] && [ "$sinks_rm" = 0 ] && result PASS RE2 "both controlled sinks were started, reachable from the rehearsal VM itself ($vm_reach) and removed" \
    || result FAIL RE2 "controlled sinks: started=${#sinks[@]}/2 reach='$vm_reach' removal_failures=$sinks_rm"
fi

if has rollback; then
  b1="$(cat "$OUT/.backup-fixture")"
  edge_running() { docker container inspect -f '{{.State.Running}}' seyra-rh-edge 2>/dev/null; }
  # Relay trust as persisted and applied, read successfully (an unreadable file is never "absent").
  relay_state() { # -> "settings=<peer> runtime=<peer> running=<peer> published=<0|1>" or "unreadable: ..."
    local st rt env pid pub
    st="$(jq -er '.relayPeer // ""' "$SEYRA_HOME/state/settings.json" 2>&1)" || { echo "unreadable: settings.json ($st)"; return 1; }
    rt="$(docker exec "$HOST" cat "$SEYRA_HOME/state/runtime.env" 2>&1)" || { echo "unreadable: state/runtime.env ($rt)"; return 1; }
    grep -q '^SEYRA_DATASET_ID=' <<<"$rt" || { echo "unreadable: state/runtime.env has no SEYRA_DATASET_ID"; return 1; }
    rt="$(sed -n 's/^SEYRA_RELAY_PEER=//p' <<<"$rt" | tr -d '"')"
    pid="$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=proxy 2>&1)" || { echo "unreadable: proxy ($pid)"; return 1; }
    env="$(D container inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$pid" 2>&1)" || { echo "unreadable: proxy env"; return 1; }
    env="$(sed -n 's/^SEYRA_RELAY_PEER=//p' <<<"$env")"
    pub="$(D container inspect -f '{{json .HostConfig.PortBindings}}' "$pid" 2>&1)" || { echo "unreadable: proxy ports"; return 1; }
    echo "settings=$st runtime=$rt running=$env published=$(grep -c '"8444/tcp"' <<<"$pub")"
  }
  edge_stop() { bash "$F/infra/edge/edge.sh" "$LAB/edge.env" stop > "$OUT/$1.log" 2>&1; }
  # RB0: trust configured and applied, proxy running: ordinary stop refused.
  edge_stop rb0-edge-stop-refused; rc=$?
  if [ $rc -eq 2 ] && grep -q 'refusing to stop' "$OUT/rb0-edge-stop-refused.log" && [ "$(edge_running)" = true ]; then
    result PASS RB0 "edge.sh stop refused while settings and the running proxy still trusted the edge address (edge kept running, address held)"
  else result FAIL RB0 "rc=$rc running=$(edge_running)"; fi
  # RB0a (review R2 case): the proxy stopped with the trust still configured. The relay port is
  # closed, which proved nothing: stop must still be refused. The same proxy container is then
  # started again (an intentional test outage, measured as a transition).
  pxy="$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=proxy)"
  proxy_down_check() { # label: stop the proxy, attempt an ordinary edge stop, start the same proxy again
    D stop -t 10 "$pxy" >/dev/null || return 1
    echo "proxy_state=$(D container inspect -f '{{.State.Status}}' "$pxy")" > "$OUT/$1.rc"
    edge_stop "$1"; echo "edge_stop_rc=$?" >> "$OUT/$1.rc"
    D start "$pxy" >/dev/null; }
  transition t4a-proxy-down-refusal proxy_down_check rb0a-edge-stop-proxy-down; rc=$?
  line="$(tline t4a-proxy-down-refusal)"
  if [ $rc -eq 0 ] && grep -q 'proxy_state=exited' "$OUT/rb0a-edge-stop-proxy-down.rc" && grep -q 'edge_stop_rc=2' "$OUT/rb0a-edge-stop-proxy-down.rc" && grep -q 'refusing to stop' "$OUT/rb0a-edge-stop-proxy-down.log" && [ "$(edge_running)" = true ] && grep -q 'final=200' <<<"$line"; then
    result PASS RB0a "proxy stopped with the trust still configured (relay port closed): edge stop refused ($(sed -n 's/^edge: refusing to stop: \(.*\)\. Stopping would.*/\1/p' "$OUT/rb0a-edge-stop-proxy-down.log")), edge kept; the same proxy started again; $line"
  else result FAIL RB0a "rc=$rc $(paste -sd' ' "$OUT/rb0a-edge-stop-proxy-down.rc" 2>/dev/null) running=$(edge_running) $line"; fi
  # RB0b: trust removed from settings and runtime.env but not yet applied (proxy not restarted).
  cli init --no-relay --server-names "localhost 127.0.0.1" > "$OUT/t4-init-no-relay.log" 2>&1 && cli access apply >> "$OUT/t4-init-no-relay.log" 2>&1; rc=$?
  edge_stop rb0b-edge-stop-not-applied; src=$?
  if [ $rc -eq 0 ] && [ $src -eq 2 ] && grep -q 'running proxy still trusts' "$OUT/rb0b-edge-stop-not-applied.log" && [ "$(edge_running)" = true ]; then
    result PASS RB0b "trust removed from settings/runtime.env but not applied (proxy not restarted): edge stop refused, edge kept"
  else result FAIL RB0b "init/apply rc=$rc stop rc=$src running=$(edge_running)"; fi
  # RB1: apply (proxy restart) while the edge still holds its address (DEPLOYMENT_PLAN §4.1).
  transition t4-rollback-relay cli proxy restart; rc=$?
  line="$(tline t4-rollback-relay)"
  state="$(relay_state)"; srs=$?
  echo "$state" > "$OUT/rb1-relay-state.txt"
  if [ $rc -eq 0 ] && [ $srs -eq 0 ] && [ "$state" = "settings= runtime= running= published=0" ] && [ "$(edge_running)" = true ] && grep -q 'final=200' <<<"$line"; then
    result PASS RB1 "relay trust removed from settings, state/runtime.env and the running proxy, relay port unpublished, all read successfully, while the edge still held its address; $line"
  else result FAIL RB1 "rc=$rc state_read=$srs [$state] edge_running=$(edge_running) $line"; fi
  runc docker closed "$NET" "" closed; rc=$?
  [ $rc -eq 0 ] && result PASS RB2 "after the relay rollback the relay listener answers nobody on the lab network" || result FAIL RB2 "$(fl closed)"
  # RB1a: trust removed and applied, but the proxy is down: its state on start is unproven, so the
  # ordinary stop must still refuse (the proxy-state branch of the evidence), then the proxy returns.
  pxy="$(D ps -q --filter label=com.docker.compose.project=seyra --filter label=com.docker.compose.service=proxy)"
  transition t4b-proxy-down-after-removal proxy_down_check rb1a-edge-stop-proxy-down; rc=$?
  line="$(tline t4b-proxy-down-after-removal)"
  if [ $rc -eq 0 ] && grep -q 'proxy_state=exited' "$OUT/rb1a-edge-stop-proxy-down.rc" && grep -q 'edge_stop_rc=2' "$OUT/rb1a-edge-stop-proxy-down.rc" && grep -q 'not plainly running' "$OUT/rb1a-edge-stop-proxy-down.log" && [ "$(edge_running)" = true ] && grep -q 'final=200' <<<"$line"; then
    result PASS RB1a "trust removed and applied, then the proxy stopped: edge stop refused (proxy not plainly running), edge kept; the same proxy started again; $line"
  else result FAIL RB1a "rc=$rc $(paste -sd' ' "$OUT/rb1a-edge-stop-proxy-down.rc" 2>/dev/null) running=$(edge_running) $line"; fi
  # RB3: now the evidence holds; the edge stops and is removed.
  edge_stop rb3-edge-stop && bash "$F/infra/edge/edge.sh" "$LAB/edge.env" remove > "$OUT/rb3-edge-remove.log" 2>&1; rc=$?
  if [ $rc -eq 0 ] && grep -q 'relay trust for .* removed' "$OUT/rb3-edge-stop.log" && ! docker container inspect seyra-rh-edge >/dev/null 2>&1; then result PASS RB3 "edge stopped on positive trust-removal evidence ($(sed -n 's/^edge: relay trust for [^ ]* removed: //p' "$OUT/rb3-edge-stop.log" | cut -c1-120)) and removed"; else result FAIL RB3 "edge stop/remove rc=$rc"; fi
  # RB4: certificate rollback with tls restore from the fixture backup (root-only previous-* dir).
  rollback_tls() { cli tls restore --from "$b1" && cli proxy restart; }
  transition t5-rollback-tls rollback_tls; rc=$?
  line="$(tline t5-rollback-tls)"
  fpn="$(fp_file "$SEYRA_HOME/secrets/tls/server.crt")"; can="$(docker exec "$HOST" sha256sum "$SEYRA_HOME/secrets/tls/ca.crt" | cut -c1-64)"
  served="$(node_in_host fingerprint)"
  if [ $rc -eq 0 ] && [ "$fpn" = "$(cat "$OUT/.fixture-fingerprint")" ] && [ "$served" = "$fpn" ] && [ "$can" = "$(cat "$OUT/.fixture-ca-sha")" ] && grep -q 'final=200' <<<"$line"; then
    result PASS RB4 "tls restore re-installed the fixture certificate and CA from the root-only backup; the proxy serves it; $line"
  else result FAIL RB4 "rc=$rc cert_restored=$([ "$fpn" = "$(cat "$OUT/.fixture-fingerprint")" ] && echo y || echo n) served=$served $line"; fi
  # RB5: software rollback to the old bundle: verified install copy + verified image load, then start.
  rollback_software() {
    local o="$LAB/transfer/old"; rm -rf "$o"; cp -al "$OLD_BUNDLE" "$o" || return 1
    docker exec "$HOST" rm -rf "$inst.rollback" && cp -a "$o/install" "$inst.rollback" \
      && (cd "$inst.rollback" && sed -n -E 's#^([0-9a-f]{64})  install/#\1  #p' "$o/SHA256SUMS" | sha256sum --quiet --strict -c -) \
      && docker exec "$HOST" rm -rf "$inst" && mv "$inst.rollback" "$inst" && cli bootstrap-load "$o" && cli verify-images && cli start; }
  transition t6-rollback-software rollback_software; rc=$?
  line="$(tline t6-rollback-software)"
  ops_now="$(D image inspect -f '{{.Id}}' "$(jq -r '.images.ops.ref' "$inst/infra/dependencies.lock.json")")"
  if [ $rc -eq 0 ] && grep -q 'final=200' <<<"$line" && grep -q 'identities_equal=yes' <<<"$line" && [ "$ops_now" = "$(jq -r '.images.ops.image_id' "$OLD_BUNDLE/install/infra/dependencies.lock.json")" ]; then
    result PASS RB5 "software rollback to the old bundle (images verified, old OPS identity): $line"
  else result FAIL RB5 "rc=$rc ops=$ops_now $line"; fi
fi

if has cleanup; then
  rm -f "$OUT/.expect-ready"
  # Retention policy: $OUT (evidence, including the frozen harness copy) is always kept; nothing else
  # of this lab is. Every required removal, the final inventory and the outer route comparison count
  # in the verdict (review c73db85 R4). Objects that are not positively this lab's are never removed;
  # they are reported. The VM's firewall and routing are never changed to make this pass.
  : > "$OUT/cleanup-failures.txt"; : > "$OUT/cleanup-notes.txt"
  cfail() { echo "$1" | tee -a "$OUT/cleanup-failures.txt" >/dev/null; }
  cnote() { echo "$1" >> "$OUT/cleanup-notes.txt"; }
  out="$(O container inspect -f '{{index .Config.Labels "seyra.validation.lab"}}' "$VM" 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && [ "$out" = "$LAB" ]; then
    if own "$HOST" 2>/dev/null; then
      docker exec "$HOST" sh -c "docker ps -q | xargs -r docker stop -t 20 >/dev/null; rm -rf '$SEYRA_HOME' '$inst' '$inst.rollback' '$inst.incoming' '$LAB/work' '$LAB/transfer' '$LAB/backup' '$LAB/secrets-backup'" > "$OUT/rc1-inner.log" 2>&1 \
        || cfail "inner removal on $HOST failed (rc1-inner.log)"
    fi
    out="$(O rm -f "$VM" 2>&1)" || cfail "removing $VM failed ($out)"
  elif [ $rc -eq 0 ]; then cnote "$VM exists but is not this lab's (label '$out'); left untouched"
  elif ! grep -qi 'no such' <<<"$out"; then cfail "cannot inspect $VM ($out)"; fi
  if ids="$(O ps -aq --filter "label=$LABEL" 2>&1)"; then
    for c in $ids; do out="$(O rm -f "$c" 2>&1)" || cfail "removing container $c failed ($out)"; done
  else cfail "cannot list this lab's containers ($ids)"; fi
  out="$(O volume inspect -f '{{index .Labels "seyra.validation.lab"}}' "$VMVOL" 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && [ "$out" = "$LAB" ]; then out="$(O volume rm "$VMVOL" 2>&1)" || cfail "removing volume $VMVOL failed ($out)"
  elif [ $rc -eq 0 ]; then cnote "volume $VMVOL is not this lab's (label '$out'); left untouched"
  elif ! grep -qi 'no such volume' <<<"$out"; then cfail "cannot inspect volume $VMVOL ($out)"; fi
  for n in "$CLIENTS" "$OUTSIDE" "$PRIVATE"; do
    out="$(O network inspect -f '{{index .Labels "seyra.validation.lab"}}' "$n" 2>&1)"; rc=$?
    if [ $rc -eq 0 ] && [ "$out" = "$LAB" ]; then out="$(O network rm "$n" 2>&1)" || cfail "removing network $n failed ($out)"
    elif [ $rc -eq 0 ]; then cnote "network $n is not this lab's (label '$out'); left untouched"
    elif ! grep -qi 'not found\|no such' <<<"$out"; then cfail "cannot inspect network $n ($out)"; fi
  done
  for p in run vm-run pki edge edge.env relay-client.json relay-client-far.json; do out="$(rm -rf "${LAB:?}/$p" 2>&1)" || cfail "removing $LAB/$p failed ($out)"; done
  if [ -e "$LAB" ]; then out="$(rmdir "$LAB" 2>&1)" || cfail "lab directory not removed ($out; left: $(ls -A "$LAB" 2>&1 | head -5 | paste -sd' '))"; fi
  # Final inventory of this lab's objects (each query must succeed and be empty).
  for kind in "ps -aq" "network ls -q" "volume ls -q"; do
    out="$(O $kind --filter "label=$LABEL" 2>&1)" || { cfail "inventory '$kind' failed ($out)"; continue; }
    [ -z "$out" ] || cfail "remaining $kind objects of this lab: $(echo $out)"
  done
  if out="$(ip -4 route 2>&1)"; then
    echo "$out" > "$OUT/vm-routes-final.txt"
    if [ -s "$OUT/vm-routes-before.txt" ]; then cmp -s "$OUT/vm-routes-before.txt" "$OUT/vm-routes-final.txt" || cfail "the outer VM routing table CHANGED (vm-routes-before.txt vs vm-routes-final.txt)"
    else cfail "no outer route baseline (vm-routes-before.txt) to compare"; fi
  else cfail "cannot read the outer VM routing table ($out)"; fi
  nf="$(grep -c . "$OUT/cleanup-failures.txt")"
  notes="$( [ -s "$OUT/cleanup-notes.txt" ] && echo "; preserved non-lab objects: $(paste -sd';' "$OUT/cleanup-notes.txt")")"
  if [ "$nf" = 0 ]; then result PASS RC1 "cleanup: every owned object removed; inventory empty (containers, networks, volumes); lab directory removed; outer routes unchanged; evidence kept in OUT$notes"
  else result FAIL RC1 "cleanup: $nf failure(s): $(head -3 "$OUT/cleanup-failures.txt" | paste -sd';')$notes"; fi
fi
finish
