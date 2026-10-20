# TLS check with the EXPLICIT root file (no Windows trust store involved): step connects to the
# service, verifies the served chain against root_ca.crt and the IP/name in the URL, and this script
# checks that the server sends leaf + issuing CA and that they are exactly the packet's certificates.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-SeyraTls.ps1 -Url https://<VM_LAN_ADDR>:<PORT> -PacketDir <public\stamp> [-Base <dir>]
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$PacketDir, [string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
$step = Get-SeyraStep $Base
$m = Get-Content -LiteralPath (Join-Path $PacketDir 'issued-manifest.json') -Raw | ConvertFrom-Json
$root = Join-Path $PacketDir 'root_ca.crt'
Assert-Seyra ((Get-SeyraFileSha256 (Join-Path $PacketDir 'root_ca.cer')) -eq $m.root_ca.sha256_fingerprint) 'packet root matches its manifest'
# step verifies the chain to --roots and the URL's host (IP SAN) during the handshake; failure exits non-zero.
$json = Invoke-SeyraStepText $step @('certificate', 'inspect', $Url, '--roots', $root, '--bundle', '--format', 'json')
$served = @($json | ConvertFrom-Json)
Assert-Seyra ($served.Count -ge 2) "server sends its chain ($($served.Count) certificates)"
Assert-Seyra ($served[0].fingerprint_sha256 -eq $m.leaf.sha256_fingerprint) 'served leaf is the issued certificate'
Assert-Seyra ($served[1].fingerprint_sha256 -eq $m.issuing_ca.sha256_fingerprint) 'served intermediate is the issuing CA'
Write-Host ("PASS TLS {0}: chain verified against the Seyra root with hostname/IP verification" -f $Url)
