# Assemble the PUBLIC packet to return to the VM: server.crt (leaf), intermediate_ca.crt, root_ca.crt,
# root_ca.cer (DER, for Windows/Apple/Android trust), and issued-manifest.json (fingerprints, validity,
# the request binding and file checksums). Refuses if any file would contain a private key.
# -IssuedDir names the attempt explicitly (<Base>\issued\<stamp>; never chosen by age). Before anything is
# written it re-checks the leaf (all times in UTC) and its actual chain for the IP against the root. An
# existing public\<stamp> is never overwritten. Times in the manifest are UTC (yyyy-MM-ddTHH:mm:ssZ) and
# renew_before is the UTC calendar date 30 days before NotAfter, the same on every PC and time zone.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Export-PublicPacket.ps1 -IssuedDir <Base>\issued\<stamp> [-Base <dir>]
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$IssuedDir, [string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
Assert-SeyraPkiFolder $Base   # read-only: private to this account, no links, keys encrypted
$step = Get-SeyraStep $Base
$IssuedDir = Resolve-SeyraIssuedDir $Base $IssuedDir
$manifest = Get-Content -LiteralPath (Join-Path $IssuedDir 'request-manifest.json') -Raw | ConvertFrom-Json
$rootCrt = Join-Path (Join-Path $Base 'root') 'root_ca.crt'
$intCrt = Join-Path (Join-Path $Base 'issuing') 'intermediate_ca.crt'
$leafCrt = Join-Path $IssuedDir 'server.crt'
$root = Test-SeyraCaCert -Step $step -Path $rootCrt -Kind root
$int = Test-SeyraCaCert -Step $step -Path $intCrt -Kind issuing -Issuer $root
$leaf = Test-SeyraLeafCert -Step $step -Path $leafCrt -Issuer $int -Manifest $manifest
Test-SeyraIssuedChain -Step $step -Leaf $leafCrt -Intermediate $intCrt -Root $rootCrt -Ip (Get-SeyraExpectedIp $manifest)
$lv = Get-SeyraValidity $leaf 'leaf'
$inv = [Globalization.CultureInfo]::InvariantCulture

$out = Join-Path (Join-Path $Base 'public') (Split-Path $IssuedDir -Leaf)
if (Test-Path -LiteralPath $out) { throw "$out exists; not overwriting it (a packet was already exported from this attempt)" }
New-Item -ItemType Directory -Path $out | Out-Null
Copy-Item -LiteralPath $leafCrt -Destination (Join-Path $out 'server.crt')
Copy-Item -LiteralPath $intCrt -Destination (Join-Path $out 'intermediate_ca.crt')
Copy-Item -LiteralPath $rootCrt -Destination (Join-Path $out 'root_ca.crt')
& $step certificate format (Join-Path $out 'root_ca.crt') --out (Join-Path $out 'root_ca.cer')
if ($LASTEXITCODE -ne 0) { throw 'DER conversion failed' }
$rootDerSha = Get-SeyraFileSha256 (Join-Path $out 'root_ca.cer')
Assert-Seyra ($rootDerSha -eq $root.fingerprint_sha256) 'root_ca.cer file SHA-256 equals the root certificate fingerprint'
$x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $out 'root_ca.cer')

$files = [ordered]@{}
foreach ($f in @('server.crt', 'intermediate_ca.crt', 'root_ca.crt', 'root_ca.cer')) { $files[$f] = Get-SeyraFileSha256 (Join-Path $out $f) }
$m = [ordered]@{
    schema            = 'seyra.lan-issued/1'
    created_at        = Format-SeyraUtc ([DateTime]::UtcNow)
    request           = [ordered]@{ ip = $manifest.sans[0].value; csr_file_sha256 = $manifest.csr_file_sha256; spki_sha256 = $manifest.spki_sha256 }
    leaf              = [ordered]@{ subject = $leaf.subject_dn; sha256_fingerprint = $leaf.fingerprint_sha256; not_before = (Format-SeyraUtc $lv.Start); not_after = (Format-SeyraUtc $lv.End); serial = $leaf.serial_number; renew_before = $lv.End.AddDays(-30).ToString('yyyy-MM-dd', $inv) }
    issuing_ca        = [ordered]@{ subject = $int.subject_dn; sha256_fingerprint = $int.fingerprint_sha256; not_after = (Format-SeyraUtc $int.validity.end 'issuing CA NotAfter') }
    root_ca           = [ordered]@{ subject = $root.subject_dn; sha256_fingerprint = $root.fingerprint_sha256; windows_thumbprint_sha1 = $x509.Thumbprint; not_after = (Format-SeyraUtc $root.validity.end 'root NotAfter') }
    files_sha256      = $files
    revocation        = 'none published (no CRL/OCSP/AIA); revocation is manual: re-issue, or rotate the issuing CA/root and update trust'
}
Write-SeyraUtf8 (Join-Path $out 'issued-manifest.json') (($m | ConvertTo-Json -Depth 5) + "`n")
Assert-SeyraNoPrivateKey $out
Write-Host "public packet: $out"
Get-ChildItem -LiteralPath $out | ForEach-Object { Write-Host ("  {0}" -f $_.Name) }
Write-Host ("leaf valid {0} .. {1} (UTC); renew before {2}" -f $m.leaf.not_before, $m.leaf.not_after, $m.leaf.renew_before)
Write-Host ("root SHA-256 fingerprint (compare out of band): {0}" -f $root.fingerprint_sha256)
Write-Host ("root Windows thumbprint (SHA-1): {0}" -f $x509.Thumbprint)
