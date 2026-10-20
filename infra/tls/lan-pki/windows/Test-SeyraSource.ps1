# One fresh HTTPS request (new process state, keep-alive disabled) for the source-boundary checks.
# Classifies the outcome and prints a UTC timestamp so it can be matched with the VM-side edge/proxy
# log record. Normal certificate validation (Windows store) stays on.
#   allowed     HTTP 200
#   forbidden   HTTP 403 from the inner relay (the inner proxy saw a source outside its allow list)
#   no-response connection closed/reset before any HTTP response (edge allow list); proof of an edge
#               denial is the matching VM-side "access forbidden by rule" record, not this alone
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-SeyraSource.ps1 -Url https://<VM_LAN_ADDR>:<PORT>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Url)
Set-StrictMode -Version 2
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$t = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$outcome = 'error'; $detail = ''
try {
    $r = Invoke-WebRequest -Uri ($Url.TrimEnd('/') + '/health/live') -UseBasicParsing -DisableKeepAlive -TimeoutSec 15
    $outcome = 'allowed'; $detail = "HTTP $($r.StatusCode)"
} catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($null -ne $resp) {
        $code = [int]$resp.StatusCode
        if ($code -eq 403) { $outcome = 'forbidden' } else { $outcome = 'other-http' }
        $detail = "HTTP $code"
    } else {
        $detail = "$($_.Exception.Status): $($_.Exception.Message)"
        if ($_.Exception.Status -in @('ConnectionClosed', 'ReceiveFailure', 'SecureChannelFailure', 'KeepAliveFailure')) { $outcome = 'no-response' }
    }
} catch { $detail = $_.Exception.Message }
Write-Host ("{0} {1} {2}" -f $t, $outcome, $detail)
