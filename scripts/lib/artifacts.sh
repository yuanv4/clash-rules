build_script_artifact() {
  local source_path="$1"
  local region_path="$2"
  local output_path="$3"
  local routing_rules_path="$4"
  local tun_path="$5"
  [[ -f "$source_path" ]] || { echo "Source file not found: $source_path" >&2; exit 1; }
  [[ -f "$region_path" ]] || { echo "Region data file not found: $region_path" >&2; exit 1; }
  [[ -f "$routing_rules_path" ]] || { echo "Routing rules file not found: $routing_rules_path" >&2; exit 1; }
  [[ -f "$tun_path" ]] || { echo "TUN config file not found: $tun_path" >&2; exit 1; }

  node - "$source_path" "$region_path" "$routing_rules_path" "$tun_path" "$output_path" <<'NODE'
const fs = require("fs");
const [sourcePath, regionPath, routingRulesPath, tunPath, outputPath] = process.argv.slice(2);
const sourceContent = fs.readFileSync(sourcePath, "utf8");
const regionContent = fs.readFileSync(regionPath, "utf8").trim();
const tunContent = fs.readFileSync(tunPath, "utf8").trim();

const readRuleFile = (path) => fs.readFileSync(path, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"));

const placeholders = {
  __REGION_SPECS__: regionContent,
  __ROUTING_RULES__: JSON.stringify(readRuleFile(routingRulesPath)),
  __TUN_CONFIG__: tunContent,
};

let result = sourceContent;
for (const [placeholder, value] of Object.entries(placeholders)) {
  if (!result.includes(placeholder)) {
    throw new Error(`Placeholder not found in source script: ${placeholder}`);
  }
  result = result.replace(placeholder, value);
}

fs.writeFileSync(outputPath, result);
NODE
}

json_metadata() {
  local path="$1"
  local build_time_utc="$2"
  local git_sha="$3"
  local skip_remote="$4"

  node - "$path" "$SOURCE_FILE" "$REGION_DATA_FILE" "$build_time_utc" "$git_sha" "$skip_remote" <<'NODE'
const fs = require("fs");
const [
  outputDir,
  source,
  regionData,
  buildTimeUtc,
  gitSha,
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
    targets: [],
    skip_remote: skipRemote,
  }, null, 2) + "\n"
);
NODE
}
