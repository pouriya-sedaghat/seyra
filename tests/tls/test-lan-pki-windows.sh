#!/usr/bin/env bash
# Regression for infra/tls/lan-pki/windows (the owner's Windows issuer/trust scripts), run on Linux:
#   1. every .ps1/.psm1 parses (PowerShell 7 parser);
#   2. the verification module accepts a correct root -> issuing CA -> server-only leaf built with the
#      pinned step CLI and the shipped server-leaf.tpl, and REJECTS wrong material: a clientAuth leaf,
#      an extra DNS SAN, a wrong IP, a too-long leaf, a leaf outliving its issuer, a leaf for another
#      key, wrong CA path lengths/kinds, an unencrypted issuer key, a CSR with an extra SAN, a CSR
#      whose file hash or public key differs from the request manifest, a manifest with a DNS name.
#   3. the ACTUAL scripts New-PkiFolder / Add-RootTrust / Remove-RootTrust / New-RootCa run as separate
#      processes against a controlled boundary (tests/tls/lan-pki-test-boundary.ps1: fixture profile with
#      an NTFS-like ACL model, a directory as Cert:\CurrentUser\Root, fault injection), covering review
#      f5bd978 R1 (unsafe Base, foreign/inherited/deny entries, foreign owner, links, reuse) and R2
#      (pending record before import, lock, interruption and reconciliation, exact undo, pre-existing
#      roots, tampered or foreign records): tests/tls/lan-pki-windows-scripts.tests.ps1.
# Test-only keys/passwords are generated in a temporary directory (password FILES are used only
# here; the real scripts always prompt). Real NTFS ACLs, the real Cert:\CurrentUser\Root store,
# Authenticode and the step.exe download are NOT exercised: they need a real Windows PC
# (tests/tls/windows/Test-LanPkiOnWindows.ps1).
#
#   STEP_LINUX=/abs/step PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 DOCKER_RUN_IMAGE=docker:29.8.2-dind \
#     tests/tls/test-lan-pki-windows.sh
set -uo pipefail
: "${STEP_LINUX:?path to the pinned Linux step binary}" "${PWSH_IMAGE:?}" "${DOCKER_RUN_IMAGE:?image with sh for running step}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
w="$(mktemp -d)"; trap 'rm -rf "$w"' EXIT
mkdir -p "$w/pki" "$w/bin"; cp "$STEP_LINUX" "$w/bin/step"; chmod 0755 "$w/bin/step"
cp "$repo/infra/tls/lan-pki/windows/server-leaf.tpl" "$w/pki/"
cat > "$w/pki/build.sh" <<'EOF'
set -eu
S=/w/bin/step; cd /w/pki
printf 'r\n' > pw.root; printf 'i\n' > pw.int
csr() { openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$1.key" -out "$1.csr" -subj "/CN=$2" -addext "subjectAltName=$3" -addext extendedKeyUsage=serverAuth -addext keyUsage=critical,digitalSignature -addext basicConstraints=critical,CA:FALSE 2>/dev/null; }
$S certificate create "Seyra LAN Root CA" root_ca.crt root_ca.key --profile root-ca --kty EC --curve P-256 --not-after 43800h --password-file pw.root >/dev/null
$S certificate create "Seyra LAN Issuing CA 2026" intermediate_ca.crt intermediate_ca.key --profile intermediate-ca --ca root_ca.crt --ca-key root_ca.key --ca-password-file pw.root --kty EC --curve P-256 --not-after 8760h --password-file pw.int >/dev/null
$S certificate create "Plain Issuing" plain_int.crt plain_int.key --profile intermediate-ca --ca root_ca.crt --ca-key root_ca.key --ca-password-file pw.root --kty EC --curve P-256 --not-after 8760h --no-password --insecure >/dev/null
$S certificate create "Short Issuing" short_int.crt short_int.key --profile intermediate-ca --ca root_ca.crt --ca-key root_ca.key --ca-password-file pw.root --kty EC --curve P-256 --not-after 720h --password-file pw.int >/dev/null
csr good 198.18.0.76 IP:198.18.0.76
csr extra 198.18.0.76 IP:198.18.0.76,DNS:extra.example.test
csr other 198.18.0.76 IP:198.18.0.76
sign() { $S certificate sign "$1" "${4:-intermediate_ca.crt}" "${5:-intermediate_ca.key}" --template "$2" --set ip="${3:-198.18.0.76}" --not-before -5m --not-after "${6:-2160h}" --password-file pw.int > "$7"; }
sign good.csr server-leaf.tpl 198.18.0.76 intermediate_ca.crt intermediate_ca.key 2160h leaf-good.crt
sign good.csr server-leaf.tpl 198.18.0.99 intermediate_ca.crt intermediate_ca.key 2160h leaf-wrongip.crt
sign good.csr server-leaf.tpl 198.18.0.76 intermediate_ca.crt intermediate_ca.key 2880h leaf-long.crt
sign good.csr server-leaf.tpl 198.18.0.76 short_int.crt short_int.key 2160h leaf-outlives.crt
sign other.csr server-leaf.tpl 198.18.0.76 intermediate_ca.crt intermediate_ca.key 2160h leaf-otherkey.crt
$S certificate sign good.csr intermediate_ca.crt intermediate_ca.key --not-after 2160h --password-file pw.int > leaf-clientauth.crt
$S certificate sign extra.csr intermediate_ca.crt intermediate_ca.key --not-after 2160h --password-file pw.int > leaf-extradns.crt
$S certificate create "Other Root" other_root.crt other_root.key --profile root-ca --kty EC --curve P-256 --not-after 43800h --no-password --insecure >/dev/null
$S certificate format root_ca.crt --out root_ca.cer >/dev/null; $S certificate format other_root.crt --out other_root.cer >/dev/null
EOF
docker run --rm --network none -u "$(id -u):$(id -g)" -v "$w:/w" --entrypoint sh "$DOCKER_RUN_IMAGE" /w/pki/build.sh || { echo "FAIL building the test PKI"; exit 1; }
manifest() { # name csr ip dns -> request manifest for that CSR
  local spki sha; sha="$(sha256sum "$w/pki/$2" | cut -c1-64)"; spki="$(openssl req -in "$w/pki/$2" -noout -pubkey | openssl pkey -pubin -outform DER | sha256sum | cut -c1-64)"
  jq -n --arg ip "$3" --arg sha "$sha" --arg spki "$spki" --argjson dns "$4" '{schema:"seyra.lan-csr-request/1", sans:[{type:"ip", value:$ip}], dns_names:$dns, spki_sha256:$spki, csr_file:"server.csr", csr_file_sha256:$sha}' > "$w/pki/$1"; }
manifest m-good.json good.csr 198.18.0.76 '[]'
manifest m-extra.json extra.csr 198.18.0.76 '[]'
manifest m-dns.json good.csr 198.18.0.76 '["map.example.test"]'
jq '.csr_file_sha256 = "0000000000000000000000000000000000000000000000000000000000000000"' "$w/pki/m-good.json" > "$w/pki/m-badhash.json"
jq --arg s "$(sha256sum "$w/pki/good.csr" | cut -c1-64)" '.csr_file_sha256 = $s' "$w/pki/m-good.json" > /dev/null
manifest m-otherkey.json other.csr 198.18.0.76 '[]'; jq --arg s "$(sha256sum "$w/pki/good.csr" | cut -c1-64)" '.csr_file_sha256 = $s' "$w/pki/m-otherkey.json" > "$w/pki/m-wrongspki.json"
cp -r "$repo/infra/tls/lan-pki/windows" "$w/win"
cp "$repo/tests/tls/lan-pki-test-boundary.ps1" "$repo/tests/tls/lan-pki-windows-scripts.tests.ps1" "$w/"
cat > "$w/test.ps1" <<'EOF'
$ErrorActionPreference = 'Stop'
$env:SEYRA_STEP_EXE = '/w/bin/step'
$fails = 0; $n = 0
function T([string]$Name, [bool]$WantOk, [scriptblock]$Body) {
    $script:n++
    $ok = $true; $msg = ''
    try { & $Body *> $null } catch { $ok = $false; $msg = $_.Exception.Message }
    if ($ok -eq $WantOk) { Write-Output ("PASS {0}" -f $Name) } else { $script:fails++; Write-Output ("FAIL {0} -- expected {1}, got {2} {3}" -f $Name, $(if ($WantOk) { 'accept' } else { 'reject' }), $(if ($ok) { 'accept' } else { 'reject' }), $msg) }
}
foreach ($f in Get-ChildItem /w/win -Include *.ps1, *.psm1 -Recurse) {
    $errs = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
    T "parses: $($f.Name)" $true { if ($errs.Count) { throw ($errs | ForEach-Object { $_.Message }) -join '; ' } }.GetNewClosure()
}
Import-Module /w/win/SeyraPki.psm1 -Force
$S = Get-SeyraStep
$P = '/w/pki'
$m = Get-Content "$P/m-good.json" -Raw | ConvertFrom-Json
$root = $null; $int = $null
T 'root accepted (pathlen 1, 5 years, self-signed)' $true { $script:root = Test-SeyraCaCert -Step $S -Path "$P/root_ca.crt" -Kind root }
T 'issuing CA accepted (pathlen 0, 1 year, issued by root)' $true { $script:int = Test-SeyraCaCert -Step $S -Path "$P/intermediate_ca.crt" -Kind issuing -Issuer $root }
T 'issuing CA rejected as a root' $false { Test-SeyraCaCert -Step $S -Path "$P/intermediate_ca.crt" -Kind root }
T 'root rejected as an issuing CA' $false { Test-SeyraCaCert -Step $S -Path "$P/root_ca.crt" -Kind issuing -Issuer $root }
T 'short (30-day) issuing CA rejected' $false { Test-SeyraCaCert -Step $S -Path "$P/short_int.crt" -Kind issuing -Issuer $root }
T 'encrypted issuer key accepted' $true { Test-SeyraKeyEncrypted "$P/intermediate_ca.key" }
T 'unencrypted issuer key rejected' $false { Test-SeyraKeyEncrypted "$P/plain_int.key" }
T 'CSR matching its manifest accepted' $true { Test-SeyraCsr -Step $S -Csr "$P/good.csr" -Manifest $m }
T 'CSR with an extra DNS SAN rejected' $false { Test-SeyraCsr -Step $S -Csr "$P/extra.csr" -Manifest (Get-Content "$P/m-extra.json" -Raw | ConvertFrom-Json) }
T 'CSR whose file hash differs from the manifest rejected' $false { Test-SeyraCsr -Step $S -Csr "$P/good.csr" -Manifest (Get-Content "$P/m-badhash.json" -Raw | ConvertFrom-Json) }
T 'CSR whose public key differs from the manifest rejected' $false { Test-SeyraCsr -Step $S -Csr "$P/good.csr" -Manifest (Get-Content "$P/m-wrongspki.json" -Raw | ConvertFrom-Json) }
T 'manifest naming a DNS name rejected' $false { Get-SeyraExpectedIp (Get-Content "$P/m-dns.json" -Raw | ConvertFrom-Json) }
T 'server-only leaf (shipped template) accepted' $true { Test-SeyraLeafCert -Step $S -Path "$P/leaf-good.crt" -Issuer $int -Manifest $m }
T 'leaf with clientAuth (default step profile) rejected' $false { Test-SeyraLeafCert -Step $S -Path "$P/leaf-clientauth.crt" -Issuer $int -Manifest $m }
T 'leaf with an extra DNS SAN rejected' $false { Test-SeyraLeafCert -Step $S -Path "$P/leaf-extradns.crt" -Issuer $int -Manifest $m }
T 'leaf for another IP rejected' $false { Test-SeyraLeafCert -Step $S -Path "$P/leaf-wrongip.crt" -Issuer $int -Manifest $m }
T 'leaf longer than 90 days rejected' $false { Test-SeyraLeafCert -Step $S -Path "$P/leaf-long.crt" -Issuer $int -Manifest $m }
T 'leaf for another key rejected' $false { Test-SeyraLeafCert -Step $S -Path "$P/leaf-otherkey.crt" -Issuer $int -Manifest $m }
T 'leaf outliving its issuing CA rejected' $false { $si = Test-SeyraCaCert -Step $S -Path "$P/short_int.crt" -Kind issuing -Issuer $root -ErrorAction SilentlyContinue; Test-SeyraLeafCert -Step $S -Path "$P/leaf-outlives.crt" -Issuer (Get-SeyraCertInfo $S "$P/short_int.crt") -Manifest $m }
T 'leaf against the wrong issuer rejected' $false { Test-SeyraLeafCert -Step $S -Path "$P/leaf-good.crt" -Issuer $root -Manifest $m }
T 'directory with a private key detected' $false { Assert-SeyraNoPrivateKey $P }
Write-Output ("# lan-pki windows module: checks={0} failed={1}" -f $n, $fails)
exit $(if ($fails) { 1 } else { 0 })
EOF
docker run --rm --network none -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$w:/w" "$PWSH_IMAGE" pwsh -NoProfile -File /w/test.ps1; rc1=$?
docker run --rm --network none -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$w:/w" "$PWSH_IMAGE" pwsh -NoProfile -File /w/lan-pki-windows-scripts.tests.ps1; rc2=$?
[ $rc1 -eq 0 ] && [ $rc2 -eq 0 ]
