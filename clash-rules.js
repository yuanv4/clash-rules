// ===========================
// VPN规则覆写脚本 V3.1
// ===========================

// ===========================
// 第一部分：分流组与节点筛选
// ===========================
const groupNames = {
  claude: "🧠 Claude",
  ai: "🤖 AI",
};

// 地区筛选数据在构建阶段从独立文件注入，最终发布产物仍保持单文件。
const regionSpecs = ({
  jp: {
    codes: ["JP", "JPN"],
    airports: ["TYO", "NRT", "HND", "KIX"],
    names: ["日本", "Japan"],
    cities: ["东京", "大阪", "Tokyo", "Osaka"],
    emoji: ["🇯🇵"],
  },
  us: {
    codes: ["US", "USA"],
    airports: ["NYC", "JFK", "LAX", "SFO", "SJC", "SEA", "ORD", "DFW", "LAS", "PHX"],
    names: ["美国", "美國", "United[\\s_-]*States", "America"],
    cities: [
      "Washington",
      "Seattle",
      "San[\\s_-]*Jose",
      "SanJose",
      "Los[\\s_-]*Angeles",
      "LosAngeles",
      "Phoenix",
      "Dallas",
      "Chicago",
    ],
    aliases: ["Silicon[\\s_-]*Valley", "SiliconValley"],
    emoji: ["🇺🇸"],
  },
  sg: {
    codes: ["SG", "SGP"],
    airports: ["SIN"],
    names: ["新加坡", "狮城", "獅城", "Singapore"],
    emoji: ["🇸🇬"],
  },
  uk: {
    codes: ["UK", "GB", "GBR"],
    airports: ["LON", "LHR", "LGW", "MAN"],
    names: ["英国", "英國", "United[\\s_-]*Kingdom", "Britain"],
    cities: ["London", "Manchester", "Birmingham", "伦敦", "倫敦", "曼彻斯特", "曼徹斯特", "伯明翰"],
    emoji: ["🇬🇧"],
  },
  de: {
    codes: ["DE", "DEU"],
    airports: ["FRA", "MUC", "BER"],
    names: ["德国", "德國", "Germany"],
    cities: ["Frankfurt", "Berlin", "Munich", "法兰克福", "法蘭克福", "柏林", "慕尼黑"],
    emoji: ["🇩🇪"],
  },
});

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
const RAW_BASE = "https://raw.githubusercontent.com";

const ruleProviders = {
  claude: {
    type: "http",
    behavior: "classical",
    format: "yaml",
    interval: 86400,
    url: `${RAW_BASE}/yuanv4/clash-rules/release/claude.yaml`,
    path: "./ruleset/local/claude.yaml",
  },
  ai: {
    type: "http",
    behavior: "classical",
    format: "yaml",
    interval: 86400,
    url: `${RAW_BASE}/yuanv4/clash-rules/release/ai.yaml`,
    path: "./ruleset/local/ai.yaml",
  },
};

const incrementalRules = [
  `RULE-SET,claude,${groupNames.claude}`,
  `RULE-SET,ai,${groupNames.ai}`,
];

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

  const makeGroup = (name, filter) => {
    const matcher = new RegExp(filter.replace(/^\(\?i\)/, ""), "i");
    const candidates = [...new Set(proxyNames.filter((n) => matcher.test(n)))];
    return {
      name,
      type: "fallback",
      hidden: false,
      url: "https://cp.cloudflare.com/",
      interval: 300,
      "expected-status": 204,
      ...(candidates.length > 0 && { proxies: candidates }),
      ...(providerNames.length > 0 && { use: providerNames }),
      filter,
    };
  };

  config["proxy-groups"] = appendProxyGroups(
    Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [],
    [
      makeGroup(groupNames.claude, claudeFilter),
      makeGroup(groupNames.ai, aiFilter),
    ]
  );

  config["rule-providers"] = mergeRuleProviders(config["rule-providers"], ruleProviders);
  config.rules = prependMissingRules(
    Array.isArray(config.rules) ? config.rules : [],
    incrementalRules
  );

  return config;
}

// Node.js 环境支持
if (typeof module !== "undefined" && module.exports) {
  module.exports = main;
}

