#!/usr/bin/env bun
/**
 * 生成 FlClash 自定义配置（custom profile）。
 *
 * 输入：
 *   - sources.json                      规则集与 provider 定义（仓库内，非机密）
 *   - 环境变量 SUBSCRIPTIONS_JSON        唯一需要配置的机密，结构见下
 *
 * SUBSCRIPTIONS_JSON 形状（值类型决定用途）：
 *   {
 *     "mojie":      "https://机场订阅链接",          // 字符串 → 远程订阅 provider
 *     "youtu":      "https://机场订阅链接",
 *     "amytelecom": ["- {name: 香港 01, ...}",        // 数组   → 静态节点（链接会过期时用）
 *                    "- {name: 香港 02, ...}"]
 *   }
 *
 * Tailscale 出口由 Worker 按请求参数注入；本脚本只生成专用占位行。
 *
 * 输出：stdout 或 --output 指定文件。
 *
 * 需要 Bun 运行时（使用内置 Bun.YAML 校验静态节点，无外部 YAML 依赖）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectTailscale } from "../worker/clash-profile.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SOURCE_CONFIG_PATH = path.join(ROOT_DIR, "sources.json");

const TEST_URL = "https://cp.cloudflare.com/generate_204";
const AI_TEST_URL = "https://chatgpt.com/";

const TAILSCALE_GROUP = "Tailscale";
const MANUAL_GROUP = "🚀 节点选择";
const FALLBACK_GROUP = "🐟 漏网之鱼";
const AD_BLOCK_GROUP = "🛑 广告过滤";
const ADULT_GROUP = "🔞 成人内容";
const DOMESTIC_GROUP = "🇨🇳 国内服务";
const FOREIGN_GROUP = "🌐 国外服务";
const AI_GROUP = "🤖 国际 AI";
const DEV_GROUP = "🧑‍💻 开发服务";
const STREAMING_GROUP = "🎬 流媒体服务";

// 机场会在节点列表里塞「剩余流量 / 到期时间」这类假节点，统一剔除；
// Tailscale 出口节点也不该进入节点组（它有独立的 Tailscale 策略组）。
const FAKE_NODE_ALT =
  "当前流量|剩余流量|距離下次重置|距离下次重置|到期时间|过期时间|套餐|官网|群组|订阅地址";
const TAILSCALE_NODE_ALT = "^(?:TAILSCALE|TAILSCALE-DIRECT)$";
const NODE_EXCLUDE_ALT = `${FAKE_NODE_ALT}|${TAILSCALE_NODE_ALT}`;
const NODE_EXCLUDE_PATTERN = `(?:${NODE_EXCLUDE_ALT})`;

// mihomo 的 filter 走 Go RE2，不支持环视断言，所以台湾/香港匹配改用边界分组。
const AI_REGION_PATTERN =
  "(?i)(?:台灣|台湾|台北|taiwan|taipei|🇹🇼|(?:^|[^a-z0-9])(?:tw|twn)(?:$|[^a-z0-9]))";
const AI_EXCLUDED_ALT =
  "🇭🇰|🇲🇴|香港|澳门|澳門|hong\\s*kong|macao|macau|(?:^|[^a-z0-9])(?:hk|hkg|mo|mac)(?:$|[^a-z0-9])";
const AI_EXCLUDE_PATTERN = `(?i)(?:${AI_EXCLUDED_ALT}|${NODE_EXCLUDE_ALT})`;

/**
 * Tailscale 出口由 Cloudflare Worker 在请求时按查询参数注入（worker/clash-profile.js），
 * 这里只留下占位符，保证同一份 KV 内容可以服务桌面端和 Android。
 */
const TAILSCALE_PROXIES_PLACEHOLDER = "  __TAILSCALE_PROXIES__";
const TAILSCALE_GROUP_PLACEHOLDER = "[__TAILSCALE_GROUP__]";
const TAILSCALE_DEFAULT_PLACEHOLDER = "__TAILSCALE_DEFAULT__";

/** YAML 双引号标量；JSON 字符串转义是 YAML 双引号风格的安全子集。 */
const q = (value) => JSON.stringify(String(value));

const usage = () => {
  process.stdout.write(
    "Usage: bun scripts/render-flclash-profile.mjs [--output FILE]\n\n" +
      "环境变量:\n" +
      '  SUBSCRIPTIONS_JSON  必填，例如：\n' +
      '    {"mojie":"https://订阅链接","amytelecom":["- {name: 香港 01, ...}"]}\n' +
      "    字符串值 = 远程订阅；数组值 = 静态节点 YAML 行\n"
  );
};

const parseArguments = (argv) => {
  let output = null;
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === "--output") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) throw new Error("--output requires a file path");
      output = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { output };
};

/**
 * 解析 SUBSCRIPTIONS_JSON：
 *   字符串值 → 远程订阅 provider
 *   数组值   → 静态节点（每个元素是一条 YAML 节点行）
 */
export const parseSubscriptionConfig = (raw, proxyGroup) => {
  const reservedNames = new Set([
    "DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL",
    "TAILSCALE", "TAILSCALE-DIRECT", TAILSCALE_GROUP, MANUAL_GROUP,
    FALLBACK_GROUP, AD_BLOCK_GROUP, ADULT_GROUP, DOMESTIC_GROUP,
    FOREIGN_GROUP, AI_GROUP, DEV_GROUP, STREAMING_GROUP, proxyGroup,
  ]);
  const names = new Set();
  if (!raw || !raw.trim()) {
    throw new Error(
      'SUBSCRIPTIONS_JSON is required, e.g. {"mojie":"https://订阅链接","amytelecom":["- {name: 香港 01, ...}"]}'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`SUBSCRIPTIONS_JSON is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SUBSCRIPTIONS_JSON must be a JSON object");
  }

  const providers = [];
  const staticProxyLines = [];

  for (const [name, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error(`Invalid subscription name "${name}" (allowed: A-Z a-z 0-9 _ . -)`);
    }

    if (typeof value === "string") {
      const url = value.trim();
      if (!/^https?:\/\//.test(url)) {
        throw new Error(
          `Subscription "${name}" must be an http(s) URL; use an array for static nodes`
        );
      }
      providers.push({ name, url });
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new Error(`Static nodes for "${name}" must not be an empty array`);
      }
      for (const [index, line] of value.entries()) {
        if (typeof line !== "string" || line.trim().length === 0) {
          throw new Error(`Static node ${index + 1} of "${name}" must be a non-empty YAML line`);
        }
        if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(line)) {
          throw new Error(`Static node ${index + 1} of "${name}" must be a single YAML line without control characters`);
        }
        let node;
        try {
          const parsedNode = Bun.YAML.parse(line);
          node = Array.isArray(parsedNode) && parsedNode.length === 1 ? parsedNode[0] : parsedNode;
        } catch {
          // Do not echo YAML parser diagnostics: they can contain credentials.
          throw new Error(`Static node ${index + 1} of "${name}" is not valid YAML`);
        }
        if (!node || typeof node !== "object" || Array.isArray(node) ||
            typeof node.name !== "string" || !node.name.trim() ||
            typeof node.type !== "string" || !node.type.trim()) {
          throw new Error(`Static node ${index + 1} of "${name}" must be one mapping with non-empty string name and type`);
        }
        if (reservedNames.has(node.name) || names.has(node.name)) {
          throw new Error(`Static node ${index + 1} of "${name}" has a reserved or duplicate name`);
        }
        names.add(node.name);
        // JSON flow mappings are YAML-safe, and keep all data on one physical line.
        // Never splice untrusted YAML (including multiline scalars) into the template.
        let serialized;
        try {
          serialized = JSON.stringify(node);
        } catch {
          throw new Error(`Static node ${index + 1} of "${name}" cannot be serialized`);
        }
        staticProxyLines.push(`  - ${serialized}`);
      }
      continue;
    }

    throw new Error(`Subscription "${name}" must be a URL string or an array of static YAML lines`);
  }

  if (providers.length === 0 && staticProxyLines.length === 0) {
    throw new Error("SUBSCRIPTIONS_JSON contains no providers and no static nodes");
  }
  return { providers, staticProxyLines };
};

const buildProxyProviders = (providers) =>
  providers
    .map(
      (provider) => `  ${q(provider.name)}:
    type: http
    url: ${q(provider.url)}
    path: ./providers/${provider.name}.yaml
    interval: 3600
    health-check:
      enable: true
      url: ${q(TEST_URL)}
      interval: 300`
    )
    .join("\n");

const buildRuleProviders = (sourceProviders, releaseBaseUrl) =>
  sourceProviders
    .map((provider) => {
      const behavior = provider.behavior ?? "classical";
      const extension = behavior === "domain" ? "txt" : "yaml";
      const format = behavior === "domain" ? "text" : "yaml";
      return `  ${q(provider.name)}:
    type: http
    behavior: ${behavior}
    format: ${format}
    interval: 86400
    url: ${q(`${releaseBaseUrl}/rules/${provider.name}.${extension}`)}
    path: ./rules/${provider.name}.${extension}`;
    })
    .join("\n");

const buildGroups = (proxyGroup) => {
  const businessGroups = [
    TAILSCALE_GROUP,
    AD_BLOCK_GROUP,
    ADULT_GROUP,
    DOMESTIC_GROUP,
    FOREIGN_GROUP,
    AI_GROUP,
    DEV_GROUP,
    STREAMING_GROUP,
    FALLBACK_GROUP,
  ];
  const nodeGroups = [MANUAL_GROUP, proxyGroup];
  const excludedFromNodeGroups = new Set([TAILSCALE_GROUP, ...nodeGroups]);
  const orderedBusiness = businessGroups.filter((name) => !excludedFromNodeGroups.has(name));

  const tailscaleProxies = [TAILSCALE_GROUP_PLACEHOLDER];

  const lines = [];
  const push = (...items) => lines.push(...items);

  push(
    `  - name: ${q(MANUAL_GROUP)}
    type: select
    include-all: true
    exclude-filter: ${q(NODE_EXCLUDE_PATTERN)}`,
    `  - name: ${q(proxyGroup)}
    type: url-test
    url: ${q(TEST_URL)}
    interval: 300
    tolerance: 50
    include-all: true
    exclude-filter: ${q(NODE_EXCLUDE_PATTERN)}`,
    `  - name: ${q(TAILSCALE_GROUP)}
    type: select
    proxies: ${tailscaleProxies.join(", ")}
    default-selected: ${TAILSCALE_DEFAULT_PLACEHOLDER}`
  );

  for (const name of orderedBusiness) {
    // 广告/成人内容默认 REJECT，其余默认走自动选择。
    if (name === AD_BLOCK_GROUP || name === ADULT_GROUP) {
      push(`  - name: ${q(name)}
    type: select
    proxies: [REJECT, DIRECT]
    default-selected: REJECT`);
      continue;
    }
    if (name === FALLBACK_GROUP) {
      push(`  - name: ${q(name)}
    type: select
    proxies: [DIRECT, ${q(proxyGroup)}, ${q(MANUAL_GROUP)}]
    default-selected: DIRECT`);
      continue;
    }
    if (name === AI_GROUP) {
      push(`  - name: ${q(name)}
    type: url-test
    url: ${q(AI_TEST_URL)}
    expected-status: 200
    interval: 90
    timeout: 5000
    tolerance: 50
    lazy: false
    include-all: true
    filter: ${q(AI_REGION_PATTERN)}
    exclude-filter: ${q(AI_EXCLUDE_PATTERN)}`);
      continue;
    }
    if (name === DOMESTIC_GROUP) {
      push(`  - name: ${q(name)}
    type: select
    proxies: [DIRECT, ${q(proxyGroup)}, ${q(MANUAL_GROUP)}]
    default-selected: DIRECT`);
      continue;
    }
    push(`  - name: ${q(name)}
    type: select
    proxies: [DIRECT, ${q(proxyGroup)}, ${q(MANUAL_GROUP)}]
    default-selected: ${q(proxyGroup)}`);
  }

  return lines.join("\n");
};

const buildRules = (sourceProviders) => {
  const lines = [
    "  - IP-CIDR,100.64.0.0/10,Tailscale,no-resolve",
    "  - IP-CIDR,100.100.100.100/32,Tailscale,no-resolve",
    "  - DOMAIN-SUFFIX,ts.net,Tailscale",
  ];
  for (const provider of sourceProviders) {
    const suffix = provider.no_resolve ? ",no-resolve" : "";
    lines.push(`  - RULE-SET,${provider.name},${provider.target}${suffix}`);
  }
  lines.push(`  - MATCH,${FALLBACK_GROUP}`);
  return lines.join("\n");
};

const buildDns = (fakeIpFilter) =>
  [
    "  enable: true",
    "  enhanced-mode: fake-ip",
    "  fake-ip-range: 198.18.0.1/16",
    "  nameserver:",
    "    - https://223.5.5.5/dns-query",
    "    - https://1.12.12.12/dns-query",
    "  fake-ip-filter:",
    ...fakeIpFilter.map((entry) => `    - ${q(entry)}`),
  ].join("\n");

export const renderProfile = (source, subscriptionsJson) => {
  if (!source.release_base_url) throw new Error("sources.json is missing release_base_url");
  if (!Array.isArray(source.providers) || source.providers.length === 0) {
    throw new Error("sources.json is missing providers");
  }

  const fakeIpFilter = Array.isArray(source.fake_ip_filter) ? source.fake_ip_filter : [];
  const proxyGroup = source.proxy_group;
  if (typeof proxyGroup !== "string" || !proxyGroup.trim()) throw new Error("sources.json is missing proxy_group");
  const { providers: subscriptions, staticProxyLines } = parseSubscriptionConfig(subscriptionsJson, proxyGroup);

  // Tailscale 占位符放在列表末尾，由 Worker 按 ?ts= 参数替换成真实节点或删除。
  const proxyLines = [...staticProxyLines, TAILSCALE_PROXIES_PLACEHOLDER];

  const sections = [];

  sections.push(
    [
      "# Generated by scripts/render-flclash-profile.mjs; do not edit.",
      "# 由 GitHub Actions 生成并推送到 Cloudflare KV；本地请勿提交到仓库。",
      "",
      "mixed-port: 7890",
      "allow-lan: false",
      "mode: rule",
      "log-level: info",
      "ipv6: true",
    ].join("\n")
  );

  sections.push(`proxy-providers:\n${buildProxyProviders(subscriptions)}`);

  if (proxyLines.length > 0) {
    sections.push(`proxies:\n${proxyLines.join("\n")}`);
  }

  sections.push(`rule-providers:\n${buildRuleProviders(source.providers, source.release_base_url)}`);
  sections.push(`proxy-groups:\n${buildGroups(proxyGroup)}`);
  sections.push(`rules:\n${buildRules(source.providers)}`);
  if (fakeIpFilter.length > 0) sections.push(`dns:\n${buildDns(fakeIpFilter)}`);

  const profile = `${sections.join("\n\n")}\n`;

  // 自检：关键段落必须存在，避免把坏配置推上线。
  for (const marker of ["proxy-providers:", "rule-providers:", "proxy-groups:", "rules:", "MATCH,"]) {
    if (!profile.includes(marker)) throw new Error(`Generated profile is missing ${marker}`);
  }
  const ruleProviderCount = (profile.match(/^    type: http$/gm) || []).length;
  if (ruleProviderCount === 0) throw new Error("Generated profile has no http providers");

  // Validate the actual template through the same four injection paths used by
  // the Worker. This is entirely local and never uses a real Tailscale key.
  for (const mode of ["off", "interface", "tsnet", "both"]) {
    const result = injectTailscale(profile, new URL(`https://example.test/?ts=${mode}&tskey=tskey-auth-FAKE_VALIDATION_ONLY`), {});
    if (!result.body) throw new Error(`Generated profile has invalid Tailscale template (${mode})`);
    try {
      const config = Bun.YAML.parse(result.body);
      if (!config || !Array.isArray(config.proxies) || !Array.isArray(config["proxy-groups"]) || !Array.isArray(config.rules)) {
        throw new Error("Invalid configuration shape");
      }
    } catch {
      throw new Error(`Generated profile is not valid YAML (${mode})`);
    }
  }
  return profile;
};

const main = async () => {
  const { output } = parseArguments(process.argv.slice(2));
  const source = JSON.parse(await fs.readFile(SOURCE_CONFIG_PATH, "utf8"));
  const profile = renderProfile(source, process.env.SUBSCRIPTIONS_JSON);
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, profile, "utf8");
    process.stderr.write(`Wrote ${output} (${Buffer.byteLength(profile)} bytes, tailscale: injected by worker)\n`);
    return;
  }
  process.stdout.write(profile);
};

if (import.meta.main) main().catch((error) => {
  process.stderr.write(`render-flclash-profile: ${error.message}\n`);
  process.exit(1);
});
