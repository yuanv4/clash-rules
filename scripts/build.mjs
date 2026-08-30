#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSubstoreOverride } from "./render-substore-override.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SOURCE_CONFIG_PATH = path.join(ROOT_DIR, "sources.json");
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, "dist");
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PATH_DECODE_PASSES = 8;

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
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(value)) {
    throw new Error(`${label} contains unsafe control or line-separator characters`);
  }
};

const assertKnownKeys = (object, allowedKeys, context) => {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${context} has unknown key ${JSON.stringify(key)}`);
    }
  }
};

const INPUT_FORMATS = new Set(["raw-list", "clash-yaml"]);

export const resolveInputFormat = (sourceInputFormat, inputFormatOverride) =>
  inputFormatOverride ?? sourceInputFormat;

const parseHttpsUrl = (value, label, { requireTrailingSlash = false } = {}) => {
  assertSafeText(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.search ||
    parsed.hash ||
    (requireTrailingSlash && !value.endsWith("/"))
  ) {
    throw new Error(
      `${label} must be an HTTPS URL${requireTrailingSlash ? " ending with '/'" : " without query/hash"}`
    );
  }
  return parsed;
};

const hasDotPathSegment = (value) => value.split("/").some((segment) => segment === "." || segment === "..");

const resolveInputSourceUrl = (relativePath, input, context) => {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(relativePath) || relativePath.startsWith("//")) {
    throw new Error(`${context} path must be a relative path`);
  }

  let decodedReferencePath = relativePath;
  const rejectUnsafeDecodedPath = (value) => {
    if (hasDotPathSegment(value)) {
      throw new Error(`${context} path contains traversal segments`);
    }
    if (value.includes("?") || value.includes("#")) {
      throw new Error(`${context} path must not contain a query or fragment`);
    }
  };

  let stabilized = false;
  try {
    for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
      rejectUnsafeDecodedPath(decodedReferencePath);
      const nextPath = decodeURIComponent(decodedReferencePath);
      rejectUnsafeDecodedPath(nextPath);
      if (nextPath === decodedReferencePath) {
        stabilized = true;
        break;
      }
      decodedReferencePath = nextPath;
    }
  } catch (error) {
    if (error.name === "URIError" || error instanceof URIError) {
      throw new Error(`${context} path contains invalid URL encoding`);
    }
    throw error;
  }
  if (!stabilized) {
    throw new Error(`${context} path encoding did not stabilize after ${MAX_PATH_DECODE_PASSES} passes`);
  }

  let resolved;
  try {
    resolved = new URL(relativePath, input.baseUrl);
  } catch (error) {
    throw new Error(`${context} path is not a valid relative URL: ${error.message}`);
  }
  if (
    resolved.protocol !== "https:" ||
    resolved.origin !== input.baseUrl.origin ||
    resolved.search ||
    resolved.hash
  ) {
    throw new Error(`${context} path resolves outside the declared HTTPS input base`);
  }

  let decodedBasePath;
  let decodedResolvedPath;
  try {
    decodedBasePath = decodeURIComponent(input.baseUrl.pathname);
    decodedResolvedPath = decodeURIComponent(resolved.pathname);
  } catch (error) {
    throw new Error(`${context} path produces invalid URL encoding`);
  }
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(decodedBasePath + decodedResolvedPath)) {
    throw new Error(`${context} path resolves to unsafe control characters`);
  }

  const normalizedBasePath = path.posix.normalize(decodedBasePath);
  const normalizedResolvedPath = path.posix.normalize(decodedResolvedPath);
  const basePathPrefix = normalizedBasePath === "/"
    ? "/"
    : `${normalizedBasePath.replace(/\/+$/u, "")}/`;
  if (!normalizedResolvedPath.startsWith(basePathPrefix)) {
    throw new Error(`${context} path escapes the declared input base path`);
  }
  return resolved.toString();
};

const validateLicense = (license, inputName) => {
  if (!license || typeof license !== "object" || Array.isArray(license)) {
    throw new Error(`Input ${inputName} must have license metadata`);
  }
  assertKnownKeys(license, new Set(["id", "url"]), `Input ${inputName} license`);
  assertSafeText(license.id, `input ${inputName} license id`);
  parseHttpsUrl(license.url, `input ${inputName} license url`);
  return { id: license.id, url: license.url };
};

export const normalizeConfiguration = (config) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("sources.json must contain a configuration object");
  }
  assertKnownKeys(config, new Set(["release_base_url", "proxy_group", "inputs", "providers"]), "Root configuration");

  assertSafeText(config.release_base_url, "release_base_url");
  assertSafeText(config.proxy_group, "proxy_group");

  const releaseBaseUrl = parseHttpsUrl(config.release_base_url, "release_base_url");
  if (config.release_base_url.endsWith("/")) {
    throw new Error("release_base_url must be an HTTPS URL without query/hash and not ending with '/'");
  }

  if (!Array.isArray(config.inputs) || config.inputs.length === 0) {
    throw new Error("sources.json must contain at least one input");
  }
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error("sources.json must contain at least one provider");
  }

  const inputNames = new Set();
  const inputsByName = new Map();
  for (const input of config.inputs) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Every input must be an object");
    }
    const inputContext = `Input ${typeof input.name === "string" ? JSON.stringify(input.name) : "(unnamed)"}`;
    assertKnownKeys(input, new Set(["name", "repository", "base_url", "license", "input_format"]), inputContext);
    assertSafeText(input.name, "input.name");
    if (inputNames.has(input.name)) {
      throw new Error(`Duplicate input name: ${input.name}`);
    }
    inputNames.add(input.name);

    parseHttpsUrl(input.repository, `input ${input.name} repository`);
    const baseUrl = parseHttpsUrl(input.base_url, `input ${input.name} base_url`, {
      requireTrailingSlash: true,
    });
    const license = validateLicense(input.license, input.name);
    if (input.input_format !== undefined) {
      assertSafeText(input.input_format, `input ${input.name} input_format`);
    }
    const inputFormat = input.input_format ?? "raw-list";
    if (!INPUT_FORMATS.has(inputFormat)) {
      throw new Error(`Input ${input.name}: unsupported input_format ${JSON.stringify(inputFormat)}`);
    }

    const normalizedInput = {
      name: input.name,
      repository: input.repository,
      baseUrl,
      license,
      inputFormat,
    };
    inputsByName.set(input.name, normalizedInput);
  }

  const providerNames = new Set();
  const providers = [];

  for (const provider of config.providers) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
      throw new Error("Every provider must be an object");
    }
    const providerContext = `Provider ${typeof provider.name === "string" ? JSON.stringify(provider.name) : "(unnamed)"}`;
    assertKnownKeys(provider, new Set(["name", "target", "no_resolve", "behavior", "inputs"]), providerContext);
    assertSafeText(provider.name, `${providerContext} name`);
    if (!/^[A-Za-z0-9_-]+$/u.test(provider.name)) {
      throw new Error("Every provider needs a safe name");
    }
    if (providerNames.has(provider.name)) {
      throw new Error(`Duplicate provider name: ${provider.name}`);
    }
    providerNames.add(provider.name);

    assertSafeText(provider.target, `provider ${provider.name} target`);
    if (provider.behavior !== undefined) {
      assertSafeText(provider.behavior, `provider ${provider.name} behavior`);
    }
    if (provider.behavior !== undefined && provider.behavior !== "classical") {
      throw new Error(`Provider ${provider.name} must use behavior classical`);
    }
    if (typeof provider.no_resolve !== "boolean") {
      throw new Error(`Provider ${provider.name}: no_resolve must be explicitly boolean`);
    }
    if (!Array.isArray(provider.inputs) || provider.inputs.length === 0) {
      throw new Error(`Provider ${provider.name} must have at least one input`);
    }

    const normalizedInputs = provider.inputs.map((reference, index) => {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        throw new Error(`Provider ${provider.name} input ${index + 1} must be an object`);
      }
      const referenceContext = `Provider ${provider.name} input ${index + 1}`;
      assertKnownKeys(reference, new Set(["input", "path", "input_format"]), referenceContext);
      assertSafeText(reference.input, `${referenceContext} name`);
      if (!inputNames.has(reference.input)) {
        throw new Error(`${referenceContext} references unknown input ${JSON.stringify(reference.input)}`);
      }
      assertSafeText(reference.path, `${referenceContext} path`);
      if (
        path.posix.isAbsolute(reference.path) ||
        reference.path.includes("\\") ||
        reference.path.includes("?") ||
        reference.path.includes("#") ||
        reference.path.split("/").includes("..")
      ) {
        throw new Error(`Provider ${provider.name} input ${index + 1} has an unsafe source path`);
      }

      const input = inputsByName.get(reference.input);
      if (reference.input_format !== undefined) {
        assertSafeText(reference.input_format, `${referenceContext} input_format`);
      }
      const inputFormat = resolveInputFormat(input.inputFormat, reference.input_format);
      if (!INPUT_FORMATS.has(inputFormat)) {
        throw new Error(
          `Provider ${provider.name} input ${index + 1}: unsupported input_format ${JSON.stringify(inputFormat)}`
        );
      }

      return {
        inputName: input.name,
        inputFormat,
        sourceUrl: resolveInputSourceUrl(reference.path, input, referenceContext),
        sourceRepository: input.repository,
        license: input.license,
      };
    });

    providers.push({
      name: provider.name,
      target: provider.target,
      noResolve: provider.no_resolve === true,
      behavior: "classical",
      inputs: normalizedInputs,
    });
  }

  return { releaseBaseUrl: releaseBaseUrl.toString().replace(/\/$/u, ""), providers };
};

const loadConfiguration = async () => {
  let config;
  try {
    config = JSON.parse(await fs.readFile(SOURCE_CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${SOURCE_CONFIG_PATH}: ${error.message}`);
  }
  return normalizeConfiguration(config);
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
  "DOMAIN-REGEX",
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

const assertSafeRuleLine = (line, url, location) => {
  if (
    line.includes("\n") ||
    line.includes("\r") ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/u.test(line)
  ) {
    throw new Error(`Unsafe multi-line or control content at ${url}:${location}`);
  }
};

export const serializeRule = ({ type, value, options = [] }) => [type, value, ...options].join(",");

const parseClassicalRule = (line, url, lineNumber) => {
  const firstComma = line.indexOf(",");
  const type = (firstComma === -1 ? line : line.slice(0, firstComma)).trim();
  const fail = (reason) => {
    throw new Error(`Invalid classical rule at ${url}:${lineNumber}: ${reason}`);
  };

  if (!CLASSICAL_RULE_TYPES.has(type)) {
    fail(`unsupported rule type ${JSON.stringify(type)}`);
  }
  if (type === "DOMAIN-REGEX") {
    const value = firstComma === -1 ? "" : line.slice(firstComma + 1);
    if (value.trim().length === 0) {
      fail("DOMAIN-REGEX requires a non-empty expression");
    }
    if (/(?:,\s*)no-resolve$/u.test(value)) {
      fail("DOMAIN-REGEX does not support an option field");
    }
    return { type, value, options: [] };
  }

  const fields = line.split(",").map((field) => field.trim());
  const [, value, option] = fields;
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
  return { type, value, options: fields.slice(2) };
};

const assertSafeRuleSource = (text, url) => {
  if (typeof text !== "string" || text.length === 0 || text.trim().length === 0) {
    throw new Error(`Empty rule source: ${url}`);
  }
  if (text.includes("\u0000")) {
    throw new Error(`Unsafe NUL character in rule source: ${url}`);
  }
  if (text.includes("\uFEFF")) {
    throw new Error(`BOM is not allowed in rule source: ${url}`);
  }
};

const deduplicateRules = (entries, url) => {
  const rules = [];
  const seen = new Set();
  for (const { line, location } of entries) {
    const rule = parseClassicalRule(line, url, location);
    const serialized = serializeRule(rule);
    if (!seen.has(serialized)) {
      seen.add(serialized);
      rules.push(rule);
    }
  }

  if (rules.length === 0) {
    throw new Error(`Rule source has no usable rules: ${url}`);
  }
  return rules;
};

const parseRawListRules = (text, url) => {
  const entries = [];

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
    assertSafeRuleLine(line, url, lineNumber + 1);
    entries.push({ line, location: lineNumber + 1 });
  }

  return deduplicateRules(entries, url);
};

const parseClashYamlRules = (text, url) => {
  if (typeof globalThis.Bun?.YAML?.parse !== "function") {
    throw new Error(`Clash YAML input at ${url} requires Bun.YAML.parse; use Bun 1.3.14 or newer`);
  }

  let document;
  try {
    document = globalThis.Bun.YAML.parse(text);
  } catch (error) {
    throw new Error(`Invalid Clash YAML at ${url}: ${error.message}`);
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`Invalid Clash YAML at ${url}: root must be a single mapping`);
  }
  if (!Object.prototype.hasOwnProperty.call(document, "payload")) {
    throw new Error(`Invalid Clash YAML at ${url}: root mapping must contain payload`);
  }
  if (!Array.isArray(document.payload)) {
    throw new Error(`Invalid Clash YAML at ${url}: payload must be an array`);
  }

  const entries = document.payload.map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid Clash YAML payload at ${url}: payload[${index}] must be a non-empty string`);
    }
    const payloadValue = value.trim();
    const bareValue = payloadValue.startsWith("+.") ? payloadValue.slice(2) : payloadValue;
    const line = payloadValue.includes(",")
      ? payloadValue
      : isValidCidr(bareValue, 4)
        ? `IP-CIDR,${bareValue}`
        : isValidCidr(bareValue, 6)
          ? `IP-CIDR6,${bareValue}`
          : `DOMAIN-SUFFIX,${bareValue}`;
    assertSafeRuleLine(line, url, `payload[${index}]`);
    return { line, location: `payload[${index}]` };
  });

  return deduplicateRules(entries, url);
};

export const parseRules = (text, url, inputFormat = "raw-list") => {
  assertSafeRuleSource(text, url);
  if (inputFormat === "clash-yaml") {
    return parseClashYamlRules(text, url);
  }
  if (inputFormat !== "raw-list") {
    throw new Error(`Unsupported rule input format ${JSON.stringify(inputFormat)} at ${url}`);
  }
  return parseRawListRules(text, url);
};

export const mergeRules = (ruleSets) => {
  const merged = [];
  const seen = new Set();
  for (const rules of ruleSets) {
    for (const rule of rules) {
      const serialized = serializeRule(rule);
      if (!seen.has(serialized)) {
        seen.add(serialized);
        merged.push(rule);
      }
    }
  }
  return merged;
};

export const renderYaml = (provider, rules) => {
  const provenance = provider.inputs.length === 1
    ? [
        `# Source: ${provider.inputs[0].sourceRepository} (${provider.inputs[0].sourceUrl})`,
        `# License: ${provider.inputs[0].license.id} (${provider.inputs[0].license.url})`,
      ]
    : provider.inputs.flatMap((input, index) => [
        `# Source ${index + 1} [${input.inputName}]: ${input.sourceRepository} (${input.sourceUrl})`,
        `# License ${index + 1} [${input.inputName}]: ${input.license.id} (${input.license.url})`,
      ]);
  const header = [
    "# Generated by scripts/build.mjs; do not edit.",
    ...provenance,
    "payload:",
  ];
  const entries = rules.map((rule) => {
    const value = serializeRule(rule);
    if (/\r|\n|[\u2028\u2029]/u.test(value)) {
      throw new Error(`Unsafe multi-line rule for ${provider.name}`);
    }
    const serialized = JSON.stringify(value);
    return `  - ${serialized}`;
  });
  return `${header.concat(entries).join("\n")}\n`;
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
  const { releaseBaseUrl, providers } = await loadConfiguration();
  await fs.mkdir(path.dirname(outputDir), { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(path.dirname(outputDir), `.${path.basename(outputDir)}-staging-`));
  let outputCommitted = false;

  try {
    const stagingRulesDir = path.join(stagingDir, "rules");
    await fs.mkdir(stagingRulesDir);
    for (const provider of providers) {
      const inputRules = [];
      for (const input of provider.inputs) {
        const sourceText = await fetchSource(input.sourceUrl);
        inputRules.push(parseRules(sourceText, input.sourceUrl, input.inputFormat));
      }
      const rules = mergeRules(inputRules);
      const yaml = renderYaml(provider, rules);
      await fs.writeFile(path.join(stagingRulesDir, `${provider.name}.yaml`), yaml, "utf8");
    }

    await fs.writeFile(
      path.join(stagingDir, "sub-store-override.js"),
      renderSubstoreOverride(providers, releaseBaseUrl),
      "utf8"
    );

    const stagedRootEntries = await fs.readdir(stagingDir);
    const stagedProviderFiles = await fs.readdir(stagingRulesDir);
    if (
      stagedRootEntries.length !== 2 ||
      !stagedRootEntries.includes("rules") ||
      !stagedRootEntries.includes("sub-store-override.js") ||
      stagedProviderFiles.length !== providers.length ||
      stagedProviderFiles.some((file) => !file.endsWith(".yaml"))
    ) {
      throw new Error("Staging directory does not contain exactly the configured publication artifacts");
    }

    await replaceOutputDirectory(stagingDir, outputDir);
    outputCommitted = true;
    process.stdout.write(
      `Built ${stagedProviderFiles.length} rule providers and sub-store override in ${outputDir}\n`
    );
  } finally {
    if (!outputCommitted) {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }
};

if (import.meta.main) {
  try {
    const outputDir = parseArguments(process.argv.slice(2));
    await build(outputDir);
  } catch (error) {
    process.stderr.write(`Build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
