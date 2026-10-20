# Assemble the PUBLIC packet to return to the VM: server.crt (leaf), intermediate_ca.crt, root_ca.crt,
# root_ca.cer (DER, for Windows/Apple/Android trust), and issued-manifest.json (fingerprints, validity,
# the request binding and file checksums). Refuses if any file would contain a private key.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Export-PublicPacket.ps1 -IssuedDir <issued\stamp> [-Base <dir>]
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$IssuedDir, [string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
$step = Get-SeyraStep $Base
$manifest = Get-Content -LiteralPath (Join-Path $IssuedDir 'request-manifest.json') -Raw | ConvertFrom-Json
$root = Test-SeyraCaCert -Step $step -Path (Join-Path $Base 'root\root_ca.crt') -Kind root
$int = Test-SeyraCaCert -Step $step -Path (Join-Path $Base 'issuing\intermediate_ca.crt') -Kind issuing -Issuer $root
$leaf = Test-SeyraLeafCert -Step $step -Path (Join-Path $IssuedDir 'server.crt') -Issuer $int -Manifest $manifest

$out = Join-Path $Base ('public\{0}' -f (Split-Path $IssuedDir -Leaf))
if (Test-Path -LiteralPath $out) { throw "$out exists" }
New-Item -ItemType Directory -Path $out | Out-Null
Copy-Item -LiteralPath (Join-Path $IssuedDir 'server.crt') -Destination (Join-Path $out 'server.crt')
Copy-Item -LiteralPath (Join-Path $Base 'issuing\intermediate_ca.crt') -Destination (Join-Path $out 'intermediate_ca.crt')
Copy-Item -LiteralPath (Join-Path $Base 'root\root_ca.crt') -Destination (Join-Path $out 'root_ca.crt')
& $step certificate format (Join-Path $out 'root_ca.crt') --out (Join-Path $out 'root_ca.cer')
if ($LASTEXITCODE -ne 0) { throw 'DER conversion failed' }
$rootDerSha = Get-SeyraFileSha256 (Join-Path $out 'root_ca.cer')
Assert-Seyra ($rootDerSha -eq $root.fingerprint_sha256) 'root_ca.cer file SHA-256 equals the root certificate fingerprint'
$x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $out 'root_ca.cer')

$files = [ordered]@{}
foreach ($f in @('server.crt', 'intermediate_ca.crt', 'root_ca.crt', 'root_ca.cer')) { $files[$f] = Get-SeyraFileSha256 (Join-Path $out $f) }
$m = [ordered]@{
    schema            = 'seyra.lan-issued/1'
    created_at        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    request           = [ordered]@{ ip = $manifest.sans[0].value; csr_file_sha256 = $manifest.csr_file_sha256; spki_sha256 = $manifest.spki_sha256 }
    leaf              = [ordered]@{ subject = $leaf.subject_dn; sha256_fingerprint = $leaf.fingerprint_sha256; not_before = $leaf.validity.start; not_after = $leaf.validity.end; serial = $leaf.serial_number; renew_before = ([datetime]$leaf.validity.end).AddDays(-30).ToString('yyyy-MM-dd') }
    issuing_ca        = [ordered]@{ subject = $int.subject_dn; sha256_fingerprint = $int.fingerprint_sha256; not_after = $int.validity.end }
    root_ca           = [ordered]@{ subject = $root.subject_dn; sha256_fingerprint = $root.fingerprint_sha256; windows_thumbprint_sha1 = $x509.Thumbprint; not_after = $root.validity.end }
    files_sha256      = $files
    revocation        = 'none published (no CRL/OCSP/AIA); revocation is manual: re-issue, or rotate the issuing CA/root and update trust'
}
Write-SeyraUtf8 (Join-Path $out 'issued-manifest.json') (($m | ConvertTo-Json -Depth 5) + "`n")
Assert-SeyraNoPrivateKey $out
Write-Host "public packet: $out"
Get-ChildItem -LiteralPath $out | ForEach-Object { Write-Host ("  {0}" -f $_.Name) }
Write-Host ("root SHA-256 fingerprint (compare out of band): {0}" -f $root.fingerprint_sha256)
Write-Host ("root Windows thumbprint (SHA-1): {0}" -f $x509.Thumbprint)
