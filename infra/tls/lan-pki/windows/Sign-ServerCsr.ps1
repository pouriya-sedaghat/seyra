# Sign the VM's server CSR with the issuing CA: 90 days (+5 minutes back-dating for clock skew),
# CA false, digitalSignature, serverAuth ONLY, SAN exactly the IP from the request manifest. Before
# signing it checks the root, the issuing CA and that the CSR is the VM's exact request (file
# SHA-256, public-key fingerprint, the single IP SAN). CSR extensions are not copied: the template
# sets every extension. step asks for the ISSUING CA key password. The result is checked again:
# the leaf (all times compared in UTC) and its actual chain for the IP against the root.
#
# -CheckIssuedDir: recovery of an EXISTING attempt; nothing is signed, written or deleted. The attempt is
# named explicitly (never chosen by age) and must be <Base>\issued\<stamp> with server.crt, server.csr and
# request-manifest.json; its server.csr and request-manifest.json must be byte-identical to -RequestDir
# (the delivered VM request). Then the same leaf and chain checks run as after signing.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Sign-ServerCsr.ps1 -RequestDir <folder with server.csr + request-manifest.json> [-Base <dir>]
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Sign-ServerCsr.ps1 -RequestDir <delivered request folder> -CheckIssuedDir <Base>\issued\<stamp> [-Base <dir>]
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RequestDir, [string]$Base, [string]$CheckIssuedDir)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
Assert-SeyraPkiFolder $Base   # read-only: private to this account, no links, keys encrypted
$step = Get-SeyraStep $Base
$csr = Join-Path $RequestDir 'server.csr'
$manifestPath = Join-Path $RequestDir 'request-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne 'seyra.lan-csr-request/1') { throw "unexpected manifest schema '$($manifest.schema)'" }
$ip = Get-SeyraExpectedIp $manifest
$rootCrt = Join-Path (Join-Path $Base 'root') 'root_ca.crt'
$intCrt = Join-Path (Join-Path $Base 'issuing') 'intermediate_ca.crt'
$intKey = Join-Path (Join-Path $Base 'issuing') 'intermediate_ca.key'
$tpl = Join-Path $PSScriptRoot 'server-leaf.tpl'

$root = Test-SeyraCaCert -Step $step -Path $rootCrt -Kind root
$int = Test-SeyraCaCert -Step $step -Path $intCrt -Kind issuing -Issuer $root
Write-Host 'request:'
Test-SeyraCsr -Step $step -Csr $csr -Manifest $manifest | Out-Null

if ($CheckIssuedDir) {
    $out = Resolve-SeyraIssuedDir $Base $CheckIssuedDir
    Write-Host "existing issuance attempt $out (re-checked only; nothing is signed, written or deleted):"
    Assert-Seyra ((Get-SeyraFileSha256 (Join-Path $out 'server.csr')) -eq (Get-SeyraFileSha256 $csr)) 'its server.csr is byte-identical to the delivered VM request'
    Assert-Seyra ((Get-SeyraFileSha256 (Join-Path $out 'request-manifest.json')) -eq (Get-SeyraFileSha256 $manifestPath)) 'its request-manifest.json is byte-identical to the delivered one'
    $leaf = Join-Path $out 'server.crt'
} else {
    $out = Join-Path (Join-Path $Base 'issued') ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ', [Globalization.CultureInfo]::InvariantCulture))
    if (Test-Path -LiteralPath $out) { throw "$out exists" }
    New-Item -ItemType Directory -Path $out | Out-Null
    $leaf = Join-Path $out 'server.crt'
    Write-Host "signing for IP $ip (enter the ISSUING CA key password)"
    $pem = & $step certificate sign $csr $intCrt $intKey --template $tpl --set "ip=$ip" --not-before -5m --not-after 2160h
    if ($LASTEXITCODE -ne 0) { throw "step certificate sign failed (exit $LASTEXITCODE)" }
    Write-SeyraUtf8 $leaf ((($pem | ForEach-Object { "$_" }) -join "`n") + "`n")
    Copy-Item -LiteralPath $csr -Destination (Join-Path $out 'server.csr')
    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $out 'request-manifest.json')
}

Write-Host 'issued certificate:'
$c = Test-SeyraLeafCert -Step $step -Path $leaf -Issuer $int -Manifest $manifest
Test-SeyraIssuedChain -Step $step -Leaf $leaf -Intermediate $intCrt -Root $rootCrt -Ip $ip
$v = Get-SeyraValidity $c 'leaf'
Write-Host ("leaf SHA-256 fingerprint {0}; valid {1} .. {2} (UTC)" -f $c.fingerprint_sha256, (Format-SeyraUtc $v.Start), (Format-SeyraUtc $v.End))
Write-Host "verified: $out. Next: Export-PublicPacket.ps1 -IssuedDir `"$out`""
