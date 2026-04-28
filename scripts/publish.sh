#!/usr/bin/env bash
set -euo pipefail

SOURCE_FILE="src/clash-rules.js"
REGION_DATA_FILE="src/data/regions.js"
OUTPUT_DIR="dist"
SKIP_REMOTE_RULES=0

usage() {
  cat <<'EOF'
Usage: scripts/publish.sh [options]

Options:
  --source-file PATH       Source script path. Default: src/clash-rules.js
  --region-data-file PATH  Region data path. Default: src/data/regions.js
  --output-dir PATH        Output directory. Default: dist
  --skip-remote-rules      Do not fetch remote rule sources.
  -h, --help               Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-file)
      SOURCE_FILE="${2:?Missing value for --source-file}"
      shift 2
      ;;
    --region-data-file)
      REGION_DATA_FILE="${2:?Missing value for --region-data-file}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?Missing value for --output-dir}"
      shift 2
      ;;
    --skip-remote-rules)
      SKIP_REMOTE_RULES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

trim() {
  local value="$1"
  value="${value#"${value%%[!$' \t\r\n']*}"}"
  value="${value%"${value##*[!$' \t\r\n']}"}"
  printf '%s' "$value"
}

normalize_rule_line() {
  local line
  line="$(trim "$1")"

  [[ -z "$line" ]] && return 1
  [[ "$line" == "payload:" ]] && return 1
  [[ "$line" == \#* || "$line" == \;* || "$line" == //* ]] && return 1

  if [[ "$line" == "- "* ]]; then
    line="$(trim "${line:2}")"
  fi

  if [[ ${#line} -ge 2 ]]; then
    local first="${line:0:1}"
    local last="${line: -1}"
    if { [[ "$first" == "'" && "$last" == "'" ]] || [[ "$first" == '"' && "$last" == '"' ]]; }; then
      line="$(trim "${line:1:${#line}-2}")"
    fi
  fi

  [[ -z "$line" ]] && return 1
  [[ "$line" =~ ^[A-Za-z0-9._-]+:[^,]+$ ]] && return 1
  [[ "$line" =~ ^payload[[:space:]]*: ]] && return 1

  printf '%s\n' "$line"
}

normalize_rule_file() {
  local path="$1"
  [[ -f "$path" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    normalize_rule_line "$line" || true
  done < "$path"
}

fetch_remote_rules() {
  local url
  for url in "$@"; do
    [[ "$SKIP_REMOTE_RULES" -eq 1 ]] && continue

    local attempt
    for attempt in 1 2 3; do
      echo "Fetching $url (attempt $attempt/3)" >&2
      local tmp
      tmp="$(mktemp)"
      if curl -fsSL --max-time 60 "$url" -o "$tmp"; then
        while IFS= read -r line || [[ -n "$line" ]]; do
          normalize_rule_line "$line" || true
        done < "$tmp"
        rm -f "$tmp"
        break
      fi

      rm -f "$tmp"
      if [[ "$attempt" -eq 3 ]]; then
        echo "Failed to fetch $url" >&2
        return 1
      fi

      echo "Fetch failed for $url. Retrying in 2 seconds..." >&2
      sleep 2
    done
  done
}

unique_rules() {
  awk '
    {
      key = tolower($0)
      if (key != "" && !seen[key]++) print
    }
  '
}

remove_excluded_rules() {
  local exclude_file="$1"
  if [[ ! -s "$exclude_file" ]]; then
    cat
    return 0
  fi

  awk '
    NR == FNR {
      line = $0
      sub(/^[ \t\r\n]+/, "", line)
      sub(/[ \t\r\n]+$/, "", line)
      if (line != "") excluded[tolower(line)] = 1
      next
    }
    {
      line = $0
      sub(/^[ \t\r\n]+/, "", line)
      sub(/[ \t\r\n]+$/, "", line)
      if (!excluded[tolower(line)]) print
    }
  ' "$exclude_file" -
}

write_rules_file() {
  local path="$1"
  local rules_file="$2"

  {
    printf 'payload:\n'
    while IFS= read -r rule || [[ -n "$rule" ]]; do
      [[ -z "$rule" ]] && continue
      printf '  - %s\n' "$rule"
    done < "$rules_file"
  } > "$path"
}

write_subconverter_config_file() {
  local path="$1"
  local claude_rules_url="$2"
  local ai_rules_url="$3"

  cat > "$path" <<EOF
custom:
  enable_rule_generator: true
  overwrite_original_rules: false
  clash_rule_base: base/forcerule.yml

  proxy_groups:
  - name: "🧠 Claude"
    type: fallback
    rule:
    - "(?i)^.*(?:(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])JP(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])JPN(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])TYO(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])NRT(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])HND(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])KIX(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|日本|Japan|东京|大阪|Tokyo|Osaka|🇯🇵).*$"
    url: "https://cp.cloudflare.com/"
    interval: 300

  - name: "🤖 AI"
    type: fallback
    rule:
    - "(?i)^.*(?:(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])JP(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])JPN(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])TYO(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])NRT(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])HND(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])KIX(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|日本|Japan|东京|大阪|Tokyo|Osaka|🇯🇵|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])SG(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])SGP(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])SIN(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|新加坡|狮城|獅城|Singapore|🇸🇬|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])US(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])USA(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])NYC(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])JFK(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])LAX(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])SFO(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])SJC(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])SEA(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])ORD(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])DFW(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])LAS(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|(?:^|[\\\\s\\\\-_|\\\\[\\\\]().])PHX(?:$|[\\\\s\\\\-_|\\\\[\\\\]().])|美国|美國|United[\\\\s_-]*States|America|Washington|Seattle|San[\\\\s_-]*Jose|SanJose|Los[\\\\s_-]*Angeles|LosAngeles|Phoenix|Dallas|Chicago|Silicon[\\\\s_-]*Valley|SiliconValley|🇺🇸).*$"
    url: "https://cp.cloudflare.com/"
    interval: 300

  rulesets:
  - group: "🧠 Claude"
    ruleset: "clash-classic:$claude_rules_url"
    interval: 86400

  - group: "🤖 AI"
    ruleset: "clash-classic:$ai_rules_url"
    interval: 86400
EOF
}

build_script_artifact() {
  local source_path="$1"
  local region_path="$2"
  local output_path="$3"

  [[ -f "$source_path" ]] || { echo "Source file not found: $source_path" >&2; exit 1; }
  [[ -f "$region_path" ]] || { echo "Region data file not found: $region_path" >&2; exit 1; }

  node - "$source_path" "$region_path" "$output_path" <<'NODE'
const fs = require("fs");
const [sourcePath, regionPath, outputPath] = process.argv.slice(2);
const sourceContent = fs.readFileSync(sourcePath, "utf8");
const regionContent = fs.readFileSync(regionPath, "utf8").trim();
const placeholder = "__REGION_SPECS__";

if (!sourceContent.includes(placeholder)) {
  throw new Error(`Placeholder not found in source script: ${placeholder}`);
}

fs.writeFileSync(outputPath, sourceContent.replace(placeholder, regionContent));
NODE
}

json_string_array() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
process.stdout.write(JSON.stringify(lines.length === 1 ? lines[0] : lines));
NODE
}

json_metadata() {
  local path="$1"
  local build_time_utc="$2"
  local git_sha="$3"
  local claude_count="$4"
  local ai_count="$5"
  local skip_remote="$6"

  node - "$path" "$SOURCE_FILE" "$REGION_DATA_FILE" "$build_time_utc" "$git_sha" "$claude_count" "$ai_count" "$skip_remote" <<'NODE'
const fs = require("fs");
const [
  outputDir,
  source,
  regionData,
  buildTimeUtc,
  gitSha,
  claudeCount,
  aiCount,
  skipRemoteRaw,
] = process.argv.slice(2);
const skipRemote = skipRemoteRaw === "1";

fs.writeFileSync(
  `${outputDir}/metadata.json`,
  JSON.stringify({
    source,
    region_data: regionData,
    output: "clash-rules.js",
    build_time_utc: buildTimeUtc,
    git_sha: gitSha,
  }, null, 2) + "\n"
);

fs.writeFileSync(
  `${outputDir}/rules-metadata.json`,
  JSON.stringify({
    build_time_utc: buildTimeUtc,
    git_sha: gitSha,
    targets: [
      {
        name: "claude",
        count: Number(claudeCount),
        output: ["claude.txt", "claude.yaml"],
        skip_remote: skipRemote,
      },
      {
        name: "ai",
        count: Number(aiCount),
        output: "ai.yaml",
        skip_remote: skipRemote,
      },
      {
        name: "subconverter",
        output: "subconverter.yaml",
        skip_remote: skipRemote,
      },
    ],
  }, null, 2) + "\n"
);
NODE
}

echo "Publishing artifacts into $OUTPUT_DIR"

[[ -f "$SOURCE_FILE" ]] || { echo "Source file not found: $SOURCE_FILE" >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"

obsolete_artifacts=(
  "ai.txt"
  "ai.yaml"
  "claude.yaml"
  "fakeip-filter.txt"
  "openai.txt"
  "gemini.txt"
  "cursor.txt"
  "google-extra.txt"
  "openrouter.txt"
)

for artifact in "${obsolete_artifacts[@]}"; do
  rm -f "$OUTPUT_DIR/$artifact"
done

script_output_file="$OUTPUT_DIR/clash-rules.js"
build_script_artifact "$SOURCE_FILE" "$REGION_DATA_FILE" "$script_output_file"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

claude_raw="$tmp_dir/claude.raw"
claude_unique="$tmp_dir/claude.unique"
claude_excludes="$tmp_dir/claude.excludes"
claude_rules="$tmp_dir/claude.rules"
openai_rules="$tmp_dir/openai.rules"
gemini_rules="$tmp_dir/gemini.rules"
ai_raw="$tmp_dir/ai.raw"
ai_rules="$tmp_dir/ai.rules"

{
  normalize_rule_file "rules/claude/manual.txt"
  fetch_remote_rules "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Claude/Claude.yaml"
} > "$claude_raw"
unique_rules < "$claude_raw" > "$claude_unique"
normalize_rule_file "rules/claude/exclude.txt" > "$claude_excludes"
remove_excluded_rules "$claude_excludes" < "$claude_unique" > "$claude_rules"

fetch_remote_rules "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/OpenAI/OpenAI.yaml" > "$openai_rules"
fetch_remote_rules "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Gemini/Gemini.yaml" > "$gemini_rules"

cat "$claude_rules" "$openai_rules" "$gemini_rules" > "$ai_raw"
unique_rules < "$ai_raw" > "$ai_rules"

claude_output_paths=("$OUTPUT_DIR/claude.txt" "$OUTPUT_DIR/claude.yaml")
for claude_output_path in "${claude_output_paths[@]}"; do
  write_rules_file "$claude_output_path" "$claude_rules"
  echo "Generated $claude_output_path with $(wc -l < "$claude_rules") rules"
done

ai_output_path="$OUTPUT_DIR/ai.yaml"
write_rules_file "$ai_output_path" "$ai_rules"
echo "Generated $ai_output_path with $(wc -l < "$ai_rules") rules"

subconverter_config_path="$OUTPUT_DIR/subconverter.yaml"
raw_base="https://raw.githubusercontent.com/yuanv4/clash-rules/release"
write_subconverter_config_file "$subconverter_config_path" "$raw_base/claude.yaml" "$raw_base/ai.yaml"
echo "Generated $subconverter_config_path"

build_time_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
git_sha="${GITHUB_SHA:-}"
json_metadata "$OUTPUT_DIR" "$build_time_utc" "$git_sha" "$(wc -l < "$claude_rules")" "$(wc -l < "$ai_rules")" "$SKIP_REMOTE_RULES"

echo "Publish preparation completed:"
echo " - $script_output_file"
for claude_output_path in "${claude_output_paths[@]}"; do
  echo " - $claude_output_path"
done
echo " - $ai_output_path"
echo " - $subconverter_config_path"
echo " - $OUTPUT_DIR/metadata.json"
echo " - $OUTPUT_DIR/rules-metadata.json"
