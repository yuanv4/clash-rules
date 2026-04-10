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

  const buildCodeBoundaryPattern = (codes) =>
    codes.map(
      (code) => `(?:^|[\\s\\-_|\\[\\]().])${code}(?:$|[\\s\\-_|\\[\\]().])`
    );

  const buildRegionKeywordGroup = (spec) => [
    ...buildCodeBoundaryPattern([...(spec.codes || []), ...(spec.airports || [])]),
    ...(spec.names || []),
    ...(spec.cities || []),
    ...(spec.aliases || []),
    ...(spec.emoji || []),
  ];

  // 地区筛选数据在构建阶段从独立文件注入，最终发布产物仍保持单文件。
  const regionSpecs = __REGION_SPECS__;

  const regionKeywordGroups = Object.fromEntries(
    Object.entries(regionSpecs).map(([key, spec]) => [
      key,
      buildRegionKeywordGroup(spec),
    ])
  );

  const buildRegionFilter = (groupKeys) => {
    const regionPattern = groupKeys
      .flatMap((key) => regionKeywordGroups[key] || [])
      .join("|");
    return `(?i)^.*(?:${regionPattern}).*$`;
  };

  const stableNodeFilters = {
    claude: buildRegionFilter(["jp"]),
    ai: buildRegionFilter(["jp", "sg", "us"]),
  };

  const buildNodeMatcher = (filter) => {
    const normalized = filter.replace(/^\(\?i\)/, "");
    return new RegExp(normalized, "i");
  };

  const uniqueValues = (items) => [...new Set(items.filter(Boolean))];

  const appendProxyGroups = (existingGroups, additions) => [
    ...existingGroups,
    ...additions.filter(
      (group) =>
        !existingGroups.some(
          (existingGroup) => existingGroup && existingGroup.name === group.name
        )
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

  // 规则集通用配置
  const ruleProviderCommon = {
    type: "http",
    format: "yaml",
    interval: 86400,
  };
  
  // 规则集提供者
  const ruleProviders = {
    claude: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/yuanv4/clash-rules/release/claude.txt`,
      path: "./ruleset/local/claude.yaml",
    },
    ai: {
      ...ruleProviderCommon,
      behavior: "domain",
      format: "mrs",
      url: "https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/ai.mrs",
      path: "./ruleset/dustinwin/ai.mrs",
    },
  };
  
  const incrementalRules = [
    `RULE-SET,claude,${groupNames.claude}`,
    `RULE-SET,ai,${groupNames.ai}`,
  ];
  
  // ===========================
  // 第三部分：主函数
  // ===========================
  // 程序入口
  function main(config) {
    // 验证配置
    if (!config) {
      throw new Error("配置对象为空");
    }
  
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

    const fallbackGroupHealthCheck = {
      hidden: false,
      url: "https://cp.cloudflare.com/",
      interval: 300,
      "expected-status": 204,
    };

    const existingProxyGroups = Array.isArray(config["proxy-groups"])
      ? config["proxy-groups"]
      : [];
    const proxyNames = Array.isArray(config.proxies)
      ? config.proxies.map((proxy) => proxy && proxy.name).filter(Boolean)
      : [];
    const claudeMatcher = buildNodeMatcher(stableNodeFilters.claude);
    const aiMatcher = buildNodeMatcher(stableNodeFilters.ai);
    const claudeCandidates = proxyNames.filter((name) => claudeMatcher.test(name));
    const aiCandidates = proxyNames.filter((name) => aiMatcher.test(name));

    const additionalProxyGroups = [
      {
        ...fallbackGroupHealthCheck,
        name: groupNames.claude,
        type: "fallback",
        proxies: uniqueValues(claudeCandidates),
      },
      {
        ...fallbackGroupHealthCheck,
        name: groupNames.ai,
        type: "fallback",
        proxies: uniqueValues(aiCandidates),
      },
    ];

    config["proxy-groups"] = appendProxyGroups(
      existingProxyGroups,
      additionalProxyGroups
    );

    config["rule-providers"] = mergeRuleProviders(
      config["rule-providers"],
      ruleProviders
    );
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
  
