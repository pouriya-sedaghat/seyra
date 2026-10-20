# Trust the Seyra LAN root for the CURRENT Windows user only (Cert:\CurrentUser\Root). Imports the
# PUBLIC root only, after its file SHA-256 equals the fingerprint you obtained independently (typed
# here, not read from the same packet). Records whether it already existed so Remove-RootTrust.ps1
# removes only a root this script added. Windows shows a security warning: confirm only if the
# displayed thumbprint equals the one printed here.
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
$Base = Get-SeyraBase $Base
$record = Join-Path $Base 'trust\root-trust-record.json'
if (Test-Path -LiteralPath $record) { throw "a trust record already exists ($record); run Remove-RootTrust.ps1 first or inspect it" }

$expected = ($ExpectedSha256 -replace '[:\s]', '').ToLowerInvariant()
$got = Get-SeyraFileSha256 $RootCer
Assert-Seyra ($got -eq $expected) "root_ca.cer SHA-256 equals the independently obtained fingerprint ($got)"
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $RootCer
$bc = $cert.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] }
Assert-Seyra ($null -ne $bc -and $bc.CertificateAuthority) 'certificate is a CA'
Assert-Seyra ($cert.Subject -eq $cert.Issuer) "self-signed root: $($cert.Subject)"
Assert-Seyra (-not $cert.HasPrivateKey) 'public certificate only'

$existing = @(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })
$pre = $existing.Count -gt 0
if (-not $pre) {
    Write-Host ("importing into Cert:\CurrentUser\Root; Windows will ask for confirmation: the thumbprint shown must be {0}" -f $cert.Thumbprint)
    Import-Certificate -FilePath $RootCer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
}
$now = @(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })
Assert-Seyra ($now.Count -eq 1) 'root present in Cert:\CurrentUser\Root'
$r = [ordered]@{ store = 'Cert:\CurrentUser\Root'; thumbprint_sha1 = $cert.Thumbprint; sha256 = $got; subject = $cert.Subject; pre_existing = $pre; recorded_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name }
Write-SeyraUtf8 $record (($r | ConvertTo-Json) + "`n")
if ($pre) { Write-Host 'the root was ALREADY trusted before this script; Remove-RootTrust.ps1 will not remove it.' }
Write-Host ("trusted for {0}: thumbprint {1}; record {2}" -f $r.account, $cert.Thumbprint, $record)
