#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SOURCE_CONFIG_PATH = path.join(ROOT_DIR, "sources.json");
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, "dist");
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const usage = () => {
  process.stdout.write(
    "Usage: bun scripts/build.mjs [--output-dir DIR]\n\n" +
      "Build the complete publication directory. DIR defaults to dist.\n"
  );
};

const parseArguments = (args) => {
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output-dir") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--output-dir requires a directory path");
      }
      outputDir = path.resolve(process.cwd(), value);
      index += 1;
    } else if (argument === "-h" || argument === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return outputDir;
};

const assertSafeText = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/u.test(value)) {
    throw new Error(`${label} contains unsafe control or line-separator characters`);
  }
};

const loadConfiguration = async () => {
  let configuration;
  try {
    configuration = JSON.parse(await fs.readFile(SOURCE_CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${SOURCE_CONFIG_PATH}: ${error.message}`);
  }

  if (configuration.license !== "AGPL-3.0") {
    throw new Error("sources.json must record license AGPL-3.0");
  }
  if (configuration.source_repository !== "boweic/ruleset.bowei.co") {
    throw new Error("sources.json must identify boweic/ruleset.bowei.co as the source repository");
  }
  assertSafeText(configuration.release_base_url, "release_base_url");
  assertSafeText(configuration.proxy_group, "proxy_group");

  let releaseBaseUrl;
  try {
    releaseBaseUrl = new URL(configuration.release_base_url);
  } catch (error) {
    throw new Error(`Invalid release_base_url: ${error.message}`);
  }
  if (
    releaseBaseUrl.protocol !== "https:" ||
    releaseBaseUrl.search ||
    releaseBaseUrl.hash ||
    configuration.release_base_url.endsWith("/")
  ) {
    throw new Error("release_base_url must be an HTTPS URL without query/hash and not ending with '/'");
  }
  if (!Array.isArray(configuration.sources) || configuration.sources.length !== 1) {
    throw new Error("sources.json must contain exactly one upstream source");
  }

  const [source] = configuration.sources;
  if (!source || source.name !== "boweic/ruleset.bowei.co") {
    throw new Error("sources.json contains an unexpected upstream source");
  }
  assertSafeText(source.repository, "source.repository");
  assertSafeText(source.base_url, "source.base_url");

  let baseUrl;
  try {
    baseUrl = new URL(source.base_url);
  } catch (error) {
    throw new Error(`Invalid source.base_url: ${error.message}`);
  }
  if (baseUrl.protocol !== "https:" || !source.base_url.endsWith("/")) {
    throw new Error("source.base_url must be an HTTPS URL ending with '/'");
  }

  if (!Array.isArray(source.rules) || source.rules.length !== 13) {
    throw new Error("sources.json must contain exactly 13 rule sets");
  }

  const names = new Set();
  for (const rule of source.rules) {
    if (!rule || typeof rule.name !== "string" || !/^[A-Za-z0-9_-]+$/u.test(rule.name)) {
      throw new Error("Every rule set needs a safe name");
    }
    if (names.has(rule.name)) {
      throw new Error(`Duplicate rule set name: ${rule.name}`);
    }
    names.add(rule.name);
    if (rule.behavior !== "classical") {
      throw new Error(`Rule set ${rule.name} must use behavior classical`);
    }
    assertSafeText(rule.path, `rule ${rule.name} path`);
    if (path.posix.isAbsolute(rule.path) || rule.path.includes("\\") || rule.path.split("/").includes("..")) {
      throw new Error(`Rule set ${rule.name} has an unsafe source path`);
    }
  }

  return { configuration, releaseBaseUrl: releaseBaseUrl.toString().replace(/\/$/u, ""), source };
};

const requestText = (urlString) =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(
      url,
      {
        headers: {
          accept: "text/plain",
          "user-agent": "clash-rules-builder",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          response.once("error", reject);
          response.once("end", () => reject(new Error(`HTTP status ${status}`)));
          return;
        }

        const chunks = [];
        let byteLength = 0;
        response.on("data", (chunk) => {
          byteLength += chunk.length;
          if (byteLength > MAX_RESPONSE_BYTES) {
            response.destroy(new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );

    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error(`request timed out after ${FETCH_TIMEOUT_MS} ms`));
    });
    request.once("error", reject);
  });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchSource = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      process.stdout.write(`Fetching ${url} (attempt ${attempt}/${FETCH_ATTEMPTS})\n`);
      const text = await requestText(url);
      if (text.trim().length === 0) {
        throw new Error("response body is empty");
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError.message}`);
};

const CLASSICAL_RULE_TYPES = new Set([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-WILDCARD",
  "PROCESS-NAME",
  "IP-CIDR",
  "IP-CIDR6",
  "IP-ASN",
]);

const isValidIpv4 = (value) => {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
  );
};

const countIpv6Groups = (value) => {
  if (value.length === 0) return 0;
  const groups = value.split(":");
  if (groups.some((group) => group.length === 0)) return null;

  let groupCount = groups.length;
  const lastGroup = groups[groups.length - 1];
  if (lastGroup.includes(".")) {
    if (!isValidIpv4(lastGroup)) return null;
    groupCount += 1;
  }

  const hexGroups = groups.slice(0, lastGroup.includes(".") ? -1 : undefined);
  if (hexGroups.some((group) => !/^[0-9A-Fa-f]{1,4}$/u.test(group))) return null;
  return groupCount;
};

const isValidIpv6 = (value) => {
  const sections = value.split("::");
  if (sections.length > 2 || value.length === 0) return false;

  const leftCount = countIpv6Groups(sections[0]);
  const rightCount = sections.length === 2 ? countIpv6Groups(sections[1]) : 0;
  if (leftCount === null || rightCount === null) return false;

  return sections.length === 2 ? leftCount + rightCount < 8 : leftCount === 8;
};

const isValidCidr = (value, version) => {
  const match = /^([^/]+)\/(\d+)$/u.exec(value);
  if (!match) return false;

  const prefixLength = Number(match[2]);
  const maxPrefixLength = version === 4 ? 32 : 128;
  if (prefixLength > maxPrefixLength) return false;
  return version === 4 ? isValidIpv4(match[1]) : isValidIpv6(match[1]);
};

const validateClassicalRule = (line, url, lineNumber) => {
  const fields = line.split(",").map((field) => field.trim());
  const [type, value, option] = fields;
  const fail = (reason) => {
    throw new Error(`Invalid classical rule at ${url}:${lineNumber}: ${reason}`);
  };

  if (!CLASSICAL_RULE_TYPES.has(type)) {
    fail(`unsupported rule type ${JSON.stringify(type)}`);
  }
  if (fields.some((field) => field.length === 0)) {
    fail("empty comma-separated field");
  }

  const hasOptionalNoResolve = fields.length === 2 || (fields.length === 3 && option === "no-resolve");
  if (!hasOptionalNoResolve) {
    fail("unexpected comma-separated fields");
  }

  if (type === "IP-CIDR" && !isValidCidr(value, 4)) {
    fail(`invalid IPv4 CIDR ${JSON.stringify(value)}`);
  }
  if (type === "IP-CIDR6" && !isValidCidr(value, 6)) {
    fail(`invalid IPv6 CIDR ${JSON.stringify(value)}`);
  }
  if (type === "IP-ASN" && (!/^\d+$/u.test(value) || Number(value) > 4_294_967_295)) {
    fail(`invalid IP-ASN ${JSON.stringify(value)}`);
  }
  if (!["IP-CIDR", "IP-CIDR6", "IP-ASN"].includes(type) && fields.length !== 2) {
    fail(`${type} does not support an option field`);
  }
  if (["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-WILDCARD"].includes(type) && /\s/u.test(value)) {
    fail(`${type} contains whitespace in its value`);
  }

  return fields.join(",");
};

const parseRules = (text, url) => {
  if (typeof text !== "string" || text.length === 0 || text.trim().length === 0) {
    throw new Error(`Empty rule source: ${url}`);
  }
  if (text.includes("\u0000")) {
    throw new Error(`Unsafe NUL character in rule source: ${url}`);
  }
  if (text.includes("\uFEFF")) {
    throw new Error(`BOM is not allowed in rule source: ${url}`);
  }

  const rules = [];
  const seen = new Set();
  const physicalLines = text.split("\n");
  for (let lineNumber = 0; lineNumber < physicalLines.length; lineNumber += 1) {
    let line = physicalLines[lineNumber];
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    } else if (line.includes("\r")) {
      throw new Error(`Unsafe embedded carriage return at ${url}:${lineNumber + 1}`);
    }

    line = line.trim();
    if (line.length === 0 || /^(?:#|;|\/\/)/u.test(line)) {
      continue;
    }
    if (line.includes("\n") || line.includes("\r") || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/u.test(line)) {
      throw new Error(`Unsafe multi-line or control content at ${url}:${lineNumber + 1}`);
    }
    const rule = validateClassicalRule(line, url, lineNumber + 1);
    if (!seen.has(rule)) {
      seen.add(rule);
      rules.push(rule);
    }
  }

  if (rules.length === 0) {
    throw new Error(`Rule source has no usable rules: ${url}`);
  }
  return rules;
};

const renderYaml = (configuration, source, rule, sourceUrl, rules) => {
  const header = [
    "# Generated by scripts/build.mjs; do not edit.",
    `# Source: ${source.repository} (${sourceUrl})`,
    `# License: ${configuration.license}`,
    "payload:",
  ];
  const entries = rules.map((value) => {
    if (/\r|\n|[\u2028\u2029]/u.test(value)) {
      throw new Error(`Unsafe multi-line rule for ${rule.name}`);
    }
    const serialized = JSON.stringify(value);
    return `  - ${serialized}`;
  });
  return `${header.concat(entries).join("\n")}\n`;
};

const renderOverrideYaml = (configuration, source, releaseBaseUrl) => {
  const lines = [
    "# 自动生成：由 scripts/build.mjs 生成，请勿手动编辑。",
    "# Bind this URL in Clash Party to load these rule providers and rules.",
    "rule-providers:",
  ];

  for (const rule of source.rules) {
    const providerUrl = `${releaseBaseUrl}/rules/${rule.name}.yaml`;
    lines.push(
      `  ${rule.name}:`,
      "    type: http",
      "    behavior: classical",
      "    format: yaml",
      "    interval: 86400",
      `    path: ./rules/${rule.name}.yaml`,
      `    url: ${JSON.stringify(providerUrl)}`,
      `    proxy: ${JSON.stringify(configuration.proxy_group)}`
    );
  }

  lines.push("+rules:");
  for (const rule of source.rules) {
    const target = [
      "ai_non_ip",
      "apple_intelligence_non_ip",
      "stream_non_ip",
      "stream_ip",
      "microsoft_cdn",
      "microsoft_services",
    ].includes(rule.name)
      ? configuration.proxy_group
      : ["reject_non_ip", "reject_ip"].includes(rule.name)
        ? "REJECT"
        : "DIRECT";
    const noResolve = rule.name.endsWith("_ip") ? ",no-resolve" : "";
    lines.push(`  - RULE-SET,${rule.name},${target}${noResolve}`);
  }

  return `${lines.join("\n")}\n`;
};

const pathExists = async (target) => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const replaceOutputDirectory = async (stagingDir, outputDir) => {
  const parentDir = path.dirname(outputDir);
  const outputExists = await pathExists(outputDir);
  let backupDir = null;
  let oldOutputMoved = false;

  if (outputExists) {
    const outputStat = await fs.lstat(outputDir);
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
      throw new Error(`Output path is not a normal directory: ${outputDir}`);
    }
    backupDir = await fs.mkdtemp(path.join(parentDir, `.${path.basename(outputDir)}-backup-`));
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rename(outputDir, backupDir);
    oldOutputMoved = true;
  }

  try {
    await fs.rename(stagingDir, outputDir);
  } catch (error) {
    if (oldOutputMoved) {
      try {
        await fs.rename(backupDir, outputDir);
      } catch (restoreError) {
        throw new Error(`${error.message}; could not restore old output: ${restoreError.message}`);
      }
    }
    throw error;
  }

  if (backupDir) {
    try {
      await fs.rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`Warning: could not remove temporary backup ${backupDir}: ${error.message}\n`);
    }
  }
};

const build = async (outputDir) => {
  const { configuration, releaseBaseUrl, source } = await loadConfiguration();
  await fs.mkdir(path.dirname(outputDir), { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(path.dirname(outputDir), `.${path.basename(outputDir)}-staging-`));
  let outputCommitted = false;

  try {
    const stagingRulesDir = path.join(stagingDir, "rules");
    await fs.mkdir(stagingRulesDir);
    for (const rule of source.rules) {
      const sourceUrl = new URL(rule.path, source.base_url).toString();
      const sourceText = await fetchSource(sourceUrl);
      const rules = parseRules(sourceText, sourceUrl);
      const yaml = renderYaml(configuration, source, rule, sourceUrl, rules);
      await fs.writeFile(path.join(stagingRulesDir, `${rule.name}.yaml`), yaml, "utf8");
    }

    await fs.writeFile(
      path.join(stagingDir, "clash-party-override.yaml"),
      renderOverrideYaml(configuration, source, releaseBaseUrl),
      "utf8"
    );

    const stagedRootEntries = await fs.readdir(stagingDir);
    const stagedProviderFiles = await fs.readdir(stagingRulesDir);
    if (
      stagedRootEntries.length !== 2 ||
      !stagedRootEntries.includes("rules") ||
      !stagedRootEntries.includes("clash-party-override.yaml") ||
      stagedProviderFiles.length !== source.rules.length ||
      stagedProviderFiles.some((file) => !file.endsWith(".yaml"))
    ) {
      throw new Error("Staging directory does not contain exactly the configured publication artifacts");
    }

    await replaceOutputDirectory(stagingDir, outputDir);
    outputCommitted = true;
    process.stdout.write(`Built ${stagedProviderFiles.length} rule providers and Clash Party override in ${outputDir}\n`);
  } finally {
    if (!outputCommitted) {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }
};

try {
  const outputDir = parseArguments(process.argv.slice(2));
  await build(outputDir);
} catch (error) {
  process.stderr.write(`Build failed: ${error.message}\n`);
  process.exitCode = 1;
}
