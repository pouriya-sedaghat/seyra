# Create the user-local SeyraPKI folder (default %LOCALAPPDATA%\SeyraPKI, which OneDrive does not
# sync) and restrict it with NTFS ACLs to the current user only (inheritance removed). Refuses a
# location under Desktop, Documents or OneDrive. Safe to re-run: it re-applies and prints the ACL.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\New-PkiFolder.ps1 [-Base <dir>]
#
# Note: a local administrator can still take ownership of any folder. This protects the encrypted
# issuer keys from other ordinary users and from sync/backup clients; it is not an HSM or air gap.
[CmdletBinding()]
param([string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = [IO.Path]::GetFullPath((Get-SeyraBase $Base))

$forbidden = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'))
foreach ($v in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) { if ($v) { $forbidden += $v } }
foreach ($f in $forbidden) {
    if ($f -and $Base.StartsWith($f.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "refusing ${Base}: it is under $f (synchronized or commonly shared)" }
}
if ($Base -match '(?i)onedrive|dropbox|google drive|icloud') { throw "refusing ${Base}: looks like a synchronized folder" }

New-Item -ItemType Directory -Force -Path $Base | Out-Null
foreach ($d in @('tools', 'root', 'issuing', 'requests', 'issued', 'public', 'trust')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Base $d) | Out-Null
}
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $Base /inheritance:r /grant:r ("{0}:(OI)(CI)F" -f $me) /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed (exit $LASTEXITCODE)" }
$acl = Get-Acl -LiteralPath $Base
$ids = @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
Write-Host "SeyraPKI folder: $Base"
Write-Host ("  access entries: {0}" -f ($ids -join ', '))
Write-Host ("  inheritance protected: {0}" -f $acl.AreAccessRulesProtected)
if (-not $acl.AreAccessRulesProtected -or $ids.Count -ne 1 -or $ids[0] -ne $me) { throw "ACL is not restricted to $me only; fix before creating keys" }
Write-Host "  ok  only $me has access"
