# Real-Windows acceptance for the LAN PKI folder and trust scripts (review f5bd978 R1/R2): real NTFS
# ACLs, a real junction and, only with -IncludeTrustStore, the real Cert:\CurrentUser\Root store.
# STATUS: prepared, NOT RUN. Run it only when asked, as the normal (non-elevated) user, in Windows
# PowerShell 5.1 from the folder holding the PKI scripts:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-LanPkiOnWindows.ps1 -ScriptDir .\scripts [-IncludeTrustStore]
#
# Everything happens in a new disposable folder %LOCALAPPDATA%\SeyraPKI-acceptance-<time> (removed at
# the end); the real %LOCALAPPDATA%\SeyraPKI is not touched. -IncludeTrustStore adds a THROW-AWAY test
# root (valid one day, its private key never written to disk) to Cert:\CurrentUser\Root and removes it
# again; Windows asks twice for confirmation. Prints PASS/FAIL per case and a summary to paste back.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ScriptDir, [switch]$IncludeTrustStore)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ScriptDir = (Resolve-Path -LiteralPath $ScriptDir).ProviderPath
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$T = Join-Path $env:LOCALAPPDATA "SeyraPKI-acceptance-$stamp"
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$users = 'S-1-5-32-545'   # BUILTIN\Users: the "foreign" principal for the tests
$script:fails = 0; $script:n = 0
function T([string]$Name, [bool]$Ok, [string]$Detail = '') {
    $script:n++
    if ($Ok) { Write-Host "PASS $Name" } else { $script:fails++; Write-Host "FAIL $Name -- $Detail" }
}
function Run([string]$Script, [string[]]$ScriptArgs) {
    # Windows PowerShell 5.1 turns a redirected native stderr line into a terminating error under
    # 'Stop'; the child's messages may be wrapped, so Flat (no whitespace) is used for matching.
    $ErrorActionPreference = 'Continue'
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir $Script) @ScriptArgs 2>&1 | ForEach-Object { "$_" }
    $text = $out -join ' '
    return [pscustomobject]@{ Rc = $LASTEXITCODE; Out = $text; Flat = ($text -replace '\s', '') }
}
function Has($R, [string]$Text) { return $R.Flat.Contains(($Text -replace '\s', '')) }
function Sddl([string]$Path) { return (Get-Acl -LiteralPath $Path).Sddl }
function TreeSddl([string]$Path) { return (@(Get-ChildItem -LiteralPath $Path -Recurse -Force | ForEach-Object { $_.FullName + '=' + (Sddl $_.FullName) }) + @($Path + '=' + (Sddl $Path))) -join "`n" }
if ($env:SEYRA_TEST_BOUNDARY) { throw 'unset SEYRA_TEST_BOUNDARY first' }

# W1 fresh folder: protected, exactly one entry (you, full control), owned by you; subfolders inherit.
$r = Run New-PkiFolder.ps1 @('-Base', $T)
$acl = Get-Acl -LiteralPath $T
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
T 'W1 fresh folder created' ($r.Rc -eq 0) $r.Out
T 'W1 protected, one entry: you, FullControl; owner you' ($acl.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $me -and [string]$rules[0].FileSystemRights -match 'FullControl' -and $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $me) $acl.Sddl
$child = Get-Acl -LiteralPath (Join-Path $T 'root')
T 'W1 subfolder inherits only your entry' (-not $child.AreAccessRulesProtected -and @($child.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -ne $me }).Count -eq 0) $child.Sddl

# W2 reuse: accepted and nothing modified.
$before = TreeSddl $T
$r = Run New-PkiFolder.ps1 @('-Base', $T)
T 'W2 reuse accepted, permissions unchanged' ($r.Rc -eq 0 -and (TreeSddl $T) -eq $before) $r.Out

# W3 owner-only base + foreign explicit ACE on a (dummy, encrypted-looking) key file: refused, unchanged.
$key = Join-Path (Join-Path $T 'root') 'root_ca.key'
[IO.File]::WriteAllText($key, "-----BEGIN ENCRYPTED PRIVATE KEY-----`nTUlJ`n-----END ENCRYPTED PRIVATE KEY-----`n")
& icacls.exe $key /grant "*${users}:(R)" /Q | Out-Null
$before = TreeSddl $T
$r = Run New-PkiFolder.ps1 @('-Base', $T)
T 'W3 foreign explicit ACE on a key file refused with the one-entry remedy' ($r.Rc -ne 0 -and (Has $r "/remove:g *$users")) $r.Out
T 'W3 nothing modified' ((TreeSddl $T) -eq $before)
& icacls.exe $key /remove:g "*$users" /Q | Out-Null
T 'W3 after the printed remedy: accepted' ((Run New-PkiFolder.ps1 @('-Base', $T)).Rc -eq 0)

# W4 exact Desktop: refused before any change.
$desk = [Environment]::GetFolderPath('Desktop')
$deskBefore = Sddl $desk; $deskItems = @(Get-ChildItem -LiteralPath $desk -Force).Count
$r = Run New-PkiFolder.ps1 @('-Base', $desk)
T 'W4 Desktop itself refused, its permissions and contents unchanged' ($r.Rc -ne 0 -and (Sddl $desk) -eq $deskBefore -and @(Get-ChildItem -LiteralPath $desk -Force).Count -eq $deskItems) $r.Out

# W5 junction inside the tree: refused, not followed; then removed with the printed remedy.
$j = Join-Path (Join-Path $T 'issued') 'junction'
New-Item -ItemType Junction -Path $j -Target $env:TEMP | Out-Null
$r = Run New-PkiFolder.ps1 @('-Base', $T)
T 'W5 junction child refused' ($r.Rc -ne 0 -and (Has $r 'is a link or junction')) $r.Out
& cmd.exe /c rmdir "$j"
T 'W5 junction removed by the remedy, target intact' (-not (Test-Path -LiteralPath $j) -and (Test-Path -LiteralPath $env:TEMP))

# W6 Base reached through a junction: refused, nothing created at the target.
$jl = Join-Path $env:LOCALAPPDATA "SeyraPKI-acceptance-link-$stamp"
$tgt = Join-Path $env:TEMP "seyra-acceptance-target-$stamp"
New-Item -ItemType Directory -Path $tgt | Out-Null
New-Item -ItemType Junction -Path $jl -Target $tgt | Out-Null
$r = Run New-PkiFolder.ps1 @('-Base', (Join-Path $jl 'SeyraPKI'))
T 'W6 Base through a junction refused, nothing created' ($r.Rc -ne 0 -and @(Get-ChildItem -LiteralPath $tgt -Force).Count -eq 0) $r.Out
& cmd.exe /c rmdir "$jl"; Remove-Item -LiteralPath $tgt

# W7 the Linux test hook is refused on Windows.
$env:SEYRA_TEST_BOUNDARY = 'C:\nonexistent.ps1'
$r = Run New-PkiFolder.ps1 @('-Base', $T)
Remove-Item Env:\SEYRA_TEST_BOUNDARY
T 'W7 SEYRA_TEST_BOUNDARY refused on Windows' ($r.Rc -ne 0 -and (Has $r 'refused on Windows')) $r.Out

if ($IncludeTrustStore) {
    # W8-W10 real Cert:\CurrentUser\Root with a throw-away root (private key only in memory).
    $ec = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve+NamedCurves]::nistP256)
    $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest("CN=Seyra acceptance test root $stamp (delete me)", $ec, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($true, $true, 1, $true)))
    $tc = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1))
    $ec.Dispose()
    $cer = Join-Path $env:TEMP "seyra-acceptance-root-$stamp.cer"
    [IO.File]::WriteAllBytes($cer, $tc.RawData)
    $sha = (Get-FileHash -LiteralPath $cer -Algorithm SHA256).Hash.ToLowerInvariant()
    $inStore = { @(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $tc.Thumbprint }).Count -gt 0 }
    $rec = Join-Path (Join-Path $T 'trust') 'root-trust-record.json'
    Write-Host "W8: Windows will ask to install '$($tc.Subject)', thumbprint $($tc.Thumbprint): click NO."
    $r = Run Add-RootTrust.ps1 @('-RootCer', $cer, '-ExpectedSha256', $sha, '-Base', $T)
    T 'W8 declined import: non-zero, not trusted, no record' ($r.Rc -ne 0 -and -not (& $inStore) -and -not (Test-Path -LiteralPath $rec)) $r.Out
    Write-Host 'W9: Windows will ask again: click YES (the root is removed again in W10).'
    $r = Run Add-RootTrust.ps1 @('-RootCer', $cer, '-ExpectedSha256', $sha, '-Base', $T)
    $x = $null; if (Test-Path -LiteralPath $rec) { $x = Get-Content -Raw -LiteralPath $rec | ConvertFrom-Json }
    T 'W9 import: trusted, record trusted and not pre-existing' ($r.Rc -eq 0 -and (& $inStore) -and $null -ne $x -and $x.state -eq 'trusted' -and $x.pre_existing -eq $false) $r.Out
    Write-Host 'W10: Windows will ask to delete the test root: click YES.'
    $r = Run Remove-RootTrust.ps1 @('-Base', $T)
    T 'W10 undo removed exactly that root; record archived' ($r.Rc -eq 0 -and -not (& $inStore) -and -not (Test-Path -LiteralPath $rec)) $r.Out
    Remove-Item -LiteralPath $cer
    if (& $inStore) { Write-Host "CLEANUP NEEDED: remove '$($tc.Subject)' in certmgr.msc (Trusted Root Certification Authorities)" }
}

Remove-Item -LiteralPath $T -Recurse -Force
Write-Host ("# lan-pki windows acceptance ({0}, PowerShell {1}): checks={2} failed={3}" -f [Environment]::OSVersion.VersionString, $PSVersionTable.PSVersion, $script:n, $script:fails)
exit $(if ($script:fails) { 1 } else { 0 })
