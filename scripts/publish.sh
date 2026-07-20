#!/usr/bin/env bash
set -euo pipefail

SOURCE_FILE="src/clash-rules.js"
REGION_DATA_FILE="src/data/regions.js"
AI_SUPPLEMENT_FILE="rules/ai/manual.txt"
DIRECT_SUPPLEMENT_FILE="rules/direct/manual.txt"
YOUTUBE_SUPPLEMENT_FILE="rules/youtube/manual.txt"
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
  "claude.txt"
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
build_script_artifact "$SOURCE_FILE" "$REGION_DATA_FILE" "$script_output_file" "$AI_SUPPLEMENT_FILE" "$DIRECT_SUPPLEMENT_FILE" "$YOUTUBE_SUPPLEMENT_FILE"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

build_time_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
git_sha="${GITHUB_SHA:-}"
json_metadata "$OUTPUT_DIR" "$build_time_utc" "$git_sha" "$SKIP_REMOTE_RULES"

echo "Publish preparation completed:"
echo " - $script_output_file"
echo " - $OUTPUT_DIR/metadata.json"
echo " - $OUTPUT_DIR/rules-metadata.json"
