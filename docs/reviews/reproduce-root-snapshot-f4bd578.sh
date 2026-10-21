#!/usr/bin/env bash
# Prepared Linux/PowerShell controlled-boundary regression; no Windows trust is changed.
# NOT EXECUTED by the reviewer: CoreCLR cannot start in the review sandbox.
# Uses the candidate's actual scripts and original pinned-Step test harness. Extends only its
# Linux store stand-in to mutate the original public root input at import time.
#
# STEP_LINUX=/verified/step-0.31.0 PWSH_IMAGE=<existing-pwsh-image> \
# DOCKER_RUN_IMAGE=<existing-shell-image> bash reproduce-root-snapshot-f4bd578.sh <candidate-tree>
set -euo pipefail
src="$(cd "${1:?candidate tree required}" && pwd)"
: "${STEP_LINUX:?}" "${PWSH_IMAGE:?}" "${DOCKER_RUN_IMAGE:?}"
w="$(mktemp -d)"
trap 'chmod -R u+w "$w" 2>/dev/null || true; rm -rf "$w"' EXIT
mkdir -p "$w/infra/tls" "$w/tests/tls"
cp -a "$src/infra/tls/lan-pki" "$w/infra/tls/"
cp -a "$src/tests/tls/." "$w/tests/tls/"
python3 - "$w" <<'PY'
from pathlib import Path
import sys
w=Path(sys.argv[1])
p=w/'tests/tls/lan-pki-test-boundary.ps1'
s=p.read_text()
needle='''        $bytes = [IO.File]::ReadAllBytes($CerPath)'''
assert s.count(needle)==1
s=s.replace(needle,'''        # Change the ORIGINAL external input after Add-RootTrust checked it.
        # A corrected boundary may consume frozen bytes/a private snapshot instead;
        # that checked object must remain unaffected by this external-path change.
        if ($env:SEYRA_TEST_FAULT -eq 'swap-root-input') {
            [IO.File]::WriteAllBytes($env:SEYRA_TEST_ORIGINAL_ROOT,
                [IO.File]::ReadAllBytes($env:SEYRA_TEST_REPLACEMENT_ROOT))
        }
'''+needle)
p.write_text(s)
p=w/'tests/tls/lan-pki-windows-scripts.tests.ps1'
s=p.read_text()
marker='Write-Output ("# lan-pki windows scripts (controlled boundary):'
assert s.count(marker)==1
pos=s.index(marker)
extra=r'''
# Follow-up F1: validation must bind the exact bytes actually imported.
$savedRoot = [IO.File]::ReadAllBytes($cer)
$env:SEYRA_TEST_ORIGINAL_ROOT = $cer
$env:SEYRA_TEST_REPLACEMENT_ROOT = $ocer
$otherThumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, [IO.File]::ReadAllBytes($ocer))).Thumbprint
$wrongStoreFile = Join-Path $Store "$otherThumb.cer"
try {
    $r = AddT 'swap-root-input'
    $wrongPresent = Test-Path -LiteralPath $wrongStoreFile
    Write-Output ("FOLLOWUP F1: exit={0}, unchecked_root_in_store={1}, record_present={2}, output={3}" -f $r.Rc, $wrongPresent, (Test-Path -LiteralPath $rec), $r.Out)
    T 'F1 changing external root input never installs an unchecked root' (-not $wrongPresent) $r.Out
    T 'F1 rejection never claims nothing trusted while unchecked root remains' (-not ($wrongPresent -and $r.Out -match 'nothing is trusted')) $r.Out
} finally {
    [IO.File]::WriteAllBytes($cer, $savedRoot)
    Remove-Item Env:\SEYRA_TEST_ORIGINAL_ROOT, Env:\SEYRA_TEST_REPLACEMENT_ROOT -ErrorAction SilentlyContinue
    $env:SEYRA_TEST_FAULT = ''
    # File-backed fixture only; never a real certificate store.
    if (Test-Path -LiteralPath $wrongStoreFile) { Remove-Item -LiteralPath $wrongStoreFile -Force }
}

'''
s=s[:pos]+extra+s[pos:]
p.write_text(s)
PY
bash "$w/tests/tls/test-lan-pki-windows.sh"
