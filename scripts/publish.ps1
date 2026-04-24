param(
    [string]$SourceFile = "src/clash-rules.js",
    [string]$RegionDataFile = "src/data/regions.js",
    [string]$OutputDir = "dist",
    [switch]$SkipRemoteRules
)

$ErrorActionPreference = "Stop"

function Get-NormalizedRuleLines {
    param([string[]]$Lines)

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

function Get-NormalizedFileRules {
    param([string[]]$Paths)

    $rules = New-Object System.Collections.Generic.List[string]

    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }

        foreach ($rule in (Get-NormalizedRuleLines -Lines (Get-Content -LiteralPath $path))) {
            $rules.Add($rule)
        }
    }

    return $rules.ToArray()
}

function Get-NormalizedRemoteRules {
    param([string[]]$Urls)

    if ($SkipRemoteRules) {
        return @()
    }

    $rules = New-Object System.Collections.Generic.List[string]
    $maxAttempts = 3
    $delaySeconds = 2

    foreach ($url in $Urls) {
        for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
            try {
                Write-Host "Fetching $url (attempt $attempt/$maxAttempts)"
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60

                foreach ($rule in (Get-NormalizedRuleLines -Lines ($response.Content -split "`r?`n"))) {
                    $rules.Add($rule)
                }

                break
            }
            catch {
                if ($attempt -eq $maxAttempts) {
                    throw
                }

                Write-Warning ("Fetch failed for {0}: {1}. Retrying in {2} seconds..." -f $url, $_.Exception.Message, $delaySeconds)
                Start-Sleep -Seconds $delaySeconds
            }
        }
    }

    return $rules.ToArray()
}

function Select-UniqueRules {
    param([string[]]$Rules)

    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $result = New-Object System.Collections.Generic.List[string]

    foreach ($rule in $Rules) {
        $normalized = $rule.Trim()
        if (-not $normalized) { continue }
        if ($seen.Add($normalized)) {
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
        $normalized = $exclude.Trim()
        if ($normalized) {
            [void]$excludeSet.Add($normalized)
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

function Write-SubconverterConfigFile {
    param(
        [string]$Path,
        [string]$ClaudeRulesUrl,
        [string]$AiRulesUrl
    )

    $content = @"
custom:
  enable_rule_generator: true
  overwrite_original_rules: false
  clash_rule_base: base/forcerule.yml

  proxy_groups:
  - name: "🧠 Claude"
    type: fallback
    rule:
    - "(?i)^.*(?:(?:^|[\\s\\-_|\\[\\]().])JP(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])JPN(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])TYO(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])NRT(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])HND(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])KIX(?:$|[\\s\\-_|\\[\\]().])|日本|Japan|东京|大阪|Tokyo|Osaka|🇯🇵).*$"
    url: "https://cp.cloudflare.com/"
    interval: 300

  - name: "🤖 AI"
    type: fallback
    rule:
    - "(?i)^.*(?:(?:^|[\\s\\-_|\\[\\]().])JP(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])JPN(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])TYO(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])NRT(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])HND(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])KIX(?:$|[\\s\\-_|\\[\\]().])|日本|Japan|东京|大阪|Tokyo|Osaka|🇯🇵|(?:^|[\\s\\-_|\\[\\]().])SG(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])SGP(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])SIN(?:$|[\\s\\-_|\\[\\]().])|新加坡|狮城|獅城|Singapore|🇸🇬|(?:^|[\\s\\-_|\\[\\]().])US(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])USA(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])NYC(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])JFK(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])LAX(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])SFO(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])SJC(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])SEA(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])ORD(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])DFW(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])LAS(?:$|[\\s\\-_|\\[\\]().])|(?:^|[\\s\\-_|\\[\\]().])PHX(?:$|[\\s\\-_|\\[\\]().])|美国|美國|United[\\s_-]*States|America|Washington|Seattle|San[\\s_-]*Jose|SanJose|Los[\\s_-]*Angeles|LosAngeles|Phoenix|Dallas|Chicago|Silicon[\\s_-]*Valley|SiliconValley|🇺🇸).*$"
    url: "https://cp.cloudflare.com/"
    interval: 300

  rulesets:
  - group: "🧠 Claude"
    ruleset: "clash-classic:$ClaudeRulesUrl"
    interval: 86400

  - group: "🤖 AI"
    ruleset: "clash-classic:$AiRulesUrl"
    interval: 86400
"@

    Set-Content -LiteralPath $Path -Value $content -Encoding utf8
}

function Build-ScriptArtifact {
    param(
        [string]$SourcePath,
        [string]$RegionPath,
        [string]$OutputPath
    )

    if (-not (Test-Path -LiteralPath $RegionPath)) {
        throw "Region data file not found: $RegionPath"
    }

    $sourceContent = Get-Content -LiteralPath $SourcePath -Raw
    $regionContent = (Get-Content -LiteralPath $RegionPath -Raw).Trim()
    $regionPlaceholder = "__REGION_SPECS__"

    if (-not $sourceContent.Contains($regionPlaceholder)) {
        throw "Placeholder not found in source script: $regionPlaceholder"
    }

    $scriptContent = $sourceContent.Replace($regionPlaceholder, $regionContent)
    Set-Content -LiteralPath $OutputPath -Value $scriptContent -Encoding utf8
}

Write-Host "Publishing artifacts into $OutputDir"

if (-not (Test-Path -LiteralPath $SourceFile)) {
    throw "Source file not found: $SourceFile"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$obsoleteArtifacts = @(
    "ai.txt",
    "ai.yaml",
    "claude.yaml",
    "fakeip-filter.txt",
    "openai.txt",
    "gemini.txt",
    "cursor.txt",
    "google-extra.txt",
    "openrouter.txt"
)

foreach ($artifact in $obsoleteArtifacts) {
    $artifactPath = Join-Path $OutputDir $artifact
    if (Test-Path -LiteralPath $artifactPath) {
        Remove-Item -LiteralPath $artifactPath -Force
    }
}

$scriptOutputFile = Join-Path $OutputDir "clash-rules.js"
Build-ScriptArtifact -SourcePath $SourceFile -RegionPath $RegionDataFile -OutputPath $scriptOutputFile

$claudeRules = @()
$claudeRules += Get-NormalizedFileRules -Paths @("rules/claude/manual.txt")
$claudeRules += Get-NormalizedRemoteRules -Urls @("https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Claude/Claude.yaml")
$claudeRules = Select-UniqueRules -Rules $claudeRules
$claudeRules = Remove-ExcludedRules -Rules $claudeRules -Excludes (Get-NormalizedFileRules -Paths @("rules/claude/exclude.txt"))

$openAiRules = Get-NormalizedRemoteRules -Urls @("https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/OpenAI/OpenAI.yaml")
$geminiRules = Get-NormalizedRemoteRules -Urls @("https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Gemini/Gemini.yaml")

$aiRules = @()
$aiRules += $claudeRules
$aiRules += $openAiRules
$aiRules += $geminiRules
$aiRules = Select-UniqueRules -Rules $aiRules

$claudeOutputPaths = @(
    (Join-Path $OutputDir "claude.txt"),
    (Join-Path $OutputDir "claude.yaml")
)
foreach ($claudeOutputPath in $claudeOutputPaths) {
    Write-RulesFile -Path $claudeOutputPath -Rules $claudeRules
    Write-Host "Generated $claudeOutputPath with $($claudeRules.Count) rules"
}

$aiOutputPath = Join-Path $OutputDir "ai.yaml"
Write-RulesFile -Path $aiOutputPath -Rules $aiRules
Write-Host "Generated $aiOutputPath with $($aiRules.Count) rules"

$subconverterConfigPath = Join-Path $OutputDir "subconverter.yaml"
$rawBase = "https://raw.githubusercontent.com/yuanv4/clash-rules/release"
Write-SubconverterConfigFile -Path $subconverterConfigPath `
    -ClaudeRulesUrl "$rawBase/claude.yaml" `
    -AiRulesUrl "$rawBase/ai.yaml"
Write-Host "Generated $subconverterConfigPath"

$buildTimeUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$gitSha = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { "" }

$scriptMetadata = [ordered]@{
    source = $SourceFile
    region_data = $RegionDataFile
    output = "clash-rules.js"
    build_time_utc = $buildTimeUtc
    git_sha = $gitSha
}

$rulesMetadata = [ordered]@{
    build_time_utc = $buildTimeUtc
    git_sha = $gitSha
    targets = @(
        [ordered]@{
            name = "claude"
            count = $claudeRules.Count
            output = @("claude.txt", "claude.yaml")
            skip_remote = [bool]$SkipRemoteRules
        }
        [ordered]@{
            name = "ai"
            count = $aiRules.Count
            output = "ai.yaml"
            skip_remote = [bool]$SkipRemoteRules
        }
        [ordered]@{
            name = "subconverter"
            output = "subconverter.yaml"
            skip_remote = [bool]$SkipRemoteRules
        }
    )
}

$scriptMetadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir "metadata.json") -Encoding utf8
$rulesMetadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDir "rules-metadata.json") -Encoding utf8

Write-Host "Publish preparation completed:"
Write-Host " - $scriptOutputFile"
foreach ($claudeOutputPath in $claudeOutputPaths) {
    Write-Host " - $claudeOutputPath"
}
Write-Host " - $aiOutputPath"
Write-Host " - $subconverterConfigPath"
Write-Host " - $(Join-Path $OutputDir 'metadata.json')"
Write-Host " - $(Join-Path $OutputDir 'rules-metadata.json')"
