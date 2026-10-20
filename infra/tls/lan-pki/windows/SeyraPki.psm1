# Seyra LAN private PKI: shared checks for the Windows issuer scripts (Windows PowerShell 5.1+).
# Every function verifies the actual certificate contents (via `step certificate inspect`) instead of
# trusting a command's exit status. Nothing here reads, prints or stores a private key or password.
Set-StrictMode -Version 2

$script:StepVersion = '0.31.0'

function Get-SeyraBase {
    param([string]$Base)
    if (-not $Base) {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set; pass -Base explicitly' }
        $Base = Join-Path $env:LOCALAPPDATA 'SeyraPKI'
    }
    return $Base
}

function Get-SeyraStep {
    param([string]$Base)
    if ($env:SEYRA_STEP_EXE) { return $env:SEYRA_STEP_EXE } # test harness only (Linux step build)
    $exe = Join-Path (Get-SeyraBase $Base) ("tools\step_{0}\bin\step.exe" -f $script:StepVersion)
    if (-not (Test-Path -LiteralPath $exe)) { throw "step $script:StepVersion not found at $exe; run Get-StepCli.ps1 first" }
    return $exe
}

function Invoke-SeyraStepText {
    param([string]$Step, [string[]]$Arguments)
    $out = & $Step @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ("step {0} failed (exit {1}): {2}" -f ($Arguments -join ' '), $LASTEXITCODE, ($out -join ' ')) }
    return ($out | ForEach-Object { "$_" }) -join "`n"
}

function Get-SeyraCertInfo {
    param([string]$Step, [string]$Path)
    return (Invoke-SeyraStepText $Step @('certificate', 'inspect', $Path, '--format', 'json')) | ConvertFrom-Json
}

function Get-SeyraSha256Hex {
    param([byte[]]$Bytes)
    $h = [System.Security.Cryptography.SHA256]::Create()
    try { return -join ($h.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) } finally { $h.Dispose() }
}

function Get-SeyraFileSha256 {
    param([string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-SeyraTrueProperties {
    # Names of the properties whose value is $true (the set of usages a step JSON object asserts).
    param($Object)
    if ($null -eq $Object) { return @() }
    return @($Object.PSObject.Properties | Where-Object { $_.Value -is [bool] -and $_.Value } | ForEach-Object { $_.Name } | Sort-Object)
}

function Get-SeyraJsonStringList {
    # A JSON string array (or null) found by key in raw JSON text; used for CSR JSON, which carries
    # integers too large for Windows PowerShell's JSON parser.
    param([string]$Json, [string]$Key)
    $m = [regex]::Match($Json, ('"{0}":\s*(null|\[[^\]]*\])' -f [regex]::Escape($Key)))
    if (-not $m.Success) { return $null }
    # The leading comma keeps an empty or one-element array intact (PowerShell unrolls returns).
    if ($m.Groups[1].Value -eq 'null') { return ,([string[]]@()) }
    return ,([string[]]@([regex]::Matches($m.Groups[1].Value, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value }))
}

function Get-SeyraCsrFacts {
    param([string]$Step, [string]$Path)
    $json = Invoke-SeyraStepText $Step @('certificate', 'inspect', $Path, '--format', 'json')
    $spki = [regex]::Match($json, '"RawSubjectPublicKeyInfo":\s*"([^"]+)"').Groups[1].Value
    if (-not $spki) { throw "CSR ${Path}: no public key found" }
    $spkiBytes = [Convert]::FromBase64String($spki)
    $p256Prefix = '3059301306072a8648ce3d020106082a8648ce3d030107'
    $prefix = -join ($spkiBytes[0..22] | ForEach-Object { $_.ToString('x2') })
    $ips = Get-SeyraJsonStringList $json 'IPAddresses'
    $dns = Get-SeyraJsonStringList $json 'DNSNames'
    $mail = Get-SeyraJsonStringList $json 'EmailAddresses'
    $uris = Get-SeyraJsonStringList $json 'URIs'
    if ($null -eq $ips -or $null -eq $dns -or $null -eq $mail) { throw "CSR ${Path}: SAN fields not readable" }
    if ($null -eq $uris) { $uris = @() }
    return [pscustomobject]@{
        SpkiSha256 = Get-SeyraSha256Hex $spkiBytes
        KeyIsP256  = ($spkiBytes.Length -eq 91 -and $prefix -eq $p256Prefix)
        IPs        = @($ips)
        DNSNames   = @($dns)
        Emails     = @($mail)
        URIs       = @($uris)
    }
}

function Assert-Seyra {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "CHECK FAILED: $Message" }
    Write-Host "  ok  $Message"
}

function Test-SeyraKeyEncrypted {
    param([string]$Path)
    $head = (Get-Content -LiteralPath $Path -TotalCount 3) -join "`n"
    Assert-Seyra ($head -match 'Proc-Type: 4,ENCRYPTED' -or $head -match 'BEGIN ENCRYPTED PRIVATE KEY') "private key $([IO.Path]::GetFileName($Path)) is stored encrypted"
}

function Test-SeyraCaCert {
    # Kind: root (self-signed, path length 1, ~5 years) or issuing (path length 0, ~1 year, issued by Issuer).
    param([string]$Step, [string]$Path, [ValidateSet('root', 'issuing')][string]$Kind, $Issuer)
    $c = Get-SeyraCertInfo $Step $Path
    Write-Host ("{0}: {1}" -f $Kind, $c.subject_dn)
    $bc = $c.extensions.basic_constraints
    Assert-Seyra ($bc.is_ca -eq $true) 'basic constraints: CA'
    $want = 1; if ($Kind -eq 'issuing') { $want = 0 }
    Assert-Seyra ($null -ne $bc.PSObject.Properties['max_path_len'] -and $bc.max_path_len -eq $want) "path length $want"
    $ku = Get-SeyraTrueProperties $c.extensions.key_usage
    Assert-Seyra (($ku -join ',') -eq 'certificate_sign,crl_sign') "key usage exactly certificate signing + CRL signing ($($ku -join ','))"
    Assert-Seyra ($c.subject_key_info.ecdsa_public_key.curve -eq 'P-256') 'EC P-256 key'
    $days = [math]::Round($c.validity.length / 86400)
    if ($Kind -eq 'root') {
        Assert-Seyra ($days -ge 1820 -and $days -le 1830) "validity about 5 years ($days days)"
        Assert-Seyra ($c.issuer_dn -eq $c.subject_dn) 'self-signed'
    } else {
        Assert-Seyra ($days -ge 364 -and $days -le 367) "validity about 1 year ($days days)"
        Assert-Seyra ($c.issuer_dn -eq $Issuer.subject_dn) "issued by $($Issuer.subject_dn)"
        Assert-Seyra ($c.extensions.authority_key_id -eq $Issuer.extensions.subject_key_id) 'authority key id matches the root'
        Assert-Seyra ([datetime]$c.validity.end -le [datetime]$Issuer.validity.end) 'does not outlive the root'
    }
    return $c
}

function Test-SeyraCsr {
    # The CSR must be the VM's exact request: file hash and public key from the request manifest,
    # exactly the expected IP SAN and nothing else, EC P-256.
    param([string]$Step, [string]$Csr, $Manifest)
    $ip = Get-SeyraExpectedIp $Manifest
    Assert-Seyra ((Get-SeyraFileSha256 $Csr) -eq $Manifest.csr_file_sha256) 'CSR file SHA-256 equals the request manifest'
    $f = Get-SeyraCsrFacts $Step $Csr
    Assert-Seyra ($f.SpkiSha256 -eq $Manifest.spki_sha256) "CSR public key fingerprint equals the manifest ($($f.SpkiSha256))"
    Assert-Seyra $f.KeyIsP256 'CSR key is EC P-256'
    Assert-Seyra ((@($f.IPs) -join ',') -eq $ip) "CSR IP SAN exactly $ip"
    Assert-Seyra ($f.DNSNames.Count -eq 0 -and $f.Emails.Count -eq 0 -and $f.URIs.Count -eq 0) 'CSR has no DNS, e-mail or URI SANs'
    return $f
}

function Get-SeyraExpectedIp {
    param($Manifest)
    $sans = @($Manifest.sans)
    if ($sans.Count -ne 1 -or $sans[0].type -ne 'ip' -or @($Manifest.dns_names).Count -ne 0) { throw 'request manifest must name exactly one IP SAN and no DNS name' }
    $ip = [string]$sans[0].value
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($ip, [ref]$parsed) -or $parsed.ToString() -ne $ip) { throw "request manifest IP '$ip' is not a canonical IPv4 address" }
    return $ip
}

function Test-SeyraLeafCert {
    param([string]$Step, [string]$Path, $Issuer, $Manifest)
    $ip = Get-SeyraExpectedIp $Manifest
    $c = Get-SeyraCertInfo $Step $Path
    $x = $c.extensions
    Write-Host ("leaf: {0}" -f $c.subject_dn)
    Assert-Seyra ($x.basic_constraints.is_ca -eq $false) 'not a CA'
    $ku = Get-SeyraTrueProperties $x.key_usage
    Assert-Seyra (($ku -join ',') -eq 'digital_signature') "key usage exactly digitalSignature ($($ku -join ','))"
    $eku = Get-SeyraTrueProperties $x.extended_key_usage
    Assert-Seyra (($eku -join ',') -eq 'server_auth') "extended key usage exactly serverAuth ($($eku -join ','))"
    $san = $x.subject_alt_name
    $sanKinds = @($san.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    Assert-Seyra (($sanKinds -join ',') -eq 'ip_addresses' -and (@($san.ip_addresses) -join ',') -eq $ip) "SAN exactly IP $ip"
    Assert-Seyra ($c.subject_key_info.fingerprint_sha256 -eq $Manifest.spki_sha256) 'public key equals the VM request (server key stays on the VM)'
    Assert-Seyra ($c.issuer_dn -eq $Issuer.subject_dn -and $x.authority_key_id -eq $Issuer.extensions.subject_key_id) "issued by $($Issuer.subject_dn)"
    $days = $c.validity.length / 86400
    Assert-Seyra ($days -gt 89 -and $days -le 90.01) ("lifetime 90 days plus at most 15 minutes back-dating ({0:N3} days)" -f $days)
    Assert-Seyra ([datetime]$c.validity.end -le [datetime]$Issuer.validity.end) 'does not outlive the issuing CA'
    Assert-Seyra ([datetime]$c.validity.start -le (Get-Date).ToUniversalTime().AddMinutes(1)) 'already valid'
    return $c
}

function Assert-SeyraNoPrivateKey {
    param([string]$Dir)
    $hits = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'PRIVATE KEY' })
    Assert-Seyra ($hits.Count -eq 0) "no file in $Dir contains a private key"
}

function Write-SeyraUtf8 {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

Export-ModuleMember -Function Get-SeyraBase, Get-SeyraStep, Invoke-SeyraStepText, Get-SeyraCertInfo, Get-SeyraSha256Hex, Get-SeyraFileSha256, Get-SeyraTrueProperties, Get-SeyraJsonStringList, Get-SeyraCsrFacts, Assert-Seyra, Test-SeyraKeyEncrypted, Test-SeyraCaCert, Test-SeyraCsr, Get-SeyraExpectedIp, Test-SeyraLeafCert, Assert-SeyraNoPrivateKey, Write-SeyraUtf8
