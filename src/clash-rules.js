// ===========================
// VPN规则覆写脚本 V3.1
// ===========================

// ===========================
// 第一部分：自定义关键词和规则
// ======= 自定义关键词 =======
// 代理关键词
const proxyKeywords = [
    // "example", 示例，可以添加需要代理的关键词
  ];
  
  // 直连关键词
  const directKeywords = [
    //"example",  示例，可以添加需要直连的关键词
  ];
  
  // 拦截关键词
  const rejectKeywords = [
    //"example",  示例，可以添加需要拦截的关键词
  ];
  // ===========================
  // 自动生成规则
  const customRules = [
    // 代理关键词规则
    ...proxyKeywords.map((keywords) => `DOMAIN-KEYWORD,${keywords},节点选择`),
    // 直连关键词规则
    ...directKeywords.map((keywords) => `DOMAIN-KEYWORD,${keywords},DIRECT`),
    // 拦截关键词规则
    ...rejectKeywords.map((keywords) => `DOMAIN-KEYWORD,${keywords},REJECT`),
  
    // 其他预设规则
  ];
  
  // ======= 伪节点排除（订阅里的说明项，非真实代理） =======
  // 业界常见写法（subconverter 默认含 到期|剩余流量|时间|官网|产品），此处补全便于脚本与 exclude-filter 复用
  const fakeNodeKeywords =
    "套餐|剩余|到期|流量|官网|时间|产品|倍率|倍速|转发|过期|续费";

  const buildCodeBoundaryPattern = (codes) =>
    codes.map(
      (code) => `(?:^|[\\s\\-_|\\[\\]().])${code}(?:$|[\\s\\-_|\\[\\]().])`
    );

  const buildRegionKeywordGroup = (spec) => [
    ...buildCodeBoundaryPattern([...(spec.codes ?? []), ...(spec.airports ?? [])]),
    ...(spec.names ?? []),
    ...(spec.cities ?? []),
    ...(spec.aliases ?? []),
    ...(spec.emoji ?? []),
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
      .flatMap((key) => regionKeywordGroups[key] ?? [])
      .join("|");
    return `(?i)^(?!.*(${fakeNodeKeywords})).*(?:${regionPattern}).*$`;
  };

  const stableNodeFilters = {
    all: `^(?!.*(${fakeNodeKeywords})).*$`,
    claude: buildRegionFilter(["jp", "us", "sg"]),
    ai: buildRegionFilter(["jp", "us", "sg", "uk", "de"]),
  };

  const domesticResolvers = [
    "https://doh.pub/dns-query",
    "https://dns.alidns.com/dns-query",
  ];

  const remoteResolvers = [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/dns-query",
  ];

  // 代理节点自身域名解析优先使用直连可达的解析器，避免启动阶段依赖国外 DoH
  const proxyBootstrapResolvers = [
    "223.5.5.5",
    "119.29.29.29",
  ];

  // Mihomo Party 的配置检查会把 fake-ip-filter 当作规则条目解析，
  // 因此这里使用最基础的 DOMAIN / DOMAIN-SUFFIX / MATCH 语法，避免 RULE-SET 与通配符列表的兼容性问题。
  const tunFriendlyFakeIpFilter = [
    "DOMAIN-SUFFIX,lan,real-ip",
    "DOMAIN-SUFFIX,local,real-ip",
    "DOMAIN-SUFFIX,localhost,real-ip",
    "DOMAIN-SUFFIX,home.arpa,real-ip",
    "DOMAIN-SUFFIX,msftconnecttest.com,real-ip",
    "DOMAIN,localhost.ptlogin2.qq.com,real-ip",
    "DOMAIN-KEYWORD,stun,real-ip",
    "MATCH,fake-ip",
  ];
  
  // ===========================
  // 第二部分：规则集和代理组配置
  // ======= 自定义规则集 =======
  const customRuleSets = [
    // 拦截规则
    "RULE-SET,reject,全局拦截",
    "RULE-SET,BanEasyListChina,全局拦截",
    "RULE-SET,BanEasyList,全局拦截",
  
    // 局域网与私有地址
    "GEOIP,LAN,全局直连,no-resolve",
    "RULE-SET,private,全局直连",
    "RULE-SET,applications,全局直连",
    "RULE-SET,lancidr,全局直连,no-resolve",

    // AI服务规则
    "RULE-SET,claude,Claude",
    "RULE-SET,openai,AI",
    "RULE-SET,gemini,AI",
    "RULE-SET,cursor,AI",
    "RULE-SET,openrouter,AI",
    "RULE-SET,google-extra,节点选择",
  
    // 国内直连
    "RULE-SET,ChinaMedia,全局直连",
    "RULE-SET,ChinaDomain,全局直连",
    "RULE-SET,direct,全局直连",
    "RULE-SET,cncidr,全局直连,no-resolve",
    "GEOIP,CN,全局直连,no-resolve",
  
    // 通用服务代理规则
    "RULE-SET,OneDrive,节点选择",
    "RULE-SET,icloud,全局直连",
    "RULE-SET,apple,全局直连",
    "RULE-SET,GoogleCN,全局直连",
    "RULE-SET,google,节点选择",
    "RULE-SET,telegramcidr,节点选择,no-resolve",
  
    // 国外代理
    "RULE-SET,proxy,节点选择",
    "RULE-SET,gfw,节点选择",
    "RULE-SET,tld-not-cn,节点选择",
  
    // 兜底规则
    "MATCH,漏网之鱼",
  ];
  // ======== 配置代理组 ========
  // 规则源默认直接使用 GitHub Raw，避免额外维护多套 CDN 入口。
  const RAW_BASE = "https://raw.githubusercontent.com";
  const SELF_RULES_REPO = "yuanv4/clash-rules";
  const BOOTSTRAP_ICON_BASE = "https://icons.getbootstrap.com/assets/icons";
  
  // 规则集通用配置
  const ruleProviderCommon = {
    type: "http",
    format: "yaml",
    interval: 86400,
  };
  
  // 规则集提供者
  const ruleProviders = {
    // 拦截规则集
    reject: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/reject.txt`,
      path: "./ruleset/loyalsoldier/reject.yaml",
    },
    BanEasyListChina: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "text",
      url: `${RAW_BASE}/ACL4SSR/ACL4SSR/master/Clash/BanEasyListChina.list`,
      path: "./ruleset/acl4ssr/BanEasyListChina.yaml",
    },
    BanEasyList: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "text",
      url: `${RAW_BASE}/ACL4SSR/ACL4SSR/master/Clash/BanEasyList.list`,
      path: "./ruleset/acl4ssr/BanEasyList.yaml",
    },
    // 局域网与私有地址
    private: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/private.txt`,
      path: "./ruleset/loyalsoldier/private.yaml",
    },
    applications: {
      ...ruleProviderCommon,
      behavior: "classical",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/applications.txt`,
      path: "./ruleset/loyalsoldier/applications.yaml",
    },
    lancidr: {
      ...ruleProviderCommon,
      behavior: "ipcidr",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/lancidr.txt`,
      path: "./ruleset/loyalsoldier/lancidr.yaml",
    },
  
    // 自维护 AI 服务规则集
    claude: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/${SELF_RULES_REPO}/release/claude.txt`,
      path: "./ruleset/local/claude.yaml",
    },
    openai: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/${SELF_RULES_REPO}/release/openai.txt`,
      path: "./ruleset/local/openai.yaml",
    },
    gemini: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/${SELF_RULES_REPO}/release/gemini.txt`,
      path: "./ruleset/local/gemini.yaml",
    },
    cursor: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/${SELF_RULES_REPO}/release/cursor.txt`,
      path: "./ruleset/local/cursor.yaml",
    },
    "google-extra": {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/${SELF_RULES_REPO}/release/google-extra.txt`,
      path: "./ruleset/local/google-extra.yaml",
    },
    openrouter: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "yaml",
      url: `${RAW_BASE}/${SELF_RULES_REPO}/release/openrouter.txt`,
      path: "./ruleset/local/openrouter.yaml",
    },
  
    // 通用服务代理规则集
    OneDrive: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "text",
      url: `${RAW_BASE}/ACL4SSR/ACL4SSR/master/Clash/OneDrive.list`,
      path: "./ruleset/acl4ssr/OneDrive.yaml",
    },
    icloud: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/icloud.txt`,
      path: "./ruleset/loyalsoldier/icloud.yaml",
    },
    apple: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/apple.txt`,
      path: "./ruleset/loyalsoldier/apple.yaml",
    },
    GoogleCN: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "text",
      url: `${RAW_BASE}/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list`,
      path: "./ruleset/acl4ssr/GoogleCN.yaml",
    },
    google: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/google.txt`,
      path: "./ruleset/loyalsoldier/google.yaml",
    },
    telegramcidr: {
      ...ruleProviderCommon,
      behavior: "ipcidr",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/telegramcidr.txt`,
      path: "./ruleset/loyalsoldier/telegramcidr.yaml",
    },
    // 国内直连
    ChinaMedia: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "text",
      url: `${RAW_BASE}/ACL4SSR/ACL4SSR/master/Clash/ChinaMedia.list`,
      path: "./ruleset/acl4ssr/ChinaMedia.yaml",
    },
    ChinaDomain: {
      ...ruleProviderCommon,
      behavior: "classical",
      format: "text",
      url: `${RAW_BASE}/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list`,
      path: "./ruleset/acl4ssr/ChinaDomain.yaml",
    },
    direct: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/direct.txt`,
      path: "./ruleset/loyalsoldier/direct.yaml",
    },
  
    cncidr: {
      ...ruleProviderCommon,
      behavior: "ipcidr",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/cncidr.txt`,
      path: "./ruleset/loyalsoldier/cncidr.yaml",
    },
    // 国外代理
    proxy: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/proxy.txt`,
      path: "./ruleset/loyalsoldier/proxy.yaml",
    },
    gfw: {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/gfw.txt`,
      path: "./ruleset/loyalsoldier/gfw.yaml",
    },
    "tld-not-cn": {
      ...ruleProviderCommon,
      behavior: "domain",
      url: `${RAW_BASE}/Loyalsoldier/clash-rules/release/tld-not-cn.txt`,
      path: "./ruleset/loyalsoldier/tld-not-cn.yaml",
    },
  };
  
  // 最终规则列表
  const rules = [...customRules, ...customRuleSets];
  
  // ===========================
  // 第三部分：DNS配置
  // ===========================
  const dnsConfig = {
    enable: true,
    listen: "0.0.0.0:1053",
    ipv6: false,
    "use-system-hosts": true,
    "respect-rules": true,
    "cache-algorithm": "arc",
    
    "default-nameserver": [
      "223.5.5.5",
      "119.29.29.29",
    ],
    
    "proxy-server-nameserver": proxyBootstrapResolvers,
    
    // Fake-IP 配置
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "rule",
    "fake-ip-filter": tunFriendlyFakeIpFilter,
    
    "nameserver-policy": {    
      // Claude / Anthropic 相关域名强制走国外 DoH，避免认证/API 解析漂移
      "+.claude.ai": remoteResolvers,
      "+.claude.com": remoteResolvers,
      "+.anthropic.com": remoteResolvers,
      "+.openrouter.ai": remoteResolvers,
      "+.cursor.com": remoteResolvers,
      "+.cursor.sh": remoteResolvers,
      "+.update.googleapis.com": remoteResolvers,
      "+.googleapis.cn": remoteResolvers,
      "+.googleapis.com": remoteResolvers,
      "+.gstatic.com": remoteResolvers,
      "+.github.io": remoteResolvers,

      // 中国域名用国内DNS
      "geosite:cn": domesticResolvers,
      
      // 国外域名用国外DNS
      "geosite:geolocation-!cn": remoteResolvers,
    },
    
    // 主DNS（会被 nameserver-policy 覆盖）
    nameserver: domesticResolvers,
    
    // 备用DNS
    fallback: remoteResolvers,
    
    // 防污染过滤
    "fallback-filter": {
      "geoip": true,
      "geoip-code": "CN",
      "ipcidr": ["240.0.0.0/4", "0.0.0.0/8"],
      "domain": [
        "+.claude.ai",
        "+.anthropic.com",
        "+.openrouter.ai",
        "+.cursor.com",
        "+.cursor.sh",
        "+.google.com",
        "+.youtube.com",
        "+.github.com",
      ],
    },
  };
  // ===========================
  // 第四部分：主函数
  // ===========================
  // 程序入口
  function main(config) {
    // 验证配置
    if (!config) {
      throw new Error("配置对象为空");
    }
  
    const proxyCount = config?.proxies?.length ?? 0;
    const proxyProviderCount = config?.["proxy-providers"]
      ? Object.keys(config["proxy-providers"]).length
      : 0;
  
    if (proxyCount === 0 && proxyProviderCount === 0) {
      throw new Error("配置文件中未找到任何代理节点");
    }
  
    // 从源头剔除伪节点（名称匹配说明项的条目），所有策略组共用过滤后的列表，无需每组单独写排除
    const fakeNodePattern = new RegExp(fakeNodeKeywords, "i");
    if (Array.isArray(config.proxies)) {
      config.proxies = config.proxies.filter(
        (p) => p && p.name && !fakeNodePattern.test(p.name)
      );
    }
  
    // 覆盖DNS配置
    config.dns = dnsConfig;

    // 嗅探用于在 TUN/Fake-IP 下把连接重新关联回域名，减少按 IP 误判造成的 TLS 失败。
    const snifferDefaults = {
      enable: true,
      "force-dns-mapping": true,
      "parse-pure-ip": true,
      "override-destination": false,
      sniff: {
        HTTP: {
          ports: [80, 8080, "8081-8880"],
          "override-destination": true,
        },
        TLS: {
          ports: [443, 8443],
          "override-destination": true,
        },
        QUIC: {
          ports: [443, 8443],
          "override-destination": true,
        },
      },
    };

    const currentSniffer = config.sniffer ?? {};
    config.sniffer = {
      ...snifferDefaults,
      ...currentSniffer,
      sniff: {
        ...snifferDefaults.sniff,
        ...(currentSniffer.sniff ?? {}),
        HTTP: {
          ...snifferDefaults.sniff.HTTP,
          ...(currentSniffer.sniff?.HTTP ?? {}),
        },
        TLS: {
          ...snifferDefaults.sniff.TLS,
          ...(currentSniffer.sniff?.TLS ?? {}),
        },
        QUIC: {
          ...snifferDefaults.sniff.QUIC,
          ...(currentSniffer.sniff?.QUIC ?? {}),
        },
      },
    };

    // 只在已有 tun 配置时注入稳妥默认值，避免脚本替用户强行切换运行模式。
    if (config.tun && typeof config.tun === "object") {
      const tunDefaults = {
        enable: true,
        stack: "mixed",
        "auto-route": true,
        "auto-detect-interface": true,
        "strict-route": true,
        "dns-hijack": ["any:53", "tcp://any:53"],
      };

      const currentTun = config.tun;
      config.tun = {
        ...tunDefaults,
        ...currentTun,
        "dns-hijack": currentTun["dns-hijack"] ?? tunDefaults["dns-hijack"],
      };
    }
  
    const selectGroupBaseOption = {
      hidden: false,
    };

    const probeGroupBaseOption = {
      ...selectGroupBaseOption,
      interval: 300,
      timeout: 5000,
      // Mihomo 官方更推荐使用稳定的 HTTPS 探测地址，避免旧 HTTP 地址频繁超时
      // url: "https://www.gstatic.com/generate_204",
      url: "https://cp.cloudflare.com",
      "expected-status": 204,
      lazy: true,
      "max-failed-times": 3,
    };

    const groupIcons = {
      manual: `${BOOTSTRAP_ICON_BASE}/sliders.svg`,
      proxy: `${BOOTSTRAP_ICON_BASE}/send-arrow-up.svg`,
      latency: `${BOOTSTRAP_ICON_BASE}/speedometer.svg`,
      claude: `${BOOTSTRAP_ICON_BASE}/claude.svg`,
      ai: `${BOOTSTRAP_ICON_BASE}/openai.svg`,
      direct: `${BOOTSTRAP_ICON_BASE}/plug.svg`,
      reject: `${BOOTSTRAP_ICON_BASE}/shield-slash.svg`,
      fallback: `${BOOTSTRAP_ICON_BASE}/question-circle.svg`,
    };
  
    // 覆盖代理组配置
    config["proxy-groups"] = [
      {
        ...selectGroupBaseOption,
        name: "节点选择",
        type: "select",
        "include-all": true,
        filter: stableNodeFilters.all,
        proxies: ["延迟选优", "DIRECT"],
        icon: groupIcons.proxy,
      },
      {
        ...probeGroupBaseOption,
        name: "延迟选优",
        type: "url-test",
        tolerance: 150,
        "include-all": true,
        filter: stableNodeFilters.all,
        icon: groupIcons.latency,
      },
      {
        ...selectGroupBaseOption,
        name: "Claude",
        type: "select",
        "include-all": true,
        filter: stableNodeFilters.claude,
        icon: groupIcons.claude,
      },
      {
        ...selectGroupBaseOption,
        name: "AI",
        type: "select",
        "include-all": true,
        filter: stableNodeFilters.ai,
        icon: groupIcons.ai,
      },
      {
        ...selectGroupBaseOption,
        name: "全局直连",
        type: "select",
        proxies: ["DIRECT", "节点选择", "延迟选优"],
        icon: groupIcons.direct,
      },
      {
        ...selectGroupBaseOption,
        name: "全局拦截",
        type: "select",
        proxies: ["REJECT"],
        icon: groupIcons.reject,
      },
      {
        ...selectGroupBaseOption,
        name: "漏网之鱼",
        type: "select",
        proxies: ["节点选择", "延迟选优", "DIRECT"],
        icon: groupIcons.fallback,
      },
    ];
  
    // 覆盖规则配置
    config["rule-providers"] = ruleProviders;
    config.rules = rules;
  
    // 返回修改后的配置
    return config;
  }
  
  // Node.js 环境支持
  if (typeof module !== "undefined" && module.exports) {
    module.exports = main;
  }
  
