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
[[ -f "src/data/tun.js" ]] || fail "required source file missing: src/data/tun.js"
[[ -f "scripts/publish.sh" ]] || fail "required script missing: scripts/publish.sh"
[[ -f "scripts/lib/rules.sh" ]] || fail "required script missing: scripts/lib/rules.sh"
[[ -f "scripts/lib/artifacts.sh" ]] || fail "required script missing: scripts/lib/artifacts.sh"
[[ -f "rules/routes.txt" ]] || fail "required rule file missing: rules/routes.txt"

command -v node >/dev/null 2>&1 || fail "node command not found"

node --check "src/clash-rules.js" >/dev/null
node --check "src/data/regions.js" >/dev/null
node --check "src/data/tun.js" >/dev/null
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
  "__REGION_SPECS__", "__ROUTING_RULES__",
  "__TUN_CONFIG__",
];
process.exit(placeholders.some((placeholder) => content.includes(placeholder)) ? 0 : 1);
NODE
then
  fail "artifact still contains unresolved placeholder: $OUTPUT_DIR/clash-rules.js"
fi

node - "$OUTPUT_DIR/clash-rules.js" "rules/routes.txt" <<'NODE'
const fs = require("fs");
const net = require("net");
const path = require("path");
const main = require(path.resolve(process.argv[2]));
const routesPath = process.argv[3];
const builtins = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS"]);
const allowedTypes = new Set([
  "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "PROCESS-NAME",
  "IP-CIDR", "IP-CIDR6", "RULE-SET", "GEOIP", "MATCH",
]);

const readRuleFile = (filePath) => fs.readFileSync(filePath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"));

const routes = readRuleFile(routesPath);

const validCidr = (value, expectedVersion = null) => {
  const parts = value.split("/");
  if (parts.length !== 2 || !/^(0|[1-9][0-9]*)$/.test(parts[1])) return false;
  const version = net.isIP(parts[0]);
  if (version === 0 || (expectedVersion !== null && version !== expectedVersion)) return false;
  const prefix = Number(parts[1]);
  const width = version === 4 ? 32 : 128;
  return prefix >= 0 && prefix <= width;
};

const isIpProvider = (name, provider) =>
  /(?:^|_)ip$/.test(name) || Boolean(provider && /\/ip\//.test(provider.url || ""));

const validateRoutes = (label, result) => {
  const groups = new Set((result["proxy-groups"] || []).map((group) => group.name));
  const providers = result["rule-providers"] || {};
  const providerNames = new Set(Object.keys(providers));
  const proxyNames = new Set((result.proxies || []).map((proxy) => proxy.name));
  const validTargets = new Set([...groups, ...builtins, ...proxyNames]);
  let matchCount = 0;

  for (let index = 0; index < routes.length; index += 1) {
    const rule = routes[index];
    const fields = rule.split(",");
    const type = fields[0];
    if (!allowedTypes.has(type)) throw new Error(`${label}: unsupported route type ${type}`);
    if (fields.some((field) => field === "")) throw new Error(`${label}: empty route field at ${index + 1}`);

    let target;
    if (["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "PROCESS-NAME"].includes(type)) {
      if (fields.length !== 3) throw new Error(`${label}: ${type} requires 3 fields`);
      target = fields[2];
    } else if (type === "IP-CIDR" || type === "IP-CIDR6") {
      if (fields.length !== 4 || fields[3] !== "no-resolve") {
        throw new Error(`${label}: ${type} must end with no-resolve`);
      }
      if (!validCidr(fields[1], type === "IP-CIDR6" ? 6 : null)) {
        const family = type === "IP-CIDR6" ? "IPv6" : "IPv4 or IPv6";
        throw new Error(`${label}: invalid ${type} ${family} CIDR ${fields[1]}`);
      }
      target = fields[2];
    } else if (type === "RULE-SET") {
      if (!providerNames.has(fields[1])) throw new Error(`${label}: missing provider ${fields[1]}`);
      const ipProvider = isIpProvider(fields[1], providers[fields[1]]);
      if ((ipProvider && (fields.length !== 4 || fields[3] !== "no-resolve")) ||
          (!ipProvider && fields.length !== 3)) {
        throw new Error(`${label}: invalid RULE-SET options for ${fields[1]}`);
      }
      target = fields[2];
    } else if (type === "GEOIP") {
      if (fields.length !== 3 && (fields.length !== 4 || fields[3] !== "no-resolve")) {
        throw new Error(`${label}: GEOIP requires target and optional no-resolve`);
      }
      target = fields[2];
    } else {
      if (fields.length !== 2) throw new Error(`${label}: MATCH requires 2 fields`);
      target = fields[1];
      matchCount += 1;
      if (index !== routes.length - 1) throw new Error(`${label}: MATCH must be last`);
    }

    if (!validTargets.has(target)) throw new Error(`${label}: dangling route target ${target}`);
  }

  if (matchCount !== 1) throw new Error(`${label}: expected exactly one MATCH, got ${matchCount}`);
  if (JSON.stringify(result.rules || []) !== JSON.stringify(routes)) {
    throw new Error(`${label}: generated rules differ from routes.txt or changed order`);
  }
};

const check = (label, config) => {
  const result = main(config);
  const groups = new Set((result["proxy-groups"] || []).map((group) => group.name));
  const proxyNames = new Set((config.proxies || []).map((proxy) => proxy.name));
  const validTargets = new Set([...groups, ...builtins, ...proxyNames]);
  for (const group of result["proxy-groups"] || []) {
    for (const candidate of group.proxies || []) {
      if (!validTargets.has(candidate)) throw new Error(`${label}: dangling group candidate ${candidate}`);
    }
  }
  validateRoutes(label, result);
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
