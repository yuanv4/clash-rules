#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR=""
NO_BUILD=0
FORCE_BUILD=0
ALLOW_NETWORK=0
TEMP_DIR=""

usage() {
  cat <<'EOF'
Usage: scripts/validate.sh [options]

Options:
  --output-dir DIR   Artifact directory to validate. Must be combined with --no-build or --build.
  --no-build         Validate the specified output directory without building.
  --build            Force building artifacts before validation.
  --allow-network    Allow remote rules during build. Default build uses --skip-remote-rules.
  -h, --help         Show this help.
EOF
}

fail() {
  echo "validate: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="${2:?Missing value for --output-dir}"
      shift 2
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    --build)
      FORCE_BUILD=1
      shift
      ;;
    --allow-network)
      ALLOW_NETWORK=1
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

if [[ "$NO_BUILD" -eq 1 && "$FORCE_BUILD" -eq 1 ]]; then
  fail "--build and --no-build cannot be used together"
fi

if [[ "$NO_BUILD" -eq 1 && -z "$OUTPUT_DIR" ]]; then
  fail "--no-build requires --output-dir"
fi

if [[ -n "$OUTPUT_DIR" && "$NO_BUILD" -eq 0 && "$FORCE_BUILD" -eq 0 ]]; then
  fail "--output-dir requires either --no-build or --build"
fi

[[ -f "src/clash-rules.js" ]] || fail "required source file missing: src/clash-rules.js"
[[ -f "src/data/regions.js" ]] || fail "required source file missing: src/data/regions.js"
[[ -f "scripts/publish.sh" ]] || fail "required script missing: scripts/publish.sh"
[[ -f "scripts/lib/rules.sh" ]] || fail "required script missing: scripts/lib/rules.sh"
[[ -f "scripts/lib/artifacts.sh" ]] || fail "required script missing: scripts/lib/artifacts.sh"
[[ -f "rules/ai/manual.txt" ]] || fail "required rule file missing: rules/ai/manual.txt"
[[ -f "rules/direct/manual.txt" ]] || fail "required rule file missing: rules/direct/manual.txt"

command -v node >/dev/null 2>&1 || fail "node command not found"

node --check "src/clash-rules.js" >/dev/null
node --check "src/data/regions.js" >/dev/null
bash -n "scripts/publish.sh" "scripts/lib/rules.sh" "scripts/lib/artifacts.sh" >/dev/null

if [[ -z "$OUTPUT_DIR" ]]; then
  TEMP_DIR="$(mktemp -d)"
  OUTPUT_DIR="$TEMP_DIR"
fi

REPO_ROOT="$(pwd -P)"
OUTPUT_DIR_ABS="$(node -e 'const path = require("path"); process.stdout.write(path.resolve(process.argv[1]));' "$OUTPUT_DIR")"

case "$OUTPUT_DIR_ABS" in
  /|"$REPO_ROOT"|"$REPO_ROOT/src"|"$REPO_ROOT/src/"*|"$REPO_ROOT/rules"|"$REPO_ROOT/rules/"*|"$REPO_ROOT/.git"|"$REPO_ROOT/.git/"*|"$REPO_ROOT/scripts"|"$REPO_ROOT/scripts/"*|"$REPO_ROOT/.github"|"$REPO_ROOT/.github/"*)
    fail "refusing dangerous --output-dir: $OUTPUT_DIR"
    ;;
esac

if [[ "$NO_BUILD" -eq 0 || "$FORCE_BUILD" -eq 1 ]]; then
  build_args=(--output-dir "$OUTPUT_DIR")
  if [[ "$ALLOW_NETWORK" -eq 0 ]]; then
    build_args+=(--skip-remote-rules)
  fi
  bash "scripts/publish.sh" "${build_args[@]}"
fi

required_artifacts=(
  "clash-rules.js"
  "metadata.json"
  "rules-metadata.json"
)

for artifact in "${required_artifacts[@]}"; do
  [[ -s "$OUTPUT_DIR/$artifact" ]] || fail "required artifact missing or empty: $OUTPUT_DIR/$artifact"
done

node --check "$OUTPUT_DIR/clash-rules.js" >/dev/null

if node - "$OUTPUT_DIR/clash-rules.js" <<'NODE'
const fs = require("fs");
const content = fs.readFileSync(process.argv[2], "utf8");
const placeholders = [
  "__REGION_SPECS__", "__AI_SUPPLEMENT_RULES__", "__DIRECT_SUPPLEMENT_RULES__",
];
process.exit(placeholders.some((placeholder) => content.includes(placeholder)) ? 0 : 1);
NODE
then
  fail "artifact still contains unresolved placeholder: $OUTPUT_DIR/clash-rules.js"
fi

node - "$OUTPUT_DIR/clash-rules.js" <<'NODE'
const path = require("path");
const main = require(path.resolve(process.argv[2]));
const builtins = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "MATCH"]);
const requiredGroups = [];

const check = (label, config) => {
  const result = main(config);
  const groups = new Set((result["proxy-groups"] || []).map((group) => group.name));
  const providers = new Set(Object.keys(result["rule-providers"] || {}));
  const proxyNames = new Set((config.proxies || []).map((proxy) => proxy.name));
  const validTargets = new Set([...groups, ...builtins, ...proxyNames]);
  for (const group of requiredGroups) {
    if (!groups.has(group)) throw new Error(`${label}: missing group ${group}`);
  }
  for (const group of result["proxy-groups"] || []) {
    for (const candidate of group.proxies || []) {
      if (!validTargets.has(candidate)) throw new Error(`${label}: dangling group candidate ${candidate}`);
    }
  }
  for (const rule of result.rules || []) {
    const fields = rule.split(",");
    if (fields[0] === "RULE-SET" && !providers.has(fields[1])) throw new Error(`${label}: missing provider ${fields[1]}`);
    let target = null;
    if (fields[0] === "RULE-SET") target = fields[2];
    else if (fields[0] === "GEOIP") target = fields[2];
    else if (fields[0] === "MATCH") target = fields[1];
    else if (fields.length >= 2) target = fields[fields.length - 1];
    if (target && !validTargets.has(target)) throw new Error(`${label}: dangling rule target ${target}`);
  }
};

check("inline", {
  proxies: [{ name: "Public JP", type: "http", server: "example.invalid", port: 443 }],
});
check("provider", {
  "proxy-providers": { PublicProvider: { type: "http", url: "https://example.invalid/public.yaml" } },
});
NODE

node - "$OUTPUT_DIR/metadata.json" "$OUTPUT_DIR/rules-metadata.json" <<'NODE'
const fs = require("fs");
for (const path of process.argv.slice(2)) {
  JSON.parse(fs.readFileSync(path, "utf8"));
}
NODE

echo "Validation passed: $OUTPUT_DIR"
