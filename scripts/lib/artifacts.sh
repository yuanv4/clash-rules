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

json_metadata() {
  local path="$1"
  local build_time_utc="$2"
  local git_sha="$3"
  local claude_count="$4"
  local skip_remote="$5"

  node - "$path" "$SOURCE_FILE" "$REGION_DATA_FILE" "$build_time_utc" "$git_sha" "$claude_count" "$skip_remote" <<'NODE'
const fs = require("fs");
const [
  outputDir,
  source,
  regionData,
  buildTimeUtc,
  gitSha,
  claudeCount,
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
    ],
  }, null, 2) + "\n"
);
NODE
}
