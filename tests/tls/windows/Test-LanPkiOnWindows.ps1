# Real-Windows acceptance for the LAN PKI folder and trust scripts (reviews f5bd978 R1/R2, f4bd578 F2):
# real NTFS ACLs, real junctions and, only with -IncludeTrustStore, the real Cert:\CurrentUser\Root.
# STATUS: prepared, NOT RUN on Windows. Run it only when asked, as the normal (non-elevated) user, in
# Windows PowerShell 5.1 from the folder holding the PKI scripts:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-LanPkiOnWindows.ps1 -ScriptDir . [-IncludeTrustStore]
#
# Everything it creates is test-owned and tracked: the PKI folder %LOCALAPPDATA%\SeyraPKI-acceptance-<time>,
# a work folder ...-<time>-work (junction targets, the test certificate, RECOVERY.txt) and one junction
# ...-link-<time>. The real %LOCALAPPDATA%\SeyraPKI, the Desktop and TEMP are only read. With
# -IncludeTrustStore a THROW-AWAY test root (valid one day, private key never written) is added to
# Cert:\CurrentUser\Root and removed again; Windows asks each time.
#
# Cleanup (also after an unexpected error or Ctrl+C) removes only what this run created:
#   - a junction is removed with `cmd /c rmdir` (never its target); the exit status and the resulting
#     link state are checked, and a folder that still holds a link is never deleted recursively;
#   - the test certificate, its trust record and RECOVERY.txt are deleted only after the store shows
#     that exact root (thumbprint and SHA-256) is absent. If it is still there, they are KEPT, the
#     exact recovery commands are printed and the run exits non-zero. A removal that was already
#     attempted (for example you clicked No) is never retried automatically;
#   - RECOVERY.txt is written BEFORE the first import, so even a killed run leaves the exact root's
#     recovery steps; a later run refuses to start until they are done.
#
# -TestModel <file> is a Linux test hook (tests/tls/lan-pki-acceptance-model.ps1) that replaces the
# Windows operations below with a controlled model; it is refused on Windows.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ScriptDir, [switch]$IncludeTrustStore, [string]$TestModel)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ScriptDir = (Resolve-Path -LiteralPath $ScriptDir).ProviderPath
$users = 'S-1-5-32-545'   # BUILTIN\Users: the "foreign" principal for the tests

# ---- operations (real Windows) --------------------------------------------------------------------
$Ops = @{
    Mode         = { 'Windows' }
    Account      = { $id = [System.Security.Principal.WindowsIdentity]::GetCurrent(); [pscustomobject]@{ Sid = $id.User.Value; Name = $id.Name } }
    LocalAppData = { $env:LOCALAPPDATA }
    Desktop      = { [Environment]::GetFolderPath('Desktop') }
    Run          = {
        # Windows PowerShell 5.1 turns a redirected native stderr line into a terminating error under
        # 'Stop'; messages may be wrapped, so Flat (no whitespace) is used for matching.
        param([string]$Step, [string]$Script, [string[]]$ScriptArgs)
        $ErrorActionPreference = 'Continue'
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir $Script) @ScriptArgs 2>&1 | ForEach-Object { "$_" }
        $text = $out -join ' '
        [pscustomobject]@{ Rc = $LASTEXITCODE; Out = $text; Flat = ($text -replace '\s', '') }
    }
    AclFacts     = {
        param([string]$Path)
        $sidType = [System.Security.Principal.SecurityIdentifier]
        $acl = Get-Acl -LiteralPath $Path
        [pscustomobject]@{ Owner = $acl.GetOwner($sidType).Value; Protected = $acl.AreAccessRulesProtected
            Aces = @($acl.GetAccessRules($true, $true, $sidType) | ForEach-Object { [pscustomobject]@{ Sid = $_.IdentityReference.Value; Allow = ($_.AccessControlType -eq 'Allow'); Rights = [string]$_.FileSystemRights; Inherited = $_.IsInherited } }) }
    }
    Fingerprint  = {
        # Permissions and names of a folder (and, with $Recurse, everything below it; links not entered).
        param([string]$Path, [bool]$Recurse)
        $lines = New-Object System.Collections.ArrayList
        $queue = New-Object System.Collections.Queue; $queue.Enqueue($Path)
        while ($queue.Count -gt 0) {
            $p = [string]$queue.Dequeue()
            [void]$lines.Add($p + '=' + (Get-Acl -LiteralPath $p).Sddl)
            if (-not ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -and ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::Directory)) {
                foreach ($c in @(Get-ChildItem -LiteralPath $p -Force | Sort-Object Name)) { if ($Recurse) { $queue.Enqueue($c.FullName) } else { [void]$lines.Add($c.FullName) } }
            }
        }
        $lines -join "`n"
    }
    Grant        = { param([string]$Path, [string]$Sid) & icacls.exe $Path /grant "*${Sid}:(R)" /Q | Out-Null; $LASTEXITCODE }
    Ungrant      = { param([string]$Path, [string]$Sid) & icacls.exe $Path /remove:g "*$Sid" /Q | Out-Null; $LASTEXITCODE }
    NewJunction  = { param([string]$Path, [string]$Target) New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null }
    RemoveLink   = { param([string]$Path) & cmd.exe /c rmdir "$Path" | Out-Null; $LASTEXITCODE }   # removes the junction itself, never its target
    StoreHas     = {
        # Whether Cert:\CurrentUser\Root holds exactly this root; other bytes under the thumbprint stop the run.
        param([string]$Thumb, [string]$Sha)
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
        $store.Open('ReadOnly')
        try { $hits = @($store.Certificates | Where-Object { $_.Thumbprint -eq $Thumb }) } finally { $store.Close() }
        foreach ($h in $hits) { if ((Get-FileHash -InputStream (New-Object IO.MemoryStream (, $h.RawData)) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha) { throw "a store entry with thumbprint $Thumb has different bytes" } }
        $hits.Count -gt 0
    }
    Checkpoint   = { param([string]$Name) }
}
if ($TestModel) {
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { throw '-TestModel is a Linux test hook and is refused on Windows' }
    $over = & $TestModel
    foreach ($k in @($over.Keys)) { $Ops[$k] = $over[$k] }
}
$mode = & $Ops.Mode
$acct = & $Ops.Account
$lad = & $Ops.LocalAppData
if ($env:SEYRA_TEST_BOUNDARY -and $mode -eq 'Windows') { throw 'unset SEYRA_TEST_BOUNDARY first' }

# An earlier run that could not finish its trust cleanup left RECOVERY.txt: finish that first.
$left = @(Get-ChildItem -LiteralPath $lad -Directory -Filter 'SeyraPKI-acceptance-*-work' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'RECOVERY.txt' } | Where-Object { Test-Path -LiteralPath $_ })
if ($left.Count -gt 0) {
    Write-Host 'An earlier acceptance run left a test root to clean up. Nothing was started. Follow the steps in:'
    foreach ($f in $left) { Write-Host "  $f"; Get-Content -LiteralPath $f | ForEach-Object { Write-Host "    $_" } }
    exit 2
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$T = Join-Path $lad "SeyraPKI-acceptance-$stamp"
$Work = Join-Path $lad "SeyraPKI-acceptance-$stamp-work"
$S = @{ Links = (New-Object System.Collections.ArrayList); Thumb = $null; Sha = $null; Cer = $null; Recovery = (Join-Path $Work 'RECOVERY.txt'); RemoveAttempted = $false }
$script:fails = 0; $script:n = 0; $script:skips = 0
function T([string]$Name, [bool]$Ok, [string]$Detail = '') {
    $script:n++
    if ($Ok) { Write-Host "PASS $Name" } else { $script:fails++; Write-Host "FAIL $Name -- $Detail" }
}
function Skip([string]$Name, [string]$Why) { $script:skips++; Write-Host "SKIP $Name -- $Why" }
function Has($R, [string]$Text) { return $R.Flat.Contains(($Text -replace '\s', '')) }
function Test-Link([string]$Path) { try { return [bool]([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) } catch { return $false } }
function Get-LinkUnder([string]$Path) {
    # Links anywhere below $Path, found without entering them.
    $found = @(); if (-not (Test-Path -LiteralPath $Path)) { return $found }
    $queue = New-Object System.Collections.Queue; $queue.Enqueue($Path)
    while ($queue.Count -gt 0) {
        $p = [string]$queue.Dequeue()
        if (Test-Link $p) { $found += $p; continue }
        if ([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::Directory) { foreach ($c in @(Get-ChildItem -LiteralPath $p -Force)) { $queue.Enqueue($c.FullName) } }
    }
    return $found
}
function Remove-TestLink([string]$Path) {
    # Removes one link this run created; true only if the link is really gone.
    if (-not (Test-Link $Path)) { return $true }
    $rc = & $Ops.RemoveLink $Path
    if ($rc -ne 0 -or (Test-Link $Path)) { Write-Host "  could not remove the link $Path (rmdir exit $rc)"; return $false }
    return $true
}
function Write-Recovery {
    $text = @(
        'Seyra acceptance test root: still to be removed from YOUR account''s Cert:\CurrentUser\Root.'
        "account     $($acct.Name) ($($acct.Sid))"
        "thumbprint  $($S.Thumb)"
        "sha256      $($S.Sha)"
        "certificate $($S.Cer)"
        "record      $(Join-Path (Join-Path $T 'trust') 'root-trust-record.json')"
        'Remove it (Windows asks for confirmation), as this account:'
        "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $ScriptDir 'Remove-RootTrust.ps1')`" -Base `"$T`""
        'If that refuses, remove exactly this root:'
        "  Get-ChildItem Cert:\CurrentUser\Root\$($S.Thumb) | Remove-Item"
        "Check it is gone (prints nothing):  Get-ChildItem Cert:\CurrentUser\Root\$($S.Thumb) -ErrorAction SilentlyContinue"
        "Then delete `"$T`" and `"$Work`"."
    )
    [IO.File]::WriteAllText($S.Recovery, (($text -join "`r`n") + "`r`n"))
}

$unexpected = $null
Write-Host ("Seyra LAN PKI acceptance ({0}) as {1}; test folders {2} and {3}" -f $mode, $acct.Name, $T, $Work)
try {
    New-Item -ItemType Directory -Path $Work | Out-Null

    # W1 fresh folder: protected, exactly one entry (you, full control), owned by you; subfolders inherit.
    $r = & $Ops.Run 'W1' New-PkiFolder.ps1 @('-Base', $T)
    T 'W1 fresh folder created' ($r.Rc -eq 0 -and (Test-Path -LiteralPath $T)) $r.Out
    if (-not (Test-Path -LiteralPath $T)) { throw "W1 did not create $T; the remaining cases need it" }
    $a = & $Ops.AclFacts $T
    T 'W1 protected, one entry: you, FullControl; owner you' ($a.Protected -and @($a.Aces).Count -eq 1 -and $a.Aces[0].Sid -eq $acct.Sid -and $a.Aces[0].Rights -match 'FullControl' -and $a.Owner -eq $acct.Sid) ($a | Out-String)
    $c = & $Ops.AclFacts (Join-Path $T 'root')
    T 'W1 subfolder inherits only your entry' (-not $c.Protected -and @($c.Aces | Where-Object { $_.Sid -ne $acct.Sid }).Count -eq 0) ($c | Out-String)

    # W2 reuse: accepted and nothing modified.
    $before = & $Ops.Fingerprint $T $true
    $r = & $Ops.Run 'W2' New-PkiFolder.ps1 @('-Base', $T)
    T 'W2 reuse accepted, permissions unchanged' ($r.Rc -eq 0 -and (& $Ops.Fingerprint $T $true) -eq $before) $r.Out

    # W3 owner-only base + foreign explicit ACE on a (dummy, encrypted-looking) key file: refused, unchanged.
    $key = Join-Path (Join-Path $T 'root') 'root_ca.key'
    [IO.File]::WriteAllText($key, "-----BEGIN ENCRYPTED PRIVATE KEY-----`nTUlJ`n-----END ENCRYPTED PRIVATE KEY-----`n")
    $rc = & $Ops.Grant $key $users
    if ($rc -ne 0) { T 'W3 setup: icacls /grant on the dummy key' $false "icacls exit $rc" }
    else {
        $before = & $Ops.Fingerprint $T $true
        $r = & $Ops.Run 'W3' New-PkiFolder.ps1 @('-Base', $T)
        T 'W3 foreign explicit ACE on a key file refused with the one-entry remedy' ($r.Rc -ne 0 -and (Has $r "/remove:g *$users")) $r.Out
        T 'W3 nothing modified' ((& $Ops.Fingerprint $T $true) -eq $before)
        $rc = & $Ops.Ungrant $key $users
        $left3 = @((& $Ops.AclFacts $key).Aces | Where-Object { $_.Sid -eq $users }).Count
        T 'W3 the printed remedy (icacls /remove:g) succeeded and removed the entry' ($rc -eq 0 -and $left3 -eq 0) "icacls exit $rc; entries left $left3"
        T 'W3 after the remedy: accepted' ((& $Ops.Run 'W3b' New-PkiFolder.ps1 @('-Base', $T)).Rc -eq 0)
    }

    # W4 Desktop itself: refused before any change (only read).
    $desk = & $Ops.Desktop
    $before = & $Ops.Fingerprint $desk $false
    $r = & $Ops.Run 'W4' New-PkiFolder.ps1 @('-Base', $desk)
    T 'W4 Desktop itself refused, its permissions and entries unchanged' ($r.Rc -ne 0 -and (& $Ops.Fingerprint $desk $false) -eq $before) $r.Out

    # W5 junction inside the tree (to a test-owned target): refused, not followed; then removed.
    $t5 = Join-Path $Work 'target-w5'; New-Item -ItemType Directory -Path $t5 | Out-Null; [IO.File]::WriteAllText((Join-Path $t5 'marker'), 'x')
    $j = Join-Path (Join-Path $T 'issued') 'junction'
    [void]$S.Links.Add($j); & $Ops.NewJunction $j $t5
    $r = & $Ops.Run 'W5' New-PkiFolder.ps1 @('-Base', $T)
    T 'W5 junction child refused' ($r.Rc -ne 0 -and (Has $r 'is a link or junction')) $r.Out
    T 'W5 junction removed (link gone, rmdir exit 0), target intact' ((Remove-TestLink $j) -and (Test-Path -LiteralPath (Join-Path $t5 'marker')))

    # W6 Base reached through a junction (to a test-owned target): refused, nothing created at the target.
    $t6 = Join-Path $Work 'target-w6'; New-Item -ItemType Directory -Path $t6 | Out-Null
    $jl = Join-Path $lad "SeyraPKI-acceptance-link-$stamp"
    [void]$S.Links.Add($jl); & $Ops.NewJunction $jl $t6
    $r = & $Ops.Run 'W6' New-PkiFolder.ps1 @('-Base', (Join-Path $jl 'SeyraPKI'))
    T 'W6 Base through a junction refused, nothing created' ($r.Rc -ne 0 -and @(Get-ChildItem -LiteralPath $t6 -Force).Count -eq 0) $r.Out
    T 'W6 junction removed (link gone, rmdir exit 0)' (Remove-TestLink $jl)

    # W7 the Linux test hook is refused on Windows.
    if ($mode -eq 'Windows') {
        $env:SEYRA_TEST_BOUNDARY = 'C:\nonexistent.ps1'
        try { $r = & $Ops.Run 'W7' New-PkiFolder.ps1 @('-Base', $T) } finally { Remove-Item Env:\SEYRA_TEST_BOUNDARY }
        T 'W7 SEYRA_TEST_BOUNDARY refused on Windows' ($r.Rc -ne 0 -and (Has $r 'refused on Windows')) $r.Out
    } else { Skip 'W7 SEYRA_TEST_BOUNDARY refused on Windows' "only meaningful on Windows ($mode)" }

    if ($IncludeTrustStore) {
        # W8-W10 Cert:\CurrentUser\Root with a throw-away root (its private key only in memory).
        $ec = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve+NamedCurves]::nistP256)
        $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest("CN=Seyra acceptance test root $stamp (delete me)", $ec, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
        $req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($true, $true, 1, $true)))
        $tc = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1))
        $ec.Dispose()
        $S.Cer = Join-Path $Work 'acceptance-root.cer'
        [IO.File]::WriteAllBytes($S.Cer, $tc.RawData)
        $S.Thumb = $tc.Thumbprint
        $S.Sha = (Get-FileHash -LiteralPath $S.Cer -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Recovery   # before any import: a killed run still leaves the exact root's recovery steps
        & $Ops.Checkpoint 'before-import'
        $rec = Join-Path (Join-Path $T 'trust') 'root-trust-record.json'
        Write-Host "W8: Windows will ask to install '$($tc.Subject)', thumbprint $($S.Thumb): click NO."
        $r = & $Ops.Run 'W8' Add-RootTrust.ps1 @('-RootCer', $S.Cer, '-ExpectedSha256', $S.Sha, '-Base', $T)
        T 'W8 declined import: non-zero, not trusted, no record' ($r.Rc -ne 0 -and -not (& $Ops.StoreHas $S.Thumb $S.Sha) -and -not (Test-Path -LiteralPath $rec)) $r.Out
        Write-Host 'W9: Windows will ask again: click YES (the root is removed again in W10).'
        $r = & $Ops.Run 'W9' Add-RootTrust.ps1 @('-RootCer', $S.Cer, '-ExpectedSha256', $S.Sha, '-Base', $T)
        $x = $null; if (Test-Path -LiteralPath $rec) { $x = Get-Content -Raw -LiteralPath $rec | ConvertFrom-Json }
        T 'W9 import: trusted, record trusted and not pre-existing' ($r.Rc -eq 0 -and (& $Ops.StoreHas $S.Thumb $S.Sha) -and $null -ne $x -and $x.state -eq 'trusted' -and $x.pre_existing -eq $false) $r.Out
        & $Ops.Checkpoint 'after-import'
        Write-Host 'W10: Windows will ask to delete the test root: click YES.'
        $S.RemoveAttempted = $true
        $r = & $Ops.Run 'W10' Remove-RootTrust.ps1 @('-Base', $T)
        T 'W10 undo removed exactly that root; record archived' ($r.Rc -eq 0 -and -not (& $Ops.StoreHas $S.Thumb $S.Sha) -and -not (Test-Path -LiteralPath $rec)) $r.Out
    }
} catch {
    $unexpected = $_.Exception.Message
    Write-Host "UNEXPECTED ERROR: $unexpected"
} finally {
    # ---- cleanup: only what this run created, verified step by step ----------------------------------
    $problems = New-Object System.Collections.ArrayList
    foreach ($l in @($S.Links)) { if (-not (Remove-TestLink $l)) { [void]$problems.Add("link $l is still there: remove only the link with  cmd /c rmdir `"$l`"") } }
    $rootPresent = $false
    if ($S.Thumb) {
        try { $rootPresent = & $Ops.StoreHas $S.Thumb $S.Sha } catch { $rootPresent = $true; [void]$problems.Add("cannot confirm the test root is gone: $($_.Exception.Message)") }
        if ($rootPresent -and -not $S.RemoveAttempted) {
            # Added by this run and nothing has tried to remove it yet (an error before W10): one normal undo.
            $S.RemoveAttempted = $true
            Write-Host 'cleanup: removing the test root again (Windows will ask: click YES)'
            try { [void](& $Ops.Run 'cleanup-remove' Remove-RootTrust.ps1 @('-Base', $T)) } catch { Write-Host "cleanup: Remove-RootTrust failed to run: $($_.Exception.Message)" }
            try { $rootPresent = & $Ops.StoreHas $S.Thumb $S.Sha } catch { $rootPresent = $true }
        }
        if ($rootPresent) { [void]$problems.Add("the test root $($S.Thumb) is still in Cert:\CurrentUser\Root") }
    }
    if ($rootPresent) {
        Write-Recovery
        Write-Host "CLEANUP NEEDED: the test root, its certificate, its record and the recovery steps were KEPT:"
        Get-Content -LiteralPath $S.Recovery | ForEach-Object { Write-Host "  $_" }
    } elseif (@($S.Links | Where-Object { Test-Link $_ }).Count -gt 0) {
        # A link this run made is still there: keep both folders (the work folder holds its target).
        [void]$problems.Add("$T and $Work were NOT deleted while a link this run created remains (see above)")
    } else {
        foreach ($dir in @($T, $Work)) {
            if (-not (Test-Path -LiteralPath $dir)) { continue }
            $links = @(Get-LinkUnder $dir)
            if ($links.Count -gt 0) { [void]$problems.Add("$dir was NOT deleted: it still holds the link(s) $($links -join ', ')"); continue }
            Remove-Item -LiteralPath $dir -Recurse -Force
        }
    }
    foreach ($p in $problems) { Write-Host "CLEANUP PROBLEM: $p" }
    $cleanup = 'ok'; if ($problems.Count -gt 0) { $cleanup = 'INCOMPLETE' }
    Write-Host ("# lan-pki windows acceptance ({0}; {1}, PowerShell {2}): checks={3} failed={4} skipped={5} unexpected_error={6} cleanup={7}" -f $mode, [Environment]::OSVersion.VersionString, $PSVersionTable.PSVersion, $script:n, $script:fails, $script:skips, [bool]$unexpected, $cleanup)
}
if ($script:fails -gt 0 -or $unexpected -or $problems.Count -gt 0) { exit 1 }
exit 0
