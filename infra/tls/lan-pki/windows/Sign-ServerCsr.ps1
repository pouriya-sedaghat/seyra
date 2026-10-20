# Sign the VM's server CSR with the issuing CA: 90 days (+5 minutes back-dating for clock skew),
# CA false, digitalSignature, serverAuth ONLY, SAN exactly the IP from the request manifest. Before
# signing it checks the root, the issuing CA and that the CSR is the VM's exact request (file
# SHA-256, public-key fingerprint, the single IP SAN). CSR extensions are not copied: the template
# sets every extension. step asks for the ISSUING CA key password. The result is checked again.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Sign-ServerCsr.ps1 -RequestDir <folder with server.csr + request-manifest.json> [-Base <dir>]
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RequestDir, [string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base
$step = Get-SeyraStep $Base
$csr = Join-Path $RequestDir 'server.csr'
$manifestPath = Join-Path $RequestDir 'request-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne 'seyra.lan-csr-request/1') { throw "unexpected manifest schema '$($manifest.schema)'" }
$ip = Get-SeyraExpectedIp $manifest
$rootCrt = Join-Path $Base 'root\root_ca.crt'
$intCrt = Join-Path $Base 'issuing\intermediate_ca.crt'
$intKey = Join-Path $Base 'issuing\intermediate_ca.key'
$tpl = Join-Path $PSScriptRoot 'server-leaf.tpl'

$root = Test-SeyraCaCert -Step $step -Path $rootCrt -Kind root
$int = Test-SeyraCaCert -Step $step -Path $intCrt -Kind issuing -Issuer $root
Write-Host 'request:'
Test-SeyraCsr -Step $step -Csr $csr -Manifest $manifest | Out-Null

$out = Join-Path $Base ('issued\{0}' -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
if (Test-Path -LiteralPath $out) { throw "$out exists" }
New-Item -ItemType Directory -Path $out | Out-Null
$leaf = Join-Path $out 'server.crt'
Write-Host "signing for IP $ip (enter the ISSUING CA key password)"
$pem = & $step certificate sign $csr $intCrt $intKey --template $tpl --set "ip=$ip" --not-before -5m --not-after 2160h
if ($LASTEXITCODE -ne 0) { throw "step certificate sign failed (exit $LASTEXITCODE)" }
Write-SeyraUtf8 $leaf ((($pem | ForEach-Object { "$_" }) -join "`n") + "`n")
Copy-Item -LiteralPath $csr -Destination (Join-Path $out 'server.csr')
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $out 'request-manifest.json')

Write-Host 'issued certificate:'
$c = Test-SeyraLeafCert -Step $step -Path $leaf -Issuer $int -Manifest $manifest
$bundle = Join-Path $out 'server-chain.pem'
Write-SeyraUtf8 $bundle (((Get-Content -LiteralPath $leaf -Raw).TrimEnd() + "`n" + (Get-Content -LiteralPath $intCrt -Raw).TrimEnd()) + "`n")
& $step certificate verify $bundle --roots $rootCrt --host $ip
if ($LASTEXITCODE -ne 0) { throw 'the issued chain does not verify for the IP against the root' }
Write-Host "  ok  chain (leaf + issuing CA) verifies against the root for $ip"
Write-Host ("leaf SHA-256 fingerprint {0}; valid {1} .. {2}" -f $c.fingerprint_sha256, $c.validity.start, $c.validity.end)
Write-Host "issued into $out. Next: Export-PublicPacket.ps1 -IssuedDir `"$out`""
