# TEST ONLY (Linux, PowerShell 7), run by tests/tls/test-lan-pki-windows.sh inside the pwsh container.
# Review f4bd578 F2: the cleanup and recovery behaviour of tests/tls/windows/Test-LanPkiOnWindows.ps1
# itself, run as a process with -TestModel lan-pki-acceptance-model.ps1 (the actual PKI scripts against
# the controlled boundary). Scenarios: success; W10 removal refused; unexpected error after the import
# (cleanup removes, or its removal is refused too); a link that cannot be removed; icacls failures; a
# killed run; no trust store. A MODEL: not Windows, NTFS or certificate-store evidence.
$ErrorActionPreference = 'Stop'
$W = '/w'; $Win = "$W/win"; $Fx = "$W/fx-acceptance"
$fails = 0; $n = 0
$Me = 'S-1-5-21-1000-1000-1000-1001'; $System = 'S-1-5-18'; $Admins = 'S-1-5-32-544'
$env:SEYRA_TEST_BOUNDARY = "$W/lan-pki-test-boundary.ps1"
$env:SEYRA_TEST_ACCOUNT_SID = $Me; $env:SEYRA_TEST_ACCOUNT_NAME = 'PC\owner'
Remove-Item Env:\SEYRA_STEP_EXE -ErrorAction SilentlyContinue
function T([string]$Name, [bool]$Cond, [string]$Detail = '') {
    $script:n++
    if ($Cond) { Write-Output "PASS $Name" } else { $script:fails++; $msg = $Detail -replace '\s+', ' '; if ($msg.Length -gt 2000) { $msg = $msg.Substring(0, 300) + ' ... ' + $msg.Substring($msg.Length - 1700) }; Write-Output ("FAIL {0} -- {1}" -f $Name, $msg) }
}
function Ace([string]$Sid) { return @{ sid = $Sid; allow = $true; rights = 'FullControl'; inheritable = $true } }

# Fixture profile: LocalAppData, a Desktop with content, the protected-folder policy and the profile ACL.
$U = "$Fx/Users/me"; $L = "$U/AppData/Local"; $D = "$U/Desktop"
# ($dir, not $d: PowerShell names are case-insensitive and $D is the Desktop.)
foreach ($dir in $D, "$U/Documents", "$U/AppData/Roaming", $L) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
[IO.File]::WriteAllText("$D/notes.txt", 'owner content')
@{ Under = @($D, "$U/Documents", "$U/AppData/Roaming"); Exact = @($U, $L) } | ConvertTo-Json | Set-Content -LiteralPath "$Fx/policy.json"
$env:SEYRA_TEST_POLICY = "$Fx/policy.json"; $env:SEYRA_TEST_ACL = "$Fx/acl.json"
[IO.File]::WriteAllText($env:SEYRA_TEST_ACL, ((@{ $U = @{ owner = $Me; protected = $true; explicit = @((Ace $Me), (Ace $System), (Ace $Admins)) } } | ConvertTo-Json -Depth 6) + "`n"))
$Store = "$W/store-acceptance"; New-Item -ItemType Directory -Force -Path $Store | Out-Null; $env:SEYRA_TEST_STORE = $Store
# An unrelated, genuinely pre-existing root that no scenario may touch.
$ocer = "$W/pki/other_root.cer"
$othumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, [IO.File]::ReadAllBytes($ocer))).Thumbprint
Copy-Item -LiteralPath $ocer -Destination "$Store/$othumb.cer"
$unrelated = (Get-FileHash -LiteralPath "$Store/$othumb.cer").Hash
$env:SEYRA_MODEL_LOCALAPPDATA = $L; $env:SEYRA_MODEL_DESKTOP = $D; $env:SEYRA_MODEL_LOG = "$W/acceptance-model.log"
$deskBefore = (@(Get-ChildItem -LiteralPath $D -Force | ForEach-Object Name) -join ',') + '|' + (Get-FileHash "$D/notes.txt").Hash

function Drive([hashtable]$Set, [switch]$NoTrust) {
    foreach ($k in 'SEYRA_MODEL_FAULTS', 'SEYRA_MODEL_LINK_FAULT', 'SEYRA_MODEL_ICACLS_FAULT', 'SEYRA_MODEL_THROW_AT', 'SEYRA_MODEL_EXIT_AT') { Remove-Item "Env:\$k" -ErrorAction SilentlyContinue }
    foreach ($k in $Set.Keys) { Set-Item "Env:\$k" $Set[$k] }
    [IO.File]::WriteAllText($env:SEYRA_MODEL_LOG, '')
    $a = @('-NoProfile', '-NonInteractive', '-File', "$W/acc/Test-LanPkiOnWindows.ps1", '-ScriptDir', $Win, '-TestModel', "$W/lan-pki-acceptance-model.ps1")
    if (-not $NoTrust) { $a += '-IncludeTrustStore' }
    $raw = @(& pwsh @a 2>&1 | ForEach-Object { "$_" }); $rc = $LASTEXITCODE
    $text = (@($raw -split "`n" | ForEach-Object { (($_ -replace "\x1b\[[0-9;]*[A-Za-z]", '') -replace '^\s*(\d+\s*)?\|\s?', '').Trim() }) -join ' ') -replace '\s+', ' '
    return [pscustomobject]@{ Rc = $rc; Out = $text }
}
function AccDirs { return @(Get-ChildItem -LiteralPath $L -Force -Filter 'SeyraPKI-acceptance-*' | ForEach-Object Name | Sort-Object) }
function TestRoots { return @(Get-ChildItem -LiteralPath $Store -Filter '*.cer' | Where-Object { $_.BaseName -ne $othumb }) }
function Runs([string]$Step) { return @(Get-Content -LiteralPath $env:SEYRA_MODEL_LOG | Where-Object { $_ -eq "$Step Remove-RootTrust.ps1" }).Count }
function TDir { $x = @(Get-ChildItem -LiteralPath $L -Directory -Filter 'SeyraPKI-acceptance-*' | Where-Object { $_.Name -notmatch '-(work|link-.*)$' }); if ($x.Count -eq 1) { return $x[0].FullName } return $null }
function WDir { $x = @(Get-ChildItem -LiteralPath $L -Directory -Filter 'SeyraPKI-acceptance-*-work'); if ($x.Count -eq 1) { return $x[0].FullName } return $null }
function Untouched { return ((Get-FileHash -LiteralPath "$Store/$othumb.cer").Hash -eq $unrelated -and ((@(Get-ChildItem -LiteralPath $D -Force | ForEach-Object Name) -join ',') + '|' + (Get-FileHash "$D/notes.txt").Hash) -eq $deskBefore) }
function Recover {
    # What RECOVERY.txt tells the owner, done here on the fixture: the product's Remove-RootTrust, then
    # removal of the test folders (links first, without following them).
    $t = TDir
    if ($t -and (Test-Path -LiteralPath "$t/trust/root-trust-record.json")) {
        Remove-Item Env:\SEYRA_TEST_FAULT -ErrorAction SilentlyContinue
        $out = & pwsh -NoProfile -NonInteractive -File "$Win/Remove-RootTrust.ps1" -Base $t 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "fixture recovery failed: $out" }
    }
    Get-ChildItem -LiteralPath $L -Force -Filter 'SeyraPKI-acceptance-*' | ForEach-Object {
        if ($_.LinkType) { & rm -- $_.FullName } else { Get-ChildItem -LiteralPath $_.FullName -Recurse -Force | Where-Object { $_.LinkType } | ForEach-Object { & rm -- $_.FullName }; Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    }
}

# A. success (you click No at W8, Yes at W9/W10)
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused' }
T 'A success: exit 0, all checks pass, W7 reported as SKIP (Windows only), cleanup ok' ($r.Rc -eq 0 -and $r.Out -match 'failed=0' -and $r.Out -match 'SKIP W7' -and $r.Out -match 'cleanup=ok') $r.Out
T 'A success: no test folder, link or recovery file left' ((AccDirs).Count -eq 0) ((AccDirs) -join ',')
T 'A success: test root removed, removal ran once (W10), unrelated root and Desktop untouched' ((TestRoots).Count -eq 0 -and (Runs 'W10') -eq 1 -and (Runs 'cleanup-remove') -eq 0 -and (Untouched))

# B. W10 removal refused (you click No when asked to delete): state kept, no automatic retry
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused,W10=remove-refused' }
$t = TDir; $wk = WDir; $roots = @(TestRoots)
$rec = $null; if ($t -and (Test-Path "$t/trust/root-trust-record.json")) { $rec = Get-Content -Raw "$t/trust/root-trust-record.json" | ConvertFrom-Json }
$recov = ''; if ($wk -and (Test-Path "$wk/RECOVERY.txt")) { $recov = Get-Content -Raw "$wk/RECOVERY.txt" }
T 'B refused removal: non-zero exit, W10 FAIL, CLEANUP NEEDED, cleanup INCOMPLETE' ($r.Rc -ne 0 -and $r.Out -match 'FAIL W10' -and $r.Out -match 'CLEANUP NEEDED' -and $r.Out -match 'cleanup=INCOMPLETE') $r.Out
T 'B ... no automatic retry: Remove-RootTrust ran exactly once' ((Runs 'W10') -eq 1 -and (Runs 'cleanup-remove') -eq 0)
T 'B ... the test root is still trusted and the record for exactly that root is kept' ($roots.Count -eq 1 -and $null -ne $rec -and $rec.thumbprint_sha1 -eq $roots[0].BaseName -and $rec.state -eq 'trusted' -and $rec.pre_existing -eq $false) ($roots | Out-String)
T 'B ... the kept certificate is exactly that root' ($wk -and (Get-FileHash "$wk/acceptance-root.cer").Hash.ToLowerInvariant() -eq $rec.sha256 -and (Get-FileHash "$wk/acceptance-root.cer").Hash -eq (Get-FileHash $roots[0].FullName).Hash)
T 'B ... RECOVERY.txt names the account, thumbprint, SHA-256 and the exact commands' ($recov.Contains($Me) -and $recov.Contains($rec.thumbprint_sha1) -and $recov.Contains($rec.sha256) -and $recov.Contains("Remove-RootTrust.ps1`" -Base `"$t`"") -and $recov.Contains("Cert:\CurrentUser\Root\$($rec.thumbprint_sha1)")) $recov
T 'B ... the output prints the same recovery steps' ($r.Out.Contains("Cert:\CurrentUser\Root\$($rec.thumbprint_sha1)") -and $r.Out.Contains('Remove-RootTrust.ps1'))
T 'B ... links were still removed; unrelated root and Desktop untouched' (@(Get-ChildItem -LiteralPath $L -Force -Filter 'SeyraPKI-acceptance-link-*').Count -eq 0 -and @(Get-ChildItem -LiteralPath $t -Recurse -Force | Where-Object { $_.LinkType }).Count -eq 0 -and (Untouched))
$before = (AccDirs) -join ','
$r = Drive @{}
T 'B ... a new run refuses to start while RECOVERY.txt exists (prints it, creates nothing)' ($r.Rc -eq 2 -and $r.Out -match 'Nothing was started' -and $r.Out.Contains($rec.thumbprint_sha1) -and ((AccDirs) -join ',') -eq $before -and (TestRoots).Count -eq 1) $r.Out
Recover
T 'B ... the documented recovery removes exactly that root' ((TestRoots).Count -eq 0 -and (AccDirs).Count -eq 0 -and (Untouched))

# C. unexpected error after the import: cleanup performs the one normal removal
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused'; SEYRA_MODEL_THROW_AT = 'after-import' }
T 'C error after import: non-zero exit, UNEXPECTED ERROR reported, cleanup ok' ($r.Rc -ne 0 -and $r.Out -match 'UNEXPECTED ERROR' -and $r.Out -match 'cleanup=ok') $r.Out
T 'C ... cleanup removed the test root with exactly one Remove-RootTrust run; folders gone' ((TestRoots).Count -eq 0 -and (Runs 'W10') -eq 0 -and (Runs 'cleanup-remove') -eq 1 -and (AccDirs).Count -eq 0 -and (Untouched))

# D. unexpected error after the import, and the cleanup removal is refused too
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused,cleanup-remove=remove-refused'; SEYRA_MODEL_THROW_AT = 'after-import' }
$t = TDir; $wk = WDir; $roots = @(TestRoots)
T 'D error + refused cleanup removal: non-zero, root, record, certificate and RECOVERY.txt kept' ($r.Rc -ne 0 -and $r.Out -match 'CLEANUP NEEDED' -and $roots.Count -eq 1 -and (Test-Path "$t/trust/root-trust-record.json") -and (Test-Path "$wk/acceptance-root.cer") -and (Get-Content -Raw "$wk/RECOVERY.txt").Contains($roots[0].BaseName)) $r.Out
T 'D ... the refused removal was not retried' ((Runs 'cleanup-remove') -eq 1 -and (Runs 'W10') -eq 0)
Recover
T 'D ... recovered' ((TestRoots).Count -eq 0 -and (AccDirs).Count -eq 0 -and (Untouched))

# E. a junction that cannot be removed (cmd /c rmdir fails): never deleted through
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused'; SEYRA_MODEL_LINK_FAULT = 'rmdir-fails' }
$t = TDir; $wk = WDir
T 'E unremovable link: non-zero, W5/W6 removal FAIL, CLEANUP PROBLEM names the link' ($r.Rc -ne 0 -and $r.Out -match 'FAIL W5 junction removed' -and $r.Out -match 'FAIL W6 junction removed' -and $r.Out -match 'CLEANUP PROBLEM: link .*issued/junction') $r.Out
T 'E ... folders holding a link were NOT deleted; link targets intact' ($t -and (Test-Path "$t/issued/junction") -and (Test-Path "$wk/target-w5/marker") -and $r.Out -match 'CLEANUP PROBLEM: \S+ and \S+ were NOT deleted while a link this run created remains') $r.Out
T 'E ... the trust part still cleaned up exactly (root removed once)' ((TestRoots).Count -eq 0 -and (Runs 'W10') -eq 1 -and (Untouched))
Recover

# F. icacls failures are reported, not assumed
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused'; SEYRA_MODEL_ICACLS_FAULT = 'ungrant' }
T 'F icacls /remove:g fails: W3 remedy FAIL, non-zero; cleanup ok' ($r.Rc -ne 0 -and $r.Out -match 'FAIL W3 the printed remedy' -and $r.Out -match 'cleanup=ok' -and (AccDirs).Count -eq 0 -and (TestRoots).Count -eq 0) $r.Out
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused'; SEYRA_MODEL_ICACLS_FAULT = 'grant' }
T 'F icacls /grant fails: W3 setup FAIL (no claim about the ACE check), non-zero' ($r.Rc -ne 0 -and $r.Out -match 'FAIL W3 setup' -and $r.Out -notmatch 'PASS W3 foreign' -and (AccDirs).Count -eq 0) $r.Out

# G. the run is killed after the import (no cleanup runs at all)
$r = Drive @{ SEYRA_MODEL_FAULTS = 'W8=import-refused'; SEYRA_MODEL_EXIT_AT = 'after-import' }
$t = TDir; $wk = WDir; $roots = @(TestRoots)
T 'G killed after import: the root, its record and the pre-written RECOVERY.txt for exactly it remain' ($r.Rc -eq 7 -and $roots.Count -eq 1 -and (Test-Path "$t/trust/root-trust-record.json") -and (Get-Content -Raw "$wk/RECOVERY.txt").Contains($roots[0].BaseName)) $r.Out
$r = Drive @{}
T 'G ... the next run refuses to start and prints the recovery steps' ($r.Rc -eq 2 -and $r.Out.Contains($roots[0].BaseName)) $r.Out
Recover
T 'G ... recovered' ((TestRoots).Count -eq 0 -and (AccDirs).Count -eq 0 -and (Untouched))

# H. without -IncludeTrustStore (the owner's self-test): no trust at all
$r = Drive @{} -NoTrust
T 'H folder-only run: exit 0, no trust-store step, nothing left' ($r.Rc -eq 0 -and $r.Out -match 'failed=0' -and $r.Out -notmatch 'W8' -and (AccDirs).Count -eq 0 -and (TestRoots).Count -eq 0 -and (Untouched)) $r.Out

Write-Output ("# lan-pki acceptance driver cleanup (Linux model): checks={0} failed={1}" -f $n, $fails)
exit $(if ($fails) { 1 } else { 0 })
