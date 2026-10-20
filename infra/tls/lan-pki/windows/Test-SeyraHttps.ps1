# HTTPS service checks from Windows with NORMAL certificate validation through the Windows store
# (run after Add-RootTrust.ps1). Every request is a fresh connection. No certificate check is
# disabled. Checks: readiness and dataset, capabilities, Swagger UI (one CSP), the spec, one search,
# one route, and the hosted map resources (TileJSON, style, a tile, sprite, glyphs) on this origin.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-SeyraHttps.ps1 -Url https://<VM_LAN_ADDR>:<PORT> [-DatasetId ds-...]
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$DatasetId,
    [string]$QueryUrlEncoded = '%D8%AA%D9%87%D8%B1%D8%A7%D9%86',
    [double[]]$From = @(51.3381, 35.6997),
    [double[]]$To = @(51.4108, 35.7575)
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Url = $Url.TrimEnd('/')
$origin = ([Uri]$Url).GetLeftPart([UriPartial]::Authority)
$fails = 0
function Check([string]$Name, [scriptblock]$Body) {
    try { $d = & $Body; Write-Host ("PASS {0} {1}" -f $Name, $d) }
    catch { $script:fails++; Write-Host ("FAIL {0} -- {1}" -f $Name, $_.Exception.Message) }
}
function Get-Seyra([string]$Path, [string]$Method = 'GET', [string]$Body) {
    $p = @{ Uri = "$Url$Path"; Method = $Method; UseBasicParsing = $true; DisableKeepAlive = $true; TimeoutSec = 30 }
    if ($Body) { $p.Body = [Text.Encoding]::UTF8.GetBytes($Body); $p.ContentType = 'application/json' }
    return Invoke-WebRequest @p
}
function Json($r) { return ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json) }

$src = $null
try { $src = (Test-NetConnection -ComputerName ([Uri]$Url).Host -Port ([Uri]$Url).Port -InformationLevel Detailed -WarningAction SilentlyContinue).SourceAddress.IPAddress } catch {}
Write-Host ("Windows source address towards the service: {0}" -f $src)

Check 'readiness' {
    $j = Json (Get-Seyra '/health/ready')
    if ($j.status -ne 'ready') { throw "status $($j.status)" }
    if ($DatasetId -and $j.dataset_id -ne $DatasetId) { throw "dataset $($j.dataset_id) != $DatasetId" }
    if (-not $DatasetId) { $script:DatasetId = $j.dataset_id }
    "ready on $($j.dataset_id)"
}
$ds = $DatasetId
Check 'capabilities' { $j = Json (Get-Seyra '/api/v1/map/capabilities'); if ($j.api_version -ne 'v1' -or $j.dataset_id -ne $ds) { throw 'unexpected capabilities' }; "api v1, $($j.dataset_id)" }
Check 'Swagger UI' {
    $r = Get-Seyra '/api/docs/'
    # Windows PowerShell joins repeated headers into one string, so count the policies inside it.
    $csp = [string]$r.Headers['Content-Security-Policy']
    $n = ([regex]::Matches($csp, 'default-src')).Count
    if ($r.StatusCode -ne 200 -or $n -ne 1 -or $csp -notmatch "default-src 'self'") { throw "status $($r.StatusCode), CSP policies $n" }
    'served with one same-origin CSP'
}
Check 'OpenAPI spec' { $j = Json (Get-Seyra '/api/docs/json'); if ($j.openapi -notmatch '^3\.') { throw 'not an OpenAPI 3 document' }; "openapi $($j.openapi), $(@($j.paths.PSObject.Properties).Count) paths" }
Check 'search' { $j = Json (Get-Seyra "/api/v1/map/search?q=$QueryUrlEncoded&lang=fa&limit=3"); $n = @($j.results).Count; if ($n -lt 1) { throw 'no results' }; "$n results" }
Check 'route' {
    $b = '{"profile":"car","objective":"time","points":[{"id":"a","lon":' + $From[0] + ',"lat":' + $From[1] + '},{"id":"b","lon":' + $To[0] + ',"lat":' + $To[1] + '}],"language":"fa"}'
    $j = Json (Get-Seyra '/api/v1/map/route' 'POST' $b)
    if (@($j.routes).Count -lt 1) { throw 'no route' }
    "{0:N0} m" -f $j.routes[0].distance_m
}
Check 'TileJSON' { $j = Json (Get-Seyra "/maps/$ds/tiles.json"); $t = @($j.tiles)[0]; if (-not $t.StartsWith("$origin/maps/$ds/tiles/")) { throw "tile URL $t is not on $origin" }; 'tile URLs on this origin' }
Check 'style' {
    $j = Json (Get-Seyra "/maps/$ds/styles/light-fa.json")
    if (-not $j.glyphs.StartsWith("$origin/maps/$ds/fonts/") -or -not $j.sprite.StartsWith("$origin/maps/$ds/sprites/")) { throw 'glyph/sprite URLs not on this origin' }
    'glyphs and sprite on this origin'
}
Check 'vector tile' {
    $z = 14; $n = [math]::Pow(2, $z); $lat = $From[1] * [math]::PI / 180
    $x = [math]::Floor(($From[0] + 180) / 360 * $n); $y = [math]::Floor((1 - [math]::Log([math]::Tan($lat) + 1 / [math]::Cos($lat)) / [math]::PI) / 2 * $n)
    $r = Get-Seyra "/maps/$ds/tiles/$z/$x/$y.pbf"
    if ($r.StatusCode -ne 200 -or $r.RawContentLength -lt 100) { throw "status $($r.StatusCode), $($r.RawContentLength) bytes" }
    "z$z/$x/$y $($r.RawContentLength) bytes"
}
Check 'sprite' { $r = Get-Seyra "/maps/$ds/sprites/light.json"; if ($r.StatusCode -ne 200) { throw $r.StatusCode }; 'light.json' }
Check 'glyphs' { $r = Get-Seyra "/maps/$ds/fonts/Vazirmatn%20Regular/0-255.pbf"; if ($r.StatusCode -ne 200) { throw $r.StatusCode }; 'Vazirmatn Regular 0-255' }
Write-Host ("# {0} failure(s)" -f $fails)
if ($fails -gt 0) { exit 1 }
