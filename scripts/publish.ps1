param(
    [string]$SourceFile = "src/clash-rules.js",
    [string]$OutputDir = "dist",
    [switch]$SkipRemoteRules
)

$ErrorActionPreference = "Stop"

function Get-NormalizedRuleLines {
    param(
        [string[]]$Lines
    )

    foreach ($rawLine in $Lines) {
        $line = $rawLine.Trim()

        if (-not $line) { continue }
        if ($line -eq "payload:") { continue }
        if ($line.StartsWith("#")) { continue }
        if ($line.StartsWith(";")) { continue }
        if ($line.StartsWith("//")) { continue }

        if ($line.StartsWith("- ")) {
            $line = $line.Substring(2).Trim()
        }

        if (($line.StartsWith("'") -and $line.EndsWith("'")) -or ($line.StartsWith('"') -and $line.EndsWith('"'))) {
            $line = $line.Substring(1, $line.Length - 2).Trim()
        }

        if (-not $line) { continue }
        if ($line -match "^[A-Za-z0-9._-]+:[^,]+$") { continue }
        if ($line -match "^payload\s*:") { continue }

        $line
    }
}

function Get-RulesFromFile {
    param(
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    return @(Get-NormalizedRuleLines -Lines (Get-Content -LiteralPath $Path))
}

function Get-RulesFromRemote {
    param(
        [string]$Url
    )

    if ($SkipRemoteRules) {
        return @()
    }

    Write-Host "Fetching $Url"
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60
    return @(Get-NormalizedRuleLines -Lines ($response.Content -split "`r?`n"))
}

function Select-UniqueRules {
    param(
        [string[]]$Rules
    )

    $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $result = New-Object System.Collections.Generic.List[string]

    foreach ($rule in $Rules) {
        $normalized = $rule.Trim()
        if (-not $normalized) { continue }
        if ($set.Add($normalized)) {
            $result.Add($normalized)
        }
    }

    return $result.ToArray()
}

function Remove-ExcludedRules {
    param(
        [string[]]$Rules,
        [string[]]$Excludes
    )

    if (-not $Excludes -or $Excludes.Count -eq 0) {
        return $Rules
    }

    $excludeSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($exclude in $Excludes) {
        if ($exclude.Trim()) {
            [void]$excludeSet.Add($exclude.Trim())
        }
    }

    return @($Rules | Where-Object { -not $excludeSet.Contains($_.Trim()) })
}

function Write-RulesFile {
    param(
        [string]$Path,
        [string[]]$Rules
    )

    $content = @("payload:") + ($Rules | ForEach-Object { "  - $_" })
    Set-Content -LiteralPath $Path -Value $content -Encoding utf8
}

Write-Host "Publishing artifacts into $OutputDir"

if (-not (Test-Path -LiteralPath $SourceFile)) {
    throw "Source file not found: $SourceFile"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$scriptOutputFile = Join-Path $OutputDir "clash-rules.js"
Copy-Item -LiteralPath $SourceFile -Destination $scriptOutputFile -Force

$targets = @(
    @{
        Name = "claude"
        Sources = @(
            "rules/claude/manual.txt"
        )
        Upstreams = @(
            "https://cdn.jsdelivr.net/gh/SkywalkerJi/Clash-Rules@master/AI/Anthropic.yaml"
        )
        Excludes = @(
            "rules/claude/exclude.txt"
        )
    },
    @{
        Name = "ai"
        Sources = @(
            "rules/ai/manual.txt"
        )
        Upstreams = @(
            "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/OpenAI/OpenAI.yaml",
            "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Gemini/Gemini.yaml"
        )
        Excludes = @(
            "rules/ai/exclude.txt"
        )
    }
)

$rulesSummary = @()

foreach ($target in $targets) {
    $rules = New-Object System.Collections.Generic.List[string]

    foreach ($sourceFile in $target.Sources) {
        foreach ($rule in (Get-RulesFromFile -Path $sourceFile)) {
            $rules.Add($rule)
        }
    }

    foreach ($url in $target.Upstreams) {
        foreach ($rule in (Get-RulesFromRemote -Url $url)) {
            $rules.Add($rule)
        }
    }

    $uniqueRules = Select-UniqueRules -Rules $rules.ToArray()

    $excludes = New-Object System.Collections.Generic.List[string]
    foreach ($excludeFile in $target.Excludes) {
        foreach ($rule in (Get-RulesFromFile -Path $excludeFile)) {
            $excludes.Add($rule)
        }
    }

    $filteredRules = Remove-ExcludedRules -Rules $uniqueRules -Excludes $excludes.ToArray()
    $outputPath = Join-Path $OutputDir "$($target.Name).txt"
    Write-RulesFile -Path $outputPath -Rules $filteredRules

    $rulesSummary += [ordered]@{
        name = $target.Name
        count = $filteredRules.Count
        output = "$($target.Name).txt"
        skip_remote = [bool]$SkipRemoteRules
    }

    Write-Host "Generated $outputPath with $($filteredRules.Count) rules"
}

$scriptMetadata = [ordered]@{
    source = $SourceFile
    output = "clash-rules.js"
    build_time_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    git_sha = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { "" }
}

$rulesMetadata = [ordered]@{
    build_time_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    git_sha = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { "" }
    targets = $rulesSummary
}

$scriptMetadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir "metadata.json") -Encoding utf8
$rulesMetadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDir "rules-metadata.json") -Encoding utf8

Write-Host "Publish preparation completed:"
Write-Host " - $scriptOutputFile"
Write-Host " - $(Join-Path $OutputDir 'claude.txt')"
Write-Host " - $(Join-Path $OutputDir 'ai.txt')"
Write-Host " - $(Join-Path $OutputDir 'metadata.json')"
Write-Host " - $(Join-Path $OutputDir 'rules-metadata.json')"
