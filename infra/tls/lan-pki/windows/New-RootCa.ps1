# Create the Seyra LAN Root CA: EC P-256, CA with path length 1, 5 years. step asks for a NEW
# password for the root key (typed twice, locally); the key is written encrypted. Refuses to
# overwrite an existing root; an existing one is only inspected (reuse after these checks pass).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\New-RootCa.ps1 [-Base <dir>] [-Name "Seyra LAN Root CA"]
[CmdletBinding()]
param([string]$Base, [string]$Name = 'Seyra LAN Root CA', [switch]$CheckExisting)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
$step = Get-SeyraStep $Base
$crt = Join-Path $Base 'root\root_ca.crt'
$key = Join-Path $Base 'root\root_ca.key'

if ((Test-Path -LiteralPath $crt) -or (Test-Path -LiteralPath $key)) {
    if (-not $CheckExisting) { throw "a root already exists in $(Split-Path $crt); not overwriting it. Re-run with -CheckExisting to verify it for reuse." }
    Write-Host 'checking the EXISTING root for reuse:'
} else {
    Write-Host "creating $Name (you will be asked for a new root key password, twice)"
    & $step certificate create $Name $crt $key --profile root-ca --kty EC --curve P-256 --not-after 43800h
    if ($LASTEXITCODE -ne 0) { throw "step certificate create failed (exit $LASTEXITCODE)" }
}
if (-not ((Test-Path -LiteralPath $crt) -and (Test-Path -LiteralPath $key))) { throw 'root certificate or key file missing' }
$c = Test-SeyraCaCert -Step $step -Path $crt -Kind root
Test-SeyraKeyEncrypted $key
Write-Host ("root SHA-256 fingerprint: {0}" -f $c.fingerprint_sha256)
Write-Host ("root valid {0} .. {1}" -f $c.validity.start, $c.validity.end)
Write-Host 'Next: New-IssuingCa.ps1. Afterwards keep the root key encrypted and copy it to protected offline storage if you have one.'
