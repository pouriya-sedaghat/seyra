# Undo Add-RootTrust.ps1: removes ONLY the root this workflow added to Cert:\CurrentUser\Root.
# The record must be intact, belong to this Windows account and name the exact root; the store entry
# must have the recorded thumbprint AND SHA-256. A root that already existed before Add-RootTrust.ps1
# is left in place. Windows asks for confirmation when deleting from the Root store. The record is
# then archived as root-trust-record.removed-<time>.json.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Remove-RootTrust.ps1 [-Base <dir>]
[CmdletBinding()]
param([string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = [IO.Path]::GetFullPath((Get-SeyraBase $Base))
$acct = Get-SeyraAccount
Assert-SeyraPkiFolder $Base
$trust = Join-Path $Base 'trust'
$recordPath = Join-Path $trust 'root-trust-record.json'

$lock = Open-SeyraLock (Join-Path $trust 'trust.lock')
try {
    if (-not (Test-Path -LiteralPath $recordPath)) { throw "no trust record at ${recordPath}: nothing to undo (this script removes only a root recorded by Add-RootTrust.ps1)" }
    Assert-SeyraWritable $trust
    $r = Read-SeyraTrustRecord $recordPath $acct.Sid ''
    $present = Test-SeyraRootPresent $r.thumbprint_sha1 $r.sha256
    if ($r.pre_existing) {
        Write-Host ("this root ({0}) existed before Add-RootTrust.ps1; it is left in Cert:\CurrentUser\Root" -f $r.thumbprint_sha1)
    } elseif ($present) {
        Write-Host ("removing {0} ({1}) from Cert:\CurrentUser\Root; Windows will ask for confirmation" -f $r.thumbprint_sha1, $r.subject)
        $removeError = $null
        try { Remove-SeyraRootStoreEntry $r.thumbprint_sha1 } catch { $removeError = $_.Exception.Message }
        if (Test-SeyraRootPresent $r.thumbprint_sha1 $r.sha256) { throw "the root is still in Cert:\CurrentUser\Root (nothing changed; the record is kept): $removeError" }
        Write-Host '  ok  root removed from Cert:\CurrentUser\Root'
    } else {
        Write-Host 'the root is not in Cert:\CurrentUser\Root (already removed, or the import never took effect)'
    }
    $archived = Join-Path $trust ('root-trust-record.removed-{0}-{1}.json' -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'), [guid]::NewGuid().ToString('N').Substring(0, 8))
    [IO.File]::Move($recordPath, $archived)
    Write-Host "record archived: $archived"
} finally {
    $lock.Dispose()
}
Write-Host 'done; restart browsers so they drop cached trust.'
