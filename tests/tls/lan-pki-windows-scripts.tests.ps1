# TEST ONLY (Linux, PowerShell 7), run by tests/tls/test-lan-pki-windows.sh inside the pwsh container.
# Runs the ACTUAL Windows scripts (New-PkiFolder, Add-RootTrust, Remove-RootTrust, New-RootCa) as
# separate processes against the controlled boundary in lan-pki-test-boundary.ps1: a fixture user
# profile with an NTFS-like ACL model, a directory standing in for Cert:\CurrentUser\Root, and fault
# injection. Real NTFS and the real CurrentUser store are NOT exercised here (see
# tests/tls/windows/Test-LanPkiOnWindows.ps1, a real-Windows acceptance run).
#   review f5bd978 R1: unsafe Base refused before any change; existing folders checked, never repaired;
#                      foreign/inherited/deny entries, foreign owner, links and plaintext keys refused
#                      anywhere in the tree with a one-item remedy.
#   review f5bd978 R2: durable pending record before import, lock, reconcile after interruption, exact
#                      undo, pre-existing roots preserved, tampered/foreign records refused.
$ErrorActionPreference = 'Stop'
$W = '/w'; $Win = "$W/win"; $Fx = "$W/fx"
$fails = 0; $n = 0
$Me = 'S-1-5-21-1000-1000-1000-1001'; $Other = 'S-1-5-21-1000-1000-1000-1002'; $System = 'S-1-5-18'; $Admins = 'S-1-5-32-544'
$env:SEYRA_TEST_BOUNDARY = "$W/lan-pki-test-boundary.ps1"
$env:SEYRA_TEST_ACCOUNT_SID = $Me; $env:SEYRA_TEST_ACCOUNT_NAME = 'PC\owner'
Remove-Item Env:\SEYRA_STEP_EXE -ErrorAction SilentlyContinue

function T([string]$Name, [bool]$Cond, [string]$Detail = '') {
    $script:n++
    if ($Cond) { Write-Output "PASS $Name" } else { $script:fails++; Write-Output ("FAIL {0} -- {1}" -f $Name, ($Detail -replace '\s+', ' ').Substring(0, [Math]::Min(400, ($Detail -replace '\s+', ' ').Length))) }
}
function Run([string]$Script, [string[]]$ScriptArgs) {
    # Out: the child's output as one line. pwsh's error view colours and word-wraps messages behind a
    # '|' gutter; colour codes and the gutter are removed and lines re-joined with single spaces.
    $raw = @(& pwsh -NoProfile -NonInteractive -File "$Win/$Script" @ScriptArgs 2>&1 | ForEach-Object { "$_" })
    $rc = $LASTEXITCODE
    $lines = @($raw -split "`n" | ForEach-Object { (($_ -replace "\x1b\[[0-9;]*[A-Za-z]", '') -replace '^\s*(\d+\s*)?\|\s?', '').Trim() })
    return [pscustomobject]@{ Rc = $rc; Out = (($lines -join ' ') -replace '\s+', ' ') }
}
function Digest([string]$Path) { if (Test-Path -LiteralPath $Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash } return 'absent' }
function Acl { return (Get-Content -Raw -LiteralPath $env:SEYRA_TEST_ACL | ConvertFrom-Json -AsHashtable) }
function Save-Acl($Db) { [IO.File]::WriteAllText($env:SEYRA_TEST_ACL, (($Db | ConvertTo-Json -Depth 6) + "`n")) }
function Ace([string]$Sid, [string]$Rights = 'FullControl', [bool]$Inheritable = $true, [bool]$Allow = $true) { return @{ sid = $Sid; allow = $Allow; rights = $Rights; inheritable = $Inheritable } }
function New-Profile([string]$Name) {
    # A fixture Windows profile: protected folders (policy) and the profile ACL (you, SYSTEM, Administrators).
    $r = "$Fx/$Name"
    foreach ($d in 'Users/me/Desktop', 'Users/me/Documents', 'Users/me/OneDrive', 'Users/me/AppData/Local/Temp', 'Users/me/AppData/Roaming', 'Windows', 'ProgramData') { New-Item -ItemType Directory -Force -Path "$r/$d" | Out-Null }
    $u = "$r/Users/me"
    @{ Under = @("$u/Desktop", "$u/Documents", "$u/OneDrive", "$u/AppData/Roaming", "$u/AppData/Local/Temp", "$r/Windows", "$r/ProgramData"); Exact = @($u, "$u/AppData/Local") } | ConvertTo-Json | Set-Content -LiteralPath "$r/policy.json"
    $env:SEYRA_TEST_POLICY = "$r/policy.json"; $env:SEYRA_TEST_ACL = "$r/acl.json"
    Save-Acl @{ $u = @{ owner = $Me; protected = $true; explicit = @((Ace $Me), (Ace $System), (Ace $Admins)) } }
    return $r
}
$EncKey = "-----BEGIN ENCRYPTED PRIVATE KEY-----`nTUlJQ2Rq`n-----END ENCRYPTED PRIVATE KEY-----`n"

# ---------------------------------------------------------------- pure policy functions (Windows paths)
Import-Module "$Win/SeyraPki.psm1" -Force
$pol = [pscustomobject]@{ Under = @('C:\Users\me\Desktop', 'C:\Users\me\Documents', 'C:\Users\me\OneDrive - Org', 'C:\Users\me\AppData\Roaming', 'C:\Windows'); Exact = @('C:\Users\me', 'C:\Users\me\AppData\Local') }
T 'path: default %LOCALAPPDATA%\SeyraPKI accepted' (@(Test-SeyraBasePath 'C:\Users\me\AppData\Local\SeyraPKI' $pol).Count -eq 0)
T 'path: exact Desktop refused (any case, trailing separator)' (@(Test-SeyraBasePath 'c:\users\ME\desktop\' $pol).Count -gt 0)
T 'path: exact Documents refused' (@(Test-SeyraBasePath 'C:\Users\me\Documents' $pol).Count -gt 0)
T 'path: beneath Documents refused' (@(Test-SeyraBasePath 'C:\Users\me\Documents\SeyraPKI' $pol).Count -gt 0)
T 'path: beneath OneDrive refused' (@(Test-SeyraBasePath 'C:\Users\me\OneDrive - Org\PKI' $pol).Count -gt 0)
T 'path: roaming AppData refused' (@(Test-SeyraBasePath 'C:\Users\me\AppData\Roaming\SeyraPKI' $pol).Count -gt 0)
T 'path: profile itself refused' (@(Test-SeyraBasePath 'C:\Users\me' $pol).Count -gt 0)
T 'path: %LOCALAPPDATA% itself refused' (@(Test-SeyraBasePath 'C:\Users\me\AppData\Local' $pol).Count -gt 0)
T 'path: drive root refused (contains everything)' (@(Test-SeyraBasePath 'C:\' $pol).Count -gt 0)
T 'path: C:\Users refused (contains the profile)' (@(Test-SeyraBasePath 'C:\Users' $pol).Count -gt 0)
T 'path: system folder refused' (@(Test-SeyraBasePath 'C:\Windows\Temp\PKI' $pol).Count -gt 0)
T 'path: UNC share refused' (@(Test-SeyraBasePath '\\server\share\SeyraPKI' $pol).Count -gt 0)
T 'path: Dropbox-like name refused' (@(Test-SeyraBasePath 'D:\Dropbox\SeyraPKI' $pol).Count -gt 0)
T 'path: a dedicated folder on another drive accepted' (@(Test-SeyraBasePath 'D:\SeyraPKI' $pol).Count -eq 0)
T 'path: prefix-only match is not "inside" (Desktop2)' (@(Test-SeyraBasePath 'C:\Users\me\AppData\Local\Desktop2' $pol).Count -eq 0)
$item = { param($Path, $Owner, $Prot, $Aces, $Link = $false) [pscustomobject]@{ Path = $Path; IsDirectory = $true; IsLink = $Link; Owner = $Owner; Protected = $Prot; Aces = @($Aces) } }
$mine = [pscustomobject]@{ Sid = $Me; Allow = $true; Rights = 'FullControl'; Inherited = $false }
$mineInh = [pscustomobject]@{ Sid = $Me; Allow = $true; Rights = 'FullControl'; Inherited = $true }
$okTree = @((& $item 'C:\P' $Me $true @($mine)), (& $item 'C:\P\root' $Me $false @($mineInh)))
T 'acl: owner-only tree accepted' (@(Test-SeyraAclPolicy $okTree $Me 'C:\P').Count -eq 0)
$bad = @(Test-SeyraAclPolicy @($okTree[0], (& $item 'C:\P\root\root_ca.key' $Me $false @($mineInh, [pscustomobject]@{ Sid = $Other; Allow = $true; Rights = 'Read'; Inherited = $false }))) $Me 'C:\P')
T 'acl: owner-only base + foreign explicit ACE on a child key refused with a one-entry remedy' ($bad.Count -eq 1 -and $bad[0].Remedy -match [regex]::Escape("icacls `"C:\P\root\root_ca.key`" /remove:g *$Other"))
$bad = @(Test-SeyraAclPolicy @((& $item 'C:\P' $Me $false @($mine, [pscustomobject]@{ Sid = $System; Allow = $true; Rights = 'FullControl'; Inherited = $true }))) $Me 'C:\P')
T 'acl: base inheriting from its parent refused (remedy on that folder only, no /T)' ($bad.Count -eq 1 -and $bad[0].Remedy -match '/inheritance:r' -and ($bad[0].Remedy -split '   ')[0] -notmatch '/T\b')
$bad = @(Test-SeyraAclPolicy @($okTree[0], (& $item 'C:\P\issued' $Me $false @($mineInh, [pscustomobject]@{ Sid = $Other; Allow = $false; Rights = 'Write'; Inherited = $false }))) $Me 'C:\P')
T 'acl: deny entry for another principal refused' ($bad.Count -eq 1 -and $bad[0].Remedy -match '/remove:d')
$bad = @(Test-SeyraAclPolicy @($okTree[0], (& $item 'C:\P\root' $Other $false @($mineInh))) $Me 'C:\P')
T 'acl: child owned by someone else refused (never takes ownership)' ($bad.Count -eq 1 -and $bad[0].Remedy -match 'never takes ownership')
$bad = @(Test-SeyraAclPolicy @($okTree[0], (& $item 'C:\P\issued\j' '' $false @() $true)) $Me 'C:\P')
T 'acl: junction refused, remedy removes only the link' ($bad.Count -eq 1 -and $bad[0].Remedy -match 'cmd /c rmdir')

# ---------------------------------------------------------------- R1: New-PkiFolder.ps1 (actual script)
$P = New-Profile 'p1'; $L = "$P/Users/me/AppData/Local"; $B = "$L/SeyraPKI"
$profileAcl = (Acl)["$P/Users/me"] | ConvertTo-Json -Depth 6
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 fresh safe tree: created (exit 0)' ($r.Rc -eq 0) $r.Out
T 'R1 fresh: the seven managed subfolders exist' (((@(Get-ChildItem -LiteralPath $B | ForEach-Object Name) | Sort-Object) -join ',') -eq 'issued,issuing,public,requests,root,tools,trust') $r.Out
$db = Acl
T 'R1 fresh: exactly one permission change, on the new folder (protected, you only)' ((@($db.Keys | Sort-Object) -join '|') -eq ((@("$P/Users/me", $B) | Sort-Object) -join '|') -and $db[$B].protected -and @($db[$B].explicit).Count -eq 1 -and $db[$B].explicit[0].sid -eq $Me) ($db | ConvertTo-Json -Depth 6)
T 'R1 fresh: the parent profile permissions are untouched' (($db["$P/Users/me"] | ConvertTo-Json -Depth 6) -eq $profileAcl)
$h = Digest $env:SEYRA_TEST_ACL
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 safe reuse: accepted' ($r.Rc -eq 0 -and $r.Out -match 'checked, not modified') $r.Out
T 'R1 safe reuse: nothing modified' ((Digest $env:SEYRA_TEST_ACL) -eq $h)

# Owner-only base plus a foreign explicit ACE on a child issuer key.
[IO.File]::WriteAllText("$B/root/root_ca.key", $EncKey)
$keyHash = Digest "$B/root/root_ca.key"
$db = Acl; $db["$B/root/root_ca.key"] = @{ explicit = @((Ace $Other 'Read, Synchronize' $false)) }; Save-Acl $db
$h = Digest $env:SEYRA_TEST_ACL
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 foreign explicit ACE on a key: refused' ($r.Rc -ne 0) $r.Out
T 'R1 foreign ACE: names the key and the one-entry remedy' ($r.Out -match [regex]::Escape("$B/root/root_ca.key") -and $r.Out -match [regex]::Escape("/remove:g *$Other")) $r.Out
T 'R1 foreign ACE: nothing changed (permissions, key bytes)' ((Digest $env:SEYRA_TEST_ACL) -eq $h -and (Digest "$B/root/root_ca.key") -eq $keyHash)
$r = Run New-RootCa.ps1 @('-Base', $B)
T 'R1 foreign ACE: New-RootCa also stops before using the folder' ($r.Rc -ne 0 -and $r.Out -match 'not private') $r.Out
$db = Acl; $db.Remove("$B/root/root_ca.key"); Save-Acl $db
T 'R1 after the targeted remedy: accepted again' ((Run New-PkiFolder.ps1 @('-Base', $B)).Rc -eq 0)

# Foreign inheritable ACE on a key folder: the folder and what inherits it are refused.
$db = Acl; $db["$B/issuing"] = @{ explicit = @((Ace $Other 'ReadAndExecute, Synchronize' $true)) }; Save-Acl $db
[IO.File]::WriteAllText("$B/issuing/intermediate_ca.key", $EncKey)
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 foreign inheritable ACE on issuing\: refused, the key listed as inherited' ($r.Rc -ne 0 -and $r.Out -match [regex]::Escape("/remove:g *$Other") -and $r.Out -match '(?s)intermediate_ca\.key.*inherited') $r.Out
$db = Acl; $db.Remove("$B/issuing"); $db["$B/issued"] = @{ owner = $Other }; Save-Acl $db
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 subfolder owned by another account: refused, no ownership taken' ($r.Rc -ne 0 -and $r.Out -match 'never takes ownership' -and (Acl)["$B/issued"].owner -eq $Other) $r.Out
$db = Acl; $db.Remove("$B/issued"); $db["$B/public"] = @{ explicit = @((Ace $Other 'Write' $false $false)) }; Save-Acl $db
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 deny entry for another principal: refused' ($r.Rc -ne 0 -and $r.Out -match '/remove:d') $r.Out
$db = Acl; $db.Remove("$B/public"); Save-Acl $db

# Redirected / reparse child (directory and file links): refused, never followed.
New-Item -ItemType Directory -Path "$W/outside" -Force | Out-Null; [IO.File]::WriteAllText("$W/outside/marker", 'x')
New-Item -ItemType SymbolicLink -Path "$B/issued/escape" -Target "$W/outside" | Out-Null
$h = Digest $env:SEYRA_TEST_ACL
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 junction-like child (directory link): refused' ($r.Rc -ne 0 -and $r.Out -match 'is a link or junction' -and $r.Out -match 'cmd /c rmdir') $r.Out
T 'R1 directory link: not followed, nothing changed' ((Digest $env:SEYRA_TEST_ACL) -eq $h -and (Get-Content -Raw "$W/outside/marker") -eq 'x' -and @(Get-ChildItem "$W/outside").Count -eq 1)
Remove-Item -LiteralPath "$B/issued/escape" -Force
New-Item -ItemType SymbolicLink -Path "$B/public/key-link" -Target "$B/root/root_ca.key" | Out-Null
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 file link to a key: refused (remedy deletes only the link)' ($r.Rc -ne 0 -and $r.Out -match 'cmd /c del') $r.Out
Remove-Item -LiteralPath "$B/public/key-link" -Force
[IO.File]::WriteAllText("$B/issuing/intermediate_ca.key", "-----BEGIN EC PRIVATE KEY-----`nTUlJ`n-----END EC PRIVATE KEY-----`n")
$r = Run New-PkiFolder.ps1 @('-Base', $B)
T 'R1 existing issuer key stored unencrypted: refused (key untouched)' ($r.Rc -ne 0 -and $r.Out -match 'stored encrypted' -and (Get-Content -Raw "$B/issuing/intermediate_ca.key") -match 'BEGIN EC PRIVATE KEY') $r.Out
[IO.File]::WriteAllText("$B/issuing/intermediate_ca.key", $EncKey)
T 'R1 tree restored: accepted' ((Run New-PkiFolder.ps1 @('-Base', $B)).Rc -eq 0)

# Folders an earlier version left (every child protected with an explicit owner entry): safe reuse.
$P2 = New-Profile 'p2'; $B2 = "$P2/Users/me/AppData/Local/SeyraPKI"
$db = Acl
foreach ($d in @('') + @(Get-SeyraManagedFolder | ForEach-Object { "/$_" })) { New-Item -ItemType Directory -Force -Path "$B2$d" | Out-Null; $db["$B2$d"] = @{ owner = $Me; protected = $true; explicit = @((Ace $Me)) } }
[IO.File]::WriteAllText("$B2/root/root_ca.key", $EncKey); $db["$B2/root/root_ca.key"] = @{ owner = $Me; protected = $true; explicit = @((Ace $Me 'FullControl' $false)) }
Save-Acl $db; $h = Digest $env:SEYRA_TEST_ACL
$r = Run New-PkiFolder.ps1 @('-Base', $B2)
T 'R1 reuse of a folder made by the earlier icacls /T version: accepted unchanged' ($r.Rc -eq 0 -and (Digest $env:SEYRA_TEST_ACL) -eq $h) $r.Out

# Unsafe Base: refused before any change.
$P3 = New-Profile 'p3'; $U = "$P3/Users/me"; $L3 = "$U/AppData/Local"
$h = Digest $env:SEYRA_TEST_ACL
foreach ($c in @(
        @('exact forbidden root (Desktop itself)', "$U/Desktop"), @('inside Documents', "$U/Documents/SeyraPKI"), @('inside OneDrive', "$U/OneDrive/SeyraPKI"),
        @('roaming AppData', "$U/AppData/Roaming/SeyraPKI"), @('temporary folder', "$L3/Temp/SeyraPKI"), @('%LOCALAPPDATA% itself', $L3),
        @('the profile itself', $U), @('a folder containing the profile', "$P3/Users"), @('filesystem root', '/'), @('sync-client name', "$L3/Dropbox/SeyraPKI"))) {
    $before = @(Get-ChildItem -LiteralPath $P3 -Recurse -Force | ForEach-Object FullName) -join '|'
    $r = Run New-PkiFolder.ps1 @('-Base', $c[1])
    $after = @(Get-ChildItem -LiteralPath $P3 -Recurse -Force | ForEach-Object FullName) -join '|'
    T "R1 unsafe Base refused before any change: $($c[0])" ($r.Rc -ne 0 -and $r.Out -match 'nothing was created or changed' -and $before -eq $after -and (Digest $env:SEYRA_TEST_ACL) -eq $h) $r.Out
}
New-Item -ItemType SymbolicLink -Path "$U/LinkToLocal" -Target $L3 | Out-Null
$r = Run New-PkiFolder.ps1 @('-Base', "$U/LinkToLocal/SeyraPKI")
T 'R1 Base reached through a link: refused, nothing created at the target' ($r.Rc -ne 0 -and $r.Out -match 'is a link' -and -not (Test-Path "$L3/SeyraPKI")) $r.Out
New-Item -ItemType SymbolicLink -Path "$L3/Dangling" -Target "$W/does-not-exist" | Out-Null
$r = Run New-PkiFolder.ps1 @('-Base', "$L3/Dangling")
T 'R1 Base that is a dangling link: refused' ($r.Rc -ne 0 -and $r.Out -match 'is a link' -and -not (Test-Path "$W/does-not-exist")) $r.Out
New-Item -ItemType Directory -Path "$L3/Other" | Out-Null; [IO.File]::WriteAllText("$L3/Other/notes.txt", 'mine')
$r = Run New-PkiFolder.ps1 @('-Base', "$L3/Other")
T 'R1 existing folder that is not a SeyraPKI folder: refused, untouched' ($r.Rc -ne 0 -and $r.Out -match 'not a SeyraPKI folder' -and @(Get-ChildItem "$L3/Other").Count -eq 1 -and (Digest $env:SEYRA_TEST_ACL) -eq $h) $r.Out
New-Item -ItemType Directory -Path "$L3/Empty" | Out-Null
$r = Run New-PkiFolder.ps1 @('-Base', "$L3/Empty")
T 'R1 existing folder inheriting its parent permissions: refused, not repaired' ($r.Rc -ne 0 -and $r.Out -match 'inherits permissions' -and $r.Out -match [regex]::Escape("/inheritance:r /grant:r `"*${Me}:(OI)(CI)F`"") -and @(Get-ChildItem "$L3/Empty").Count -eq 0 -and (Digest $env:SEYRA_TEST_ACL) -eq $h) $r.Out
[IO.File]::WriteAllText("$L3/AFile", 'x')
T 'R1 Base that is a file: refused' ((Run New-PkiFolder.ps1 @('-Base', "$L3/AFile")).Rc -ne 0)

# ---------------------------------------------------------------- R2: Add-RootTrust / Remove-RootTrust (actual scripts)
$P4 = New-Profile 'trust'; $B = "$P4/Users/me/AppData/Local/SeyraPKI"
T 'R2 setup: PKI folder created' ((Run New-PkiFolder.ps1 @('-Base', $B)).Rc -eq 0)
$Store = "$W/store"; New-Item -ItemType Directory -Force -Path $Store | Out-Null; $env:SEYRA_TEST_STORE = $Store
$cer = "$W/pki/root_ca.cer"; $sha = (Get-FileHash -LiteralPath $cer -Algorithm SHA256).Hash.ToLowerInvariant()
$thumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, [IO.File]::ReadAllBytes($cer))).Thumbprint
$ocer = "$W/pki/other_root.cer"; $osha = (Get-FileHash -LiteralPath $ocer -Algorithm SHA256).Hash.ToLowerInvariant()
$rec = "$B/trust/root-trust-record.json"
function Has { return (Test-Path -LiteralPath "$Store/$thumb.cer") }
function Rec { if (Test-Path -LiteralPath $rec) { return (Get-Content -Raw -LiteralPath $rec | ConvertFrom-Json) } return $null }
function ObservedText { return ([regex]::Match((Get-Content -Raw -LiteralPath $rec), '"observed_at":\s*"([^"]*)"').Groups[1].Value) }
function Archived { return @(Get-ChildItem -LiteralPath "$B/trust" -Filter 'root-trust-record.removed-*.json').Count }
function AddT([string]$Fault = '', [string]$Sha = $sha, [string]$Cer = $cer) { $env:SEYRA_TEST_FAULT = $Fault; return (Run Add-RootTrust.ps1 @('-RootCer', $Cer, '-ExpectedSha256', $Sha, '-Base', $B)) }
function UndoT([string]$Fault = '') { $env:SEYRA_TEST_FAULT = $Fault; return (Run Remove-RootTrust.ps1 @('-Base', $B)) }
$env:SEYRA_TEST_READONLY_DIR = "$B/trust"

& chmod 0555 "$B/trust"
$r = AddT
T 'R2 no record-write permission (no lock yet): refused before import' ($r.Rc -ne 0 -and $r.Out -match 'nothing was changed' -and -not (Has) -and $null -eq (Rec)) $r.Out
& chmod 0755 "$B/trust"; [IO.File]::WriteAllText("$B/trust/trust.lock", ''); & chmod 0555 "$B/trust"
$r = AddT
T 'R2 no record-write permission (lock present): refused by the write probe before import' ($r.Rc -ne 0 -and $r.Out -match 'cannot write the trust record' -and -not (Has) -and $null -eq (Rec)) $r.Out
& chmod 0755 "$B/trust"
$r = AddT '' $osha
T 'R2 wrong fingerprint typed: refused, nothing trusted or recorded' ($r.Rc -ne 0 -and -not (Has) -and $null -eq (Rec)) $r.Out
$r = AddT 'import-refused'
T 'R2 import refused / no effect: non-zero, nothing trusted, pending record withdrawn' ($r.Rc -ne 0 -and $r.Out -match 'NOT added' -and -not (Has) -and $null -eq (Rec)) $r.Out

$r = AddT 'import-then-crash'
$x = Rec
T 'R2 import succeeded, then the run was interrupted: root trusted, record pending, pre_existing false' ($r.Rc -eq 9 -and (Has) -and $null -ne $x -and $x.state -eq 'pending' -and $x.pre_existing -eq $false) $r.Out
$observed = ObservedText
$r = AddT
$x = Rec
T 'R2 retry reconciles: trusted, still NOT pre-existing, original observation kept' ($r.Rc -eq 0 -and $r.Out -match 'reconciling' -and $x.state -eq 'trusted' -and $x.pre_existing -eq $false -and (ObservedText) -ceq $observed -and $observed -cmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$') ($r.Out + ' observed ' + $observed + ' now ' + (ObservedText))
$r = AddT
T 'R2 repeated Add: no change, still not pre-existing' ($r.Rc -eq 0 -and (Rec).pre_existing -eq $false -and (Has)) $r.Out
$r = UndoT
T 'R2 undo removes the root this workflow added; record archived' ($r.Rc -eq 0 -and -not (Has) -and $null -eq (Rec) -and (Archived) -eq 1) $r.Out

$r = AddT 'import-effect-then-error'
T 'R2 import took effect but reported an error: recorded as added (trusted, not pre-existing)' ($r.Rc -eq 0 -and $r.Out -match 'IS in the store' -and (Has) -and (Rec).state -eq 'trusted' -and (Rec).pre_existing -eq $false) $r.Out
T 'R2 ... and undo removes it' ((UndoT).Rc -eq 0 -and -not (Has))

$r = AddT 'import-then-readonly'
& chmod 0755 "$B/trust"
T 'R2 import succeeded, final record write failed: non-zero, root trusted, record still pending/not pre-existing' ($r.Rc -ne 0 -and (Has) -and (Rec).state -eq 'pending' -and (Rec).pre_existing -eq $false) $r.Out
$r = AddT
T 'R2 ... retry completes it as added by this workflow' ($r.Rc -eq 0 -and (Rec).state -eq 'trusted' -and (Rec).pre_existing -eq $false) $r.Out
T 'R2 ... and undo removes it' ((UndoT).Rc -eq 0 -and -not (Has))

Copy-Item -LiteralPath $cer -Destination "$Store/$thumb.cer"
$r = AddT
T 'R2 genuinely pre-existing root: recorded pre_existing true, store unchanged' ($r.Rc -eq 0 -and $r.Out -match 'ALREADY trusted' -and (Rec).pre_existing -eq $true -and (Has)) $r.Out
$r = UndoT
T 'R2 undo leaves a genuinely pre-existing root in place (record archived)' ($r.Rc -eq 0 -and (Has) -and $null -eq (Rec)) $r.Out
Remove-Item -LiteralPath "$Store/$thumb.cer"

$r = AddT
T 'R2 setup: trusted by this workflow' ($r.Rc -eq 0 -and (Has))
$env:SEYRA_TEST_ACCOUNT_SID = $Other; $env:SEYRA_TEST_ACCOUNT_NAME = 'PC\other'
$r = UndoT
$env:SEYRA_TEST_ACCOUNT_SID = $Me; $env:SEYRA_TEST_ACCOUNT_NAME = 'PC\owner'
T 'R2 another account: refused (the folder is not theirs), store and record unchanged' ($r.Rc -ne 0 -and (Has) -and $null -ne (Rec)) $r.Out
$orig = Get-Content -Raw -LiteralPath $rec
$tamper = { param($Name, $Text, $Want) [IO.File]::WriteAllText($rec, $Text); $r = UndoT; T "R2 tampered record ($Name): refused, store unchanged" ($r.Rc -ne 0 -and $r.Out -match $Want -and (Has)) $r.Out; [IO.File]::WriteAllText($rec, $orig) }
& $tamper 'other account in the record' ($orig -replace [regex]::Escape($Me), $Other) 'another Windows account'
& $tamper 'other root bytes' ($orig -replace $sha, ('0' * 64)) 'different bytes'
& $tamper 'pre_existing flipped while pending' (($orig -replace '"trusted"', '"pending"') -replace '"pre_existing": false', '"pre_existing": true') 'pending for a root that pre-existed'
& $tamper 'unknown state' ($orig -replace '"trusted"', '"done"') "state 'done'"
& $tamper 'not JSON' '{ broken' 'not readable JSON'
& $tamper 'malformed timestamp' ($orig -replace '"observed_at":\s*"[^"]*"', '"observed_at": "yesterday"') 'malformed observed_at'
& $tamper 'other store' ($orig -replace 'CurrentUser\\\\Root', 'LocalMachine\\Root') 'names store'
$r = AddT '' $osha $ocer
T 'R2 Add for another root while a record exists: refused, record kept' ($r.Rc -ne 0 -and $r.Out -match 'is for another root' -and (Rec).sha256 -eq $sha) $r.Out
$r = UndoT 'remove-refused'
T 'R2 removal declined: non-zero, root and record kept' ($r.Rc -ne 0 -and (Has) -and $null -ne (Rec)) $r.Out
Remove-Item -LiteralPath "$Store/$thumb.cer"
$r = AddT
T 'R2 record says trusted but the root was removed outside: Add refuses with the next step' ($r.Rc -ne 0 -and $r.Out -match 'Run Remove-RootTrust.ps1' -and -not (Has)) $r.Out
$r = UndoT
T 'R2 ... Remove closes that record' ($r.Rc -eq 0 -and $null -eq (Rec)) $r.Out
$r = UndoT
T 'R2 Remove without a record: refused (nothing to undo)' ($r.Rc -ne 0 -and $r.Out -match 'nothing to undo') $r.Out
[IO.File]::WriteAllBytes("$Store/$thumb.cer", [byte[]](1, 2, 3))
$r = AddT
T 'R2 store entry with the thumbprint but other bytes: refused, untouched' ($r.Rc -ne 0 -and $r.Out -match 'different bytes' -and (Get-Item "$Store/$thumb.cer").Length -eq 3 -and $null -eq (Rec)) $r.Out
Remove-Item -LiteralPath "$Store/$thumb.cer"

# Review f4bd578 F1: the ORIGINAL external root file is replaced by another valid root after the check
# and before the store call. Importing the frozen checked root is correct; the other root never is.
$othumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, [IO.File]::ReadAllBytes($ocer))).Thumbprint
$savedRoot = [IO.File]::ReadAllBytes($cer)
$env:SEYRA_TEST_ORIGINAL_ROOT = $cer; $env:SEYRA_TEST_REPLACEMENT_ROOT = $ocer
try {
    $r = AddT 'swap-root-input'
    T 'F1 fixture: the external root file really was replaced at import time' ((Get-FileHash -LiteralPath $cer -Algorithm SHA256).Hash.ToLowerInvariant() -eq $osha)
    T 'F1 file changed after the check: the unchecked root is NOT in the store' (-not (Test-Path -LiteralPath "$Store/$othumb.cer")) $r.Out
    T 'F1 ... the checked root was imported and recorded as added by this workflow' ($r.Rc -eq 0 -and (Has) -and (Rec).state -eq 'trusted' -and (Rec).sha256 -eq $sha -and (Rec).pre_existing -eq $false) $r.Out
    T 'F1 ... the store entry is byte-identical to the checked root' ((Digest "$Store/$thumb.cer").ToLowerInvariant() -eq $sha)
} finally {
    [IO.File]::WriteAllBytes($cer, $savedRoot)
    Remove-Item Env:\SEYRA_TEST_ORIGINAL_ROOT, Env:\SEYRA_TEST_REPLACEMENT_ROOT -ErrorAction SilentlyContinue
    $env:SEYRA_TEST_FAULT = ''
}
$r = UndoT
T 'F1 ... undo removes exactly the checked root' ($r.Rc -eq 0 -and -not (Has) -and $null -eq (Rec)) $r.Out
$refused = $false
try { Add-SeyraRootStoreEntry ([IO.File]::ReadAllBytes($ocer)) $sha } catch { $refused = $_.Exception.Message -match 'not the checked root' }
T 'F1 the store boundary refuses bytes whose SHA-256 is not the checked one (nothing imported)' ($refused -and -not (Test-Path -LiteralPath "$Store/$othumb.cer"))

# Overlapping runs: the second waits for nothing and changes nothing.
$env:SEYRA_TEST_FAULT = 'slow-import'
$bg = Start-Process -FilePath pwsh -ArgumentList @('-NoProfile', '-NonInteractive', '-File', "$Win/Add-RootTrust.ps1", '-RootCer', $cer, '-ExpectedSha256', $sha, '-Base', $B) -PassThru -RedirectStandardOutput "$W/bg.out" -RedirectStandardError "$W/bg.err"
$null = $bg.Handle
Start-Sleep -Seconds 3
$r = AddT
$r2 = UndoT
$bg.WaitForExit()
T 'R2 overlapping Add while another run holds the lock: refused' ($r.Rc -ne 0 -and $r.Out -match 'another Add-RootTrust/Remove-RootTrust run is active') $r.Out
T 'R2 overlapping Remove while another run holds the lock: refused' ($r2.Rc -ne 0 -and $r2.Out -match 'run is active') $r2.Out
T 'R2 the first run completed normally' ($bg.ExitCode -eq 0 -and (Has) -and (Rec).state -eq 'trusted' -and (Rec).pre_existing -eq $false) ((Get-Content -Raw "$W/bg.out") + (Get-Content -Raw "$W/bg.err"))
T 'R2 a left-over lock file does not block a later run (OS lock, not file existence)' ((UndoT).Rc -eq 0 -and -not (Has) -and (Test-Path "$B/trust/trust.lock"))
T 'R2 the record folder holds no temporary or probe files' (@(Get-ChildItem -LiteralPath "$B/trust" -Force | Where-Object { $_.Name -match 'tmp-|probe' }).Count -eq 0)

Write-Output ("# lan-pki windows scripts (controlled boundary): checks={0} failed={1}" -f $n, $fails)
exit $(if ($fails) { 1 } else { 0 })
