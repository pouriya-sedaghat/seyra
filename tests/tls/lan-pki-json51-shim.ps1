# TEST ONLY (Linux, PowerShell 7). Emulates the JSON form Windows PowerShell 5.1 produces: its
# ConvertFrom-Json keeps ISO 8601 date strings as STRINGS, whereas PowerShell 7 turns them into DateTime
# values. Dot-sourced before the module is imported, this global function is what the module's own
# Get-SeyraCertInfo then calls, so the actual helpers see the 5.1 form. Built on System.Text.Json
# (JsonDocument), which never interprets dates; objects become PSCustomObjects, arrays arrays.
function global:ConvertFrom-Json {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true, ValueFromPipeline = $true, Position = 0)][AllowEmptyString()][string]$InputObject)
    begin { $parts = New-Object System.Collections.Generic.List[string] }
    process { $parts.Add($InputObject) }
    end {
        function ConvertFrom-ElementAs51($e) {
            switch ($e.ValueKind.ToString()) {
                'Object' { $o = [ordered]@{}; foreach ($p in $e.EnumerateObject()) { $o[$p.Name] = ConvertFrom-ElementAs51 $p.Value }; return [pscustomobject]$o }
                'Array' { return , @(foreach ($x in $e.EnumerateArray()) { ConvertFrom-ElementAs51 $x }) }
                'String' { return $e.GetString() }
                'Number' { $l = 0L; if ($e.TryGetInt64([ref]$l)) { return $l }; return $e.GetDouble() }
                'True' { return $true }
                'False' { return $false }
                default { return $null }
            }
        }
        $doc = [System.Text.Json.JsonDocument]::Parse(($parts -join "`n"))
        try { ConvertFrom-ElementAs51 $doc.RootElement } finally { $doc.Dispose() }
    }
}
