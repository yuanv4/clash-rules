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
  fallback: "🐟 漏网之鱼",
  claude: "🧠 Claude",
  ai: "🤖 AI",
};

const DEFAULT_COMMUNITY_RULE_BASE = "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release";
const DEFAULT_LOCAL_RULE_BASE = "https://raw.githubusercontent.com/yuanv4/clash-rules/release";
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

const makeHttpProvider = (name, url, behavior = "classical") => ({
  type: "http",
  behavior,
  format: "yaml",
  interval: 86400,
  url,
  path: `./ruleset/${name}.yaml`,
});

const buildRuleProviders = () => {
  const args = getScriptArguments();
  const communityBase = args.communityBase || DEFAULT_COMMUNITY_RULE_BASE;
  const localBase = args.localBase || DEFAULT_LOCAL_RULE_BASE;

  return {
    claude: makeHttpProvider("local/claude", getProviderUrl(localBase, "claude.yaml")),
    ai: makeHttpProvider("local/ai", getProviderUrl(localBase, "ai.yaml")),
    applications: makeHttpProvider("community/applications", getProviderUrl(communityBase, "applications.txt")),
    private: makeHttpProvider("community/private", getProviderUrl(communityBase, "private.txt")),
    reject: makeHttpProvider("community/reject", getProviderUrl(communityBase, "reject.txt")),
    icloud: makeHttpProvider("community/icloud", getProviderUrl(communityBase, "icloud.txt")),
    apple: makeHttpProvider("community/apple", getProviderUrl(communityBase, "apple.txt")),
    google: makeHttpProvider("community/google", getProviderUrl(communityBase, "google.txt")),
    telegramcidr: makeHttpProvider("community/telegramcidr", getProviderUrl(communityBase, "telegramcidr.txt")),
    gfw: makeHttpProvider("community/gfw", getProviderUrl(communityBase, "gfw.txt")),
    greatfire: makeHttpProvider("community/greatfire", getProviderUrl(communityBase, "greatfire.txt")),
    "tld-not-cn": makeHttpProvider("community/tld-not-cn", getProviderUrl(communityBase, "tld-not-cn.txt")),
    direct: makeHttpProvider("community/direct", getProviderUrl(communityBase, "direct.txt")),
    cncidr: makeHttpProvider("community/cncidr", getProviderUrl(communityBase, "cncidr.txt")),
    lancidr: makeHttpProvider("community/lancidr", getProviderUrl(communityBase, "lancidr.txt")),
  };
};

const incrementalRules = [
  `RULE-SET,claude,${groupNames.claude}`,
  `RULE-SET,ai,${groupNames.ai}`,
];

const communityRules = [
  "RULE-SET,applications,DIRECT",
  "RULE-SET,private,DIRECT",
  "RULE-SET,reject,REJECT",
  "RULE-SET,icloud,DIRECT",
  "RULE-SET,apple,DIRECT",
  `RULE-SET,google,${groupNames.select}`,
  `RULE-SET,telegramcidr,${groupNames.telegram},no-resolve`,
  `RULE-SET,gfw,${groupNames.select}`,
  `RULE-SET,greatfire,${groupNames.select}`,
  `RULE-SET,tld-not-cn,${groupNames.select}`,
  "RULE-SET,direct,DIRECT",
  "RULE-SET,cncidr,DIRECT,no-resolve",
  "RULE-SET,lancidr,DIRECT,no-resolve",
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
