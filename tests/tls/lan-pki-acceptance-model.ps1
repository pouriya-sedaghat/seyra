# TEST ONLY (Linux, PowerShell 7). Controlled model of the Windows operations used by
# tests/tls/windows/Test-LanPkiOnWindows.ps1 (passed to it as -TestModel; refused on Windows). The ACTUAL PKI
# scripts run against the controlled boundary of lan-pki-test-boundary.ps1 (SEYRA_TEST_* variables), and:
#   SEYRA_MODEL_LOCALAPPDATA / SEYRA_MODEL_DESKTOP  fixture folders
#   SEYRA_MODEL_FAULTS       "<step>=<SEYRA_TEST_FAULT>,..." for single script runs, e.g.
#                            W8=import-refused (you click No), W10=remove-refused, cleanup-remove=remove-refused
#   SEYRA_MODEL_LINK_FAULT   rmdir-fails: every link removal fails and leaves the link (cmd /c rmdir failing)
#   SEYRA_MODEL_ICACLS_FAULT grant | ungrant: that icacls call fails without effect
#   SEYRA_MODEL_THROW_AT     checkpoint name (before-import, after-import): an unexpected error there
#   SEYRA_MODEL_EXIT_AT      checkpoint name: the process ends at once there (interruption; no cleanup runs)
#   SEYRA_MODEL_LOG          one line per script run: "<step> <script>"
# Symbolic links stand in for junctions. Nothing here is Windows, NTFS or certificate-store evidence.
@{
    Mode         = { 'MODEL (Linux; not Windows evidence)' }
    Account      = { [pscustomobject]@{ Sid = $env:SEYRA_TEST_ACCOUNT_SID; Name = $env:SEYRA_TEST_ACCOUNT_NAME } }
    LocalAppData = { $env:SEYRA_MODEL_LOCALAPPDATA }
    Desktop      = { $env:SEYRA_MODEL_DESKTOP }
    Run          = {
        param([string]$Step, [string]$Script, [string[]]$ScriptArgs)
        $fault = ''
        foreach ($pair in ([string]$env:SEYRA_MODEL_FAULTS -split ',')) { $kv = $pair -split '=', 2; if ($kv.Count -eq 2 -and $kv[0] -eq $Step) { $fault = $kv[1] } }
        Add-Content -LiteralPath $env:SEYRA_MODEL_LOG -Value "$Step $Script"
        $saved = $env:SEYRA_TEST_FAULT; $env:SEYRA_TEST_FAULT = $fault
        try { $raw = @(& pwsh -NoProfile -NonInteractive -File (Join-Path $ScriptDir $Script) @ScriptArgs 2>&1 | ForEach-Object { "$_" }); $rc = $LASTEXITCODE }
        finally { $env:SEYRA_TEST_FAULT = $saved }
        # pwsh's error view colours and wraps messages behind a '|' gutter: strip both, re-join lines.
        $lines = @($raw -split "`n" | ForEach-Object { (($_ -replace "\x1b\[[0-9;]*[A-Za-z]", '') -replace '^\s*(\d+\s*)?\|\s?', '').Trim() })
        $text = ($lines -join ' ') -replace '\s+', ' '
        [pscustomobject]@{ Rc = $rc; Out = $text; Flat = ($text -replace '\s', '') }
    }
    AclFacts     = {
        param([string]$Path)
        $b = & $env:SEYRA_TEST_BOUNDARY
        $i = & $b.GetAclItem $Path
        [pscustomobject]@{ Owner = $i.Owner; Protected = $i.Protected; Aces = @($i.Aces) }
    }
    Fingerprint  = {
        param([string]$Path, [bool]$Recurse)
        $acl = ''; if (Test-Path -LiteralPath $env:SEYRA_TEST_ACL) { $acl = Get-Content -Raw -LiteralPath $env:SEYRA_TEST_ACL }
        $names = @(Get-ChildItem -LiteralPath $Path -Force -Recurse:$Recurse | ForEach-Object { $_.FullName } | Sort-Object)
        "$acl`n$($names -join "`n")"
    }
    Grant        = {
        param([string]$Path, [string]$Sid)
        if ($env:SEYRA_MODEL_ICACLS_FAULT -eq 'grant') { return 5 }
        $db = Get-Content -Raw -LiteralPath $env:SEYRA_TEST_ACL | ConvertFrom-Json -AsHashtable
        $e = $db[$Path]; if (-not $e) { $e = @{} }
        $e['explicit'] = @(@($e['explicit'] | Where-Object { $_ }) + @(@{ sid = $Sid; allow = $true; rights = 'Read, Synchronize'; inheritable = $false }))
        $db[$Path] = $e
        [IO.File]::WriteAllText($env:SEYRA_TEST_ACL, (($db | ConvertTo-Json -Depth 6) + "`n"))
        return 0
    }
    Ungrant      = {
        param([string]$Path, [string]$Sid)
        if ($env:SEYRA_MODEL_ICACLS_FAULT -eq 'ungrant') { return 5 }
        $db = Get-Content -Raw -LiteralPath $env:SEYRA_TEST_ACL | ConvertFrom-Json -AsHashtable
        if ($db[$Path]) { $db[$Path]['explicit'] = @($db[$Path]['explicit'] | Where-Object { $_ -and $_['sid'] -ne $Sid }) }
        [IO.File]::WriteAllText($env:SEYRA_TEST_ACL, (($db | ConvertTo-Json -Depth 6) + "`n"))
        return 0
    }
    NewJunction  = { param([string]$Path, [string]$Target) New-Item -ItemType SymbolicLink -Path $Path -Target $Target | Out-Null }
    RemoveLink   = {
        param([string]$Path)
        if ($env:SEYRA_MODEL_LINK_FAULT -eq 'rmdir-fails') { return 2 }
        & rm -- $Path; return $LASTEXITCODE
    }
    StoreHas     = {
        param([string]$Thumb, [string]$Sha)
        $f = Join-Path $env:SEYRA_TEST_STORE "$Thumb.cer"
        if (-not (Test-Path -LiteralPath $f)) { return $false }
        if ((Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha) { throw "a store entry with thumbprint $Thumb has different bytes" }
        return $true
    }
    Checkpoint   = {
        param([string]$Name)
        if ($Name -eq $env:SEYRA_MODEL_THROW_AT) { throw "model: unexpected error at $Name" }
        if ($Name -eq $env:SEYRA_MODEL_EXIT_AT) { [Environment]::Exit(7) }
    }
}
