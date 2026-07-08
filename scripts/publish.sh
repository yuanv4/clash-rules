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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/rules.sh"
source "$SCRIPT_DIR/lib/artifacts.sh"
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
  "subconverter.yaml"
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
{
  normalize_rule_file "rules/claude/manual.txt"
  fetch_remote_rules "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Claude/Claude.yaml"
} > "$claude_raw"
unique_rules < "$claude_raw" > "$claude_unique"
normalize_rule_file "rules/claude/exclude.txt" > "$claude_excludes"
remove_excluded_rules "$claude_excludes" < "$claude_unique" > "$claude_rules"


claude_output_paths=("$OUTPUT_DIR/claude.txt" "$OUTPUT_DIR/claude.yaml")
for claude_output_path in "${claude_output_paths[@]}"; do
  write_rules_file "$claude_output_path" "$claude_rules"
  echo "Generated $claude_output_path with $(wc -l < "$claude_rules") rules"
done


build_time_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
git_sha="${GITHUB_SHA:-}"
json_metadata "$OUTPUT_DIR" "$build_time_utc" "$git_sha" "$(wc -l < "$claude_rules")" "$SKIP_REMOTE_RULES"

echo "Publish preparation completed:"
echo " - $script_output_file"
for claude_output_path in "${claude_output_paths[@]}"; do
  echo " - $claude_output_path"
done
echo " - $OUTPUT_DIR/metadata.json"
echo " - $OUTPUT_DIR/rules-metadata.json"
