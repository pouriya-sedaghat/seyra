# TEST ONLY (Linux, PowerShell 7). Stand-in for the Windows-only "boundary" of
# infra/tls/lan-pki/windows/SeyraPki.psm1, loaded when SEYRA_TEST_BOUNDARY names this file (the module
# refuses that variable on Windows). The real scripts then run unchanged against:
#   SEYRA_TEST_ACCOUNT_SID / SEYRA_TEST_ACCOUNT_NAME   the "current account"
#   SEYRA_TEST_POLICY   JSON {"Under": [...], "Exact": [...]}: the protected folders of a fixture profile
#   SEYRA_TEST_ACL      JSON {"<full path>": {"owner": sid, "protected": bool,
#                                             "explicit": [{"sid", "allow", "rights", "inheritable"}]}}
#                       NTFS-like model: an item without an entry is owned by the account, not protected,
#                       without explicit entries; its effective entries are its explicit ones plus (unless
#                       protected) its parent's inheritable ones, marked inherited.
#   SEYRA_TEST_STORE    directory standing in for Cert:\CurrentUser\Root (<THUMBPRINT>.cer, DER)
#   SEYRA_TEST_FAULT    import-refused | import-effect-then-error | import-then-crash | swap-root-input
#                       (rewrites SEYRA_TEST_ORIGINAL_ROOT with SEYRA_TEST_REPLACEMENT_ROOT at import time) |
#                       import-then-readonly (makes SEYRA_TEST_READONLY_DIR read-only after the import) |
#                       slow-import (holds the run for 6 s) | remove-refused
# Links and directories are taken from the real (Linux) filesystem: a symbolic link reports
# ReparsePoint, as a junction or symbolic link does on Windows.
$loadAcl = {
    if ($env:SEYRA_TEST_ACL -and (Test-Path -LiteralPath $env:SEYRA_TEST_ACL)) { return (Get-Content -Raw -LiteralPath $env:SEYRA_TEST_ACL | Microsoft.PowerShell.Utility\ConvertFrom-Json -AsHashtable) }
    return @{}
}
$saveAcl = { param($Db) [IO.File]::WriteAllText($env:SEYRA_TEST_ACL, (($Db | ConvertTo-Json -Depth 6) + "`n")) }
@{
    # SEYRA_TEST_NOW (ISO 8601 with a zone) fixes the module's "now" for deterministic time tests.
    UtcNow     = { if ($env:SEYRA_TEST_NOW) { $env:SEYRA_TEST_NOW } else { [DateTime]::UtcNow } }
    Account    = { [pscustomobject]@{ Sid = $env:SEYRA_TEST_ACCOUNT_SID; Name = $env:SEYRA_TEST_ACCOUNT_NAME } }
    BasePolicy = {
        $p = Get-Content -Raw -LiteralPath $env:SEYRA_TEST_POLICY | Microsoft.PowerShell.Utility\ConvertFrom-Json
        [pscustomobject]@{ Under = @($p.Under); Exact = @($p.Exact) }
    }
    GetAclItem = {
        param([string]$Path)
        $db = & $loadAcl
        $acct = $env:SEYRA_TEST_ACCOUNT_SID
        function Get-Effective([string]$P) {
            $e = $null; if ($db.ContainsKey($P)) { $e = $db[$P] }
            $owner = $acct; $prot = $false; $explicit = @()
            if ($e) { if ($e['owner']) { $owner = $e['owner'] }; $prot = [bool]$e['protected']; $explicit = @($e['explicit']) }
            $aces = @($explicit | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ Sid = $_['sid']; Allow = [bool]$_['allow']; Rights = $_['rights']; Inherited = $false; Inheritable = [bool]$_['inheritable'] } })
            $parent = [IO.Path]::GetDirectoryName($P)
            if (-not $prot -and $parent) {
                $aces += @((Get-Effective $parent).Aces | Where-Object { $_.Inheritable } | ForEach-Object { [pscustomobject]@{ Sid = $_.Sid; Allow = $_.Allow; Rights = $_.Rights; Inherited = $true; Inheritable = $true } })
            }
            return [pscustomobject]@{ Owner = $owner; Protected = $prot; Aces = $aces }
        }
        $attr = [IO.File]::GetAttributes($Path)
        $isDir = [bool]($attr -band [IO.FileAttributes]::Directory)
        if ($attr -band [IO.FileAttributes]::ReparsePoint) { return [pscustomobject]@{ Path = $Path; IsDirectory = $isDir; IsLink = $true; Owner = ''; Protected = $false; Aces = @() } }
        $eff = Get-Effective $Path
        return [pscustomobject]@{ Path = $Path; IsDirectory = $isDir; IsLink = $false; Owner = $eff.Owner; Protected = $eff.Protected; Aces = @($eff.Aces | ForEach-Object { [pscustomobject]@{ Sid = $_.Sid; Allow = $_.Allow; Rights = $_.Rights; Inherited = $_.Inherited } }) }
    }.GetNewClosure()
    SetOwnerOnlyAcl = {
        param([string]$Path, [string]$Sid)
        $db = & $loadAcl
        $db[$Path] = @{ owner = $Sid; protected = $true; explicit = @(@{ sid = $Sid; allow = $true; rights = 'FullControl'; inheritable = $true }) }
        & $saveAcl $db
    }.GetNewClosure()
    StoreFind = {
        param([string]$Thumbprint)
        $f = Join-Path $env:SEYRA_TEST_STORE "$Thumbprint.cer"
        if (-not (Test-Path -LiteralPath $f)) { return @() }
        return @([pscustomobject]@{ Thumbprint = $Thumbprint; RawData = [IO.File]::ReadAllBytes($f) })
    }
    StoreImport = {
        param([byte[]]$Der)
        if ($env:SEYRA_TEST_FAULT -eq 'swap-root-input') {
            # The ORIGINAL external root file changes after Add-RootTrust checked it (review f4bd578 F1).
            # The store receives the caller's bytes, so this must not change what is imported.
            [IO.File]::WriteAllBytes($env:SEYRA_TEST_ORIGINAL_ROOT, [IO.File]::ReadAllBytes($env:SEYRA_TEST_REPLACEMENT_ROOT))
        }
        if ($env:SEYRA_TEST_FAULT -eq 'import-refused') { throw 'The operation was canceled by the user.' }
        $bytes = [byte[]]$Der.Clone()
        $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, $bytes)
        [IO.File]::WriteAllBytes((Join-Path $env:SEYRA_TEST_STORE "$($c.Thumbprint).cer"), $bytes)
        switch ($env:SEYRA_TEST_FAULT) {
            'import-effect-then-error' { throw 'simulated: the import took effect, then reported an error' }
            'import-then-crash' { [Environment]::Exit(9) }
            'import-then-readonly' { & chmod 0555 $env:SEYRA_TEST_READONLY_DIR }
            'slow-import' { Start-Sleep -Seconds 6 }
        }
    }
    StoreRemove = {
        param([string]$Thumbprint)
        if ($env:SEYRA_TEST_FAULT -eq 'remove-refused') { throw 'The operation was canceled by the user.' }
        Remove-Item -LiteralPath (Join-Path $env:SEYRA_TEST_STORE "$Thumbprint.cer") -Force
    }
}
