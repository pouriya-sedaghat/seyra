# Download the pinned Smallstep CLI (step) for this PC's architecture into the user-local SeyraPKI
# tools folder, verify the zip's SHA-256 against the pin BEFORE extracting anything, and report the
# executable's Authenticode status as it is (the pinned release is verified by checksum; see README).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Get-StepCli.ps1 [-Base <dir>]
#
# Pins (official release v0.31.0, https://github.com/smallstep/cli/releases/tag/v0.31.0): the SHA-256
# values equal the release's checksums.txt, whose cosign signature names the release workflow of
# smallstep/cli at refs/tags/v0.31.0.
[CmdletBinding()]
param([string]$Base)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'SeyraPki.psm1') -Force
$Base = Get-SeyraBase $Base

$version = '0.31.0'
$pins = @{
    'AMD64' = @{ Url = 'https://github.com/smallstep/cli/releases/download/v0.31.0/step_windows_0.31.0_amd64.zip'; Sha256 = '3b8dc1245fb1dffe3b57bf10cac9b3da9808ed42f7274f869085e1086214d0f4' }
    'ARM64' = @{ Url = 'https://github.com/smallstep/cli/releases/download/v0.31.0/step_windows_0.31.0_arm64.zip'; Sha256 = 'f5be7139b78db9d051274c029cc3aefa7d87c16d4867a430eddfebdc8689d922' }
}
$arch = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
if (-not $pins.ContainsKey($arch)) { throw "unsupported architecture '$arch' (pinned: AMD64, ARM64)" }
$pin = $pins[$arch]

$tools = Join-Path $Base 'tools'
if (-not (Test-Path -LiteralPath $Base)) { throw "$Base does not exist; run New-PkiFolder.ps1 first (it sets the folder permissions)" }
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$zip = Join-Path $tools ([IO.Path]::GetFileName($pin.Url))
if (-not (Test-Path -LiteralPath $zip)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Write-Host "downloading $($pin.Url)"
    Invoke-WebRequest -Uri $pin.Url -OutFile $zip -UseBasicParsing
}
$got = Get-SeyraFileSha256 $zip
if ($got -ne $pin.Sha256) {
    Remove-Item -LiteralPath $zip
    throw "SHA-256 MISMATCH for $zip`n  got      $got`n  expected $($pin.Sha256)`nThe download was deleted and nothing was extracted or run."
}
Write-Host "  ok  zip SHA-256 equals the pin ($got, $arch)"
Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force
$exe = Join-Path $tools ("step_{0}\bin\step.exe" -f $version)
if (-not (Test-Path -LiteralPath $exe)) { throw "step.exe not found at $exe after extraction" }
$sig = Get-AuthenticodeSignature -LiteralPath $exe
Write-Host ("  Authenticode status of step.exe: {0} (recorded as observed; trust rests on the pinned SHA-256)" -f $sig.Status)
$v = & $exe version
if ($LASTEXITCODE -ne 0) { throw "step version failed" }
Write-Host ("  {0}" -f ($v -join ' '))
if (($v -join ' ') -notmatch [regex]::Escape("Smallstep CLI/$version")) { throw "unexpected step version: $($v -join ' ')" }
Write-Host "step $version ready: $exe"
