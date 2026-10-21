# Create the user-local SeyraPKI folder (default %LOCALAPPDATA%\SeyraPKI, which OneDrive does not
# sync), private to the current Windows account, or check an existing one. Nothing outside the folder
# is changed, and an existing folder is never repaired:
#   1. before anything is created or changed, -Base is refused if it is in, equal to or above a
#      Desktop, Documents, OneDrive, roaming, temporary, public or system folder; equal to or above the
#      profile or %LOCALAPPDATA%; a network/device path; or reached through a link, junction or
#      network drive;
#   2. a NEW folder (created by this run) gets a protected owner-only access list on that one folder
#      (no inheritance from its parent, full control for you, nothing else); what is created inside
#      it inherits that;
#   3. an EXISTING folder must hold only the SeyraPKI subfolders; it is checked, not modified;
#   4. the whole tree (subfolders, issuer keys, tools) is checked without following links: owned by
#      you, no link or junction, no entry for anyone else (explicit or inherited), existing issuer
#      keys still encrypted. Any problem stops the run with the exact item and a remedy for that
#      item only (this script never takes ownership or changes permissions recursively).
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
$acct = Get-SeyraAccount
$managed = @(Get-SeyraManagedFolder)

$why = @(Test-SeyraBasePath $Base (Get-SeyraBasePolicy)) + @(Get-SeyraPathRedirection $Base)
if ($why.Count -gt 0) {
    throw ("refusing {0} (nothing was created or changed):`n  - {1}`nOmit -Base to use %LOCALAPPDATA%\SeyraPKI, or name a new dedicated folder." -f $Base, ($why -join "`n  - "))
}

if (Test-Path -LiteralPath $Base) {
    if (-not (Test-Path -LiteralPath $Base -PathType Container)) { throw "refusing ${Base}: it exists and is not a folder (nothing was changed)" }
    $foreign = @(Get-ChildItem -LiteralPath $Base -Force | Where-Object { $managed -notcontains $_.Name } | ForEach-Object { $_.Name })
    if ($foreign.Count -gt 0) { throw ("refusing {0}: it exists and is not a SeyraPKI folder (unexpected: {1}). Nothing was changed; use a new -Base." -f $Base, ($foreign -join ', ')) }
    Write-Host "existing folder $Base (checked, not modified):"
} else {
    $parent = [IO.Path]::GetDirectoryName($Base)
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "refusing ${Base}: its parent folder $parent does not exist (nothing was created)" }
    New-Item -ItemType Directory -Path $Base | Out-Null
    Set-SeyraOwnerOnlyAcl $Base $acct.Sid
    Write-Host "created $Base for $($acct.Name) only:"
}
# The folder must already be private before anything is created inside it.
Assert-SeyraPkiFolder $Base
foreach ($d in $managed) {
    $p = Join-Path $Base $d
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}
Write-Host 'with its subfolders:'
Assert-SeyraPkiFolder $Base
Write-Host "SeyraPKI folder ready: $Base"
