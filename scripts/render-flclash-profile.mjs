#!/usr/bin/env node
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
 * Tailscale 出口（可选，两者可同时配置）：
 *   TAILSCALE_INTERFACE  桌面端：生成 TAILSCALE-DIRECT 节点，绑定系统 Tailscale 网卡
 *   TAILSCALE_AUTH_KEY   Android：生成 type: tailscale 的内嵌节点（FlClash 单 VPN 槽位时使用）
 *   都不配置时 Tailscale 组只含 DIRECT。
 *
 * 输出：stdout 或 --output 指定文件。
 *
 * 只依赖 Node 内置能力，Bun / Node 均可运行。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SOURCE_CONFIG_PATH = path.join(ROOT_DIR, "sources.json");

const TEST_URL = "https://cp.cloudflare.com/generate_204";
const AI_TEST_URL = "https://chatgpt.com/";

const TAILSCALE_GROUP = "Tailscale";
const TAILSCALE_NODE = "TAILSCALE";
const TAILSCALE_DIRECT_NODE = "TAILSCALE-DIRECT";
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

/** Tailscale 可选配置：接口名直连（桌面端）或 tsnet 内嵌节点（Android）。 */
const readTailscaleConfig = () => ({
  interfaceName: (process.env.TAILSCALE_INTERFACE || "").trim(),
  authKey: (process.env.TAILSCALE_AUTH_KEY || "").trim(),
});

const buildTailscaleProxies = ({ interfaceName, authKey }) => {
  const lines = [];
  if (interfaceName) {
    lines.push(
      `  - name: ${q(TAILSCALE_DIRECT_NODE)}`,
      "    type: direct",
      `    interface-name: ${q(interfaceName)}`
    );
  }
  if (authKey) {
    lines.push(
      `  - name: ${q(TAILSCALE_NODE)}`,
      "    type: tailscale",
      `    auth-key: ${q(authKey)}`,
      "    state-dir: ./tailscale",
      "    udp: true",
      "    accept-routes: true",
      "    ip-version: ipv4-prefer"
    );
  }
  return lines;
};

/** YAML 双引号标量；JSON 字符串转义是 YAML 双引号风格的安全子集。 */
const q = (value) => JSON.stringify(String(value));

const usage = () => {
  process.stdout.write(
    "Usage: node scripts/render-flclash-profile.mjs [--output FILE]\n\n" +
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
const parseSubscriptionConfig = () => {
  const raw = process.env.SUBSCRIPTIONS_JSON;
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
        const trimmed = line.trim().replace(/\r$/, "");
        if (/^proxies:\s*$/.test(trimmed)) continue;
        staticProxyLines.push(trimmed.startsWith("- ") ? `  ${trimmed}` : `  - ${trimmed}`);
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
      (provider) => `  ${provider.name}:
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
      return `  ${provider.name}:
    type: http
    behavior: ${behavior}
    format: ${format}
    interval: 86400
    url: ${q(`${releaseBaseUrl}/rules/${provider.name}.${extension}`)}
    path: ./rules/${provider.name}.${extension}`;
    })
    .join("\n");

const buildGroups = (proxyGroup, tailscale) => {
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

  const tailscaleProxies = [];
  if (tailscale.interfaceName) tailscaleProxies.push(TAILSCALE_DIRECT_NODE);
  if (tailscale.authKey) tailscaleProxies.push(TAILSCALE_NODE);
  tailscaleProxies.push("DIRECT");
  const tailscaleDefault = tailscaleProxies[0];

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
    proxies: [${tailscaleProxies.join(", ")}]
    default-selected: ${tailscaleDefault}`
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

const main = async () => {
  const { output } = parseArguments(process.argv.slice(2));

  const source = JSON.parse(await fs.readFile(SOURCE_CONFIG_PATH, "utf8"));
  if (!source.release_base_url) throw new Error("sources.json is missing release_base_url");
  if (!Array.isArray(source.providers) || source.providers.length === 0) {
    throw new Error("sources.json is missing providers");
  }

  const { providers: subscriptions, staticProxyLines } = parseSubscriptionConfig();
  const fakeIpFilter = Array.isArray(source.fake_ip_filter) ? source.fake_ip_filter : [];
  const proxyGroup = source.proxy_group;
  if (!proxyGroup) throw new Error("sources.json is missing proxy_group");

  const tailscale = readTailscaleConfig();
  const tailscaleProxyLines = buildTailscaleProxies(tailscale);
  const proxyLines = [...tailscaleProxyLines, ...staticProxyLines];

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
  sections.push(`proxy-groups:\n${buildGroups(proxyGroup, tailscale)}`);
  sections.push(`rules:\n${buildRules(source.providers)}`);
  if (fakeIpFilter.length > 0) sections.push(`dns:\n${buildDns(fakeIpFilter)}`);

  const profile = `${sections.join("\n\n")}\n`;

  // 自检：关键段落必须存在，避免把坏配置推上线。
  for (const marker of ["proxy-providers:", "rule-providers:", "proxy-groups:", "rules:", "MATCH,"]) {
    if (!profile.includes(marker)) throw new Error(`Generated profile is missing ${marker}`);
  }
  const ruleProviderCount = (profile.match(/^    type: http$/gm) || []).length;
  if (ruleProviderCount === 0) throw new Error("Generated profile has no http providers");

  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, profile, "utf8");
    const tailscaleSummary =
      [tailscale.interfaceName ? `interface=${tailscale.interfaceName}` : null,
       tailscale.authKey ? "tsnet=on" : null].filter(Boolean).join(", ") || "none";
    process.stderr.write(
      `Wrote ${output} (${Buffer.byteLength(profile)} bytes, ${subscriptions.length} providers, ` +
        `${staticProxyLines.length} static nodes, tailscale: ${tailscaleSummary})\n`
    );
    return;
  }
  process.stdout.write(profile);
};

main().catch((error) => {
  process.stderr.write(`render-flclash-profile: ${error.message}\n`);
  process.exit(1);
});
