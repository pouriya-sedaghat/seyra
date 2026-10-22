# Trust the Seyra LAN root for the CURRENT Windows user only (Cert:\CurrentUser\Root). Imports the
# PUBLIC root only, after its file SHA-256 equals the fingerprint you obtained independently (typed
# here, not read from the same packet). Windows shows a security warning: confirm only if the
# displayed thumbprint equals the one printed here.
#
# The file is read ONCE: those bytes are hashed, parsed, recorded and imported (the store boundary
# takes the bytes, not the path), so changing the file after the check cannot change what is trusted.
#
# Recoverable record (SeyraPKI\trust\root-trust-record.json, so Remove-RootTrust.ps1 removes only a
# root this workflow added):
#   - one run at a time (trust\trust.lock); the record folder must be writable before anything else;
#   - BEFORE any store change the record is written durably with the original observation
#     (pre_existing = whether this exact root was already trusted) and state "pending";
#   - after the import the store is checked again: present -> state "trusted"; absent (you declined,
#     or policy blocked it) -> nothing was trusted and the pending record is withdrawn;
#   - after an interruption, a re-run reconciles the pending record with the store and keeps the
#     original observation (a root this workflow added is never re-classified as pre-existing);
#   - a damaged record, another account's record or another root's record stops the run unchanged.
#
# Scope: every application that uses this account's certificate store will trust certificates this
# root (and its issuing CA) signs, for any name, not only the map VM's address. It does not affect
# other Windows users, LocalMachine, phones or other machines.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Add-RootTrust.ps1 -RootCer <public\...\root_ca.cer> -ExpectedSha256 <64 hex> [-Base <dir>]
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RootCer, [Parameter(Mandatory = $true)][string]$ExpectedSha256, [string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = [IO.Path]::GetFullPath((Get-SeyraBase $Base))
$acct = Get-SeyraAccount
Assert-SeyraPkiFolder $Base
$trust = Join-Path $Base 'trust'
$recordPath = Join-Path $trust 'root-trust-record.json'

$RootCer = (Resolve-Path -LiteralPath $RootCer).ProviderPath
$expected = ($ExpectedSha256 -replace '[:\s]', '').ToLowerInvariant()
$der = [IO.File]::ReadAllBytes($RootCer)   # the only read of the file; everything below uses these bytes
$sha = Get-SeyraSha256Hex $der
Assert-Seyra ($sha -eq $expected) "root_ca.cer SHA-256 equals the independently obtained fingerprint ($sha)"
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, $der)
Assert-Seyra ((Get-SeyraSha256Hex $cert.RawData) -eq $sha) 'the file is exactly one DER certificate'
$bc = $cert.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] }
Assert-Seyra ($null -ne $bc -and $bc.CertificateAuthority) 'certificate is a CA'
Assert-Seyra ($cert.Subject -eq $cert.Issuer) "self-signed root: $($cert.Subject)"
Assert-Seyra (-not $cert.HasPrivateKey) 'public certificate only'
$thumb = $cert.Thumbprint

$lock = Open-SeyraLock (Join-Path $trust 'trust.lock')
try {
    Assert-SeyraWritable $trust
    $present = Test-SeyraRootPresent $thumb $sha
    if (Test-Path -LiteralPath $recordPath) {
        $r = Read-SeyraTrustRecord $recordPath $acct.Sid $sha
        if ($r.thumbprint_sha1 -ne $thumb) { throw "CHECK FAILED: trust record $recordPath has thumbprint $($r.thumbprint_sha1), not $thumb; nothing was changed" }
        $pre = [bool]$r.pre_existing
        $observed = [string]$r.observed_at
        Write-Host ("existing record: state {0}, pre_existing {1} (observed {2}); root in store now: {3}" -f $r.state, $pre, $observed, $present)
        if ($r.state -eq 'trusted' -and -not $present) {
            throw "the record says this root is trusted, but it is no longer in Cert:\CurrentUser\Root (removed outside this workflow). Nothing was changed. Run Remove-RootTrust.ps1 to close the record, then Add-RootTrust.ps1 again."
        }
        if ($r.state -eq 'pending' -and $present) { Write-Host '  reconciling: an earlier run''s import had taken effect; it stays recorded as added by this workflow' }
    } else {
        $pre = $present
        $observed = Get-SeyraUtcStamp
        $state = 'pending'; if ($pre) { $state = 'trusted' }
        Write-SeyraFileDurable $recordPath (Format-SeyraTrustRecord $acct $sha $thumb $cert.Subject $pre $state $observed)
        Write-Host ("  ok  recorded before any store change: pre_existing {0}, state {1}" -f $pre, $state)
    }

    if (-not $present) {
        Write-Host ("importing into Cert:\CurrentUser\Root; Windows will ask for confirmation: the thumbprint shown must be {0}" -f $thumb)
        $importError = $null
        try { Add-SeyraRootStoreEntry $der $sha } catch { $importError = $_.Exception.Message }
        $present = Test-SeyraRootPresent $thumb $sha
        if (-not $present) {
            Remove-Item -LiteralPath $recordPath -Force
            $detail = ''; if ($importError) { $detail = ": $importError" }
            throw "the checked root $thumb was NOT added to Cert:\CurrentUser\Root (only its checked bytes were offered to the store; the pending record was withdrawn)$detail"
        }
        if ($importError) { Write-Host "  note: the import reported '$importError', but the root IS in the store" }
    }
    $final = Format-SeyraTrustRecord $acct $sha $thumb $cert.Subject $pre 'trusted' $observed
    Write-SeyraFileDurable $recordPath $final
    Assert-Seyra (Test-SeyraRootPresent $thumb $sha) 'root present in Cert:\CurrentUser\Root'
    Assert-Seyra ((Read-SeyraTrustRecord $recordPath $acct.Sid $sha).state -eq 'trusted') 'trust record complete'
} finally {
    $lock.Dispose()
}
if ($pre) { Write-Host 'this root was ALREADY trusted before this workflow; Remove-RootTrust.ps1 will leave it in place.' }
Write-Host ("trusted for {0}: thumbprint {1}; record {2}" -f $acct.Name, $thumb, $recordPath)
