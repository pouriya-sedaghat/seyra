# TEST ONLY (Linux, PowerShell 7), run by tests/tls/test-lan-pki-windows.sh in the pwsh container once per
# time zone (TZ=UTC, Asia/Tehran, America/New_York; the host's zone database mounted read-only) and JSON form:
#   SEYRA_JSON_FORM=native  PowerShell 7: step's ISO times arrive as DateTime values (kind Utc)
#   SEYRA_JSON_FORM=ps51    Windows PowerShell 5.1's form (strings), emulated by lan-pki-json51-shim.ps1
#   SEYRA_TIME_MODE=after   the full suite against SEYRA_MODULE_DIR (the current scripts)
#   SEYRA_TIME_MODE=before  only the desired-behaviour checks that also apply to an older module (used to
#                           record the 352bd9a behaviour); everything else is reported NOT RUN
# Review 352bd9a Windows-time finding: certificate instants must be compared in UTC on every PC.
$ErrorActionPreference = 'Stop'
$W = '/w'; $P = "$W/pki"; $Mod = $env:SEYRA_MODULE_DIR; $Form = $env:SEYRA_JSON_FORM; $Mode = $env:SEYRA_TIME_MODE
$fails = 0; $n = 0; $notrun = 0
$Tag = "[$($env:TZ) $Form $Mode]"
function T([string]$Name, [bool]$Cond, [string]$Detail = '') {
    $script:n++
    if ($Cond) { Write-Output "PASS $Tag $Name" } else { $script:fails++; $d = ($Detail -replace '\s+', ' '); if ($d.Length -gt 900) { $d = $d.Substring(0, 300) + ' ... ' + $d.Substring($d.Length - 600) }; Write-Output "FAIL $Tag $Name -- $d" }
}
function NR([string]$Name, [string]$Why, [int]$Count = 1) { $script:notrun += $Count; Write-Output "NOT RUN $Tag $Name -- $Why" }
function Done { Write-Output ("# lan-pki certificate times {0}: checks={1} failed={2} notrun={3}" -f $Tag, $n, $fails, $notrun); exit $(if ($fails) { 1 } else { 0 }) }
function Accepts([scriptblock]$Body) { try { & $Body *> $null; return $true } catch { $script:lastError = $_.Exception.Message; return $false } }
function TimeVal([string]$Key) { return [regex]::Match((Get-Content -Raw -LiteralPath "$P/times.json"), ('"{0}":\s*"([^"]+)"' -f $Key)).Groups[1].Value }

# The zone must really be in effect (a missing zone database silently means UTC).
$off = [TimeZoneInfo]::Local.GetUtcOffset([DateTime]::UtcNow)
$offText = ('{0}{1:hh\:mm}' -f $(if ($off -lt [TimeSpan]::Zero) { '-' } else { '+' }), $off)
T "time zone in effect: $offText (expected $env:SEYRA_EXPECT_OFFSET)" ($offText -eq $env:SEYRA_EXPECT_OFFSET)
if ($offText -ne $env:SEYRA_EXPECT_OFFSET) { Done }

$env:SEYRA_STEP_EXE = "$W/bin/step"
if ($Mode -eq 'after') {
    $env:SEYRA_TEST_BOUNDARY = "$W/lan-pki-test-boundary.ps1"
    $env:SEYRA_TEST_NOW = TimeVal 'now'   # a fixed reference "now" (the module reads it via the test boundary)
}
if ($Form -eq 'ps51') { . "$W/lan-pki-json51-shim.ps1" }
Import-Module "$Mod/SeyraPki.psm1" -Force
$S = Get-SeyraStep
$info = Get-SeyraCertInfo $S "$P/leaf-backdated.crt"
T "JSON form is $Form (NotBefore arrives as $($info.validity.start.GetType().Name))" (($Form -eq 'ps51' -and $info.validity.start -is [string]) -or ($Form -eq 'native' -and $info.validity.start -is [datetime]))

# ---- pure normalisation (current module only)
if ($Mode -eq 'after') {
    $want = [DateTime]::new(2026, 10, 21, 14, 35, 54, [DateTimeKind]::Utc)
    $same = { param($v) $u = ConvertTo-SeyraUtc $v; return ($u.Kind -eq [DateTimeKind]::Utc -and $u -eq $want) }
    T 'Z, +03:30 and -04:00 forms of one instant are equal in UTC' ((& $same '2026-10-21T14:35:54Z') -and (& $same '2026-10-21T18:05:54+03:30') -and (& $same '2026-10-21T10:35:54-04:00'))
    T 'a DateTime from PowerShell 7 JSON keeps its instant' (& $same ((Microsoft.PowerShell.Utility\ConvertFrom-Json '{"t":"2026-10-21T14:35:54Z"}').t))
    T 'a [datetime] cast of the ISO string (Local kind, the 5.1 path) keeps its instant' (& $same ([datetime]'2026-10-21T14:35:54Z'))
    T 'a DateTimeOffset keeps its instant' (& $same ([DateTimeOffset]::Parse('2026-10-21T18:05:54+03:30', [Globalization.CultureInfo]::InvariantCulture)))
    T 'fractional seconds are accepted' ((ConvertTo-SeyraUtc '2026-10-21T14:35:54.5Z') -eq $want.AddMilliseconds(500))
    foreach ($bad in @('2026-10-21T14:35:54', '2026-10-21 14:35:54Z', '2026-13-01T00:00:00Z', 'yesterday', '', '21/10/2026 14:35:54')) {
        T "malformed or unzoned '$bad' is refused" (-not (Accepts { ConvertTo-SeyraUtc $bad }))
    }
    T 'a DateTime of kind Unspecified is refused (it would be read as local time)' (-not (Accepts { ConvertTo-SeyraUtc ([DateTime]::new(2026, 10, 21, 14, 35, 54)) }))
    T '$null and numbers are refused' (-not (Accepts { ConvertTo-SeyraUtc $null }) -and -not (Accepts { ConvertTo-SeyraUtc 1761057354 }))
    T 'formatting is UTC and invariant' ((Format-SeyraUtc '2026-10-21T18:05:54+03:30') -ceq '2026-10-21T14:35:54Z')
    T 'the test clock is the fixed reference time' ((Format-SeyraUtc (Get-SeyraUtcNow)) -ceq (TimeVal 'now'))
} else { NR 'pure normalisation (ConvertTo-SeyraUtc, Format-SeyraUtc, test clock)' 'not present in this module' 15 }

# ---- the actual validation helpers
$root = $null; $int = $null; $short = $null
T 'root accepted' (Accepts { $script:root = Test-SeyraCaCert -Step $S -Path "$P/root_ca.crt" -Kind root })
T 'issuing CA accepted (does not outlive the root)' (Accepts { $script:int = Test-SeyraCaCert -Step $S -Path "$P/intermediate_ca.crt" -Kind issuing -Issuer $root })
$m = Microsoft.PowerShell.Utility\ConvertFrom-Json (Get-Content -Raw -LiteralPath "$P/m-good.json")
$leaf = { param($File, $Issuer = $int) Test-SeyraLeafCert -Step $S -Path "$P/$File" -Issuer $Issuer -Manifest $m }
T 'a valid back-dated leaf (NotBefore now-5m) is accepted' (Accepts { & $leaf 'leaf-backdated.crt' }) $lastError
T 'a leaf whose NotBefore is 2 h in the future is refused' (-not (Accepts { & $leaf 'leaf-future.crt' }))
if ($Mode -eq 'after') {
    T 'NotBefore 30 s after now is accepted (inside the unchanged 1-minute allowance)' (Accepts { & $leaf 'leaf-edge-ok.crt' }) $lastError
    T 'NotBefore 2 min after now is refused (outside the allowance)' (-not (Accepts { & $leaf 'leaf-edge-bad.crt' }))
} else { NR 'allowance edges (+30 s / +2 min)' 'need the fixed test clock, absent in this module' 2 }
T 'leaves ending at 22:45Z and 01:15Z (90 days) are accepted' ((Accepts { & $leaf 'leaf-late.crt' }) -and (Accepts { & $leaf 'leaf-early.crt' })) $lastError
T 'a leaf outliving its issuing CA is still refused' (-not (Accepts { $si = Get-SeyraCertInfo $S "$P/short_int.crt"; & $leaf 'leaf-outlives.crt' $si }))

# ---- renew_before as 352bd9a's Export-PublicPacket computed it (comparator demonstration, before mode only:
#      that script cannot run on Linux because of its Windows-only 'root\root_ca.crt' paths)
if ($Mode -eq 'before') {
    foreach ($k in 'late', 'early') {
        $end = (Get-SeyraCertInfo $S "$P/leaf-$k.crt").validity.end
        $old = ([datetime]$end).AddDays(-30).ToString('yyyy-MM-dd')
        T "comparator demo: 352bd9a renew_before expression for the $k leaf gives the UTC date $(TimeVal "${k}_renew")" ($old -eq (TimeVal "${k}_renew")) "it gave $old"
    }
    NR 'actual Sign-ServerCsr -CheckIssuedDir / Export-PublicPacket runs' 'not present in / not runnable on Linux for this version' 1
    Done
}

# ---- the actual scripts, as separate processes: recovery check of explicit attempts, then export
$Me = 'S-1-5-21-1000-1000-1000-1001'
$env:SEYRA_TEST_ACCOUNT_SID = $Me; $env:SEYRA_TEST_ACCOUNT_NAME = 'PC\owner'
$Fx = "$W/fx-time-$(($env:TZ) -replace '/', '_')-$Form"; $U = "$Fx/Users/me"; $L = "$U/AppData/Local"; $B = "$L/SeyraPKI"
foreach ($dir in "$U/Desktop", $L) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
@{ Under = @("$U/Desktop"); Exact = @($U, $L) } | Microsoft.PowerShell.Utility\ConvertTo-Json | Set-Content -LiteralPath "$Fx/policy.json"
$env:SEYRA_TEST_POLICY = "$Fx/policy.json"; $env:SEYRA_TEST_ACL = "$Fx/acl.json"
$ace = { param($Sid) @{ sid = $Sid; allow = $true; rights = 'FullControl'; inheritable = $true } }
[IO.File]::WriteAllText($env:SEYRA_TEST_ACL, ((@{ $U = @{ owner = $Me; protected = $true; explicit = @((& $ace $Me), (& $ace 'S-1-5-18')) } } | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 6) + "`n"))
function Run([string]$Script, [hashtable]$A) {
    $argv = @('-NoProfile', '-NonInteractive', '-File', "$W/lan-pki-run-as.ps1", '-Form', $Form, '-Script', "$Mod/$Script")
    foreach ($k in $A.Keys) { $argv += @("-$k", $A[$k]) }
    $raw = @(& pwsh @argv 2>&1 | ForEach-Object { "$_" }); $rc = $LASTEXITCODE
    $text = (@($raw -split "`n" | ForEach-Object { (($_ -replace "\x1b\[[0-9;]*[A-Za-z]", '') -replace '^\s*(\d+\s*)?\|\s?', '').Trim() }) -join ' ') -replace '\s+', ' '
    return [pscustomobject]@{ Rc = $rc; Out = $text; Flat = ($text -replace '\s', '') }
}
function Has($R, [string]$Text) { return $R.Flat.Contains(($Text -replace '\s', '')) }
function TreeDigest([string]$Dir) { return (@(Get-ChildItem -LiteralPath $Dir -Recurse -Force | Sort-Object FullName | ForEach-Object { if ($_.PSIsContainer) { "d $($_.FullName)" } else { "f $($_.FullName) $((Get-FileHash -LiteralPath $_.FullName).Hash)" } }) -join "`n") }

$r = Run New-PkiFolder.ps1 @{ Base = $B }
T 'fixture PKI folder created' ($r.Rc -eq 0) $r.Out
if ($r.Rc -ne 0) { Done }
foreach ($f in 'root_ca.crt', 'root_ca.key') { Copy-Item "$P/$f" "$B/root/" }
foreach ($f in 'intermediate_ca.crt', 'intermediate_ca.key') { Copy-Item "$P/$f" "$B/issuing/" }
$Req = "$Fx/delivered-request"; New-Item -ItemType Directory -Path $Req | Out-Null
Copy-Item "$P/good.csr" "$Req/server.csr"; Copy-Item "$P/m-good.json" "$Req/request-manifest.json"
$att = [ordered]@{ empty = '20261021T120000Z'; partial = '20261021T121500Z'; cand = '20261021T123000Z'; late = '20261021T124000Z'; early = '20261021T124100Z'; future = '20261021T124200Z'; wrongcsr = '20261021T124300Z'; otherkey = '20261021T124400Z' }
$leafOf = @{ cand = 'leaf-backdated.crt'; late = 'leaf-late.crt'; early = 'leaf-early.crt'; future = 'leaf-future.crt'; wrongcsr = 'leaf-backdated.crt'; otherkey = 'leaf-otherkey.crt' }
foreach ($k in $att.Keys) {
    $d = "$B/issued/$($att[$k])"; New-Item -ItemType Directory -Path $d | Out-Null
    if ($k -eq 'empty') { continue }
    Copy-Item "$P/good.csr" "$d/server.csr"
    if ($k -eq 'partial') { continue }
    Copy-Item "$P/m-good.json" "$d/request-manifest.json"; Copy-Item "$P/$($leafOf[$k])" "$d/server.crt"
}
Copy-Item -Force "$P/extra.csr" "$B/issued/$($att.wrongcsr)/server.csr"
$issuedBefore = TreeDigest "$B/issued"
$chk = { param($k) Run Sign-ServerCsr.ps1 @{ Base = $B; RequestDir = $Req; CheckIssuedDir = "$B/issued/$($att[$k])" } }
$r = & $chk 'cand'
T 'recovery: the explicitly named candidate passes (request binding, leaf in UTC, actual chain for the IP)' ($r.Rc -eq 0 -and (Has $r 'byte-identical to the delivered VM request') -and (Has $r 'chain (leaf + issuing CA) verifies against the root') -and (Has $r 'already valid')) $r.Out
$r = Run Sign-ServerCsr.ps1 @{ Base = $B; RequestDir = $Req; CheckIssuedDir = "$B/issued/$($att.cand)/" }
T 'recovery: the same attempt named with a trailing separator is accepted' ($r.Rc -eq 0) $r.Out
$r = & $chk 'empty'
T 'recovery: an empty attempt is refused (missing server.crt)' ($r.Rc -ne 0 -and (Has $r 'not a completed issuance attempt') -and (Has $r 'server.crt')) $r.Out
$r = & $chk 'partial'
T 'recovery: a partial attempt is refused' ($r.Rc -ne 0 -and (Has $r 'missing: server.crt, request-manifest.json')) $r.Out
$r = Run Sign-ServerCsr.ps1 @{ Base = $B; RequestDir = $Req; CheckIssuedDir = "$B/root" }
T 'recovery: a folder that is not inside issued is refused' ($r.Rc -ne 0 -and (Has $r 'is not a folder directly inside')) $r.Out
$r = & $chk 'wrongcsr'
T 'recovery: an attempt whose server.csr is not the delivered request is refused' ($r.Rc -ne 0 -and (Has $r 'its server.csr is byte-identical') -and (Has $r 'CHECK FAILED')) $r.Out
$r = & $chk 'otherkey'
T 'recovery: a leaf for another key is refused' ($r.Rc -ne 0 -and (Has $r 'public key equals the VM request')) $r.Out
$r = & $chk 'future'
T 'recovery: a leaf with a future NotBefore is refused (already valid)' ($r.Rc -ne 0 -and (Has $r 'CHECK FAILED: already valid')) $r.Out
T 'recovery checks wrote and deleted nothing in any attempt' ((TreeDigest "$B/issued") -eq $issuedBefore)

$exp = { param($k) Run Export-PublicPacket.ps1 @{ Base = $B; IssuedDir = "$B/issued/$($att[$k])" } }
foreach ($k in 'cand', 'late', 'early') {
    $r = & $exp $k
    $pub = "$B/public/$($att[$k])"
    $mm = $null; if (Test-Path "$pub/issued-manifest.json") { $mm = Microsoft.PowerShell.Utility\ConvertFrom-Json -AsHashtable (Get-Content -Raw "$pub/issued-manifest.json") }
    $key = @{ cand = 'good'; late = 'late'; early = 'early' }[$k]
    $raw = ''; if ($mm) { $raw = Get-Content -Raw "$pub/issued-manifest.json" }
    $nb = [regex]::Match($raw, '"not_before":\s*"([^"]+)"').Groups[1].Value; $na = [regex]::Match($raw, '"not_after":\s*"([^"]+)"').Groups[1].Value
    $rb = [regex]::Match($raw, '"renew_before":\s*"([^"]+)"').Groups[1].Value
    T "export ($k): exit 0, the five public files, chain verified" ($r.Rc -eq 0 -and @(Get-ChildItem -LiteralPath $pub -ErrorAction SilentlyContinue).Count -eq 5 -and (Has $r 'chain (leaf + issuing CA) verifies')) $r.Out
    T "export ($k): validity written as the exact UTC instants" ($nb -ceq (TimeVal "${key}_nb") -and $na -ceq (TimeVal "${key}_na")) "not_before $nb, not_after $na"
    T "export ($k): renew_before is the UTC date $(TimeVal "${key}_renew")" ($rb -ceq (TimeVal "${key}_renew")) "renew_before $rb"
    T "export ($k): CA dates are UTC ISO strings" ($raw -cmatch '"issuing_ca":[^}]*"not_after":\s*"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"' -and $raw -cmatch '"root_ca":[^}]*"not_after":\s*"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"')
}
$before = TreeDigest "$B/public"
$r = & $exp 'cand'
T 'export: an existing public packet is never overwritten' ($r.Rc -ne 0 -and (Has $r 'not overwriting') -and (TreeDigest "$B/public") -eq $before) $r.Out
$r = & $exp 'empty'
T 'export: an empty attempt is refused' ($r.Rc -ne 0 -and (Has $r 'not a completed issuance attempt')) $r.Out
$r = & $exp 'future'
T 'export: a leaf with a future NotBefore is refused, nothing exported' ($r.Rc -ne 0 -and -not (Test-Path "$B/public/$($att.future)")) $r.Out
T 'exports changed no attempt' ((TreeDigest "$B/issued") -eq $issuedBefore)
Done
