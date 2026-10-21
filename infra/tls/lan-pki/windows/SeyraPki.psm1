# Seyra LAN private PKI: shared checks for the Windows issuer scripts (Windows PowerShell 5.1+).
# Every function verifies the actual certificate contents (via `step certificate inspect`) instead of
# trusting a command's exit status. Nothing here reads, prints or stores a private key or password.
Set-StrictMode -Version 2

$script:StepVersion = '0.31.0'
$script:ManagedFolders = @('tools', 'root', 'issuing', 'requests', 'issued', 'public', 'trust')
$script:TrustSchema = 'seyra.root-trust/1'

# The Windows-only operations (current account, folder permissions, Cert:\CurrentUser\Root) are
# isolated in the "boundary" functions below. A Linux regression replaces them with a test-only file
# named by SEYRA_TEST_BOUNDARY (tests/tls/lan-pki-test-boundary.ps1); that variable is refused on
# Windows, so on a real PC these scripts always use the real account, ACLs and store.
$script:Boundary = @{}
if ($env:SEYRA_TEST_BOUNDARY) {
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { throw 'SEYRA_TEST_BOUNDARY is set: it is a Linux test hook and is refused on Windows. Remove the variable and run again.' }
    $script:Boundary = & $env:SEYRA_TEST_BOUNDARY
}

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

# ---- private PKI folder: path and owner-only permission policy --------------------------------------

function Get-SeyraManagedFolder {
    return $script:ManagedFolders
}

function Get-SeyraAccount {
    # Boundary: SID and name of the account running this script.
    if ($script:Boundary.ContainsKey('Account')) { return & $script:Boundary.Account }
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    return [pscustomobject]@{ Sid = $id.User.Value; Name = $id.Name }
}

function Get-SeyraBasePolicy {
    # Boundary: Under = folders the PKI folder must not be in, equal to or contain (synchronized,
    # shared, temporary, roaming or system); Exact = broad folders it must not be or contain (a
    # dedicated folder beneath them, such as %LOCALAPPDATA%\SeyraPKI, is fine).
    if ($script:Boundary.ContainsKey('BasePolicy')) { return & $script:Boundary.BasePolicy }
    $under = @('Desktop', 'MyDocuments', 'MyPictures', 'MyMusic', 'MyVideos', 'Favorites', 'ApplicationData', 'CommonDesktopDirectory', 'CommonDocuments', 'CommonApplicationData', 'Windows', 'ProgramFiles', 'ProgramFilesX86') | ForEach-Object { [Environment]::GetFolderPath($_) }
    $under += @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer, $env:TEMP, $env:TMP, $env:PUBLIC)
    $exact = @('UserProfile', 'LocalApplicationData') | ForEach-Object { [Environment]::GetFolderPath($_) }
    return [pscustomobject]@{ Under = @($under | Where-Object { $_ }); Exact = @($exact | Where-Object { $_ }) }
}

function ConvertTo-SeyraPathKey {
    # Comparable form of a path: '\' separators, no trailing separator, lower case.
    param([string]$Path)
    return ($Path -replace '/', '\').TrimEnd('\').ToLowerInvariant()
}

function Test-SeyraBasePath {
    # Reasons (none = acceptable) why $Base must not hold the PKI folder. Pure: compares strings only.
    param([string]$Base, $Policy)
    $why = @()
    if ($Base -match '^(\\\\|//)') { $why += 'it is a network or device path' }
    if ($Base -match '(?i)onedrive|dropbox|google ?drive|icloud|nextcloud|owncloud|syncthing|pcloud') { $why += 'its name looks like a synchronized folder' }
    $b = ConvertTo-SeyraPathKey $Base
    $o = [StringComparison]::Ordinal
    foreach ($u in @($Policy.Under)) {
        $k = ConvertTo-SeyraPathKey $u
        if ($b -eq $k) { $why += "it is $u itself (synchronized, shared, temporary or system folder)" }
        elseif ($b.StartsWith($k + '\', $o)) { $why += "it is inside $u (synchronized, shared, temporary or system folder)" }
        elseif ($k.StartsWith($b + '\', $o)) { $why += "it contains $u" }
    }
    foreach ($e in @($Policy.Exact)) {
        $k = ConvertTo-SeyraPathKey $e
        if ($b -eq $k) { $why += "it is $e itself (too broad; use a dedicated folder beneath it)" }
        elseif ($k.StartsWith($b + '\', $o)) { $why += "it contains $e" }
    }
    return $why
}

function Get-SeyraPathRedirection {
    # Reasons why $Path is redirected: it or an existing parent is a reparse point (symbolic link,
    # junction, mount point, cloud placeholder), or it is on a network drive. Nothing is followed.
    param([string]$Path)
    $why = @()
    $p = $Path
    while ($p) {
        $a = $null
        try { $a = [IO.File]::GetAttributes($p) } catch { $a = $null }
        if ($null -ne $a -and ($a -band [IO.FileAttributes]::ReparsePoint)) { $why += "$p is a link, junction or other reparse point" }
        $p = [IO.Path]::GetDirectoryName($p)
    }
    $root = [IO.Path]::GetPathRoot($Path)
    if ($root -and $root -notmatch '^(\\\\|//)') {
        if ((New-Object IO.DriveInfo $root).DriveType -eq [IO.DriveType]::Network) { $why += "$root is a network drive" }
    }
    return $why
}

function Get-SeyraAclItem {
    # Boundary: owner, inheritance protection and access entries (as SIDs) of one file or folder.
    # A link is reported as a link; its target is not read.
    param([string]$Path)
    if ($script:Boundary.ContainsKey('GetAclItem')) { return & $script:Boundary.GetAclItem $Path }
    $attr = [IO.File]::GetAttributes($Path)
    $isDir = [bool]($attr -band [IO.FileAttributes]::Directory)
    if ($attr -band [IO.FileAttributes]::ReparsePoint) { return [pscustomobject]@{ Path = $Path; IsDirectory = $isDir; IsLink = $true; Owner = ''; Protected = $false; Aces = @() } }
    $sidType = [System.Security.Principal.SecurityIdentifier]
    $acl = Get-Acl -LiteralPath $Path
    $aces = @($acl.GetAccessRules($true, $true, $sidType) | ForEach-Object {
            [pscustomobject]@{ Sid = $_.IdentityReference.Value; Allow = ($_.AccessControlType -eq 'Allow'); Rights = [string]$_.FileSystemRights; Inherited = $_.IsInherited } })
    return [pscustomobject]@{ Path = $Path; IsDirectory = $isDir; IsLink = $false; Owner = $acl.GetOwner($sidType).Value; Protected = $acl.AreAccessRulesProtected; Aces = $aces }
}

function Get-SeyraTreeAcl {
    # The folder and everything beneath it, parents before children. Links are reported and never
    # entered; a listing error stops the check.
    param([string]$Base, [int]$Limit = 5000)
    $items = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($Base)
    while ($queue.Count -gt 0) {
        $p = [string]$queue.Dequeue()
        $it = Get-SeyraAclItem $p
        [void]$items.Add($it)
        if ($items.Count -gt $Limit) { throw "more than $Limit entries under $Base; this is not a SeyraPKI folder" }
        if ($it.IsDirectory -and -not $it.IsLink) {
            foreach ($c in @(Get-ChildItem -LiteralPath $p -Force | Sort-Object Name)) { $queue.Enqueue($c.FullName) }
        }
    }
    return $items.ToArray()
}

function Test-SeyraAclPolicy {
    # Owner-only policy for the PKI folder. Every entry: not a link, owned by $Sid, no allow or deny
    # entry for anyone else (explicit or inherited). $Base itself: protected from its parent's
    # inheritance and full control for $Sid. Returns one problem per defect, each with a remedy that
    # touches only that item. Pure: works on the items it is given.
    param($Items, [string]$Sid, [string]$Base)
    $out = New-Object System.Collections.ArrayList
    $baseKey = ConvertTo-SeyraPathKey $Base
    foreach ($it in @($Items)) {
        $p = [string]$it.Path
        $add = { param($Problem, $Remedy) [void]$out.Add([pscustomobject]@{ Path = $p; Problem = $Problem; Remedy = $Remedy }) }
        if ($it.IsLink) {
            $rm = 'del'; if ($it.IsDirectory) { $rm = 'rmdir' }
            & $add 'is a link or junction (not followed: keys must never be reached through a link)' ("check where it points: Get-Item -LiteralPath '{0}' -Force | Format-List LinkType, Target; then remove only the link: cmd /c {1} `"{0}`" (the target is not touched)" -f $p, $rm)
            continue
        }
        if ($it.Owner -ne $Sid) { & $add ("is owned by {0}, not by you ({1})" -f $it.Owner, $Sid) 'do not reuse it (this script never takes ownership): use a new -Base that this script creates, or have its owner delete it' }
        $isBase = (ConvertTo-SeyraPathKey $p) -eq $baseKey
        if ($isBase -and -not $it.Protected) { & $add 'inherits permissions from its parent folder' ("icacls `"{0}`" /inheritance:r /grant:r `"*{1}:(OI)(CI)F`"   (this folder only, no /T)" -f $p, $Sid) }
        $full = $false
        foreach ($a in @($it.Aces)) {
            if ($a.Sid -eq $Sid -and $a.Allow) { if ([string]$a.Rights -match 'FullControl') { $full = $true }; continue }
            if ($isBase -and $a.Inherited) { continue }   # covered by the inheritance problem above
            $what = 'denies'; $flag = 'd'; if ($a.Allow) { $what = 'grants'; $flag = 'g' }
            if ($a.Inherited) { & $add ("{0} {1} to {2} (inherited)" -f $what, $a.Rights, $a.Sid) 'fix the parent folder listed above that has this entry explicitly; it then disappears here' }
            else { & $add ("{0} {1} to {2} (explicit entry)" -f $what, $a.Rights, $a.Sid) ("icacls `"{0}`" /remove:{1} *{2}   (this entry on this item only)" -f $p, $flag, $a.Sid) }
        }
        if ($isBase -and -not $full) { & $add 'does not give you full control' ("icacls `"{0}`" /grant:r `"*{1}:(OI)(CI)F`"   (this folder only, no /T)" -f $p, $Sid) }
    }
    return $out.ToArray()
}

function Set-SeyraOwnerOnlyAcl {
    # Boundary; only for a folder this run has just created: protected access list with one entry,
    # full control for $Sid, inherited by what is later created inside it. Not recursive.
    param([string]$Path, [string]$Sid)
    if ($script:Boundary.ContainsKey('SetOwnerOnlyAcl')) { & $script:Boundary.SetOwnerOnlyAcl $Path $Sid; return }
    & icacls.exe $Path /inheritance:r /grant:r ("*{0}:(OI)(CI)F" -f $Sid) /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed on $Path (exit $LASTEXITCODE)" }
}

function Assert-SeyraPkiFolder {
    # Read-only check of the whole PKI folder: path policy, no redirection, owner-only permissions on
    # every entry (see Test-SeyraAclPolicy) and existing issuer keys still encrypted. Throws with a
    # remedy per problem; changes nothing.
    param([string]$Base)
    $Base = [IO.Path]::GetFullPath($Base)
    $acct = Get-SeyraAccount
    $why = @(Test-SeyraBasePath $Base (Get-SeyraBasePolicy)) + @(Get-SeyraPathRedirection $Base)
    if ($why.Count -gt 0) { throw ("CHECK FAILED: {0} is not an acceptable PKI folder:`n  - {1}" -f $Base, ($why -join "`n  - ")) }
    if (-not (Test-Path -LiteralPath $Base -PathType Container)) { throw "$Base does not exist; run New-PkiFolder.ps1 first (it sets the folder permissions)" }
    $items = @(Get-SeyraTreeAcl $Base)
    $problems = @(Test-SeyraAclPolicy $items $acct.Sid $Base)
    if ($problems.Count -gt 0) {
        $list = ($problems | ForEach-Object { "  {0}`n      {1}`n      remedy: {2}" -f $_.Path, $_.Problem, $_.Remedy }) -join "`n"
        throw ("CHECK FAILED: {0} is not private to {1} ({2}):`n{3}`nNothing was changed. Apply the remedies (each touches only the item named), or use a new -Base, then run again." -f $Base, $acct.Name, $acct.Sid, $list)
    }
    foreach ($k in @(@('root', 'root_ca.key'), @('issuing', 'intermediate_ca.key'))) {
        $kp = Join-Path (Join-Path $Base $k[0]) $k[1]
        if (Test-Path -LiteralPath $kp) { Test-SeyraKeyEncrypted $kp }
    }
    Write-Host ("  ok  {0}: {1} entries, all owned by and private to {2}; no links" -f $Base, $items.Count, $acct.Name)
}

# ---- Cert:\CurrentUser\Root trust record ---------------------------------------------------------

function Get-SeyraRootStoreEntry {
    # Boundary: entries of Cert:\CurrentUser\Root with this SHA-1 thumbprint (Thumbprint, RawData).
    param([string]$Thumbprint)
    if ($script:Boundary.ContainsKey('StoreFind')) { return & $script:Boundary.StoreFind $Thumbprint }
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
    $store.Open('ReadOnly')
    try { return @($store.Certificates | Where-Object { $_.Thumbprint -eq $Thumbprint } | ForEach-Object { [pscustomobject]@{ Thumbprint = $_.Thumbprint; RawData = $_.RawData } }) }
    finally { $store.Close() }
}

function Add-SeyraRootStoreEntry {
    # Boundary: add exactly these DER bytes to Cert:\CurrentUser\Root (Windows asks for confirmation).
    # It takes the caller's checked snapshot, never a path: a file changed after the check cannot be
    # what is imported. The SHA-256 is verified again immediately before the store call.
    param([byte[]]$Der, [string]$Sha256)
    if ((Get-SeyraSha256Hex $Der) -ne $Sha256) { throw "CHECK FAILED: the bytes to import are not the checked root ($Sha256); nothing was imported" }
    if ($script:Boundary.ContainsKey('StoreImport')) { & $script:Boundary.StoreImport $Der; return }
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, $Der)
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
    $store.Open('ReadWrite')
    try { $store.Add($cert) } finally { $store.Close() }
}

function Remove-SeyraRootStoreEntry {
    # Boundary: remove the entries with this thumbprint from Cert:\CurrentUser\Root (Windows asks).
    param([string]$Thumbprint)
    if ($script:Boundary.ContainsKey('StoreRemove')) { & $script:Boundary.StoreRemove $Thumbprint; return }
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
    $store.Open('ReadWrite')
    try { foreach ($c in @($store.Certificates | Where-Object { $_.Thumbprint -eq $Thumbprint })) { $store.Remove($c) } } finally { $store.Close() }
}

function Test-SeyraRootPresent {
    # Whether the store holds exactly this root. An entry with the thumbprint but other bytes is
    # ambiguous and stops the run.
    param([string]$Thumbprint, [string]$Sha256)
    $entries = @(Get-SeyraRootStoreEntry $Thumbprint)
    foreach ($e in $entries) {
        if ((Get-SeyraSha256Hex $e.RawData) -ne $Sha256) { throw "CHECK FAILED: Cert:\CurrentUser\Root has an entry with thumbprint $Thumbprint but different bytes; nothing was changed. Inspect it in certmgr.msc." }
    }
    return ($entries.Count -gt 0)
}

function Get-SeyraUtcStamp {
    return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Write-SeyraFileDurable {
    # Replace $Path with $Text so that an interruption leaves the old or the new complete file: write
    # a new temporary file beside it, flush it to disk, read it back, rename it over $Path, read again.
    param([string]$Path, [string]$Text)
    $tmp = '{0}.tmp-{1}' -f $Path, [guid]::NewGuid().ToString('N')
    $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($Text)
    $fs = New-Object System.IO.FileStream($tmp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $fs.Write($bytes, 0, $bytes.Length); $fs.Flush($true) } finally { $fs.Dispose() }
    try {
        if ([IO.File]::ReadAllText($tmp) -cne $Text) { throw "read-back of $tmp differs" }
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($tmp, $Path, [NullString]::Value) } else { [IO.File]::Move($tmp, $Path) }
    } catch {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        throw
    }
    if ([IO.File]::ReadAllText($Path) -cne $Text) { throw "read-back of $Path differs" }
}

function Assert-SeyraWritable {
    # The trust state must be writable (create, flush, rename, delete) before the store is changed.
    param([string]$Dir)
    $probe = Join-Path $Dir ('.write-probe-{0}' -f [guid]::NewGuid().ToString('N'))
    try {
        Write-SeyraFileDurable $probe ('{"probe":"' + ('x' * 1024) + '"}' + "`n")
        Remove-Item -LiteralPath $probe -Force
    } catch { throw "CHECK FAILED: cannot write the trust record in $Dir ($($_.Exception.Message)); nothing was changed" }
    Write-Host "  ok  trust record folder is writable ($Dir)"
}

function Open-SeyraLock {
    # Exclusive lock held for one run; the operating system releases it if the process ends.
    param([string]$Path)
    try { return New-Object System.IO.FileStream($Path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch {
        $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
        if ($e -is [UnauthorizedAccessException]) { throw "CHECK FAILED: cannot create or open the lock $Path (no write permission?): $($e.Message); nothing was changed" }
        throw "another Add-RootTrust/Remove-RootTrust run is active (cannot lock $Path): $($e.Message); nothing was changed"
    }
}

function Format-SeyraTrustRecord {
    param($Account, [string]$Sha256, [string]$Thumbprint, [string]$Subject, [bool]$PreExisting, [string]$State, [string]$ObservedAt)
    $r = [ordered]@{
        schema = $script:TrustSchema; state = $State; store = 'CurrentUser\Root'
        account_sid = $Account.Sid; account = $Account.Name
        sha256 = $Sha256; thumbprint_sha1 = $Thumbprint; subject = $Subject
        pre_existing = $PreExisting; observed_at = $ObservedAt; updated_at = (Get-SeyraUtcStamp)
    }
    return (($r | ConvertTo-Json) + "`n")
}

function Read-SeyraTrustRecord {
    # The trust record, strictly validated for this account (and root, if $Sha256 is given). Anything
    # unexpected is treated as tampering: the run stops and nothing is changed.
    param([string]$Path, [string]$Sid, [string]$Sha256)
    $stop = { param($Why) throw ("CHECK FAILED: trust record {0} {1}. Nothing was changed.`n  Recovery: compare it with the store (Get-ChildItem Cert:\CurrentUser\Root | Format-List Thumbprint, Subject); if the record is damaged, move it aside (Rename-Item -LiteralPath '{0}' -NewName 'root-trust-record.damaged.json') and decide in certmgr.msc whether the Seyra root should stay." -f $Path, $Why) }
    try { $r = [IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { & $stop 'is not readable JSON' }
    $names = @($r.PSObject.Properties | ForEach-Object { $_.Name })
    foreach ($n in @('schema', 'state', 'store', 'account_sid', 'account', 'sha256', 'thumbprint_sha1', 'subject', 'pre_existing', 'observed_at', 'updated_at')) {
        if ($names -notcontains $n) { & $stop "has no '$n'" }
    }
    if ($r.schema -ne $script:TrustSchema) { & $stop "has schema '$($r.schema)'" }
    if ($r.store -ne 'CurrentUser\Root') { & $stop "names store '$($r.store)'" }
    if (@('pending', 'trusted') -notcontains $r.state) { & $stop "has state '$($r.state)'" }
    if ($r.pre_existing -isnot [bool]) { & $stop 'has a non-boolean pre_existing' }
    if ($r.state -eq 'pending' -and $r.pre_existing) { & $stop 'is pending for a root that pre-existed (never written by Add-RootTrust.ps1)' }
    if ([string]$r.sha256 -cnotmatch '^[0-9a-f]{64}$' -or [string]$r.thumbprint_sha1 -cnotmatch '^[0-9A-F]{40}$') { & $stop 'has a malformed fingerprint' }
    foreach ($n in @('observed_at', 'updated_at')) {
        # PowerShell 7 parses ISO dates into [datetime] (5.1 keeps the string); keep the recorded UTC text.
        if ($r.$n -is [datetime]) { $r.$n = $r.$n.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
        if ([string]$r.$n -cnotmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$') { & $stop "has a malformed $n" }
    }
    if ($r.account_sid -ne $Sid) { & $stop "belongs to another Windows account ($($r.account) $($r.account_sid)); run as that account" }
    if ($Sha256 -and $r.sha256 -ne $Sha256) { & $stop "is for another root (SHA-256 $($r.sha256)); run Remove-RootTrust.ps1 for that one first" }
    return $r
}

Export-ModuleMember -Function Get-SeyraBase, Get-SeyraStep, Invoke-SeyraStepText, Get-SeyraCertInfo, Get-SeyraSha256Hex, Get-SeyraFileSha256, Get-SeyraTrueProperties, Get-SeyraJsonStringList, Get-SeyraCsrFacts, Assert-Seyra, Test-SeyraKeyEncrypted, Test-SeyraCaCert, Test-SeyraCsr, Get-SeyraExpectedIp, Test-SeyraLeafCert, Assert-SeyraNoPrivateKey, Write-SeyraUtf8,
    Get-SeyraManagedFolder, Get-SeyraAccount, Get-SeyraBasePolicy, ConvertTo-SeyraPathKey, Test-SeyraBasePath, Get-SeyraPathRedirection, Get-SeyraAclItem, Get-SeyraTreeAcl, Test-SeyraAclPolicy, Set-SeyraOwnerOnlyAcl, Assert-SeyraPkiFolder,
    Get-SeyraRootStoreEntry, Add-SeyraRootStoreEntry, Remove-SeyraRootStoreEntry, Test-SeyraRootPresent, Get-SeyraUtcStamp, Write-SeyraFileDurable, Assert-SeyraWritable, Open-SeyraLock, Format-SeyraTrustRecord, Read-SeyraTrustRecord
