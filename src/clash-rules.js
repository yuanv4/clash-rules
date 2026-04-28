// ===========================
// VPN规则覆写脚本 V4.0
// ===========================

// ===========================
// 第一部分：分流组与节点筛选
// ===========================
const groupNames = {
  select: "🚀 节点选择",
  auto: "♻️ 自动选择",
  telegram: "📲 Telegram",
  streaming: "🎬 流媒体",
  apple: "🍎 Apple",
  microsoft: "Ⓜ️ Microsoft",
  global: "🌍 国外网站",
  fallback: "🐟 漏网之鱼",
  claude: "🧠 Claude",
  ai: "🤖 AI",
  cloudflare: "☁️ Cloudflare",
};

const DEFAULT_COMMUNITY_RULE_BASE = "https://ruleset.skk.moe/Clash";
const DEFAULT_LOCAL_RULE_BASE = "https://raw.githubusercontent.com/yuanv4/clash-rules/release";
const CLOUDFLARE_RULE_URL = "https://rules.kr328.app/cloudflare.yaml";
const HEALTH_CHECK_URL = "https://cp.cloudflare.com/";

// 地区筛选数据在构建阶段从独立文件注入，最终发布产物仍保持单文件。
const regionSpecs = __REGION_SPECS__;

const buildRegionFilter = (groupKeys) => {
  const pattern = groupKeys.flatMap((key) => {
    const spec = regionSpecs[key] || {};
    const bounded = [...(spec.codes || []), ...(spec.airports || [])].map(
      (code) => `(?:^|[\\s\\-_|\\[\\]().])${code}(?:$|[\\s\\-_|\\[\\]().])`
    );
    return [...bounded, ...(spec.names || []), ...(spec.cities || []), ...(spec.aliases || []), ...(spec.emoji || [])];
  }).join("|");
  return `(?i)^.*(?:${pattern}).*$`;
};

const claudeFilter = buildRegionFilter(["jp"]);
const aiFilter = buildRegionFilter(["jp", "sg", "us"]);

const appendProxyGroups = (existingGroups, additions) => [
  ...existingGroups,
  ...additions.filter(
    (group) => !existingGroups.some((g) => g && g.name === group.name)
  ),
];

const prependMissingRules = (existingRules, additions) => [
  ...additions.filter((rule) => !existingRules.includes(rule)),
  ...existingRules,
];

const mergeRuleProviders = (existingProviders, additions) => ({
  ...(existingProviders || {}),
  ...Object.fromEntries(
    Object.entries(additions).filter(
      ([name]) => !Object.prototype.hasOwnProperty.call(existingProviders || {}, name)
    )
  ),
});

// ===========================
// 第二部分：规则集提供者
// ===========================
const getScriptArguments = () =>
  typeof $arguments === "object" && $arguments ? $arguments : {};

const trimTrailingSlash = (value) => `${value || ""}`.replace(/\/+$/, "");

const getProviderUrl = (base, file) => `${trimTrailingSlash(base)}/${file}`;
const getSukkaProviderUrl = (base, kind, file) => getProviderUrl(base, `${kind}/${file}`);

const makeHttpProvider = (name, url, behavior = "classical", format = "yaml") => ({
  type: "http",
  behavior,
  format,
  interval: 86400,
  url,
  path: `./ruleset/${name}.${format === "text" ? "txt" : "yaml"}`,
});

const makeSukkaProvider = (name, kind, file, behavior = "classical") => {
  const args = getScriptArguments();
  return makeHttpProvider(
    `community/${name}`,
    getSukkaProviderUrl(args.communityBase || DEFAULT_COMMUNITY_RULE_BASE, kind, file),
    behavior,
    "text"
  );
};

const buildRuleProviders = () => {
  const args = getScriptArguments();
  const localBase = args.localBase || DEFAULT_LOCAL_RULE_BASE;

  return {
    claude: makeHttpProvider("local/claude", getProviderUrl(localBase, "claude.yaml")),
    cloudflare: makeHttpProvider("community/cloudflare", CLOUDFLARE_RULE_URL),
    lan_non_ip: makeSukkaProvider("lan_non_ip", "non_ip", "lan.txt"),
    lan_ip: makeSukkaProvider("lan_ip", "ip", "lan.txt"),
    reject_non_ip: makeSukkaProvider("reject_non_ip", "non_ip", "reject.txt"),
    reject_ip: makeSukkaProvider("reject_ip", "ip", "reject.txt"),
    ai_non_ip: makeSukkaProvider("ai_non_ip", "non_ip", "ai.txt"),
    apple_intelligence_non_ip: makeSukkaProvider("apple_intelligence_non_ip", "non_ip", "apple_intelligence.txt"),
    telegram_non_ip: makeSukkaProvider("telegram_non_ip", "non_ip", "telegram.txt"),
    telegram_ip: makeSukkaProvider("telegram_ip", "ip", "telegram.txt"),
    stream_non_ip: makeSukkaProvider("stream_non_ip", "non_ip", "stream.txt"),
    stream_ip: makeSukkaProvider("stream_ip", "ip", "stream.txt"),
    apple_cdn: makeSukkaProvider("apple_cdn", "non_ip", "apple_cdn.txt"),
    apple_services: makeSukkaProvider("apple_services", "non_ip", "apple_services.txt"),
    microsoft_cdn: makeSukkaProvider("microsoft_cdn", "non_ip", "microsoft_cdn.txt"),
    microsoft_services: makeSukkaProvider("microsoft_services", "non_ip", "microsoft.txt"),
    domestic_non_ip: makeSukkaProvider("domestic_non_ip", "non_ip", "domestic.txt"),
    direct_non_ip: makeSukkaProvider("direct_non_ip", "non_ip", "direct.txt"),
    global_non_ip: makeSukkaProvider("global_non_ip", "non_ip", "global.txt"),
    domestic_ip: makeSukkaProvider("domestic_ip", "ip", "domestic.txt"),
  };
};

const incrementalRules = [
  `RULE-SET,claude,${groupNames.claude}`,
  `RULE-SET,cloudflare,${groupNames.cloudflare}`,
];

const communityRules = [
  "RULE-SET,lan_non_ip,DIRECT",
  "RULE-SET,lan_ip,DIRECT,no-resolve",
  "RULE-SET,reject_non_ip,REJECT",
  "RULE-SET,reject_ip,REJECT,no-resolve",
  `RULE-SET,ai_non_ip,${groupNames.ai}`,
  `RULE-SET,apple_intelligence_non_ip,${groupNames.ai}`,
  `RULE-SET,telegram_non_ip,${groupNames.telegram}`,
  `RULE-SET,telegram_ip,${groupNames.telegram},no-resolve`,
  `RULE-SET,stream_non_ip,${groupNames.streaming}`,
  `RULE-SET,stream_ip,${groupNames.streaming},no-resolve`,
  `RULE-SET,apple_cdn,${groupNames.apple}`,
  `RULE-SET,apple_services,${groupNames.apple}`,
  `RULE-SET,microsoft_cdn,${groupNames.microsoft}`,
  `RULE-SET,microsoft_services,${groupNames.microsoft}`,
  "RULE-SET,domestic_non_ip,DIRECT",
  "RULE-SET,direct_non_ip,DIRECT",
  `RULE-SET,global_non_ip,${groupNames.global}`,
  "RULE-SET,domestic_ip,DIRECT,no-resolve",
  "GEOIP,CN,DIRECT",
  `MATCH,${groupNames.fallback}`,
];

const compactUnique = (items) => [...new Set(items.filter(Boolean))];

// ===========================
// 第三部分：主函数
// ===========================
function main(config) {
  if (!config) throw new Error("配置对象为空");

  const proxyCount = (config.proxies && config.proxies.length) || 0;
  const proxyProviderCount = config["proxy-providers"]
    ? Object.keys(config["proxy-providers"]).length
    : 0;

  if (proxyCount === 0 && proxyProviderCount === 0) {
    throw new Error("配置文件中未找到任何代理节点");
  }

  if (Array.isArray(config.proxies)) {
    config.proxies = config.proxies.filter((p) => p && p.name);
  }

  const proxyNames = Array.isArray(config.proxies)
    ? config.proxies.map((p) => p.name)
    : [];
  const providerNames = config["proxy-providers"]
    ? Object.keys(config["proxy-providers"])
    : [];
  const hasLocalProxies = proxyNames.length > 0;
  const hasProxyProviders = providerNames.length > 0;
  const selectableProxies = compactUnique([
    groupNames.auto,
    "DIRECT",
    ...proxyNames,
  ]);

  const withProxySources = (group, fallbackProxies = proxyNames) => ({
    ...group,
    ...(hasLocalProxies && { proxies: compactUnique(fallbackProxies) }),
    ...(hasProxyProviders && { use: providerNames }),
  });

  const makeGroup = (name, filter) => {
    const matcher = new RegExp(filter.replace(/^\(\?i\)/, ""), "i");
    const candidates = [...new Set(proxyNames.filter((n) => matcher.test(n)))];
    return withProxySources({
      name,
      type: "fallback",
      hidden: false,
      url: HEALTH_CHECK_URL,
      interval: 300,
      "expected-status": 204,
      filter,
    }, candidates.length > 0 ? candidates : proxyNames);
  };

  config["proxy-groups"] = appendProxyGroups(
    Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [],
    [
      withProxySources({
        name: groupNames.select,
        type: "select",
      }, selectableProxies),
      withProxySources({
        name: groupNames.auto,
        type: "url-test",
        url: HEALTH_CHECK_URL,
        interval: 300,
        tolerance: 50,
      }),
      withProxySources({
        name: groupNames.telegram,
        type: "select",
      }, selectableProxies),
      withProxySources({
        name: groupNames.streaming,
        type: "select",
      }, selectableProxies),
      withProxySources({
        name: groupNames.apple,
        type: "select",
      }, ["DIRECT", groupNames.select, groupNames.auto, ...proxyNames]),
      withProxySources({
        name: groupNames.microsoft,
        type: "select",
      }, ["DIRECT", groupNames.select, groupNames.auto, ...proxyNames]),
      withProxySources({
        name: groupNames.global,
        type: "select",
      }, selectableProxies),
      withProxySources({
        name: groupNames.cloudflare,
        type: "select",
      }, ["DIRECT", groupNames.select, groupNames.auto, ...proxyNames]),
      makeGroup(groupNames.claude, claudeFilter),
      makeGroup(groupNames.ai, aiFilter),
      withProxySources({
        name: groupNames.fallback,
        type: "select",
      }, selectableProxies),
    ]
  );

  config["rule-providers"] = mergeRuleProviders(config["rule-providers"], buildRuleProviders());
  config.rules = prependMissingRules(
    Array.isArray(config.rules) ? config.rules : [],
    [...incrementalRules, ...communityRules]
  );

  return config;
}

// Node.js 环境支持
if (typeof module !== "undefined" && module.exports) {
  module.exports = main;
}
