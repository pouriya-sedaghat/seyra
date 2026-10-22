# TEST ONLY (Linux, PowerShell 7): run one actual LAN PKI script in a fresh process, with -Form ps51
# loading the Windows PowerShell 5.1 JSON-form emulation (lan-pki-json51-shim.ps1) first.
param([ValidateSet('native', 'ps51')][string]$Form, [string]$Script, [string]$Base, [string]$RequestDir, [string]$IssuedDir, [string]$CheckIssuedDir)
$ErrorActionPreference = 'Stop'
if ($Form -eq 'ps51') { . (Join-Path $PSScriptRoot 'lan-pki-json51-shim.ps1') }
$a = @{}
foreach ($k in 'Base', 'RequestDir', 'IssuedDir', 'CheckIssuedDir') { $v = Get-Variable -Name $k -ValueOnly; if ($v) { $a[$k] = $v } }
& $Script @a
