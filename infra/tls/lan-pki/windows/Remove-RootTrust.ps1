# Undo Add-RootTrust.ps1: removes ONLY the root it added from Cert:\CurrentUser\Root, after checking
# the store entry's SHA-256 equals the record. A root that already existed before is left alone.
# Windows asks for confirmation when deleting from the Root store.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Remove-RootTrust.ps1 [-Base <dir>]
[CmdletBinding()]
param([string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
$record = Join-Path $Base 'trust\root-trust-record.json'
$r = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
if ($r.pre_existing) { throw 'this root existed before Add-RootTrust.ps1; not removing it' }
$entry = @(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $r.thumbprint_sha1 })
if ($entry.Count -eq 0) { Write-Host 'the root is not in Cert:\CurrentUser\Root (already removed)' }
else {
    Assert-Seyra ((Get-SeyraSha256Hex $entry[0].RawData) -eq $r.sha256) 'store entry SHA-256 equals the recorded root'
    Remove-Item -LiteralPath ('Cert:\CurrentUser\Root\{0}' -f $r.thumbprint_sha1)
    Assert-Seyra (@(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $r.thumbprint_sha1 }).Count -eq 0) 'root removed from Cert:\CurrentUser\Root'
}
Rename-Item -LiteralPath $record -NewName ('root-trust-record.removed-{0}.json' -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
Write-Host 'done; restart browsers so they drop cached trust.'
