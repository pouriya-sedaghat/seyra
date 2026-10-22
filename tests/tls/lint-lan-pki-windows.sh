#!/usr/bin/env bash
# Windows PowerShell 5.1 compatibility analysis of infra/tls/lan-pki/windows (static; no Windows needed):
# PSScriptAnalyzer 1.23.0 compatibility rules for syntax 5.1 and the Windows Server 2019 / PowerShell
# 5.1.17763 / .NET Framework 4.x command and type profile, then all Error/Warning rules.
# Installs PSScriptAnalyzer from the PowerShell Gallery into a throw-away container (needs network,
# hence --network host); the scripts are mounted read-only.
#
#   PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 tests/tls/lint-lan-pki-windows.sh [<windows-dir>]
set -uo pipefail
: "${PWSH_IMAGE:?}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$(cd "${1:-$repo/infra/tls/lan-pki/windows}" && pwd)"
docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$dir:/win:ro" "$PWSH_IMAGE" pwsh -NoProfile -Command '
$ProgressPreference = "SilentlyContinue"
Install-Module PSScriptAnalyzer -RequiredVersion 1.23.0 -Scope CurrentUser -Force -AcceptLicense -ErrorAction Stop
Import-Module PSScriptAnalyzer
"PSScriptAnalyzer " + (Get-Module PSScriptAnalyzer).Version
$profile51 = "win-48_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework"
$settings = @{ IncludeRules = @("PSUseCompatibleSyntax", "PSUseCompatibleCommands", "PSUseCompatibleTypes"); Rules = @{
  PSUseCompatibleSyntax   = @{ Enable = $true; TargetVersions = @("5.1") }
  PSUseCompatibleCommands = @{ Enable = $true; TargetProfiles = @($profile51) }
  PSUseCompatibleTypes    = @{ Enable = $true; TargetProfiles = @($profile51) } } }
$files = Get-ChildItem /win -Include *.ps1, *.psm1 -Recurse
$r = $files | ForEach-Object { Invoke-ScriptAnalyzer -Path $_.FullName -Settings $settings }
$r | ForEach-Object { "{0}:{1} {2} {3}" -f $_.ScriptName, $_.Line, $_.RuleName, $_.Message }
"compat findings: " + @($r).Count
$all = $files | ForEach-Object { Invoke-ScriptAnalyzer -Path $_.FullName -Severity Error, Warning }
$all | ForEach-Object { "{0}:{1} {2} {3}" -f $_.ScriptName, $_.Line, $_.RuleName, ($_.Message -split "`n")[0] }
"error/warning findings: " + @($all).Count
if (@($r).Count -gt 0) { exit 1 }'
