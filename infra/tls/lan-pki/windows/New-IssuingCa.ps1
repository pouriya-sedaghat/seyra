# Create the issuing (intermediate) CA from the root: EC P-256, CA with path length 0, 1 year.
# step asks first for the ROOT key password, then for a NEW issuing-key password (typed twice).
# Refuses to overwrite; -CheckExisting only verifies an existing issuing CA against the root.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\New-IssuingCa.ps1 [-Base <dir>] [-Name "Seyra LAN Issuing CA 2026"]
[CmdletBinding()]
param([string]$Base, [string]$Name = 'Seyra LAN Issuing CA 2026', [switch]$CheckExisting)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
$step = Get-SeyraStep $Base
$rootCrt = Join-Path $Base 'root\root_ca.crt'
$rootKey = Join-Path $Base 'root\root_ca.key'
$crt = Join-Path $Base 'issuing\intermediate_ca.crt'
$key = Join-Path $Base 'issuing\intermediate_ca.key'

$root = Test-SeyraCaCert -Step $step -Path $rootCrt -Kind root
if ((Test-Path -LiteralPath $crt) -or (Test-Path -LiteralPath $key)) {
    if (-not $CheckExisting) { throw "an issuing CA already exists in $(Split-Path $crt); not overwriting it. Re-run with -CheckExisting to verify it for reuse." }
    Write-Host 'checking the EXISTING issuing CA for reuse:'
} else {
    Write-Host "creating $Name (enter the ROOT key password, then a NEW issuing-key password twice)"
    & $step certificate create $Name $crt $key --profile intermediate-ca --ca $rootCrt --ca-key $rootKey --kty EC --curve P-256 --not-after 8760h
    if ($LASTEXITCODE -ne 0) { throw "step certificate create failed (exit $LASTEXITCODE)" }
}
if (-not ((Test-Path -LiteralPath $crt) -and (Test-Path -LiteralPath $key))) { throw 'issuing certificate or key file missing' }
$c = Test-SeyraCaCert -Step $step -Path $crt -Kind issuing -Issuer $root
Test-SeyraKeyEncrypted $key
& $step certificate verify $crt --roots $rootCrt
if ($LASTEXITCODE -ne 0) { throw 'the issuing CA does not verify against the root' }
Write-Host '  ok  issuing CA verifies against the root'
Write-Host ("issuing CA SHA-256 fingerprint: {0}; valid until {1}" -f $c.fingerprint_sha256, $c.validity.end)
Write-Host 'The root key is not needed again until the issuing CA is renewed: keep it encrypted, ideally offline.'
